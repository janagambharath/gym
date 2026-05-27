from __future__ import annotations

import logging
import os

from flask import Flask

from app.extensions import scheduler
from app.models import Gym
from app.services.reminder_service import run_due_reminders_for_gym


_logger = logging.getLogger(__name__)
_LOCK_KEY = "renewaldesk:scheduler_lock"


def _lock_ttl(app: Flask) -> int:
    return max((app.config["REMINDER_JOB_MINUTES"] * 60 * 2), 300)


def _acquire_redis_lock(redis_url: str, ttl: int) -> bool:
    try:
        import redis as _redis

        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        return bool(r.set(_LOCK_KEY, os.getpid(), nx=True, ex=ttl))
    except Exception as exc:
        _logger.warning("Could not acquire Redis scheduler lock: %s", exc)
        return False


def _refresh_redis_lock(redis_url: str, ttl: int) -> None:
    try:
        import redis as _redis

        r = _redis.from_url(redis_url, socket_connect_timeout=2)
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
        replace_existing=True,
    )
    _logger.info("Scheduler configured with Redis lock on pid=%s", os.getpid())
    return True


def _scheduled_reminder_job(app: Flask) -> None:
    with app.app_context():
        redis_url = app.config.get("REDIS_URL", "memory://")
        if redis_url != "memory://":
            _refresh_redis_lock(redis_url, _lock_ttl(app))

        app.logger.info("Running scheduled reminder scan")
        active_gyms = Gym.query.filter_by(status="active").all()
        for gym in active_gyms:
            try:
                result = run_due_reminders_for_gym(
                    gym.id,
                    app.config["REMINDER_DAYS_BEFORE"],
                    gym.timezone or "Asia/Kolkata",
                )
                app.logger.info("Reminder scan for gym %s: %s", gym.id, result)
            except Exception:
                from app.extensions import db

                db.session.rollback()
                app.logger.exception("Reminder scan failed for gym %s", gym.id)
