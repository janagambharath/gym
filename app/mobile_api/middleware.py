"""Authentication and authorisation middleware for the mobile API."""
from __future__ import annotations

from functools import wraps

from flask import g, request

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.token_service import decode_access_token
from app.models.user import User


# Paths that are always accessible regardless of subscription state.
# These allow the owner to view their subscription, complete an upgrade,
# or restore a purchase even after their trial has expired.
_SUBSCRIPTION_EXEMPT_PREFIXES = (
    "/api/mobile/v1/subscription/",
    "/api/mobile/v1/billing/",
    "/api/mobile/v1/health",
)


def _is_subscription_exempt() -> bool:
    """Return True if the current request path is exempt from trial lockdown."""
    path = request.path
    return any(path.startswith(prefix) for prefix in _SUBSCRIPTION_EXEMPT_PREFIXES)


def _is_trial_expired(gym) -> bool:
    """Return True when the gym's trial has expired and no paid subscription is active."""
    from datetime import date as dt_date

    status = (gym.subscription_status or "trial").lower()
    if status in ("active", "pending", "grace_period"):
        return False
    if status == "trial":
        if gym.trial_ends_at is None:
            return False  # No trial end date set yet — treat as active trial
        return gym.trial_ends_at < dt_date.today()
    # Expired, cancelled, payment_failed — all locked
    return True


def token_required(view):
    """Decorator that verifies the Bearer access token and populates g.current_user / g.gym_id."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return error_response("UNAUTHORIZED", "Missing or invalid Authorization header.", 401)

        token = auth_header[7:]
        payload = decode_access_token(token)
        if payload is None:
            return error_response("TOKEN_EXPIRED", "Access token is invalid or expired.", 401)

        user = db.session.get(User, payload.get("sub"))
        if user is None:
            return error_response("UNAUTHORIZED", "User not found.", 401)
        if not user.is_active:
            return error_response("ACCOUNT_DISABLED", "Account is disabled.", 403)
        if user.gym is None or not user.gym.is_operational():
            return error_response("GYM_INACTIVE", "Gym account is not active.", 403)

        g.current_user = user
        g.user_id = user.id
        g.gym_id = user.gym_id

        # Trial expiry write lockdown: block mutating requests when trial
        # has expired and no paid subscription is active.  GET (read-only)
        # requests are always allowed so the owner can still view data,
        # access the dashboard, and navigate to the subscription screen.
        if (
            request.method in ("POST", "PUT", "PATCH", "DELETE")
            and not _is_subscription_exempt()
            and _is_trial_expired(user.gym)
        ):
            return error_response(
                "SUBSCRIPTION_REQUIRED",
                "Your free trial has ended. Please upgrade to a paid plan to continue using Renewal Desk.",
                403,
            )

        return view(*args, **kwargs)

    return wrapped


def roles_required(*roles: str):
    """Decorator that checks the authenticated user's role (must be called after token_required)."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = getattr(g, "current_user", None)
            if user is None or user.role not in roles:
                return error_response("FORBIDDEN", "You do not have permission.", 403)
            return view(*args, **kwargs)

        return wrapped

    return decorator

