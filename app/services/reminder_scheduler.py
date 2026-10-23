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
    # Short TTL, kept alive by heartbeat during the run. If the worker dies
    # mid-job the lock expires in minutes instead of 2x the job interval
    # (which starved all reminders/expiry for up to 48h).
    return 300


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
    if not isinstance(payload, dict):
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

            # Reconcile failed blocks: expired members whose block command
            # never acked (terminal offline, timeout, etc.) get re-queued.
            # Without this, a single failed block leaves the member with
            # terminal access indefinitely.
            try:
                from app.services.bridge_service import queue_membership_command
                from app.models import Member
                from app.models.rrr import RRRAdmsCommand, RRRIntegration
                from app.services.bridge_service import resolve_adms_enroll_number
                from app.services.timezone_service import today_for_gym

                integration = RRRIntegration.query.filter_by(
                    gym_id=gym.id, connector_type="adms_direct"
                ).first()
                if integration and integration.commands_enabled:
                    expired_linked = (
                        Member.query.filter(
                            Member.gym_id == gym.id,
                            Member.status == "expired",
                            Member.membership_end < today_for_gym(gym.timezone),
                            Member.deleted_at.is_(None),
                            Member.device_enroll_number.isnot(None),
                        ).all()
                    )
                    requeued = 0
                    for m in expired_linked:
                        try:
                            enroll = resolve_adms_enroll_number(m)
                        except ValueError:
                            continue
                        if not enroll:
                            continue
                        acked = RRRAdmsCommand.query.filter_by(
                            integration_id=integration.id,
                            action="block",
                            test_enroll_number=enroll,
                            status="acked",
                        ).first()
                        if not acked:
                            queue_membership_command(m, force=True)
                            requeued += 1
                    if requeued:
                        db.session.commit()
                        app.logger.info(
                            "Re-queued %s failed block commands for gym %s",
                            requeued, gym.id,
                        )
            except Exception:
                db.session.rollback()
                app.logger.exception("Block reconciliation failed for gym %s", gym.id)

            # Reconcile failed blocks for legacy TCP-bridge (.exe) gyms.
            # The branch above only covers adms_direct integrations, so a
            # bridge gym whose disable_user command burned through its
            # bounded retries stayed unblocked indefinitely (Yodha Fitness,
            # 2026-10-21: member expired 8 days, block never re-queued).
            # Same rule as ADMS: expired + linked + no acked block on
            # record -> re-queue. queue_membership_command dedupes
            # pending/leased commands, so repeat scans cannot flood.
            try:
                from app.models import Member
                from app.models.bridge import BridgeCommand
                from app.services.bridge_service import (
                    _active_installation,
                    desired_command_type,
                    queue_membership_command,
                )
                from app.services.timezone_service import today_for_gym

                installation = _active_installation(gym.id)
                if installation is not None:
                    expired_linked = (
                        Member.query.filter(
                            Member.gym_id == gym.id,
                            Member.status == "expired",
                            Member.membership_end < today_for_gym(gym.timezone),
                            Member.deleted_at.is_(None),
                            Member.device_enroll_number.is_not(None),
                        ).all()
                    )
                    changed = False
                    requeued = 0
                    for m in expired_linked:
                        if desired_command_type(m) != "disable_user":
                            continue
                        latest = (
                            BridgeCommand.query.filter_by(
                                bridge_id=installation.id, member_id=m.id
                            )
                            .order_by(
                                BridgeCommand.created_at.desc(),
                                BridgeCommand.id.desc(),
                            )
                            .first()
                        )
                        if (
                            latest is not None
                            and latest.status == "acked"
                            and latest.command_type == "disable_user"
                        ):
                            continue
                        if latest is None or latest.status == "failed":
                            requeued += 1
                        queue_membership_command(m, force=True)
                        changed = True
                    if changed:
                        db.session.commit()
                    if requeued:
                        app.logger.info(
                            "Re-queued %s failed bridge block commands for gym %s",
                            requeued,
                            gym.id,
                        )
            except Exception:
                db.session.rollback()
                app.logger.exception(
                    "Bridge block reconciliation failed for gym %s", gym.id
                )

            # Auto-link unmapped biometric IDs (fully automatic, no manual trigger)
            # First ensure we have a terminal user list (with names) to match against
            try:
                from app.services.enroll_match_service import get_adms_snapshot, get_terminal_snapshot
                from app.models.rrr import RRRIntegration, RRRAdmsCommand
                from app.models.bridge import BridgeCommand
                
                # NOTE (2026-10-14): auto sync_users disabled — proven on Elite Gym
                # hardware (X2008) that the terminal acks DATA QUERY USERINFO
                # but never uploads the user table. Queueing it daily just
                # piles up failed commands. Names are linked manually via
                # the Unmapped Punches screen instead.
            except Exception:
                db.session.rollback()
                pass
            
            # M2: scheduler auto-link REMOVED (2026-10-15). Auto-linking now
            # happens only from the OPERLOG enrollment trigger (fresh data,
            # right after the owner enrolls someone). The unsupervised
            # scheduler sweep risked wrong-person links at 90% similarity,
            # which could queue a block for the wrong terminal PIN.
            # Manual linking remains via Unmapped Punches / enroll-match UI.
            finally:
                # Heartbeat: prove we are alive so the short-TTL lock survives
                # long runs but expires quickly if this worker dies.
                _refresh_redis_lock(redis_url, _lock_ttl(app))
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
                # RRR retention nudges: we-miss-you, attendance drop, win-back
                try:
                    from app.services.retention_service import run_retention_nudges_for_gym
                    retention_result = run_retention_nudges_for_gym(
                        gym.id, gym.timezone or "Asia/Kolkata",
                    )
                    app.logger.info("Retention nudges for gym %s: %s", gym.id, retention_result)
                except Exception:
                    app.logger.exception("Retention nudges failed for gym %s", gym.id)
                try:
                    from app.services.push_notification_service import notify_expiring_members_daily
                    notify_expiring_members_daily(gym, result.get("sent", 0), expired_count)
                except Exception:
                    # Never swallow: a broken push pipeline must be visible.
                    app.logger.exception("Push notification failed for gym %s", gym.id)
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
