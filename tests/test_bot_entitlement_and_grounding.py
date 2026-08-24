"""Focused regression tests for bot entitlement and grounded fallback behavior."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models.bot import BotConversation, BotEvent, BotLead, BotMessage
from app.services.ai_router import AIRouter
from app.services.bot_service import BotService
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.webhooks.whatsapp import _process_message


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/api/mobile/v1/bot/leads", None),
        ("get", "/api/mobile/v1/bot/leads/999", None),
        ("patch", "/api/mobile/v1/bot/leads/999", {"status": "contacted"}),
        ("get", "/api/mobile/v1/bot/conversations", None),
        ("post", "/api/mobile/v1/bot/conversations/999/handover", {"action": "take_over"}),
        ("post", "/api/mobile/v1/bot/conversations/999/message", {"body": "Hello"}),
        ("get", "/api/mobile/v1/bot/config", None),
        ("patch", "/api/mobile/v1/bot/config", {"opening_hours": "Configured only"}),
        ("post", "/api/mobile/v1/bot/test", {"message": "Hello"}),
        ("get", "/api/mobile/v1/bot/stats", None),
    ],
)
def test_mobile_bot_routes_are_denied_without_whatsapp_bot_entitlement(
    client, seed_gym, method, path, payload
):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    token = create_access_token(owner.id, gym.id, owner.role)

    request_kwargs = {"headers": {"Authorization": f"Bearer {token}"}}
    if payload is not None:
        request_kwargs["json"] = payload
    response = getattr(client, method)(path, **request_kwargs)

    assert response.status_code == 403
    assert response.get_json() == {
        "success": False,
        "error": {
            "code": "FEATURE_NOT_ENABLED",
            "message": "WhatsApp AI Bot is not enabled for this gym.",
        },
    }


def test_unentitled_unknown_sender_does_not_start_bot(seed_gym):
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    db.session.commit()

    message = {
        "id": "unknown-sender-message",
        "from": "919111222333",
        "type": "text",
        "text": {"body": "What are your plans?"},
    }

    with patch("app.webhooks.whatsapp.BotService") as bot_service:
        changed = _process_message(gym, message)

    assert changed is False
    bot_service.assert_not_called()
    assert BotConversation.query.filter_by(gym_id=gym.id).count() == 0
    assert BotLead.query.filter_by(gym_id=gym.id).count() == 0


def test_known_member_whatsapp_flow_is_not_gated_by_bot_entitlement(seed_member):
    gym = seed_member.gym
    gym.whatsapp_enabled = True
    db.session.commit()

    message = {
        "id": "known-member-message",
        "from": seed_member.phone.lstrip("+"),
        "type": "text",
        "text": {"body": "Hello"},
    }

    with patch.object(
        WhatsAppService,
        "send_text",
        return_value=WhatsAppResult(ok=True, provider_message_id="welcome-message"),
    ) as send_text:
        changed = _process_message(gym, message)

    assert changed is True
    assert seed_member.whatsapp_opted_in is True
    send_text.assert_called_once()


def test_deterministic_fallback_does_not_invent_unconfigured_bot_facts(seed_gym):
    gym = seed_gym["gym"]
    router = AIRouter(gym)
    conversation = BotConversation(gym_id=gym.id, phone="919999900001")
    lead = BotLead(gym_id=gym.id, phone="919999900001")

    hours_response, _, hours_handover = router._conversational_fallback(
        "What are your hours on Sunday?", conversation, lead
    )
    trial_response, _, trial_handover = router._conversational_fallback(
        "Do you offer a trial?", conversation, lead
    )
    facilities_response, _, facilities_handover = router._conversational_fallback(
        "What facilities do you have?", conversation, lead
    )

    assert "6:00 AM" not in hours_response
    assert "don't have" in hours_response.lower()
    assert "free 1-day" not in trial_response.lower()
    assert "don't have" in trial_response.lower()
    assert "cardio & strength zone" not in facilities_response.lower()
    assert "don't have" in facilities_response.lower()
    assert hours_handover is True
    assert trial_handover is True
    assert facilities_handover is True


def test_bot_reply_history_only_contains_provider_accepted_messages(seed_gym):
    gym = seed_gym["gym"]
    service = BotService(gym)
    delivered = BotConversation(gym_id=gym.id, phone="919999900011")
    failed = BotConversation(gym_id=gym.id, phone="919999900012")
    db.session.add_all([delivered, failed])
    db.session.flush()

    with patch.object(
        WhatsAppService,
        "send_text",
        return_value=WhatsAppResult(ok=True, provider_message_id="wamid.bot.1"),
    ):
        assert service._send_reply(delivered, "Welcome!") is True

    with patch.object(
        WhatsAppService,
        "send_text",
        return_value=WhatsAppResult(ok=False, error="Provider unavailable"),
    ):
        assert service._send_reply(failed, "Welcome!") is False

    db.session.commit()
    assert BotMessage.query.filter_by(conversation_id=delivered.id).count() == 1
    assert BotMessage.query.filter_by(conversation_id=failed.id).count() == 0
    assert BotEvent.query.filter_by(
        conversation_id=delivered.id,
        event_type="bot_reply_sent",
        provider_message_id="wamid.bot.1",
    ).count() == 1
    assert BotEvent.query.filter_by(
        conversation_id=failed.id,
        event_type="bot_reply_failed",
    ).count() == 1
