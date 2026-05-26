from __future__ import annotations

from flask import Blueprint, current_app, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import ReminderLog
from app.repositories import TenantRepository
from app.services.audit_service import audit
from app.services.reminder_service import run_due_reminders_for_gym, send_reminder
from app.utils.decorators import active_gym_required, roles_required


reminders_bp = Blueprint("reminders", __name__, url_prefix="/reminders")


@reminders_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    status = request.args.get("status", "")
    page = request.args.get("page", 1, type=int)
    query = ReminderLog.query.filter_by(gym_id=current_user.gym_id)
    if status:
        query = query.filter_by(status=status)
    pagination = (
        query.options(joinedload(ReminderLog.member))
        .order_by(ReminderLog.created_at.desc())
        .paginate(page=page, per_page=20, error_out=False)
    )
    return render_template("reminders/index.html", pagination=pagination, status=status)


@reminders_bp.post("/run-now")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def run_now():
    result = run_due_reminders_for_gym(
        current_user.gym_id,
        current_app.config["REMINDER_DAYS_BEFORE"],
        current_user.gym.timezone or "Asia/Kolkata",
    )
    audit(action="run_reminders_now", resource_type="reminder_log", metadata=result)
    db.session.commit()
    flash(f"Reminder scan complete: {result}", "success")
    return redirect(url_for("reminders.index"))


@reminders_bp.post("/<int:reminder_id>/resend")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def resend(reminder_id: int):
    log = TenantRepository(ReminderLog, current_user.gym_id).get_or_404(reminder_id)
    if log.status == "sent":
        flash("This reminder has already been sent.", "info")
        return redirect(url_for("reminders.index"))
    send_reminder(log)
    audit(action="resend_reminder", resource_type="reminder_log", resource_id=log.id)
    db.session.commit()
    flash("Reminder send attempted.", "success" if log.status == "sent" else "warning")
    return redirect(url_for("reminders.index"))
