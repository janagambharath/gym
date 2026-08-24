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
