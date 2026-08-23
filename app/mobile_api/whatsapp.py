"""Mobile API WhatsApp reminder endpoint."""
from __future__ import annotations

from flask import current_app, g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, QRSettings
from app.services.audit_service import audit
from app.services.error_messages import friendly_error
from app.services.reminder_service import create_manual_test_log, ensure_default_template, send_reminder


def register_whatsapp_routes(bp):
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

        try:
            template = ensure_default_template(g.gym_id)
            log = create_manual_test_log(
                member,
                template,
                gym_timezone=gym.timezone or "Asia/Kolkata",
            )
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
