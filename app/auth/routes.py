from __future__ import annotations

import os
from datetime import date, timedelta
from urllib.parse import urljoin, urlparse

from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.forms import (
    ChangePasswordForm,
    ForgotPasswordForm,
    LoginForm,
    RegisterGymForm,
    ResetPasswordForm,
)
from app.models import Gym, MembershipPlan, NotificationTemplate, QRSettings, User
from app.services.audit_service import audit
from app.utils.helpers import slugify


auth_bp = Blueprint("auth", __name__, url_prefix="/auth")

_DUMMY_HASH = (
    "scrypt:32768:8:1$GQmmIBLE1bn1DV52"
    "$05eaf8274eb21937778541fcca673d6168266f7a21e8bfe7575777468dc7d164"
    "9fb81317f11fde3958d2d31d21667182acdc5266d74d33eedc2b7bbdfbd9db23"
)


def _is_safe_redirect(url: str | None) -> bool:
    if not url:
        return False
    ref = urlparse(urljoin(request.host_url, url))
    host = urlparse(request.host_url)
    return ref.scheme in {"http", "https"} and ref.netloc == host.netloc


@auth_bp.route("/login", methods=["GET", "POST"])
@limiter.limit("10 per minute; 60 per hour")
def login():
    if current_user.is_authenticated:
        return redirect(url_for("admin.dashboard" if current_user.is_super_admin else "gym.dashboard"))

    form = LoginForm()
    if form.validate_on_submit():
        submitted_email = form.email.data.lower().strip()
        default_admin_email = os.getenv("DEFAULT_ADMIN_EMAIL", "").lower().strip()
        default_admin_pass = os.getenv("DEFAULT_ADMIN_PASSWORD")

        # Bootstrap or sync super admin directly from environment variables on login
        if (
            default_admin_email
            and default_admin_pass
            and submitted_email == default_admin_email
            and form.password.data == default_admin_pass
        ):
            bootstrap_user = User.query.filter_by(email=default_admin_email).first()
            if not bootstrap_user:
                bootstrap_user = User(
                    email=default_admin_email,
                    full_name="Platform Admin",
                    role="super_admin",
                    is_active=True,
                )
                bootstrap_user.set_password(default_admin_pass)
                db.session.add(bootstrap_user)
            else:
                bootstrap_user.set_password(default_admin_pass)
                bootstrap_user.role = "super_admin"
                bootstrap_user.is_active = True
                bootstrap_user.failed_login_count = 0
                bootstrap_user.locked_until = None
            db.session.commit()

        user = User.query.filter_by(email=submitted_email).first()
        if user and user.is_locked():
            flash(
                "Account is temporarily locked due to too many failed attempts. "
                "Try again in 15 minutes.",
                "danger",
            )
            return render_template("auth/login.html", form=form)

        password_ok = (
            user.check_password(form.password.data)
            if user
            else check_password_hash(_DUMMY_HASH, form.password.data)
        )
        if not user or not password_ok:
            if user:
                user.record_failed_login()
            else:
                audit(
                    action="login_failed_unknown_email",
                    resource_type="user",
                    metadata={"attempted_email": form.email.data.lower().strip()},
                )
            db.session.commit()
            flash("Invalid email or password.", "danger")
            return render_template("auth/login.html", form=form)
        if not user.is_active:
            flash("This user account is inactive.", "warning")
            return render_template("auth/login.html", form=form)
        if not user.is_super_admin and (not user.gym or not user.gym.is_operational()):
            flash("This gym account is suspended. Contact platform support.", "warning")
            return render_template("auth/login.html", form=form)

        login_user(user, remember=form.remember.data)
        session.permanent = True
        user.reset_failed_logins()
        user.mark_login()
        audit(action="login", resource_type="user", resource_id=user.id, gym_id=user.gym_id)
        db.session.commit()

        next_url = request.args.get("next")
        if not _is_safe_redirect(next_url):
            next_url = None
        return redirect(next_url or url_for("admin.dashboard" if user.is_super_admin else "gym.dashboard"))

    return render_template("auth/login.html", form=form)


