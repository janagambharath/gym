"""Authentication and authorisation middleware for the mobile API."""
from __future__ import annotations

from functools import wraps

from flask import g, request

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.token_service import decode_access_token
from app.models.user import User
from app.services.timezone_service import today_for_gym


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
    status = (gym.subscription_status or "trial").lower()
    if status in ("active", "pending", "grace_period"):
        return False
    if status == "trial":
        if gym.trial_ends_at is None:
            return False  # No trial end date set yet — treat as active trial
        # V10-L4: gym-local today, not server-local — in the 00:00–05:30
        # IST window the server date is a day behind, so a trial that
        # ended yesterday (gym-local) kept API access for ~5.5 hours.
        return gym.trial_ends_at < today_for_gym(gym.timezone or "Asia/Kolkata")
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
        # V8-L4: a token minted before the last password change or
        # logout-all carries a stale "ver" and is rejected here, even
        # though its 15-minute HMAC expiry has not passed. Tokens
        # minted before this version existed carry no "ver" at all and
        # are rejected too (fail-closed); clients holding a refresh
        # token recover via /auth/refresh, which mints a current one.
        if payload.get("role") in ("gym_owner", "staff", "super_admin"):
            if payload.get("ver") != (user.token_version or 1):
                return error_response(
                    "TOKEN_EXPIRED",
                    "Access token was revoked (password changed or signed out everywhere). Sign in again.",
                    401,
                )
        # SECURITY (2026-10-13): member and owner tokens share the same secret
        # and format, and members.id / users.id both autoincrement from 1, so
        # numeric collisions are guaranteed. Without a role check, a member's
        # valid token authenticates as whichever User shares their numeric ID.
        # Owner endpoints must reject member tokens outright.
        if payload.get("role") not in ("gym_owner", "staff", "super_admin"):
            return error_response("FORBIDDEN", "Insufficient role for this endpoint.", 403)
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
            # W-M2 (2026-11-10): connect-waba is deliberately NOT exempt
            # — a trial-expired gym must not connect paid WhatsApp — but
            # the 403 has to say so in words the page can display.
            # Every other endpoint keeps the generic message.
            if request.path.endswith("/whatsapp/connect-waba"):
                message = (
                    "Your free trial has ended — upgrade to connect WhatsApp."
                )
            else:
                message = (
                    "Your free trial has ended. Please upgrade to a paid plan "
                    "to continue using Renewal Desk."
                )
            return error_response(
                "SUBSCRIPTION_REQUIRED",
                message,
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

