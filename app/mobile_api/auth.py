"""Mobile API authentication endpoints."""
from __future__ import annotations

from datetime import date, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import g, jsonify, request
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import token_required
from app.mobile_api.token_service import (
    create_access_token,
    create_refresh_token,
    revoke_all_user_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
)
from app.models import Gym, MembershipPlan, NotificationTemplate, QRSettings
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.models.user import User
from app.services.audit_service import audit
from app.services.mobile_billing_service import SUPPORTED_LOCALES, entitlement_for
from app.utils.helpers import slugify


def _mobile_auth_payload(user: User, access_token: str, refresh_token: str) -> dict:
    gym = user.gym
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
        },
        "gym": {
            "id": gym.id,
            "name": gym.name,
            "slug": gym.slug,
            "timezone": gym.timezone,
            "country": gym.country,
            "currency": gym.currency,
            "whatsapp_enabled": gym.whatsapp_enabled,
        },
    }


def _registration_error(data: dict) -> str | None:
    required = {
        "owner_name": "Owner name",
        "email": "Email",
        "phone": "Phone",
        "password": "Password",
        "gym_name": "Gym name",
        "country": "Country",
        "currency": "Currency",
        "timezone": "Timezone",
    }
    for key, label in required.items():
        if not isinstance(data.get(key), str) or not data[key].strip():
            return f"{label} is required."
    email = data["email"].strip().lower()
    if "@" not in email or len(email) > 255:
        return "Enter a valid email address."
    if len(data["owner_name"].strip()) > 160 or len(data["gym_name"].strip()) > 160:
        return "Owner and gym names must be 160 characters or fewer."
    phone = data["phone"].strip()
    if not phone.startswith("+") or not phone[1:].isdigit() or not 8 <= len(phone) <= 16:
        return "Phone must be in E.164 format, for example +919876543210."
    password = data["password"]
    if (
        len(password) < 12
        or not any(char.islower() for char in password)
        or not any(char.isupper() for char in password)
        or not any(char.isdigit() for char in password)
        or not any(not char.isalnum() for char in password)
    ):
        return "Password must be at least 12 characters and include upper, lower, number, and symbol."
    country = data["country"].strip().upper()
    currency = data["currency"].strip().upper()
    locale = SUPPORTED_LOCALES.get(country)
    if locale is None:
        return "Country is not currently supported."
    if locale["currency"] != currency:
        return "Currency must match the selected country."
    try:
        ZoneInfo(data["timezone"].strip())
    except ZoneInfoNotFoundError:
        return "Timezone is invalid."
    if data.get("terms_accepted") is not True:
        return "You must accept the terms to create an account."
    return None