@auth_bp.route("/register", methods=["GET", "POST"])
@limiter.limit("30 per hour")
def register():
    if current_user.is_authenticated:
        return redirect(url_for("gym.dashboard"))

    form = RegisterGymForm()
    if form.validate_on_submit():
        slug_base = slugify(form.gym_name.data)
        slug = slug_base
        counter = 2
        while Gym.query.filter_by(slug=slug).first():
            slug = f"{slug_base}-{counter}"
            counter += 1

        gym = Gym(
            name=form.gym_name.data.strip(),
            slug=slug,
            email=form.email.data.lower().strip(),
            phone=form.phone.data.strip(),
            status="active",
            trial_ends_at=date.today() + timedelta(days=14),
            max_members=50,
        )
        db.session.add(gym)
        db.session.flush()

        owner = User(
            gym_id=gym.id,
            email=form.email.data.lower().strip(),
            full_name=form.owner_name.data.strip(),
            role="gym_owner",
        )
        owner.set_password(form.password.data)
        db.session.add(owner)
        db.session.add(MembershipPlan(gym_id=gym.id, name="Monthly", duration_days=30, price=0))
        db.session.add(QRSettings(gym_id=gym.id, payment_label=gym.name))
        db.session.add(
            NotificationTemplate(
                gym_id=gym.id,
                name="Default renewal reminder",
                days_before=3,
                message_body=(
                    "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
                    "{{ expiry_date }}. Please complete your renewal payment to keep access active."
                ),
            )
        )
        try:
            audit(action="register_gym", resource_type="gym", resource_id=gym.id, gym_id=gym.id)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            flash("An account with this email already exists.", "danger")
            return render_template("auth/register.html", form=form)

        flash("Gym account created. Sign in to continue.", "success")
        return redirect(url_for("auth.login"))

    return render_template("auth/register.html", form=form)


@auth_bp.route("/logout", methods=["POST"])
@login_required
def logout():
    audit(action="logout", resource_type="user", resource_id=current_user.id, gym_id=current_user.gym_id)
    db.session.commit()
    logout_user()
    flash("Signed out.", "info")
    return redirect(url_for("auth.login"))


@auth_bp.route("/change-password", methods=["GET", "POST"])
@login_required
def change_password():
    form = ChangePasswordForm()
    if form.validate_on_submit():
        if not current_user.check_password(form.current_password.data):
            flash("Current password is incorrect.", "danger")
            return render_template("auth/change_password.html", form=form)
        current_user.set_password(form.new_password.data)
        audit(action="change_password", resource_type="user", resource_id=current_user.id)
        db.session.commit()
        flash("Password changed successfully.", "success")
        if current_user.is_super_admin:
            return redirect(url_for("admin.dashboard"))
        return redirect(url_for("gym.dashboard"))
    return render_template("auth/change_password.html", form=form)


_RESET_SALT = "password-reset"
_RESET_MAX_AGE = 30 * 60  # 30 minutes


@auth_bp.route("/forgot-password", methods=["GET", "POST"])
@limiter.limit("5 per minute")
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for("auth.change_password"))
    form = ForgotPasswordForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data.lower().strip()).first()
        if user and user.is_active:
            serializer = URLSafeTimedSerializer(
                current_app.config["SECRET_KEY"], salt=_RESET_SALT
            )
            token = serializer.dumps({"user_id": user.id})
            reset_url = url_for("auth.reset_password", token=token, _external=True)
            current_app.logger.info(
                "Password reset link for %s: %s", user.email, reset_url
            )
            # TODO: Send via email or WhatsApp
        # Always show the same message to prevent email enumeration
        flash(
            "If an account with that email exists, a reset link has been generated. "
            "Check application logs or contact support.",
            "info",
        )
        return redirect(url_for("auth.login"))
    return render_template("auth/forgot_password.html", form=form)


@auth_bp.route("/reset-password/<token>", methods=["GET", "POST"])
@limiter.limit("10 per hour")
def reset_password(token: str):
    if current_user.is_authenticated:
        return redirect(url_for("auth.change_password"))
    serializer = URLSafeTimedSerializer(
        current_app.config["SECRET_KEY"], salt=_RESET_SALT
    )
    try:
        payload = serializer.loads(token, max_age=_RESET_MAX_AGE)
    except (BadSignature, SignatureExpired):
        flash("This reset link is invalid or has expired.", "danger")
        return redirect(url_for("auth.forgot_password"))
    user = db.session.get(User, payload.get("user_id"))
    if not user:
        flash("Invalid reset link.", "danger")
        return redirect(url_for("auth.forgot_password"))
    form = ResetPasswordForm()
    if form.validate_on_submit():
        user.set_password(form.new_password.data)
        user.reset_failed_logins()
        audit(action="password_reset", resource_type="user", resource_id=user.id)
        db.session.commit()
        flash("Password has been reset. Sign in with your new password.", "success")
        return redirect(url_for("auth.login"))
    return render_template("auth/reset_password.html", form=form)
