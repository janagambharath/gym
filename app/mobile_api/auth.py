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
