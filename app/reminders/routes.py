from __future__ import annotations

import threading
import uuid

from flask import Blueprint, current_app, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.orm import contains_eager

from app.extensions import db, limiter
from app.models import Member, ReminderLog
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.reminder_service import run_due_reminders_for_gym, send_reminder
from app.utils.decorators import active_gym_required, roles_required


reminders_bp = Blueprint("reminders", __name__, url_prefix="/reminders")
_scan_jobs: dict[str, dict] = {}


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
    gym_timezone = current_user.gym.timezone or "Asia/Kolkata"
    days_before = list(current_app.config["REMINDER_DAYS_BEFORE"])
    job_id = uuid.uuid4().hex
    app = current_app._get_current_object()

    def _background_scan() -> None:
        with app.app_context():
            try:
                result = run_due_reminders_for_gym(gym_id, days_before, gym_timezone)
                _scan_jobs[job_id] = {"status": "done", "result": result}
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
                _scan_jobs[job_id] = {"status": "error", "error": str(exc)}
                app.logger.exception("Manual reminder scan failed job=%s gym=%s", job_id, gym_id)

    _scan_jobs[job_id] = {"status": "running"}
    audit(
        action="run_reminders_now",
        resource_type="reminder_log",
        metadata={"job_id": job_id, "days_before": days_before},
    )
    db.session.commit()
    threading.Thread(target=_background_scan, daemon=True).start()

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
        send_reminder(log)
    except ValueError as exc:
        db.session.rollback()
        flash(str(exc), "warning")
        return redirect(url_for("reminders.index"))
    audit(action="resend_reminder", resource_type="reminder_log", resource_id=log.id)
    db.session.commit()
    flash("Reminder send attempted.", "success" if log.status == "sent" else "warning")
    return redirect(url_for("reminders.index"))
