"""Mobile API WhatsApp Bot & Leads endpoints."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from functools import wraps
from urllib.parse import urlparse

from flask import current_app, g, jsonify, request
from sqlalchemy import or_

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models.bot import (
    BotConversation,
    BotEvent,
    BotFAQ,
    BotLead,
    BotMessage,
    GymBotConfig,
)
from app.models.gym import Gym
from app.services.entitlement_service import WHATSAPP_BOT_FEATURE, is_feature_enabled
from app.services.whatsapp_service import WhatsAppService


# Keep the conversation-detail payload useful on mobile without allowing a
# long-lived WhatsApp thread to produce an unbounded response.
CONVERSATION_DETAIL_MESSAGE_LIMIT = 100
BOT_CONFIG_FIELDS = frozenset(
    {
        "greeting_message",
        "opening_hours",
        "map_link",
        "trial_enabled",
        "trial_price",
        "trial_duration_days",
        "registration_link",
        "handover_enabled",
    }
)


def _validate_bot_config_update(data: object) -> tuple[dict[str, object] | None, str | None]:
    """Validate owner-managed bot configuration before changing persisted state."""

    if not isinstance(data, dict):
        return None, "Configuration must be a JSON object."

    unknown_fields = set(data) - BOT_CONFIG_FIELDS
    if unknown_fields:
        return None, f"Unsupported configuration field: {sorted(unknown_fields)[0]}."
    if not data:
        return None, "At least one configuration field is required."

    updates: dict[str, object] = {}
    text_limits = {
        "greeting_message": 2000,
        "opening_hours": 2000,
        "map_link": 512,
        "registration_link": 512,
    }
    for field, maximum_length in text_limits.items():
        if field not in data:
            continue
        value = data[field]
        if value is None:
            updates[field] = None
            continue
        if not isinstance(value, str):
            return None, f"{field} must be a string or null."
        value = value.strip()
        if len(value) > maximum_length:
            return None, f"{field} must be {maximum_length} characters or fewer."
        if field in {"map_link", "registration_link"} and value:
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                return None, f"{field} must be a valid HTTPS URL."
        updates[field] = value or None

    for field in ("trial_enabled", "handover_enabled"):
        if field in data:
            if not isinstance(data[field], bool):
                return None, f"{field} must be a boolean."
            updates[field] = data[field]

    if "trial_price" in data:
        value = data["trial_price"]
        if value is None:
            updates["trial_price"] = None
        elif isinstance(value, bool):
            return None, "trial_price must be a non-negative amount or null."
        else:
            try:
                amount = Decimal(str(value))
            except (InvalidOperation, ValueError):
                return None, "trial_price must be a non-negative amount or null."
            if not amount.is_finite() or amount < 0 or amount > Decimal("99999999.99"):
                return None, "trial_price must be between 0 and 99999999.99."
            if amount.as_tuple().exponent < -2:
                return None, "trial_price can contain at most two decimal places."
            updates["trial_price"] = amount

    if "trial_duration_days" in data:
        value = data["trial_duration_days"]
        if value is None:
            updates["trial_duration_days"] = None
        elif isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 365:
            return None, "trial_duration_days must be a whole number from 1 to 365 or null."
        else:
            updates["trial_duration_days"] = value

    return updates, None


def whatsapp_bot_entitlement_required(view):
    """Require a current server-side WhatsApp Bot entitlement for this gym."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_feature_enabled(getattr(g, "gym_id", None), WHATSAPP_BOT_FEATURE):
            return error_response(
                "FEATURE_NOT_ENABLED",
                "WhatsApp AI Bot is not enabled for this gym.",
                403,
            )
        return view(*args, **kwargs)

    return wrapped


