from __future__ import annotations

import json as _json
import threading
import uuid

from flask import Blueprint, current_app, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.orm import contains_eager

from app.extensions import db, limiter
from app.models import Member, QRSettings, ReminderLog
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.reminder_service import (
    create_manual_test_log,
    ensure_default_template,
    run_due_reminders_for_gym,
    send_reminder,
)
from app.utils.decorators import active_gym_required, roles_required


reminders_bp = Blueprint("reminders", __name__, url_prefix="/reminders")
_SCAN_JOB_TTL = 300


def _set_scan_job(job_id: str, payload: dict) -> None:
    redis_url = current_app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        return
    try:
        import redis as _redis

        redis_client = _redis.from_url(redis_url, socket_connect_timeout=2)
        redis_client.setex(f"scan_job:{job_id}", _SCAN_JOB_TTL, _json.dumps(payload))
    except Exception:
        current_app.logger.exception("Could not persist reminder scan job status")


def _format_scan_result(result: dict) -> tuple[str, str]:
    sent = result.get("sent", 0)
    failed = result.get("failed", 0)
    skipped = result.get("skipped", 0)
    category = "success" if failed == 0 else "warning"
    parts = [f"{sent} reminder{'s' if sent != 1 else ''} sent"]
    if skipped:
        parts.append(f"{skipped} already sent")
    if failed:
        parts.append(f"{failed} failed")
    return " / ".join(parts), category


@reminders_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    status = request.args.get("status", "")
    page = request.args.get("page", 1, type=int)
    query = (
        ReminderLog.query.join(ReminderLog.member)
        .filter(
            ReminderLog.gym_id == current_user.gym_id,
            Member.deleted_at.is_(None),
        )
        .options(contains_eager(ReminderLog.member))
    )
    if status:
        query = query.filter(ReminderLog.status == status)
    pagination = (
        query.order_by(ReminderLog.created_at.desc())
        .paginate(page=page, per_page=20, error_out=False)
    )
    return render_template("reminders/index.html", pagination=pagination, status=status)


@reminders_bp.post("/run-now")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
@limiter.limit("2 per minute")
def run_now():
    gym_id = current_user.gym_id
    if not current_user.gym.whatsapp_enabled or not current_user.gym.phone_number_id:
        flash("Connect and enable this gym's WhatsApp Business number first.", "warning")
        return redirect(url_for("gym.whatsapp_settings"))

    gym_timezone = current_user.gym.timezone or "Asia/Kolkata"
    days_before = list(current_app.config["REMINDER_DAYS_BEFORE"])
    job_id = uuid.uuid4().hex
    app = current_app._get_current_object()

    def _background_scan() -> None:
        with app.app_context():
            try:
                result = run_due_reminders_for_gym(gym_id, days_before, gym_timezone)
                _set_scan_job(job_id, {"status": "done", "result": result})
                message, category = _format_scan_result(result)
                app.logger.info(
                    "Manual reminder scan complete job=%s gym=%s category=%s result=%s",
                    job_id,
                    gym_id,
                    category,
                    message,
                )
            except Exception as exc:
                db.session.rollback()
                _set_scan_job(job_id, {"status": "error", "error": str(exc)})
                app.logger.exception("Manual reminder scan failed job=%s gym=%s", job_id, gym_id)

    _set_scan_job(job_id, {"status": "running"})
    audit(
        action="run_reminders_now",
        resource_type="reminder_log",
        metadata={"job_id": job_id, "days_before": days_before},
    )
    db.session.commit()
    threading.Thread(target=_background_scan, daemon=False).start()

    flash("Reminder scan started in background. Refresh in a moment.", "info")
    return redirect(url_for("reminders.index"))


@reminders_bp.post("/<int:reminder_id>/resend")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
@limiter.limit("5 per minute")
def resend(reminder_id: int):
    log = TenantRepository(ReminderLog, current_user.gym_id).get_or_404(reminder_id)
    if log.member.deleted_at is not None:
        flash("Cannot resend a reminder for a deleted member.", "warning")
        return redirect(url_for("reminders.index"))
    if log.status == "sent":
        flash("This reminder has already been sent.", "info")
        return redirect(url_for("reminders.index"))
    try:
        send_reminder(log, force=True)
    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), "warning")
        return redirect(url_for("reminders.index"))
    audit(action="resend_reminder", resource_type="reminder_log", resource_id=log.id)
    db.session.commit()
    flash("Reminder send attempted.", "success" if log.status == "sent" else "warning")
    return redirect(url_for("reminders.index"))


@reminders_bp.post("/members/<int:member_id>/send-test")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
@limiter.limit("5 per minute")
def send_test(member_id: int):
    member = TenantRepository(Member, current_user.gym_id).get_or_404(member_id)
    if member.deleted_at is not None:
        flash("Cannot send a test reminder to a deleted member.", "warning")
        return redirect(request.referrer or url_for("reminders.index"))
    if not member.whatsapp_opted_in:
        flash("This member has not opted in by messaging the gym's WhatsApp number.", "warning")
        return redirect(request.referrer or url_for("reminders.index"))
    if not current_user.gym.whatsapp_enabled or not current_user.gym.phone_number_id:
        flash("Connect and enable this gym's WhatsApp Business number first.", "warning")
        return redirect(url_for("gym.whatsapp_settings"))

    try:
        template = ensure_default_template(current_user.gym_id)
        log = create_manual_test_log(
            member,
            template,
            gym_timezone=current_user.gym.timezone or "Asia/Kolkata",
        )
        send_reminder(log, force=True)
        qr_active = bool(
            QRSettings.query.filter_by(gym_id=current_user.gym_id, is_active=True)
            .filter(
                (QRSettings.qr_public_url.isnot(None))
                | (QRSettings.qr_image_path.isnot(None))
            )
            .first()
        )
        audit(
            action="send_test_reminder",
            resource_type="reminder_log",
            resource_id=log.id,
            metadata={
                "member_id": member.id,
                "qr_active": qr_active,
            },
        )
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("Test reminder failed for member %s", member.id)
        flash(f"Test reminder failed: {str(exc)[:180]}", "warning")
        return redirect(request.referrer or url_for("reminders.index"))

    if log.status == "sent":
        flash(f"Test reminder sent to {member.full_name}.", "success")
    else:
        flash(f"Test reminder failed: {log.error_message or 'Unknown error'}", "warning")
    return redirect(request.referrer or url_for("reminders.index"))
