"""WhatsApp AI Receptionist & Lead Bot Service.

Handles:
- Natural conversation flow via Multi-Tier AIRouter (OpenRouter Free Models + Conversational Fallback)
- Multi-turn state tracking and conversation memory
- Automatic Lead creation and tracking
- Staff notifications & human handover
- Test simulator for mobile Bot Test screen
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from flask import current_app

from app.extensions import db
from app.models.bot import (
    BotBookingRequest,
    BotConversation,
    BotLead,
    BotMessage,
    GymBotConfig,
)
from app.models.gym import Gym
from app.services.ai_router import AIRouter
from app.services.whatsapp_service import WhatsAppService

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


class BotService:
    def __init__(self, gym: Gym):
        self.gym = gym
        self.config = GymBotConfig.query.filter_by(gym_id=gym.id).first()
        self.whatsapp = WhatsAppService(gym)
        self.ai_router = AIRouter(gym)

    def handle_inbound_message(
        self,
        phone: str,
        message_body: str,
        provider_message_id: str | None = None,
        customer_name: str | None = None,
    ) -> bool:
        """Process an inbound message from a non-member or prospective lead."""
        phone = phone.strip().lstrip("+")
        clean_text = (message_body or "").strip()

        # 1. Get or create conversation
        conversation = BotConversation.query.filter_by(
            gym_id=self.gym.id, phone=phone
        ).first()

        if not conversation:
            conversation = BotConversation(
                gym_id=self.gym.id,
                phone=phone,
                customer_name=customer_name,
                state="new",
                handover_status="bot_active",
                last_message_at=_utcnow(),
            )
            db.session.add(conversation)
            db.session.flush()

        # Deduplication check for provider_message_id
        if provider_message_id:
            existing_msg = BotMessage.query.filter_by(
                provider_message_id=provider_message_id
            ).first()
            if existing_msg:
                return False

        # Record inbound message
        inbound_msg = BotMessage(
            conversation_id=conversation.id,
            sender="customer",
            body=clean_text,
            provider_message_id=provider_message_id,
        )
        db.session.add(inbound_msg)
        conversation.last_message_at = _utcnow()
        if customer_name and not conversation.customer_name:
            conversation.customer_name = customer_name

        # 2. Get or create lead
        lead = BotLead.query.filter_by(gym_id=self.gym.id, phone=phone).first()
        if not lead:
            lead = BotLead(
                gym_id=self.gym.id,
                conversation_id=conversation.id,
                name=customer_name or conversation.customer_name,
                phone=phone,
                source="whatsapp",
                status="new",
            )
            db.session.add(lead)
            db.session.flush()

        # 3. Check for human handover status
        if conversation.handover_status == "human_active":
            if clean_text.lower() in {"#bot", "#start", "start bot", "restart"}:
                conversation.handover_status = "bot_active"
                conversation.state = "new"
                reply = f"🤖 AI Receptionist reactivated for *{self.gym.name}*! How can I help you today?"
                self._send_reply(conversation, reply)
                return True
            # In human_active mode, silence bot so staff can chat directly
            return True

        # 4. Fetch recent messages for multi-turn context
        recent_raw = (
            BotMessage.query.filter_by(conversation_id=conversation.id)
            .order_by(BotMessage.created_at.desc())
            .limit(6)
            .all()
        )
        recent_messages = [
            {"sender": m.sender, "body": m.body} for m in reversed(recent_raw)
        ]

        # 5. Generate response using multi-tier AI Router
        reply_text, intent, is_handover = self.ai_router.route_and_generate(
            conversation=conversation,
            lead=lead,
            incoming_text=clean_text,
            recent_messages=recent_messages,
        )

        if is_handover:
            conversation.handover_status = "human_requested"

        if reply_text:
            self._send_reply(conversation, reply_text)

        return True

    def test_generate_response(self, message_text: str) -> dict[str, Any]:
        """Simulates AI bot response generation for mobile Bot Test screen (NO real WhatsApp send)."""
        clean_text = (message_text or "").strip()

        # Temporary dummy conversation and lead for evaluation
        dummy_conv = BotConversation(
            gym_id=self.gym.id,
            phone="919999900000",
            state="testing",
            handover_status="bot_active",
        )
        dummy_lead = BotLead(
            gym_id=self.gym.id,
            phone="919999900000",
            name="Test User",
            status="test",
        )

        reply_text, intent, is_handover = self.ai_router.route_and_generate(
            conversation=dummy_conv,
            lead=dummy_lead,
            incoming_text=clean_text,
            recent_messages=[],
        )

        return {
            "input": clean_text,
            "response": reply_text,
            "intent": intent,
            "handover": is_handover,
            "lead_captured": {
                "name": dummy_lead.name,
                "interested_plan": dummy_lead.interested_plan,
                "status": dummy_lead.status,
                "notes": dummy_lead.notes,
            },
        }

    def _send_reply(self, conversation: BotConversation, text: str) -> None:
        """Send outbound text to user via WhatsApp and record it in database."""
        res = self.whatsapp.send_text(to=conversation.phone, body=text)
        provider_id = res.provider_message_id if res.ok else None

        outbound_msg = BotMessage(
            conversation_id=conversation.id,
            sender="bot",
            body=text,
            provider_message_id=provider_id,
        )
        db.session.add(outbound_msg)
