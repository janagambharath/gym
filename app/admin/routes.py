from __future__ import annotations

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import login_required
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import Gym, Member, PaymentVerification, ReminderLog, User
from app.services.audit_service import audit
from app.utils.decorators import roles_required


admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.route("/")
@login_required
@roles_required("super_admin")
def dashboard():
    stats = {
        "gyms": Gym.query.count(),
        "active_gyms": Gym.query.filter_by(status="active").count(),
        "members": Member.query.filter(Member.deleted_at.is_(None)).count(),
        "sent_reminders": ReminderLog.query.filter_by(status="sent").count(),
        "revenue_verified": PaymentVerification.query.with_entities(
            func.coalesce(func.sum(PaymentVerification.amount), 0)
        )
        .filter_by(status="verified")
        .scalar(),
    }
    recent_gyms = Gym.query.order_by(Gym.created_at.desc()).limit(8).all()
    failed_reminders = (
        ReminderLog.query.filter_by(status="failed")
        .options(joinedload(ReminderLog.member))
        .order_by(ReminderLog.created_at.desc())
        .limit(8)
        .all()
    )
    return render_template(
        "admin/dashboard.html",
        stats=stats,
        recent_gyms=recent_gyms,
        failed_reminders=failed_reminders,
    )


@admin_bp.route("/gyms")
@login_required
@roles_required("super_admin")
def gyms():
    page = request.args.get("page", 1, type=int)
    status = request.args.get("status", "")
    query = Gym.query
    if status:
        query = query.filter_by(status=status)
    pagination = query.order_by(Gym.created_at.desc()).paginate(
        page=page, per_page=20, error_out=False
    )
    return render_template("admin/gyms.html", pagination=pagination, status=status)


@admin_bp.post("/gyms/<int:gym_id>/toggle")
@login_required
@roles_required("super_admin")
def toggle_gym(gym_id: int):
    gym = Gym.query.get_or_404(gym_id)
    gym.status = "suspended" if gym.status == "active" else "active"
    audit(action="toggle_gym_status", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
    db.session.commit()
    flash(f"{gym.name} is now {gym.status}.", "success")
    return redirect(url_for("admin.gyms"))


@admin_bp.route("/gyms/<int:gym_id>")
@login_required
@roles_required("super_admin")
def gym_detail(gym_id: int):
    gym = Gym.query.get_or_404(gym_id)
    stats = {
        "users": User.query.filter_by(gym_id=gym.id).count(),
        "members": Member.query.filter_by(gym_id=gym.id).filter(Member.deleted_at.is_(None)).count(),
        "pending_payments": PaymentVerification.query.filter_by(gym_id=gym.id, status="pending").count(),
        "sent_reminders": ReminderLog.query.filter_by(gym_id=gym.id, status="sent").count(),
    }
    users = User.query.filter_by(gym_id=gym.id).order_by(User.created_at.desc()).all()
    return render_template("admin/gym_detail.html", gym=gym, stats=stats, users=users)