def _normalize_registration_payload(data: dict) -> tuple[dict, bool]:
    """Accept the legacy signup payload while keeping one registration flow."""
    if "full_name" not in data:
        return data, False

    locales = {
        "India": ("IN", "INR", "Asia/Kolkata"),
        "UAE": ("AE", "AED", "Asia/Dubai"),
        "United States": ("US", "USD", "America/New_York"),
        "United Kingdom": ("GB", "GBP", "Europe/London"),
        "Australia": ("AU", "AUD", "Australia/Sydney"),
    }
    country_name = (data.get("country") or "India").strip()
    country, default_currency, default_timezone = locales.get(country_name, locales["India"])
    return {
        "owner_name": data.get("full_name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "password": data.get("password"),
        "gym_name": data.get("gym_name"),
        "country": country,
        "currency": data.get("currency") or default_currency,
        "timezone": data.get("timezone") or default_timezone,
        "terms_accepted": True,
    }, True


def register_auth_routes(bp):
    @bp.route("/auth/register", methods=["POST"])
    @limiter.limit("5 per hour")
    def register():
        """Create a gym owner with the same token/session shape as login."""
        data, legacy_signup = _normalize_registration_payload(request.get_json(silent=True) or {})
        validation_error = _registration_error(data)
        if validation_error:
            return error_response("VALIDATION_ERROR", validation_error, 400)

        email = data["email"].strip().lower()
        phone = data["phone"].strip()
        country = data["country"].strip().upper()
        currency = data["currency"].strip().upper()
        if User.query.filter_by(email=email).first() is not None:
            return error_response("DUPLICATE_EMAIL", "An account already exists for this email.", 409)
        if Gym.query.filter_by(phone=phone).first() is not None:
            return error_response("DUPLICATE_PHONE", "An account already exists for this phone number.", 409)

        slug_base = slugify(data["gym_name"].strip()) or "gym"
        slug = slug_base
        suffix = 2
        while Gym.query.filter_by(slug=slug).first() is not None:
            slug = f"{slug_base}-{suffix}"
            suffix += 1

        try:
            gym = Gym(
                name=data["gym_name"].strip(),
                slug=slug,
                email=email,
                phone=phone,
                timezone=data["timezone"].strip(),
                country=country,
                currency=currency,
                status="active",
                subscription_status="trial",
                billing_source="MANUAL",
                trial_ends_at=date.today() + timedelta(days=DEFAULT_TRIAL_DAYS),
                max_members=50,
            )
            db.session.add(gym)
            db.session.flush()
            owner = User(
                gym_id=gym.id,
                email=email,
                full_name=data["owner_name"].strip(),
                role="gym_owner",
            )
            owner.set_password(data["password"])
            db.session.add(owner)
            if legacy_signup:
                for name, duration_days, price in (
                    ("1 Month Membership", 30, 1000),
                    ("3 Months Membership", 90, 2700),
                    ("1 Year Annual Plan", 365, 9000),
                ):
                    db.session.add(MembershipPlan(
                        gym_id=gym.id,
                        name=name,
                        duration_days=duration_days,
                        price=price,
                    ))
                gym.subscription_status = "trial"
            else:
                db.session.add(MembershipPlan(gym_id=gym.id, name="Monthly", duration_days=30, price=0))
            db.session.add(QRSettings(gym_id=gym.id, payment_label=gym.name))
            db.session.add(NotificationTemplate(
                gym_id=gym.id,
                name="Default renewal reminder",
                days_before=3,
                message_body=(
                    "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
                    "{{ expiry_date }}. Please complete your renewal payment to keep access active."
                ),
            ))
            db.session.flush()
            owner.reset_failed_logins()
            owner.mark_login()
            access_token = create_access_token(owner.id, gym.id, owner.role)
            refresh_token = create_refresh_token(owner.id, gym.id)
            audit(
                action="mobile_register_gym",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=owner.id,
            )
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return error_response("DUPLICATE_ACCOUNT", "An account with these details already exists.", 409)

        payload = _mobile_auth_payload(owner, access_token, refresh_token)
        payload["registration"] = {
            "gym_id": gym.id,
            "owner_id": owner.id,
            "setup_state": "PLAN_SELECTION",
            "billing": entitlement_for(gym),
        }
        if legacy_signup:
            payload["is_new_signup"] = True
        return jsonify({"success": True, "data": payload}), 201

    @bp.route("/auth/google", methods=["POST"])
    @limiter.limit("10 per minute")
    def google_auth():
        """Authenticate or register via Google ID token."""
        import secrets
        import string
        import urllib.request
        import json as json_mod

        from flask import current_app

        data = request.get_json(silent=True) or {}
        id_token = (data.get("id_token") or "").strip()
        if not id_token:
            return error_response("VALIDATION_ERROR", "Google ID token is required.", 400)

        # Verify token with Google
        try:
            verify_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
            req = urllib.request.Request(verify_url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                google_data = json_mod.loads(resp.read().decode())
        except Exception:
            return error_response("GOOGLE_AUTH_FAILED", "Could not verify Google token.", 401)

        # Validate audience matches our client ID
        configured_client_ids = [
            cid.strip()
            for cid in current_app.config.get("GOOGLE_OAUTH_CLIENT_ID", "").split(",")
            if cid.strip()
        ]
        if configured_client_ids and google_data.get("aud") not in configured_client_ids:
            return error_response("GOOGLE_AUTH_FAILED", "Google token audience mismatch.", 401)

        google_email = (google_data.get("email") or "").strip().lower()
        email_verified = google_data.get("email_verified") == "true"
        if not google_email or not email_verified:
            return error_response("GOOGLE_AUTH_FAILED", "Google account email is not verified.", 401)

        google_name = google_data.get("name") or google_email.split("@")[0]

        # Check if user already exists → login
        existing_user = User.query.filter_by(email=google_email).first()
        if existing_user is not None:
            if not existing_user.is_active:
                return error_response("ACCOUNT_DISABLED", "Account is disabled.", 403)
            if existing_user.role not in ("gym_owner", "staff"):
                return error_response("FORBIDDEN", "Mobile access is not available for this account type.", 403)
            if existing_user.gym is None or not existing_user.gym.is_operational():
                return error_response("GYM_INACTIVE", "Gym account is not active.", 403)

            existing_user.reset_failed_logins()
            existing_user.mark_login()
            access_token = create_access_token(existing_user.id, existing_user.gym_id, existing_user.role)
            refresh_token = create_refresh_token(existing_user.id, existing_user.gym_id)
            audit(
                action="mobile_google_login",
                resource_type="user",
                resource_id=existing_user.id,
                gym_id=existing_user.gym_id,
                actor_id=existing_user.id,
            )
            db.session.commit()
            return jsonify({"success": True, "data": _mobile_auth_payload(existing_user, access_token, refresh_token)})

        # New user → create gym owner account
        gym_name = data.get("gym_name", "").strip() or f"{google_name}'s Gym"
        country_code = (data.get("country") or "IN").strip().upper()
        phone = (data.get("phone") or "").strip()

        locale = SUPPORTED_LOCALES.get(country_code)
        if locale is None:
            locale = SUPPORTED_LOCALES["IN"]
            country_code = "IN"
        currency = locale["currency"]
        timezone = data.get("timezone") or locale.get("timezone", "Asia/Kolkata")

        slug_base = slugify(gym_name) or "gym"
        slug = slug_base
        suffix = 2
        while Gym.query.filter_by(slug=slug).first() is not None:
            slug = f"{slug_base}-{suffix}"
            suffix += 1

        # Generate a secure random password for Google-created accounts
        random_password = ''.join(secrets.choice(string.ascii_letters + string.digits + "!@#$%") for _ in range(24))

        try:
            gym = Gym(
                name=gym_name,
                slug=slug,
                email=google_email,
                phone=phone or None,
                timezone=timezone,
                country=country_code,
                currency=currency,
                status="active",
                subscription_status="trial",
                billing_source="MANUAL",
                trial_ends_at=date.today() + timedelta(days=DEFAULT_TRIAL_DAYS),
                max_members=50,
            )
            db.session.add(gym)
            db.session.flush()
            owner = User(
                gym_id=gym.id,
                email=google_email,
                full_name=google_name,
                role="gym_owner",
            )
            owner.set_password(random_password)
            db.session.add(owner)
            db.session.add(MembershipPlan(gym_id=gym.id, name="Monthly", duration_days=30, price=0))
            db.session.add(QRSettings(gym_id=gym.id, payment_label=gym.name))
            db.session.add(NotificationTemplate(
                gym_id=gym.id,
                name="Default renewal reminder",
                days_before=3,
                message_body=(
                    "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
                    "{{ expiry_date }}. Please complete your renewal payment to keep access active."
                ),
            ))
            db.session.flush()
            owner.reset_failed_logins()
            owner.mark_login()
            access_token = create_access_token(owner.id, gym.id, owner.role)
            refresh_token = create_refresh_token(owner.id, gym.id)
            audit(
                action="mobile_google_register",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=owner.id,
            )
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return error_response("DUPLICATE_ACCOUNT", "An account with these details already exists.", 409)

        payload = _mobile_auth_payload(owner, access_token, refresh_token)
        payload["registration"] = {
            "gym_id": gym.id,
            "owner_id": owner.id,
            "setup_state": "PLAN_SELECTION",
            "billing": entitlement_for(gym),
        }
        payload["is_new_signup"] = True
        return jsonify({"success": True, "data": payload}), 201

    @bp.route("/auth/signup", methods=["POST"])
    @limiter.limit("5 per minute")
    def signup():
        return register()

    @bp.route("/auth/login", methods=["POST"])
    @limiter.limit("5 per minute")
    def login():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not email or not password:
            return error_response("VALIDATION_ERROR", "Email and password are required.", 400)

        user = User.query.filter_by(email=email).first()
        if user is None:
            return error_response("INVALID_CREDENTIALS", "Invalid email or password.", 401)

        if user.is_locked():
            return error_response(
                "ACCOUNT_LOCKED",
                "Account is temporarily locked due to too many failed attempts.",
                403,
            )

        if not user.check_password(password):
            user.record_failed_login()
            db.session.commit()
            return error_response("INVALID_CREDENTIALS", "Invalid email or password.", 401)

        if not user.is_active:
            return error_response("ACCOUNT_DISABLED", "Account is disabled.", 403)

        if user.role not in ("gym_owner", "staff"):
            return error_response(
                "FORBIDDEN", "Mobile access is not available for this account type.", 403
            )

        if user.gym is None or not user.gym.is_operational():
            return error_response("GYM_INACTIVE", "Gym account is not active.", 403)

        # Success — reset failed logins, issue tokens.
        user.reset_failed_logins()
        user.mark_login()

        access_token = create_access_token(user.id, user.gym_id, user.role)
        refresh_token = create_refresh_token(user.id, user.gym_id)

        audit(
            action="mobile_login",
            resource_type="user",
            resource_id=user.id,
            gym_id=user.gym_id,
            actor_id=user.id,
        )
        db.session.commit()

        return jsonify({"success": True, "data": _mobile_auth_payload(user, access_token, refresh_token)})

    @bp.route("/auth/refresh", methods=["POST"])
    @limiter.limit("10 per minute")
    def refresh():
        data = request.get_json(silent=True) or {}
        raw_token = data.get("refresh_token") or ""
        if not raw_token:
            return error_response("VALIDATION_ERROR", "Refresh token is required.", 400)

        result = rotate_refresh_token(raw_token)
        if result is None:
            db.session.commit()
            return error_response("TOKEN_EXPIRED", "Refresh token is invalid or expired.", 401)

        new_refresh, old_record = result
        user = db.session.get(User, old_record.user_id)
        if user is None or not user.is_active:
            db.session.commit()
            return error_response("ACCOUNT_DISABLED", "Account is no longer active.", 403)

        access_token = create_access_token(user.id, user.gym_id, user.role)
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "access_token": access_token,
                "refresh_token": new_refresh,
            },
        })

    @bp.route("/auth/logout", methods=["POST"])
    @token_required
    def logout():
        data = request.get_json(silent=True) or {}
        raw_token = data.get("refresh_token") or ""
        if raw_token:
            revoke_refresh_token(raw_token)
        audit(
            action="mobile_logout",
            resource_type="user",
            resource_id=g.current_user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Logged out."}})

    @bp.route("/auth/logout-all", methods=["POST"])
    @token_required
    def logout_all():
        count = revoke_all_user_tokens(g.current_user.id)
        audit(
            action="mobile_logout_all",
            resource_type="user",
            resource_id=g.current_user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"revoked_count": count},
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"message": f"Revoked {count} sessions."}})

    @bp.route("/me", methods=["GET"])
    @token_required
    def me():
        user = g.current_user
        gym = user.gym
        return jsonify({
            "success": True,
            "data": {
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                    "role": user.role,
                },
                "gym": {
                    "id": gym.id,
                    "name": gym.name,
                    "slug": gym.slug,
                    "timezone": gym.timezone,
                    "country": gym.country,
                    "currency": gym.currency,
                    "whatsapp_enabled": gym.whatsapp_enabled,
                },
            },
        })

    @bp.route("/auth/account", methods=["DELETE"])
    @token_required
    def delete_account():
        user = g.current_user
        gym = user.gym

        if user.role == "gym_owner" and gym:
            # Revoke all refresh tokens for all users belonging to this gym
            gym_users = User.query.filter_by(gym_id=gym.id).all()
            for u in gym_users:
                revoke_all_user_tokens(u.id)

            audit(
                action="mobile_account_deleted",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=user.id,
                metadata={"owner_email": user.email, "gym_name": gym.name},
            )

            # Cascade delete gym and its users/data
            db.session.delete(gym)
            db.session.commit()

            return jsonify({
                "success": True,
                "data": {
                    "message": "Gym account and all associated data deleted successfully.",
                },
            })

        # Staff user deletion
        revoke_all_user_tokens(user.id)
        audit(
            action="mobile_staff_account_deleted",
            resource_type="user",
            resource_id=user.id,
            gym_id=g.gym_id,
            actor_id=user.id,
            metadata={"staff_email": user.email},
        )
        db.session.delete(user)
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "message": "Staff account deleted successfully.",
            },
        })
