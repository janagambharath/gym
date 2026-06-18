from __future__ import annotations

import logging
import os
import json
import uuid
from datetime import datetime

from flask import Flask

from app.extensions import scheduler
from app.models import Gym
from app.services.reminder_service import auto_expire_members_for_gym, run_due_reminders_for_gym


_logger = logging.getLogger(__name__)
_LOCK_KEY = "renewaldesk:scheduler_lock"
_GYM_BATCH_SIZE = 50
_LOCK_OWNER: str | None = None


def _lock_ttl(app: Flask) -> int:
    return max((app.config["REMINDER_JOB_MINUTES"] * 60 * 2), 300)


def _deployment_id() -> str:
    return (
        os.getenv("RAILWAY_DEPLOYMENT_ID")
        or os.getenv("RAILWAY_GIT_COMMIT_SHA")
        or os.getenv("GIT_COMMIT_SHA")
        or os.getenv("SOURCE_VERSION")
        or "local"
    )


def _lock_owner() -> str:
    global _LOCK_OWNER
    if _LOCK_OWNER is None:
        _LOCK_OWNER = json.dumps(
            {
                "deployment": _deployment_id(),
                "pid": os.getpid(),
                "token": uuid.uuid4().hex,
            },
            sort_keys=True,
        )
    return _LOCK_OWNER


def _lock_deployment(owner: bytes | str | None) -> str | None:
    if not owner:
        return None
    if isinstance(owner, bytes):
        owner = owner.decode("utf-8", errors="replace")
    try:
        payload = json.loads(owner)
    except json.JSONDecodeError:
        return None
    deployment = payload.get("deployment")
    return deployment if isinstance(deployment, str) else None


def _acquire_redis_lock(redis_url: str, ttl: int) -> bool:
    try:
        import redis as _redis

        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        owner = _lock_owner()
        if r.set(_LOCK_KEY, owner, nx=True, ex=ttl):
            return True

        current_owner = r.get(_LOCK_KEY)
        current_deployment = _lock_deployment(current_owner)
        if current_deployment == _deployment_id():
            return False

        with r.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(_LOCK_KEY)
                    watched_owner = pipe.get(_LOCK_KEY)
                    watched_deployment = _lock_deployment(watched_owner)
                    if watched_deployment == _deployment_id():
                        pipe.unwatch()
                        return False
                    pipe.multi()
                    pipe.set(_LOCK_KEY, owner, ex=ttl)
                    pipe.execute()
                    _logger.info(
                        "Replaced stale scheduler lock from deployment %s",
                        watched_deployment or "unknown",
                    )
                    return True
                except _redis.WatchError:
                    continue
    except Exception as exc:
        _logger.warning("Could not acquire Redis scheduler lock: %s", exc)
        return False


def _refresh_redis_lock(redis_url: str, ttl: int) -> None:
    try:
        import redis as _redis

        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        if r.get(_LOCK_KEY) == _lock_owner().encode("utf-8"):
            r.expire(_LOCK_KEY, ttl)
    except Exception:
        _logger.exception("Could not refresh Redis scheduler lock")


def configure_scheduler(app: Flask) -> bool:
    redis_url = app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        _logger.warning(
            "REDIS_URL not set; scheduler lock unavailable. Keep ENABLE_SCHEDULER=false "
            "on web workers and run reminders from a single cron service."
        )
        return False

    ttl = _lock_ttl(app)
    if not _acquire_redis_lock(redis_url, ttl):
        _logger.info("Scheduler lock held by another worker; skipping scheduler start.")
        return False

    job_id = "membership-renewal-reminders"
    if scheduler.get_job(job_id):
        return True

    scheduler.add_job(
        id=job_id,
        func=_scheduled_reminder_job,
        trigger="interval",
        minutes=app.config["REMINDER_JOB_MINUTES"],
        kwargs={"app": app},
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
        next_run_time=datetime.now(scheduler.timezone),
        replace_existing=True,
    )
    _logger.info("Scheduler configured with Redis lock on pid=%s", os.getpid())
    return True


def _iter_active_gyms():
    last_id = 0
    while True:
        batch = (
            Gym.query.filter_by(status="active")
            .filter(Gym.id > last_id)
            .order_by(Gym.id.asc())
            .limit(_GYM_BATCH_SIZE)
            .all()
        )
        if not batch:
            break
        for gym in batch:
            last_id = gym.id
            yield gym


def _scheduled_reminder_job(app: Flask) -> None:
    with app.app_context():
        from app.extensions import db

        redis_url = app.config.get("REDIS_URL", "memory://")
        if redis_url != "memory://":
            _refresh_redis_lock(redis_url, _lock_ttl(app))

        app.logger.info("Running scheduled reminder scan")
        for gym in _iter_active_gyms():
            try:
                expired_count = auto_expire_members_for_gym(gym)
                if expired_count:
                    db.session.commit()
                    app.logger.info(
                        "Auto-expired %s members for gym %s",
                        expired_count,
                        gym.id,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception("Auto-expiry failed for gym %s", gym.id)
                continue

            if not gym.whatsapp_enabled:
                db.session.expire_all()
                continue
            try:
                result = run_due_reminders_for_gym(
                    gym.id,
                    app.config["REMINDER_DAYS_BEFORE"],
                    gym.timezone or "Asia/Kolkata",
                )
                app.logger.info("Reminder scan for gym %s: %s", gym.id, result)
            except Exception as exc:
                db.session.rollback()
                app.logger.exception("Reminder scan failed for gym %s", gym.id)
                try:
                    import sentry_sdk

                    with sentry_sdk.push_scope() as scope:
                        scope.set_extra("gym_id", gym.id)
                        sentry_sdk.capture_exception(exc)
                except Exception:
                    pass
            finally:
                db.session.expire_all()
