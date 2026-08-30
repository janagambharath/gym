"""Mobile API WhatsApp reminder endpoint."""
from __future__ import annotations

from flask import current_app, g, jsonify, request
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, QRSettings, ReminderLog
from app.services.audit_service import audit
from app.services.error_messages import friendly_error
from app.services.reminder_service import create_manual_test_log, ensure_default_template, send_reminder
from app.services.whatsapp_service import WhatsAppService


def _connection_state(gym) -> str:
    """Return a backend-confirmed state, never a client cache inference."""
    configured = bool(gym.whatsapp_enabled and gym.phone_number_id)
    stored = (gym.whatsapp_connection_status or "NOT_CONNECTED").upper()
    if configured:
        return "CONNECTED" if stored != "FAILED" else "FAILED"
    return stored if stored in {"PENDING", "ACTION_REQUIRED", "FAILED"} else "NOT_CONNECTED"


def _serialize_reminder_log(log: ReminderLog) -> dict:
    return {
        "id": log.id,
        "member_id": log.member_id,
        "member_name": log.member.full_name if log.member else None,
        "status": log.status,
        "error_message": log.error_message,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "template_name": log.template.name if log.template else None,
    }


def register_whatsapp_routes(bp):
    @bp.route("/whatsapp/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def whatsapp_status():
        gym = g.current_user.gym
        state = _connection_state(gym)
        next_step = None
        if state in {"NOT_CONNECTED", "ACTION_REQUIRED"}:
            next_step = "WhatsApp setup required. Complete Meta Business onboarding with your account administrator."
        elif state == "PENDING":
            next_step = "WhatsApp setup is pending provider confirmation."
        elif state == "FAILED":
            next_step = "WhatsApp setup failed. Review the provider configuration and retry from the administrator console."
        return jsonify({"success": True, "data": {
            "state": state,
            "business_phone_number": gym.business_phone_number or gym.phone or None,
            "next_step": next_step,
        }})

    @bp.route("/whatsapp/send-reminder", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("5 per minute")
    def send_whatsapp_reminder():
        gym = g.current_user.gym
        if not gym.whatsapp_enabled or not gym.phone_number_id:
            return error_response(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp Business is not configured for this gym.",
                400,
            )

        data = request.get_json(silent=True) or {}
        member_id = data.get("member_id")
        if not member_id:
            return error_response("VALIDATION_ERROR", "member_id is required.", 400)

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)
        if not member.whatsapp_opted_in:
            return error_response(
                "WHATSAPP_OPT_IN_REQUIRED",
                "Member has not opted in to receive WhatsApp reminders.",
                409,
            )

        try:
            template = ensure_default_template(g.gym_id)
            log = create_manual_test_log(
                member,
                template,
                gym_timezone=gym.timezone or "Asia/Kolkata",
            )
            # Prioritize official Meta approved template message for mobile app trigger
            template_name = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_NAME", "")
            whatsapp = WhatsAppService(gym)
            template_sent = False
            if template_name:
                from app.models.mixins import utcnow
                from app.services.reminder_service import _send_template_message, _template_context
                t_result = _send_template_message(
                    whatsapp,
                    to=log.phone_snapshot,
                    template_context=_template_context(gym, member),
                )
                if t_result.ok:
                    log.status = "sent"
                    log.sent_at = utcnow()
                    log.provider_message_id = t_result.provider_message_id
                    log.error_message = None
                    template_sent = True
                else:
                    current_app.logger.warning(
                        "Mobile template reminder failed: %s, falling back to session reminder",
                        t_result.error,
                    )
            if not template_sent:
                send_reminder(log, force=True)

            audit(
                action="mobile_send_reminder",
                resource_type="reminder_log",
                resource_id=log.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={"member_id": member.id},
            )
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception("Mobile WhatsApp send failed for member %s", member.id)
            return error_response("SEND_FAILED", f"Reminder failed: {str(exc)[:180]}", 500)

        if log.status == "sent":
            return jsonify({
                "success": True,
                "data": {"message": f"Reminder sent to {member.full_name}.", "status": "sent"},
            })
        else:
            friendly = friendly_error(log.error_message)
            return jsonify({
                "success": False,
                "error": {
                    "code": "SEND_FAILED",
                    "message": friendly or log.error_message or "Unknown error",
                },
            }), 422

    @bp.route("/whatsapp/reminders", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_reminders():
        """List recent WhatsApp reminder logs for this gym."""
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status_filter = request.args.get("status", "").strip()

        query = ReminderLog.query.filter_by(gym_id=g.gym_id)
        if status_filter:
            query = query.filter_by(status=status_filter)
        total = query.count()

        logs = (
            query.options(
                joinedload(ReminderLog.member),
                joinedload(ReminderLog.template),
            )
            .order_by(ReminderLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return jsonify({
            "success": True,
            "data": {
                "reminders": [_serialize_reminder_log(log) for log in logs],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/whatsapp/broadcast/stats", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def broadcast_stats():
        """Return audience counts for announcement broadcasts."""
        from datetime import date, timedelta
        from app.services.broadcast_service import get_target_members

        gym = g.current_user.gym
        today = date.today()
        seven_days = today + timedelta(days=7)

        active_count = len(get_target_members(gym.id, "active"))
        expired_count = len(get_target_members(gym.id, "expired"))
        all_count = len(get_target_members(gym.id, "all"))

        return jsonify({
            "success": True,
            "data": {
                "whatsapp_enabled": _connection_state(gym) == "CONNECTED",
                "connection_state": _connection_state(gym),
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "counts": {
                    "active": active_count,
                    "expired": expired_count,
                    "all": all_count,
                },
            },
        })

    @bp.route("/whatsapp/broadcast", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("5 per minute")
    def send_broadcast():
        """Send a bulk announcement or festival broadcast."""
        from app.services.broadcast_service import send_broadcast_announcement

        gym = g.current_user.gym
        if not gym.whatsapp_enabled or not gym.phone_number_id:
            return error_response(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp Business is not configured for this gym.",
                400,
            )

        data = request.get_json(silent=True) or {}
        message = (data.get("message") or "").strip()
        audience = data.get("audience", "active")

        if not message:
            return error_response("VALIDATION_ERROR", "Announcement message cannot be empty.", 400)

        result = send_broadcast_announcement(gym, announcement_text=message, audience=audience)
        if not result.get("success"):
            return error_response("BROADCAST_FAILED", result.get("error", "Broadcast failed"), 400)

        return jsonify({
            "success": True,
            "data": result,
        })

    @bp.route("/whatsapp/connection-status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def connection_status():
        """Return truthful WhatsApp connection status and Meta onboarding state."""
        gym = g.current_user.gym
        
        if gym.whatsapp_enabled and gym.phone_number_id:
            status = "CONNECTED"
            desc = "WhatsApp Business is active and connected to Renewal Desk automation."
            next_action = "Your automated renewal reminders and AI receptionist are active."
        elif gym.whatsapp_business_account_id and not gym.phone_number_id:
            status = "ACTION_REQUIRED"
            desc = "Meta requires business verification or phone number selection to complete setup."
            next_action = "Complete Meta Embedded Signup on your phone or computer."
        else:
            status = "NOT_CONNECTED"
            desc = "No WhatsApp Business account connected to Renewal Desk."
            next_action = "Connect your existing WhatsApp Business number or register a new dedicated number."

        return jsonify({
            "success": True,
            "data": {
                "status": status,
                "status_description": desc,
                "next_action": next_action,
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "phone_number_id": gym.phone_number_id or "",
                "waba_id": gym.whatsapp_business_account_id or "",
                "coexistence_eligible": True,
                "profile": {
                    "about": gym.business_category or "Fitness Gym & Training Center",
                    "description": f"{gym.name} automated member desk & renewals.",
                    "address": gym.address or "",
                    "email": gym.email or "",
                    "vertical": "FITNESS",
                },
            },
        })

    @bp.route("/whatsapp/onboarding-config", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def onboarding_config():
        """Return Meta Embedded Signup client configuration."""
        gym = g.current_user.gym
        meta_app_id = current_app.config.get("META_APP_ID") or "1098320491823901"
        config_id = current_app.config.get("META_CONFIG_ID") or "renewal_desk_embedded_v1"

        return jsonify({
            "success": True,
            "data": {
                "meta_app_id": meta_app_id,
                "config_id": config_id,
                "gym_id": gym.id,
                "gym_name": gym.name,
                "supported_methods": [
                    {
                        "id": "coexistence",
                        "title": "Connect Existing WhatsApp Business",
                        "description": "Use your existing WhatsApp Business App number with Meta Cloud API coexistence.",
                        "recommended": True,
                    },
                    {
                        "id": "new_number",
                        "title": "Use a New Business Number",
                        "description": "Register a new SIM or virtual number dedicated for 24/7 gym automation.",
                        "recommended": False,
                    },
                ],
            },
        })

    @bp.route("/whatsapp/connect-waba", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def connect_waba():
        """Connect or update tenant-scoped WABA and Phone Number ID."""
        data = request.get_json(silent=True) or {}
        waba_id = (data.get("waba_id") or "").strip()
        phone_number_id = (data.get("phone_number_id") or "").strip()
        phone = (data.get("business_phone_number") or "").strip()

        if not phone_number_id:
            return error_response("VALIDATION_ERROR", "phone_number_id is required.", 400)

        gym = g.current_user.gym
        gym.whatsapp_business_account_id = waba_id or gym.whatsapp_business_account_id or f"waba_{gym.id}"
        gym.phone_number_id = phone_number_id
        if phone:
            gym.business_phone_number = phone
        gym.whatsapp_enabled = True

        audit(
            action="mobile_connect_waba",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=gym.id,
            actor_id=g.current_user.id,
            metadata={"waba_id": gym.whatsapp_business_account_id, "phone_number_id": phone_number_id},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "status": "CONNECTED",
                "message": "WhatsApp Business connected successfully.",
                "phone_number_id": gym.phone_number_id,
                "business_phone_number": gym.business_phone_number,
            },
        })

    @bp.route("/whatsapp/profile", methods=["GET", "PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def whatsapp_profile():
        """View or update WhatsApp Business profile information."""
        gym = g.current_user.gym

        if request.method == "PATCH":
            if g.current_user.role != "gym_owner":
                return error_response("FORBIDDEN", "Only gym owners can update business profile.", 403)

            data = request.get_json(silent=True) or {}
            if "about" in data:
                gym.business_category = (data.get("about") or "").strip()[:64]
            if "address" in data:
                gym.address = (data.get("address") or "").strip()
            if "email" in data:
                gym.email = (data.get("email") or "").strip()
            
            db.session.commit()
            audit(
                action="mobile_update_whatsapp_profile",
                resource_type="gym",
                resource_id=gym.id,
                gym_id=gym.id,
                actor_id=g.current_user.id,
            )

        return jsonify({
            "success": True,
            "data": {
                "name": gym.name,
                "about": gym.business_category or "Gym / Fitness Center",
                "address": gym.address or "",
                "email": gym.email or "",
                "business_phone_number": gym.business_phone_number or gym.phone or "",
                "whatsapp_enabled": bool(gym.whatsapp_enabled and gym.phone_number_id),
            },
        })

