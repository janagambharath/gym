"""Mobile API staff endpoint."""
from __future__ import annotations

import secrets
import string
import urllib.parse

from flask import current_app, g, jsonify, request
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.mobile_api.token_service import revoke_all_user_tokens
from app.models import User
from app.services.audit_service import audit
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)
from app.utils.helpers import normalize_phone_e164


def _serialize_staff(u: User) -> dict:
    return {
        "id": u.id,
        "full_name": u.full_name,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _generate_temp_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _make_whatsapp_invite_url(gym_name: str, staff_name: str, email: str, temp_pass: str, phone: str | None) -> str:
    msg = (
        f"Hi {staff_name},\n\n"
        f"You have been added to the staff team at *{gym_name}* on Renewal Desk.\n\n"
        f"Your login credentials:\n"
        f"• Email: {email}\n"
        f"• Password: {temp_pass}\n\n"
        f"Open the app to log in: {current_app.config.get('PUBLIC_BASE_URL', 'https://gym-production-910c.up.railway.app')}"
    )
    encoded = urllib.parse.quote(msg)
    target_phone = phone.replace("+", "").strip() if phone else ""
    return f"https://wa.me/{target_phone}?text={encoded}" if target_phone else f"https://wa.me/?text={encoded}"


def register_staff_routes(bp):
    @bp.route("/staff", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def list_staff():
        staff = (
            User.query.filter_by(gym_id=g.gym_id)
            .filter(User.role.in_(["gym_owner", "staff"]))
            .order_by(User.full_name.asc())
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "staff": [_serialize_staff(u) for u in staff],
            },
        })

    @bp.route("/staff", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def create_staff():
        data = request.get_json(silent=True) or {}
        # A retry after a successful create must replay the stored
        # response — including the SAME generated temp password — not
        # 409 on the duplicate email, and never a second account.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="create_staff",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        full_name = (data.get("full_name") or data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        role = (data.get("role") or "staff").strip().lower()
        raw_phone = (data.get("phone") or "").strip()
        phone = normalize_phone_e164(raw_phone) if raw_phone else None

        if not full_name:
            return error_response("VALIDATION_ERROR", "Full name is required.", 400)
        if not email or "@" not in email:
            return error_response("VALIDATION_ERROR", "A valid email address is required.", 400)
        if role not in ("staff", "gym_owner"):
            role = "staff"

        existing = User.query.filter_by(email=email).first()
        if existing:
            return error_response("CONFLICT", f"An account with email '{email}' already exists.", 409)

        password = data.get("password") or _generate_temp_password(10)
        if len(password) < 6:
            return error_response("VALIDATION_ERROR", "Password must be at least 6 characters.", 400)

        user = User(
            gym_id=g.gym_id,
            email=email,
            full_name=full_name,
            role=role,
            is_active=True,
            is_temporary_password=True,
            invitation_status="sent",
        )
        user.set_password(password)
        db.session.add(user)
        db.session.flush()

        audit(
            action="create_staff_mobile",
            resource_type="user",
            resource_id=user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"email": email, "role": role},
        )
        gym_name = g.current_user.gym.name if g.current_user.gym else "Renewal Desk"
        invite_wa_url = _make_whatsapp_invite_url(gym_name, full_name, email, password, phone)

        serialized = _serialize_staff(user)
        serialized["temp_password"] = password
        serialized["invite_whatsapp_url"] = invite_wa_url

        response_body = {
            "success": True,
            "data": serialized,
            "message": f"Staff account created for {full_name}.",
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="create_staff",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=201,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="create_staff",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body), 201

    @bp.route("/staff/<int:user_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    def update_staff(user_id: int):
        user = User.query.filter_by(id=user_id, gym_id=g.gym_id).first()
        if not user:
            return error_response("NOT_FOUND", "Staff member not found.", 404)

        data = request.get_json(silent=True) or {}
        # A retry after a successful update must replay, not re-apply
        # (re-applying is mostly harmless, but a demote-then-retry
        # after the owner re-promoted would demote again).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_staff",
            headers=request.headers,
            payload={**data, "user_id": user_id},
        )
        if replay is not None:
            return replay

        if "full_name" in data:
            name = (data["full_name"] or "").strip()
            if not name:
                return error_response("VALIDATION_ERROR", "Full name cannot be empty.", 400)
            user.full_name = name

        if "role" in data:
            role = (data["role"] or "").strip().lower()
            if role in ("staff", "gym_owner"):
                # Owner cannot demote themselves if they are the only gym owner
                if user.id == g.current_user.id and role != "gym_owner":
                    return error_response("FORBIDDEN", "You cannot demote yourself from Gym Owner.", 403)
                user.role = role

        if "is_active" in data:
            is_active = bool(data["is_active"])
            if user.id == g.current_user.id and not is_active:
                return error_response("FORBIDDEN", "You cannot deactivate your own account.", 403)
            user.is_active = is_active

        audit(
            action="update_staff_mobile",
            resource_type="user",
            resource_id=user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        response_body = {
            "success": True,
            "data": _serialize_staff(user),
            "message": "Staff member updated successfully.",
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_staff",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="update_staff",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.route("/staff/<int:user_id>/reset-password", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def reset_staff_password(user_id: int):
        user = User.query.filter_by(id=user_id, gym_id=g.gym_id).first()
        if not user:
            return error_response("NOT_FOUND", "Staff member not found.", 404)

        data = request.get_json(silent=True) or {}
        # A retry after a successful reset must replay the SAME new
        # password, not generate (and set) a second one — the first
        # password is what the owner already shared.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="reset_staff_password",
            headers=request.headers,
            payload={**data, "user_id": user_id},
        )
        if replay is not None:
            return replay

        # Caller-supplied password preferred; otherwise generate a secure one
        # (the PWA reset flow sends no body). Either way, min 12 chars.
        new_password = data.get("new_password") or data.get("password") or _generate_temp_password(16)
        if len(new_password) < 12:
            return error_response("VALIDATION_ERROR", "Password must be at least 12 characters.", 400)

        user.set_password(new_password)
        # Kick out any sessions on the old password.
        revoke_all_user_tokens(user.id)
        user.failed_login_count = 0
        user.locked_until = None
        user.must_change_password = False

        audit(
            action="reset_staff_password_mobile",
            resource_type="user",
            resource_id=user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        gym_name = g.current_user.gym.name if g.current_user.gym else "Renewal Desk"
        invite_wa_url = _make_whatsapp_invite_url(gym_name, user.full_name, user.email, new_password, None)

        response_body = {
            "success": True,
            "data": {
                "id": user.id,
                "new_password": new_password,
                "invite_whatsapp_url": invite_wa_url,
            },
            "message": f"Password reset for {user.full_name}.",
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="reset_staff_password",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="reset_staff_password",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.route("/staff/<int:user_id>", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner")
    def delete_staff(user_id: int):
        user = User.query.filter_by(id=user_id, gym_id=g.gym_id).first()
        if not user:
            return error_response("NOT_FOUND", "Staff member not found.", 404)

        if user.id == g.current_user.id:
            return error_response("FORBIDDEN", "You cannot remove your own account.", 403)

        # A retry after a successful deactivate must replay, not 404
        # (the row still exists but is_active is False — the lookup
        # above still finds it, so this is belt-and-braces).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="delete_staff",
            headers=request.headers,
            payload={"user_id": user_id},
        )
        if replay is not None:
            return replay

        # Deactivate and disassociate
        user.is_active = False
        audit(
            action="deactivate_staff_mobile",
            resource_type="user",
            resource_id=user.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        response_body = {
            "success": True,
            "data": {"message": f"{user.full_name} has been deactivated."},
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="delete_staff",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="delete_staff",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)
