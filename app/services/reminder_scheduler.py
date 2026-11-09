from __future__ import annotations

import logging
import os
import json
import uuid
from datetime import datetime

from flask import Flask

from app.extensions import scheduler
from app.models import Gym
from app.services.payment_service import apply_due_scheduled_renewals
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
        # V7-L4: prune expired idempotency replay rows (24h TTL) on the
        # same cadence as the reminder scan. Best-effort — a prune
        # failure must never block reminders.
        try:
            from app.services.idempotency_service import (
                prune_expired_idempotency_keys,
            )

            pruned = prune_expired_idempotency_keys()
            if pruned:
                db.session.commit()
                app.logger.info(
                    "Pruned %s expired idempotency row(s)", pruned
                )
        except Exception:
            db.session.rollback()
            app.logger.exception("Idempotency prune failed (non-fatal)")
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

            try:
                activated_count = apply_due_scheduled_renewals(gym)
                if activated_count:
                    db.session.commit()
                    app.logger.info(
                        "Activated %s scheduled renewals for gym %s",
                        activated_count,
                        gym.id,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception("Scheduled renewal activation failed for gym %s", gym.id)

            # V7-M7: reset stale INSIDE members. Entry-only gyms never
            # exit-scan, so without this the Inside list accumulates
            # phantom members indefinitely. This is the job that actually
            # runs in production (daily, REMINDER_JOB_MINUTES); the
            # flask run-reminders CLI was previously the only caller and
            # nothing schedules it.
            try:
                from app.services.access_event_service import (
                    auto_reset_stale_inside_members,
                    backfill_missing_bridge_projections,
                )

                reset_count = auto_reset_stale_inside_members(
                    gym.id, gym.timezone or "Asia/Kolkata"
                )
                if reset_count:
                    db.session.commit()
                    app.logger.info(
                        "Auto-exited %s stale INSIDE members for gym %s",
                        reset_count,
                        gym.id,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception("Stale-inside reset failed for gym %s", gym.id)

            # V7-L16: re-project bridge punches whose AccessEvent
            # projection threw at ingest. Without this a transient
            # failure loses the feed row, the count and the INSIDE flip
            # permanently (_backfill_bridge_punch only runs for unmapped
            # rows). Scoped to the last 7 days, per-row contained.
            try:
                from app.services.access_event_service import (
                    backfill_missing_bridge_projections as _backfill_bridge,
                )

                backfilled = _backfill_bridge(gym.id)
                if backfilled:
                    db.session.commit()
                    app.logger.info(
                        "Backfilled %s bridge punch projections for gym %s",
                        backfilled,
                        gym.id,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception(
                    "Bridge projection backfill failed for gym %s", gym.id
                )

            # V8-M8: mirror of the bridge backfill above, for direct-ADMS
            # (RRR) punches whose projection threw at ingest. The ATTLOG
            # ack is preserved on projection failure and the terminal
            # never re-sends, so without this sweep the punch stays
            # unprojected forever (visible in the feed leg, but no INSIDE
            # flip, no member-app last_visit/today_entries, no Retain
            # nudge). Same shape: last 7 days, per-row contained.
            try:
                from app.services.access_event_service import (
                    backfill_missing_rrr_projections as _backfill_rrr,
                )

                backfilled = _backfill_rrr(gym.id)
                if backfilled:
                    db.session.commit()
                    app.logger.info(
                        "Backfilled %s RRR punch projections for gym %s",
                        backfilled,
                        gym.id,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception(
                    "RRR projection backfill failed for gym %s", gym.id
                )

            # V11-H3: reconcile failed door commands (blocks AND unblocks)
            # for both ADMS and bridge gyms. Shared with the `flask
            # run-reminders` CLI via
            # app.services.bridge_service.reconcile_failed_membership_commands
            # — the block-only inline scans used to live here, and the CLI
            # had no reconcile at all, so in the CLI-cron deployment shape
            # even failed blocks never self-healed. A renewed member whose
            # unblock failed once is now re-driven by the active-member
            # unblock scan (guarded by member_is_proven_enableable; an
            # expired/paused/deleted member is never unblocked).
            try:
                from app.services.bridge_service import (
                    reconcile_failed_membership_commands,
                )

                counts = reconcile_failed_membership_commands(gym)
                if any(counts.values()):
                    db.session.commit()
                    app.logger.info(
                        "Re-queued failed door commands for gym %s: %s",
                        gym.id, counts,
                    )
            except Exception:
                db.session.rollback()
                app.logger.exception(
                    "Door-command reconciliation failed for gym %s", gym.id
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
            # Heartbeat: prove we are alive so the short-TTL lock survives
            # long runs but expires quickly if this worker dies. Continue to
            # the messaging jobs below; a per-gym auto-link sweep is disabled.
            _refresh_redis_lock(redis_url, _lock_ttl(app))

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