def register_bot_routes(bp):
    # ─── Leads ────────────────────────────────────────────────────────

    @bp.route("/bot/leads", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def list_leads():
        status = request.args.get("status", "").strip()
        search = request.args.get("search", "").strip()
        page = max(1, int(request.args.get("page", 1)))
        page_size = min(50, max(1, int(request.args.get("page_size", 20))))

        query = BotLead.query.filter_by(gym_id=g.gym_id)
        if status:
            query = query.filter_by(status=status)
        if search:
            pattern = f"%{search}%"
            query = query.filter(
                or_(
                    BotLead.name.ilike(pattern),
                    BotLead.phone.ilike(pattern),
                    BotLead.interested_plan.ilike(pattern),
                )
            )

        query = query.order_by(BotLead.created_at.desc())
        total = query.count()
        leads = query.offset((page - 1) * page_size).limit(page_size).all()

        return jsonify({
            "success": True,
            "data": {
                "leads": [
                    {
                        "id": lead.id,
                        "name": lead.name,
                        "phone": lead.phone,
                        "source": lead.source,
                        "intent": lead.intent,
                        "status": lead.status,
                        "interested_plan": lead.interested_plan,
                        "trial_requested": lead.trial_requested,
                        "notes": lead.notes,
                        "created_at": lead.created_at.isoformat() if lead.created_at else None,
                        "conversation_id": lead.conversation_id,
                    }
                    for lead in leads
                ],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size or 1,
                },
            },
        })

    @bp.route("/bot/leads/<int:lead_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def get_lead(lead_id: int):
        lead = BotLead.query.filter_by(gym_id=g.gym_id, id=lead_id).first_or_404()
        messages = []
        if lead.conversation_id:
            raw_msgs = (
                BotMessage.query.filter_by(conversation_id=lead.conversation_id)
                .order_by(BotMessage.created_at.asc())
                .all()
            )
            messages = [
                {
                    "id": m.id,
                    "sender": m.sender,
                    "body": m.body,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in raw_msgs
            ]

        return jsonify({
            "success": True,
            "data": {
                "lead": {
                    "id": lead.id,
                    "name": lead.name,
                    "phone": lead.phone,
                    "source": lead.source,
                    "intent": lead.intent,
                    "status": lead.status,
                    "interested_plan": lead.interested_plan,
                    "trial_requested": lead.trial_requested,
                    "notes": lead.notes,
                    "created_at": lead.created_at.isoformat() if lead.created_at else None,
                    "conversation_id": lead.conversation_id,
                },
                "messages": messages,
            },
        })

    @bp.route("/bot/leads/<int:lead_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def update_lead(lead_id: int):
        lead = BotLead.query.filter_by(gym_id=g.gym_id, id=lead_id).first_or_404()
        data = request.get_json() or {}

        if "status" in data:
            lead.status = data["status"]
        if "notes" in data:
            lead.notes = data["notes"]
        if "name" in data:
            lead.name = data["name"]

        db.session.commit()
        return jsonify({
            "success": True,
            "data": {
                "message": "Lead updated successfully",
                "lead": {
                    "id": lead.id,
                    "status": lead.status,
                    "notes": lead.notes,
                },
            },
        })

    # ─── Conversations & Handover ─────────────────────────────────────

    @bp.route("/bot/conversations", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def list_conversations():
        convs = (
            BotConversation.query.filter_by(gym_id=g.gym_id)
            .order_by(BotConversation.last_message_at.desc())
            .limit(50)
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "conversations": [
                    {
                        "id": c.id,
                        "phone": c.phone,
                        "customer_name": c.customer_name,
                        "state": c.state,
                        "handover_status": c.handover_status,
                        "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
                    }
                    for c in convs
                ],
            },
        })

    @bp.route("/bot/conversations/<int:conv_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def get_conversation(conv_id: int):
        """Return the newest bounded, chronologically ordered conversation history."""

        conversation = BotConversation.query.filter_by(
            gym_id=g.gym_id,
            id=conv_id,
        ).first_or_404()

        # Query newest-first so the fixed limit always keeps the most useful
        # portion of a long thread, then restore chronological display order.
        recent_messages = (
            BotMessage.query.filter_by(conversation_id=conversation.id)
            .order_by(BotMessage.created_at.desc(), BotMessage.id.desc())
            .limit(CONVERSATION_DETAIL_MESSAGE_LIMIT)
            .all()
        )
        messages = [
            {
                "id": message.id,
                "sender": message.sender,
                "body": message.body,
                "created_at": message.created_at.isoformat() if message.created_at else None,
            }
            for message in reversed(recent_messages)
        ]

        # Do not use the relationship alone here: both the conversation and
        # the linked lead must remain scoped to the authenticated tenant.
        lead = (
            BotLead.query.filter_by(
                gym_id=g.gym_id,
                conversation_id=conversation.id,
            )
            .order_by(BotLead.created_at.desc(), BotLead.id.desc())
            .first()
        )

        lead_summary = None
        if lead:
            lead_summary = {
                "id": lead.id,
                "name": lead.name,
                "phone": lead.phone,
                "source": lead.source,
                "intent": lead.intent,
                "status": lead.status,
                "interested_plan": lead.interested_plan,
                "trial_requested": lead.trial_requested,
                "created_at": lead.created_at.isoformat() if lead.created_at else None,
            }

        return jsonify({
            "success": True,
            "data": {
                "conversation": {
                    "id": conversation.id,
                    "phone": conversation.phone,
                    "customer_name": conversation.customer_name,
                    "state": conversation.state,
                    "handover_status": conversation.handover_status,
                    "last_message_at": (
                        conversation.last_message_at.isoformat()
                        if conversation.last_message_at
                        else None
                    ),
                },
                "messages": messages,
                "lead": lead_summary,
            },
        })

    @bp.route("/bot/conversations/<int:conv_id>/handover", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def toggle_handover(conv_id: int):
        conv = BotConversation.query.filter_by(gym_id=g.gym_id, id=conv_id).first_or_404()
        data = request.get_json() or {}
        # action: take_over (human_active) or resume_bot (bot_active)
        action = data.get("action", "take_over")

        if action not in {"take_over", "resume_bot"}:
            return error_response(
                "VALIDATION_ERROR",
                "Action must be either 'take_over' or 'resume_bot'.",
                400,
            )

        if action == "take_over":
            conv.handover_status = "human_active"
            conv.active_staff_id = g.user_id
            event_type = "human_takeover"
        else:
            conv.handover_status = "bot_active"
            conv.active_staff_id = None

            event_type = "bot_resumed"

        db.session.add(
            BotEvent(
                gym_id=g.gym_id,
                conversation_id=conv.id,
                event_type=event_type,
                payload={"staff_user_id": g.user_id},
            )
        )

        db.session.commit()
        return jsonify({
            "success": True,
            "data": {
                "handover_status": conv.handover_status,
                "message": f"Handover status updated to {conv.handover_status}",
            },
        })

    @bp.route("/bot/conversations/<int:conv_id>/message", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def send_manual_message(conv_id: int):
        conv = BotConversation.query.filter_by(gym_id=g.gym_id, id=conv_id).first_or_404()
        data = request.get_json() or {}
        body = (data.get("body") or "").strip()

        if not body:
            return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Message body is required"}}), 400
        if len(body) > 4096:
            return error_response(
                "VALIDATION_ERROR",
                "Message body must be 4096 characters or fewer.",
                400,
            )

        gym = db.session.get(Gym, g.gym_id)
        if not gym or not gym.whatsapp_enabled:
            return jsonify({"success": False, "error": {"code": "WHATSAPP_DISABLED", "message": "WhatsApp is not enabled"}}), 400

        ws = WhatsAppService(gym)
        res = ws.send_text(to=conv.phone, body=body)
        if not res.ok:
            current_app.logger.warning(
                "Could not send staff WhatsApp message gym=%s conversation=%s: %s",
                g.gym_id,
                conv.id,
                res.error or "unknown provider error",
            )
            return error_response(
                "WHATSAPP_SEND_FAILED",
                "Message could not be sent. Check WhatsApp setup and retry.",
                502,
            )

        msg = BotMessage(
            conversation_id=conv.id,
            sender="staff",
            body=body,
            provider_message_id=res.provider_message_id,
        )
        db.session.add(msg)
        conv.handover_status = "human_active"
        conv.active_staff_id = g.user_id
        db.session.add(
            BotEvent(
                gym_id=g.gym_id,
                conversation_id=conv.id,
                event_type="staff_message_sent",
                provider_message_id=res.provider_message_id,
                payload={"staff_user_id": g.user_id},
            )
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "message": {
                    "id": msg.id,
                    "sender": msg.sender,
                    "body": msg.body,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                },
            },
        })

    # ─── Bot Config ───────────────────────────────────────────────────

    @bp.route("/bot/config", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def get_bot_config():
        config = GymBotConfig.query.filter_by(gym_id=g.gym_id).first()

        faqs = BotFAQ.query.filter_by(gym_id=g.gym_id).order_by(BotFAQ.priority.desc()).all()

        return jsonify({
            "success": True,
            "data": {
                "config": {
                    # A read must not create configuration rows.  These are the
                    # same conservative defaults a newly-created config receives
                    # when an owner explicitly saves the setup form.
                    "greeting_message": config.greeting_message if config else None,
                    "opening_hours": config.opening_hours if config else None,
                    "map_link": config.map_link if config else None,
                    "trial_enabled": config.trial_enabled if config else False,
                    "trial_price": str(config.trial_price) if config and config.trial_price else None,
                    "trial_duration_days": config.trial_duration_days if config else None,
                    "registration_link": config.registration_link if config else None,
                    "handover_enabled": config.handover_enabled if config else True,
                },
                "faqs": [
                    {"id": f.id, "question": f.question, "answer": f.answer, "enabled": f.enabled}
                    for f in faqs
                ],
            },
        })

    @bp.route("/bot/config", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    @whatsapp_bot_entitlement_required
    def update_bot_config():
        updates, validation_error = _validate_bot_config_update(request.get_json(silent=True))
        if validation_error:
            return error_response("VALIDATION_ERROR", validation_error, 400)

        config = GymBotConfig.query.filter_by(gym_id=g.gym_id).first()
        if not config:
            config = GymBotConfig(gym_id=g.gym_id)
            db.session.add(config)

        for field, value in (updates or {}).items():
            setattr(config, field, value)

        db.session.commit()
        return jsonify({
            "success": True,
            "data": {
                "message": "Bot configuration updated successfully",
            },
        })

    # ─── Bot Testing Sandbox ──────────────────────────────────────────

    @bp.route("/bot/test", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def test_bot_message():
        data = request.get_json() or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Message is required"}}), 400

        gym = db.session.get(Gym, g.gym_id)
        if not gym:
            return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "Gym not found"}}), 404

        from app.services.bot_service import BotService
        bot_svc = BotService(gym)
        test_result = bot_svc.test_generate_response(message)

        return jsonify({
            "success": True,
            "data": test_result,
        })

    # ─── Bot Real Analytics ───────────────────────────────────────────

    @bp.route("/bot/stats", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    @whatsapp_bot_entitlement_required
    def bot_stats():
        from sqlalchemy import func
        from app.models.bot import BotBookingRequest

        total_conversations = BotConversation.query.filter_by(gym_id=g.gym_id).count()
        total_leads = BotLead.query.filter_by(gym_id=g.gym_id).count()
        trial_requests = BotLead.query.filter_by(gym_id=g.gym_id, trial_requested=True).count()
        contacted_leads = BotLead.query.filter_by(gym_id=g.gym_id, status="contacted").count()
        converted_leads = BotLead.query.filter_by(gym_id=g.gym_id, status="converted").count()
        handover_requested = BotConversation.query.filter_by(gym_id=g.gym_id, handover_status="human_requested").count()

        return jsonify({
            "success": True,
            "data": {
                "total_conversations": total_conversations,
                "total_leads": total_leads,
                "trial_requests": trial_requests,
                "contacted_leads": contacted_leads,
                "converted_leads": converted_leads,
                "handover_requested": handover_requested,
            },
        })

