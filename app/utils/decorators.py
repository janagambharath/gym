from __future__ import annotations

from datetime import date
from functools import wraps

from flask import abort, flash, redirect, url_for
from flask_login import current_user, logout_user


def roles_required(*roles: str):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for("auth.login"))
            if current_user.role not in roles:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def active_gym_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for("auth.login"))
        if current_user.is_super_admin:
            return view(*args, **kwargs)
        if current_user.gym is None or not current_user.gym.is_operational():
            flash("This gym account is not active. Contact platform support.", "warning")
            logout_user()
            return redirect(url_for("auth.login"))
        if (
            current_user.gym.subscription_status == "trial"
            and current_user.gym.trial_ends_at
            and current_user.gym.trial_ends_at < date.today()
        ):
            flash(
                "Your 14-day free trial has ended. Contact support to upgrade your plan.",
                "warning",
            )
            logout_user()
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)

    return wrapped
