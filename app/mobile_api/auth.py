"""Mobile API authentication endpoints."""
from __future__ import annotations

from flask import g, jsonify, request

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
from app.models.user import User
from app.services.audit_service import audit


def register_auth_routes(bp):
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

        return jsonify({
            "success": True,
            "data": {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                    "role": user.role,
                },
                "gym": {
                    "id": user.gym.id,
                    "name": user.gym.name,
                    "slug": user.gym.slug,
                    "timezone": user.gym.timezone,
                    "country": user.gym.country,
                    "currency": user.gym.currency,
                    "whatsapp_enabled": user.gym.whatsapp_enabled,
                },
            },
        })

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

    @bp.route("/auth/signup", methods=["POST"])
    @limiter.limit("5 per minute")
    def signup():
        from datetime import date, datetime, timedelta, timezone
        from decimal import Decimal
        from app.models import Gym, MembershipPlan
        from app.models.bot import FeatureEntitlement
        from app.utils.helpers import normalize_phone_e164, slugify

        data = request.get_json(silent=True) or {}
        full_name = (data.get("full_name") or data.get("owner_name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        raw_phone = (data.get("phone") or "").strip()
        password = data.get("password") or ""
        gym_name = (data.get("gym_name") or "").strip()
        country = (data.get("country") or "India").strip()

        country_defaults = {
            "India": {"timezone": "Asia/Kolkata", "currency": "INR", "phone_code": "+91"},
            "UAE": {"timezone": "Asia/Dubai", "currency": "AED", "phone_code": "+971"},
            "United States": {"timezone": "America/New_York", "currency": "USD", "phone_code": "+1"},
            "United Kingdom": {"timezone": "Europe/London", "currency": "GBP", "phone_code": "+44"},
            "Australia": {"timezone": "Australia/Sydney", "currency": "AUD", "phone_code": "+61"},
            "Saudi Arabia": {"timezone": "Asia/Riyadh", "currency": "SAR", "phone_code": "+966"},
            "Canada": {"timezone": "America/Toronto", "currency": "CAD", "phone_code": "+1"},
        }
        c_info = country_defaults.get(country, {"timezone": "Asia/Kolkata", "currency": "INR", "phone_code": "+91"})
        currency = (data.get("currency") or c_info["currency"]).strip().upper()
        timezone_val = (data.get("timezone") or c_info["timezone"]).strip()
        phone = normalize_phone_e164(raw_phone, c_info["phone_code"])

        # Validation
        if not full_name or not email or not phone or not password or not gym_name:
            return error_response("VALIDATION_ERROR", "All fields are required.", 400)

        if "@" not in email or "." not in email:
            return error_response("VALIDATION_ERROR", "Please enter a valid email address.", 400)

        if len(password) < 6:
            return error_response("VALIDATION_ERROR", "Password must be at least 6 characters.", 400)

        existing_user_email = User.query.filter_by(email=email).first()
        if existing_user_email:
            return error_response("CONFLICT", "An account with this email already exists.", 409)

        existing_gym_phone = Gym.query.filter_by(phone=phone).first()
        if existing_gym_phone:
            return error_response("CONFLICT", "An account with this phone number already exists.", 409)

        # Generate unique slug
        slug_base = slugify(gym_name)
        slug = slug_base
        counter = 2
        while Gym.query.filter_by(slug=slug).first():
            slug = f"{slug_base}-{counter}"
            counter += 1

        try:
            # 1. Create Gym
            gym = Gym(
                name=gym_name,
                slug=slug,
                email=email,
                phone=phone,
                country=country,
                currency=currency,
                timezone=timezone_val,
                status="active",
                subscription_status="trial",
                trial_ends_at=date.today() + timedelta(days=30),
                max_members=500,
                whatsapp_enabled=False,
            )
            db.session.add(gym)
            db.session.flush()

            # 2. Create Owner User
            user = User(
                gym_id=gym.id,
                email=email,
                full_name=full_name,
                role="gym_owner",
                is_active=True,
            )
            user.set_password(password)
            db.session.add(user)
            db.session.flush()

            # 3. Seed Default Starter Plans
            seed_plans = [
                ("1 Month Membership", 30, Decimal("1000") if currency == "INR" else (Decimal("150") if currency == "AED" else Decimal("30"))),
                ("3 Months Membership", 90, Decimal("2700") if currency == "INR" else (Decimal("400") if currency == "AED" else Decimal("80"))),
                ("1 Year Annual Plan", 365, Decimal("9000") if currency == "INR" else (Decimal("1200") if currency == "AED" else Decimal("250"))),
            ]
            for p_name, p_days, p_price in seed_plans:
                plan = MembershipPlan(
                    gym_id=gym.id,
                    name=p_name,
                    duration_days=p_days,
                    price=p_price,
                    is_active=True,
                )
                db.session.add(plan)

            # 4. Feature Entitlements for 30-day trial
            exp_date = datetime.now(timezone.utc) + timedelta(days=30)
            for feat in ["renewal_desk", "whatsapp_bot", "biometric", "advanced_reports"]:
                ent = FeatureEntitlement(gym_id=gym.id, feature=feat, enabled=True, expires_at=exp_date)
                db.session.add(ent)

            audit(
                action="self_service_signup",
                resource_type="user",
                resource_id=user.id,
                gym_id=gym.id,
                actor_id=user.id,
            )
            db.session.commit()

            access_token = create_access_token(user.id, gym.id, user.role)
            refresh_token = create_refresh_token(user.id, gym.id)

            return jsonify({
                "success": True,
                "data": {
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
                    "is_new_signup": True,
                },
            }), 201
        except Exception as exc:
            db.session.rollback()
            return error_response("SIGNUP_FAILED", f"Account registration failed: {str(exc)}", 500)
