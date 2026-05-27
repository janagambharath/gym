from __future__ import annotations

from datetime import date, timedelta
from urllib.parse import urljoin, urlparse

from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash

from app.extensions import db, limiter
from app.forms import LoginForm, RegisterGymForm
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
        user = User.query.filter_by(email=form.email.data.lower().strip()).first()
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
@limiter.limit("5 per hour")
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
                    "{{ expiry_date }}. Please complete payment using the QR image."
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
