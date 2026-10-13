from __future__ import annotations

from functools import wraps

from flask import abort, flash, redirect, request, url_for
from flask_login import current_user, logout_user

from app.mobile_api.middleware import _is_trial_expired


def roles_required(*roles: str):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for("auth.login", next=request.path))
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
        if not current_user.gym or not current_user.gym.is_operational():
            flash("This gym account is not active. Contact platform support.", "warning")
            logout_user()
            return redirect(url_for("auth.login"))
        # Trial expiry write lockdown (2026-10-13): mirror the mobile API.
        # Previously only the mobile API blocked writes on expired trials,
        # so an expired gym could keep mutating data through the web
        # dashboard. Reads stay allowed so the owner can reach upgrade screens.
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and _is_trial_expired(
            current_user.gym
        ):
            flash(
                "Your free trial has ended. Please upgrade to a paid plan to continue.",
                "warning",
            )
            return redirect(url_for("gym.dashboard"))
        return view(*args, **kwargs)

    return wrapped
