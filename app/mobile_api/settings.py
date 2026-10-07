"""Mobile API settings endpoint."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from flask import current_app, g, jsonify, request, url_for
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, MembershipPlan, QRSettings
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.mobile_billing_service import entitlement_for
from app.services.storage_service import delete_local_upload, save_gym_qr
from app.utils.helpers import normalize_public_media_url


def _serialize_plan(p: MembershipPlan) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "duration_days": p.duration_days,
        "price": str(p.price),
    }


def _payment_qr_url(qr: QRSettings | None) -> str | None:
    """Return the image URL members can actually load.

    Dashboard uploads are stored privately under ``uploads/gym_qr``.  A
    short-lived signed URL keeps those files private while still allowing the
    member web and Android clients to display the owner's QR image.
    """
    if not qr:
        return None
    if qr.qr_public_url:
        return normalize_public_media_url(qr.qr_public_url) or None
    if not qr.qr_image_path:
        return None
    if qr.qr_image_path.startswith(("http://", "https://")):
        return normalize_public_media_url(qr.qr_image_path) or None

    from itsdangerous import URLSafeTimedSerializer

    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="qr-media")
    token = serializer.dumps({"path": qr.qr_image_path.replace("\\", "/")})
    return url_for("signed_qr_file", token=token, _external=True)


def _serialize_payment_settings(qr: QRSettings | None, gym: Gym | None) -> dict:
    return {
        "upi_id": qr.upi_id if qr else None,
        "payment_label": qr.payment_label if qr else (gym.name if gym else None),
        "instructions": qr.instructions if qr else None,
        # Keep the established field name so older Android releases work too.
        "qr_public_url": _payment_qr_url(qr),
        "is_active": qr.is_active if qr else True,
    }


def register_settings_routes(bp):
    @bp.route("/settings", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_settings():
        gym = g.current_user.gym
        plans = (
            MembershipPlan.query.filter_by(gym_id=g.gym_id, is_active=True)
            .order_by(MembershipPlan.name.asc())
            .all()
        )
        qr = QRSettings.query.filter_by(gym_id=g.gym_id).first()
        return jsonify({
            "success": True,
            "data": {
                "gym": {
                    "id": gym.id,
                    "name": gym.name,
                    "slug": gym.slug,
                    "email": gym.email,
                    "phone": gym.phone,
                    "address": gym.address,
                    "timezone": gym.timezone,
                    "country": gym.country,
                    "currency": gym.currency,
                    "whatsapp_enabled": gym.whatsapp_enabled,
                    "whatsapp_connection_status": gym.whatsapp_connection_status,
                    "max_members": gym.max_members,
                    "subscription_status": gym.subscription_status,
                    "billing": entitlement_for(gym),
                },
                "plans": [_serialize_plan(p) for p in plans],
                "payment_settings": _serialize_payment_settings(qr, gym),
            },
        })

    @bp.route("/settings", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    def update_settings():
        data = request.get_json(silent=True) or {}
        gym = g.current_user.gym

        # Only owner can update; only safe fields allowed.
        allowed = {"name", "email", "phone", "address", "timezone"}
        updates = {}
        for key in allowed:
            if key in data:
                val = (data[key] or "").strip() if isinstance(data.get(key), str) else data[key]
                setattr(gym, key, val or None if key != "name" else val)
                updates[key] = val

        if "name" in updates and not updates["name"]:
            return error_response("VALIDATION_ERROR", "Gym name cannot be empty.", 400)

        audit(
            action="update_gym_settings",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"updated_fields": list(updates.keys())},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Settings updated."}})

    @bp.route("/settings/payment", methods=["GET", "PUT", "PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def payment_settings():
        qr = QRSettings.query.filter_by(gym_id=g.gym_id).first()
        if request.method == "GET":
            return jsonify({
                "success": True,
                "data": _serialize_payment_settings(qr, g.current_user.gym),
            })

        data = request.get_json(silent=True) or {}
        if not qr:
            qr = QRSettings(gym_id=g.gym_id, payment_label=g.current_user.gym.name)
            db.session.add(qr)

        if "upi_id" in data:
            upi_id = (data["upi_id"] or "").strip()
            if upi_id and "@" not in upi_id:
                return error_response(
                    "VALIDATION_ERROR",
                    "Invalid UPI ID format (must contain '@', e.g. merchant@okaxis).",
                    400,
                )
            qr.upi_id = upi_id or None

        if "payment_label" in data:
            qr.payment_label = (data["payment_label"] or "").strip() or None

        if "instructions" in data:
            qr.instructions = (data["instructions"] or "").strip() or None

        if "is_active" in data:
            qr.is_active = bool(data["is_active"])
        elif qr.upi_id:
            qr.is_active = True

        audit(
            action="update_qr_settings",
            resource_type="qr_settings",
            resource_id=qr.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"upi_id": qr.upi_id, "is_active": qr.is_active},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Gym payment details updated successfully.",
            "data": _serialize_payment_settings(qr, g.current_user.gym),
        })

    @bp.route("/settings/payment/qr", methods=["POST", "DELETE"])
    @token_required
    @roles_required("gym_owner")
    def payment_qr_image():
        """Let gym owners replace the QR shown in VYNLA from their app."""
        qr = QRSettings.query.filter_by(gym_id=g.gym_id).first()
        if not qr:
            qr = QRSettings(gym_id=g.gym_id, payment_label=g.current_user.gym.name)
            db.session.add(qr)
            db.session.flush()

        if request.method == "DELETE":
            old_path = qr.qr_image_path
            qr.qr_image_path = None
            qr.qr_public_url = None
            invalidate_dashboard_cache(g.gym_id)
            audit(
                action="remove_qr_settings",
                resource_type="qr_settings",
                resource_id=qr.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
            )
            db.session.commit()
            if old_path and not old_path.startswith(("http://", "https://")):
                try:
                    delete_local_upload(old_path)
                except Exception:
                    current_app.logger.exception("Could not remove old QR upload for gym %s", g.gym_id)
            return jsonify({"success": True, "data": _serialize_payment_settings(qr, g.current_user.gym)})

        upload = request.files.get("qr_image")
        if not upload or not upload.filename:
            return error_response("VALIDATION_ERROR", "Select a PNG, JPG, or WebP QR image.", 400)

        old_path = qr.qr_image_path
        try:
            qr.qr_image_path = save_gym_qr(upload, g.gym_id)
        except ValueError as exc:
            return error_response("VALIDATION_ERROR", str(exc), 400)
        # An uploaded image deliberately takes precedence over a legacy URL.
        qr.qr_public_url = None
        invalidate_dashboard_cache(g.gym_id)
        audit(
            action="upload_qr_settings",
            resource_type="qr_settings",
            resource_id=qr.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        db.session.commit()
        if old_path and old_path != qr.qr_image_path and not old_path.startswith(("http://", "https://")):
            try:
                delete_local_upload(old_path)
            except Exception:
                current_app.logger.exception("Could not remove replaced QR upload for gym %s", g.gym_id)
        return jsonify({"success": True, "data": _serialize_payment_settings(qr, g.current_user.gym)})

    # ─── Plan Management ─────────────────────────────────────────────

    @bp.route("/plans", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def create_plan():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return error_response("VALIDATION_ERROR", "Plan name is required.", 400)
        if len(name) > 120:
            return error_response("VALIDATION_ERROR", "Plan name is too long (max 120 chars).", 400)

        try:
            duration_days = int(data.get("duration_days", 30))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid duration_days.", 400)
        if not 1 <= duration_days <= 730:
            return error_response("VALIDATION_ERROR", "duration_days must be between 1 and 730.", 400)

        try:
            price = Decimal(str(data.get("price", "0")).strip() or "0")
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid price.", 400)
        if price < 0:
            return error_response("VALIDATION_ERROR", "Price cannot be negative.", 400)

        existing = MembershipPlan.query.filter_by(gym_id=g.gym_id, name=name, is_active=True).first()
        if existing:
            return error_response("CONFLICT", f"A plan named '{name}' already exists.", 409)

        plan = MembershipPlan(
            gym_id=g.gym_id,
            name=name,
            duration_days=duration_days,
            price=price,
            is_active=True,
        )
        db.session.add(plan)
        db.session.flush()
        audit(
            action="create_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"name": name, "price": str(price), "duration_days": duration_days},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": _serialize_plan(plan)}), 201

    @bp.route("/plans/<int:plan_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    def update_plan(plan_id: int):
        plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
        if plan is None:
            return error_response("NOT_FOUND", "Plan not found.", 404)

        data = request.get_json(silent=True) or {}

        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return error_response("VALIDATION_ERROR", "Plan name cannot be empty.", 400)
            dupe = MembershipPlan.query.filter(
                MembershipPlan.gym_id == g.gym_id,
                MembershipPlan.name == name,
                MembershipPlan.is_active == True,
                MembershipPlan.id != plan_id,
            ).first()
            if dupe:
                return error_response("CONFLICT", f"A plan named '{name}' already exists.", 409)
            plan.name = name

        if "duration_days" in data:
            try:
                duration_days = int(data["duration_days"])
            except (TypeError, ValueError):
                return error_response("VALIDATION_ERROR", "Invalid duration_days.", 400)
            if not 1 <= duration_days <= 730:
                return error_response("VALIDATION_ERROR", "duration_days must be between 1 and 730.", 400)
            plan.duration_days = duration_days

        if "price" in data:
            try:
                price = Decimal(str(data["price"]).strip() or "0")
            except (InvalidOperation, TypeError):
                return error_response("VALIDATION_ERROR", "Invalid price.", 400)
            if price < 0:
                return error_response("VALIDATION_ERROR", "Price cannot be negative.", 400)
            plan.price = price

        audit(
            action="update_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": _serialize_plan(plan)})

    @bp.route("/plans/<int:plan_id>", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner")
    def delete_plan(plan_id: int):
        plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
        if plan is None:
            return error_response("NOT_FOUND", "Plan not found.", 404)

        # Soft-delete — members keep their plan reference.
        plan.is_active = False
        audit(
            action="delete_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Plan deleted."}})

    # ── Biometric Bridge Management ──────────────────────────────────

    @bp.route("/settings/bridge", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def bridge_status():
        """Get biometric bridge connection status and device info."""
        from app.models.bridge import BridgeCommand, BridgeInstallation
        from app.models.mixins import utcnow

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id).first()
        if not bridge:
            return jsonify({"success": True, "data": {"provisioned": False}})

        now = utcnow()
        hb = bridge.last_heartbeat_at
        if hb and hb.tzinfo is None:
            from datetime import timezone
            hb = hb.replace(tzinfo=timezone.utc)
        hb_age = (now - hb).total_seconds() if hb else None
        device_online = hb_age is not None and hb_age <= 120 and bridge.is_active

        pending = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="pending").count()
        failed = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").count()

        return jsonify({"success": True, "data": {
            "provisioned": True,
            "is_active": bridge.is_active,
            "device_online": device_online,
            "last_heartbeat": hb.isoformat() if hb else None,
            "heartbeat_age_seconds": int(hb_age) if hb_age is not None else None,
            "display_name": bridge.display_name,
            "device_serial": bridge.device_serial,
            "installed_version": bridge.installed_version,
            "pc_name": bridge.pc_name,
            "os_info": bridge.os_info,
            "public_id": bridge.public_id,
            "status": bridge.status,
            "pending_commands": pending,
            "failed_commands": failed,
            "first_paired_at": bridge.first_paired_at.isoformat() if bridge.first_paired_at else None,
        }})

    @bp.route("/settings/bridge/provision", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def bridge_provision():
        """Provision a new biometric bridge for this gym."""
        from app.models.bridge import BridgeInstallation

        existing = BridgeInstallation.query.filter_by(gym_id=g.gym_id).first()
        if existing and existing.is_active:
            return error_response(
                "ALREADY_PROVISIONED",
                "A bridge is already provisioned. Deactivate it first to create a new one.",
                409,
            )

        data = request.get_json(silent=True) or {}
        device_serial = (data.get("device_serial") or "").strip()
        display_name = (data.get("display_name") or "Gym biometric device").strip()

        if not device_serial:
            return error_response("VALIDATION_ERROR", "device_serial is required.", 400)

        if existing and not existing.is_active:
            db.session.delete(existing)
            db.session.flush()

        installation, raw_key = BridgeInstallation.create_for_gym(
            gym_id=g.gym_id,
            display_name=display_name,
            device_serial=device_serial,
        )
        db.session.add(installation)
        audit(
            action="bridge_provision",
            resource_type="bridge",
            resource_id=None,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"device_serial": device_serial},
        )
        db.session.commit()

        return jsonify({"success": True, "data": {
            "public_id": installation.public_id,
            "api_key": raw_key,
            "device_serial": device_serial,
            "display_name": display_name,
            "message": "Bridge provisioned. Save the API key — it won't be shown again.",
        }}), 201

    @bp.route("/settings/bridge/deactivate", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def bridge_deactivate():
        """Deactivate the biometric bridge."""
        from app.models.bridge import BridgeInstallation

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return error_response("NOT_FOUND", "No active bridge found.", 404)

        bridge.is_active = False
        bridge.status = "disabled"
        audit(
            action="bridge_deactivate",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Bridge deactivated."}})

    @bp.route("/settings/bridge/commands", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def bridge_commands():
        """List recent bridge commands with status."""
        from app.models.bridge import BridgeCommand, BridgeInstallation

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id).first()
        if not bridge:
            return jsonify({"success": True, "data": {"commands": []}})

        page = request.args.get("page", 1, type=int)
        per_page = min(request.args.get("per_page", 25, type=int), 100)
        status_filter = request.args.get("status")

        query = BridgeCommand.query.filter_by(bridge_id=bridge.id)
        if status_filter and status_filter in ("pending", "leased", "acked", "failed"):
            query = query.filter_by(status=status_filter)

        pagination = (
            query.order_by(BridgeCommand.created_at.desc())
            .paginate(page=page, per_page=per_page, error_out=False)
        )

        commands = []
        for cmd in pagination.items:
            commands.append({
                "id": cmd.id,
                "command_type": cmd.command_type,
                "enroll_number": cmd.enroll_number,
                "member_name": cmd.member_name,
                "status": cmd.status,
                "created_at": cmd.created_at.isoformat() if cmd.created_at else None,
                "acknowledged_at": cmd.acknowledged_at.isoformat() if cmd.acknowledged_at else None,
                "last_error": cmd.last_error,
                "retry_attempt": cmd.retry_attempt,
                "delivery_attempts": cmd.delivery_attempts,
            })

        return jsonify({"success": True, "data": {
            "commands": commands,
            "pagination": {
                "page": pagination.page,
                "per_page": pagination.per_page,
                "total": pagination.total,
                "total_pages": pagination.pages,
            },
        }})

    @bp.route("/settings/bridge/reconcile", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def bridge_reconcile():
        """Force re-sync all enrolled members' access state to the device."""
        from app.services.bridge_service import queue_gym_reconciliation

        count = queue_gym_reconciliation(g.gym_id)
        db.session.commit()
        audit(
            action="bridge_reconcile",
            resource_type="bridge",
            resource_id=None,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"queued_count": count},
        )
        return jsonify({"success": True, "data": {
            "queued_count": count,
            "message": f"Re-syncing {count} enrolled member(s) to biometric device.",
        }})
