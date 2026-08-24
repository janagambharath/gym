"""Mobile API WhatsApp Bot & Leads endpoints."""
from __future__ import annotations

from flask import g, jsonify, request
from sqlalchemy import or_

from app.extensions import db
from app.mobile_api.middleware import roles_required, token_required
from app.models.bot import (
    BotConversation,
    BotFAQ,
    BotLead,
    BotMessage,
    GymBotConfig,
)
from app.models.gym import Gym
from app.services.whatsapp_service import WhatsAppService


def register_bot_routes(bp):
    # ─── Leads ────────────────────────────────────────────────────────

    @bp.route("/bot/leads", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
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

    @bp.route("/bot/conversations/<int:conv_id>/handover", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def toggle_handover(conv_id: int):
        conv = BotConversation.query.filter_by(gym_id=g.gym_id, id=conv_id).first_or_404()
        data = request.get_json() or {}
        # action: take_over (human_active) or resume_bot (bot_active)
        action = data.get("action", "take_over")

        if action == "take_over":
            conv.handover_status = "human_active"
            conv.active_staff_id = g.user_id
        else:
            conv.handover_status = "bot_active"
            conv.active_staff_id = None

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
    def send_manual_message(conv_id: int):
        conv = BotConversation.query.filter_by(gym_id=g.gym_id, id=conv_id).first_or_404()
        data = request.get_json() or {}
        body = (data.get("body") or "").strip()

        if not body:
            return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Message body is required"}}), 400

        gym = Gym.query.get(g.gym_id)
        if not gym or not gym.whatsapp_enabled:
            return jsonify({"success": False, "error": {"code": "WHATSAPP_DISABLED", "message": "WhatsApp is not enabled"}}), 400

        ws = WhatsAppService(gym)
        res = ws.send_text(to=conv.phone, body=body)

        provider_id = None
        if res.ok and isinstance(res.data, dict):
            messages = res.data.get("messages") or []
            if messages:
                provider_id = messages[0].get("id")

        msg = BotMessage(
            conversation_id=conv.id,
            sender="staff",
            body=body,
            provider_message_id=provider_id,
        )
        db.session.add(msg)
        conv.handover_status = "human_active"
        conv.active_staff_id = g.user_id
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
    def get_bot_config():
        config = GymBotConfig.query.filter_by(gym_id=g.gym_id).first()
        if not config:
            config = GymBotConfig(gym_id=g.gym_id)
            db.session.add(config)
            db.session.commit()

        faqs = BotFAQ.query.filter_by(gym_id=g.gym_id).order_by(BotFAQ.priority.desc()).all()

        return jsonify({
            "success": True,
            "data": {
                "config": {
                    "greeting_message": config.greeting_message,
                    "opening_hours": config.opening_hours,
                    "map_link": config.map_link,
                    "trial_enabled": config.trial_enabled,
                    "trial_price": str(config.trial_price) if config.trial_price else None,
                    "trial_duration_days": config.trial_duration_days,
                    "registration_link": config.registration_link,
                    "handover_enabled": config.handover_enabled,
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
    def update_bot_config():
        config = GymBotConfig.query.filter_by(gym_id=g.gym_id).first()
        if not config:
            config = GymBotConfig(gym_id=g.gym_id)
            db.session.add(config)

        data = request.get_json() or {}
        if "greeting_message" in data:
            config.greeting_message = data["greeting_message"]
        if "opening_hours" in data:
            config.opening_hours = data["opening_hours"]
        if "map_link" in data:
            config.map_link = data["map_link"]
        if "trial_enabled" in data:
            config.trial_enabled = bool(data["trial_enabled"])
        if "trial_price" in data:
            config.trial_price = data["trial_price"]
        if "trial_duration_days" in data:
            config.trial_duration_days = data["trial_duration_days"]
        if "registration_link" in data:
            config.registration_link = data["registration_link"]
        if "handover_enabled" in data:
            config.handover_enabled = bool(data["handover_enabled"])

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
    def test_bot_message():
        data = request.get_json() or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify({"success": False, "error": {"code": "VALIDATION_ERROR", "message": "Message is required"}}), 400

        gym = Gym.query.get(g.gym_id)
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

