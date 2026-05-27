from __future__ import annotations

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.extensions import db
from app.models import User
from app.services.audit_service import audit
from app.utils.decorators import active_gym_required, roles_required


staff_bp = Blueprint("staff", __name__, url_prefix="/app/staff")

_INVITE_SALT = "staff-invite"
_INVITE_MAX_AGE = 48 * 3600


def _invite_serializer() -> URLSafeTimedSerializer:
    from flask import current_app

    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_INVITE_SALT)


@staff_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner")
def index():
    users = User.query.filter_by(gym_id=current_user.gym_id).order_by(User.created_at.desc()).all()
    return render_template("gym/staff.html", users=users)


@staff_bp.post("/invite")
@login_required
@active_gym_required
@roles_required("gym_owner")
def invite():
    email = request.form.get("email", "").strip().lower()
    if not email:
        flash("Email is required.", "danger")
        return redirect(url_for("staff.index"))

    existing = User.query.filter_by(email=email).first()
    if existing:
        flash("An account with this email already exists.", "danger")
        return redirect(url_for("staff.index"))

    token = _invite_serializer().dumps(
        {
            "email": email,
            "gym_id": current_user.gym_id,
            "invited_by": current_user.id,
        }
    )
    invite_url = url_for("staff.accept_invite", token=token, _external=True)
    audit(action="invite_staff", resource_type="user", metadata={"invited_email": email})
    db.session.commit()
    flash(f"Invite link: {invite_url}", "info")
    return redirect(url_for("staff.index"))


@staff_bp.route("/accept/<token>", methods=["GET", "POST"])
def accept_invite(token: str):
    if current_user.is_authenticated:
        flash("Sign out before accepting a staff invite.", "warning")
        return redirect(url_for("admin.dashboard" if current_user.is_super_admin else "gym.dashboard"))

    try:
        payload = _invite_serializer().loads(token, max_age=_INVITE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        flash("This invite link is invalid or has expired.", "danger")
        return redirect(url_for("auth.login"))

    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        password = request.form.get("password", "")
        if not full_name or len(password) < 10:
            flash("Name and password (min 10 chars) are required.", "danger")
            return render_template("gym/accept_invite.html", email=payload["email"])

        existing = User.query.filter_by(email=payload["email"]).first()
        if existing:
            flash("An account with this email already exists.", "danger")
            return redirect(url_for("auth.login"))

        user = User(
            gym_id=payload["gym_id"],
            email=payload["email"],
            full_name=full_name,
            role="staff",
            is_active=True,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.flush()
        audit(
            action="accept_staff_invite",
            resource_type="user",
            resource_id=user.id,
            gym_id=payload["gym_id"],
            actor_id=payload.get("invited_by"),
        )
        db.session.commit()
        flash("Account created. Sign in to continue.", "success")
        return redirect(url_for("auth.login"))

    return render_template("gym/accept_invite.html", email=payload["email"])


@staff_bp.post("/<int:user_id>/toggle")
@login_required
@active_gym_required
@roles_required("gym_owner")
def toggle_staff(user_id: int):
    user = User.query.filter_by(id=user_id, gym_id=current_user.gym_id).first_or_404()
    if user.id == current_user.id:
        flash("You cannot deactivate yourself.", "danger")
        return redirect(url_for("staff.index"))
    user.is_active = not user.is_active
    audit(action="toggle_staff", resource_type="user", resource_id=user.id)
    db.session.commit()
    flash(f"{user.full_name} is now {'active' if user.is_active else 'inactive'}.", "success")
    return redirect(url_for("staff.index"))
