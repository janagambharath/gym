"""Focused coverage for the bounded mobile bot conversation-detail API."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym
from app.models.bot import (
    BotConversation,
    BotLead,
    BotMessage,
    FeatureEntitlement,
    GymBotConfig,
)


def _headers(owner, gym):
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def _enable_whatsapp_bot(gym):
    db.session.add(
        FeatureEntitlement(
            gym_id=gym.id,
            feature="whatsapp_bot",
            enabled=True,
        )
    )


def test_conversation_detail_returns_latest_ordered_safe_history_and_lead_summary(
    client, seed_gym
):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    _enable_whatsapp_bot(gym)

    conversation = BotConversation(
        gym_id=gym.id,
        phone="919999988888",
        customer_name="Prospective Member",
        state="plan_discovery",
        handover_status="human_requested",
        last_message_at=datetime(2026, 8, 24, 8, 0, tzinfo=timezone.utc),
    )
    db.session.add(conversation)
    db.session.flush()

    lead = BotLead(
        gym_id=gym.id,
        conversation_id=conversation.id,
        name="Prospective Member",
        phone="919999988888",
        source="whatsapp",
        intent="pricing_enquiry",
        status="interested",
        interested_plan="Premium",
        trial_requested=True,
        notes="Internal staff-only note",
    )
    db.session.add(lead)

    first_message_at = datetime(2026, 8, 24, 6, 0, tzinfo=timezone.utc)
    for number in range(105):
        db.session.add(
            BotMessage(
                conversation_id=conversation.id,
                sender="customer" if number % 2 == 0 else "bot",
                body=f"message-{number}",
                created_at=first_message_at + timedelta(minutes=number),
            )
        )
    db.session.commit()

    response = client.get(
        f"/api/mobile/v1/bot/conversations/{conversation.id}",
        headers=_headers(owner, gym),
    )

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert set(data["conversation"]) == {
        "id",
        "phone",
        "customer_name",
        "state",
        "handover_status",
        "last_message_at",
    }
    assert data["conversation"] == {
        "id": conversation.id,
        "phone": "919999988888",
        "customer_name": "Prospective Member",
        "state": "plan_discovery",
        "handover_status": "human_requested",
        "last_message_at": conversation.last_message_at.isoformat(),
    }
    assert len(data["messages"]) == 100
    assert [message["body"] for message in data["messages"]] == [
        f"message-{number}" for number in range(5, 105)
    ]
    assert set(data["messages"][0]) == {"id", "sender", "body", "created_at"}

    assert set(data["lead"]) == {
        "id",
        "name",
        "phone",
        "source",
        "intent",
        "status",
        "interested_plan",
        "trial_requested",
        "created_at",
    }
    assert data["lead"] == {
        "id": lead.id,
        "name": "Prospective Member",
        "phone": "919999988888",
        "source": "whatsapp",
        "intent": "pricing_enquiry",
        "status": "interested",
        "interested_plan": "Premium",
        "trial_requested": True,
        "created_at": lead.created_at.isoformat(),
    }
    assert "notes" not in data["lead"]


def test_conversation_detail_requires_entitlement_and_never_crosses_tenant_boundary(
    client, seed_gym
):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    own_conversation = BotConversation(gym_id=gym.id, phone="919999900001")
    db.session.add(own_conversation)

    other_gym = Gym(
        name="Other Gym",
        slug="other-gym",
        email="owner@other-gym.test",
        status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=14),
    )
    db.session.add(other_gym)
    db.session.flush()
    foreign_conversation = BotConversation(gym_id=other_gym.id, phone="919999900002")
    db.session.add(foreign_conversation)
    db.session.commit()

    headers = _headers(owner, gym)
    denied = client.get(
        f"/api/mobile/v1/bot/conversations/{own_conversation.id}",
        headers=headers,
    )
    assert denied.status_code == 403
    assert denied.get_json()["error"]["code"] == "FEATURE_NOT_ENABLED"

    _enable_whatsapp_bot(gym)
    db.session.commit()

    own_response = client.get(
        f"/api/mobile/v1/bot/conversations/{own_conversation.id}",
        headers=headers,
    )
    assert own_response.status_code == 200
    assert own_response.get_json()["data"]["lead"] is None
    assert own_response.get_json()["data"]["messages"] == []

    foreign_response = client.get(
        f"/api/mobile/v1/bot/conversations/{foreign_conversation.id}",
        headers=headers,
    )
    assert foreign_response.status_code == 404
    assert foreign_response.get_json()["error"]["code"] == "NOT_FOUND"


def test_bot_config_read_returns_defaults_without_creating_a_row(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    _enable_whatsapp_bot(gym)
    db.session.commit()

    response = client.get("/api/mobile/v1/bot/config", headers=_headers(owner, gym))

    assert response.status_code == 200
    assert response.get_json()["data"]["config"] == {
        "greeting_message": None,
        "opening_hours": None,
        "map_link": None,
        "trial_enabled": False,
        "trial_price": None,
        "trial_duration_days": None,
        "registration_link": None,
        "handover_enabled": True,
    }
    assert GymBotConfig.query.filter_by(gym_id=gym.id).count() == 0


def test_bot_config_update_rejects_invalid_types_before_creating_a_row(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    _enable_whatsapp_bot(gym)
    db.session.commit()

    response = client.patch(
        "/api/mobile/v1/bot/config",
        headers=_headers(owner, gym),
        json={"trial_enabled": "false"},
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert GymBotConfig.query.filter_by(gym_id=gym.id).count() == 0

    valid = client.patch(
        "/api/mobile/v1/bot/config",
        headers=_headers(owner, gym),
        json={
            "greeting_message": "Welcome!",
            "map_link": "https://maps.example/gym",
            "trial_enabled": False,
            "trial_price": "0.00",
            "trial_duration_days": None,
            "handover_enabled": True,
        },
    )
    assert valid.status_code == 200
    config = GymBotConfig.query.filter_by(gym_id=gym.id).one()
    assert config.trial_enabled is False
    assert config.trial_price == 0
