"""Unit tests for Mobile API Staff, Reports, and WhatsApp Bot endpoints."""
from datetime import date, timedelta
from unittest.mock import patch

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, User
from app.models.bot import BotConversation, BotEvent, BotLead, BotMessage, FeatureEntitlement
from app.services.whatsapp_service import WhatsAppResult


def test_staff_list_endpoint(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    
    # Add staff user
    staff = User(
        gym_id=gym.id,
        email="staff@testgym.com",
        full_name="Staff Trainer",
        role="staff",
    )
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()

    owner_token = create_access_token(owner.id, gym.id, owner.role)
    staff_token = create_access_token(staff.id, gym.id, staff.role)

    # Owner can view staff list
    res = client.get(
        "/api/mobile/v1/staff",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert len(data["staff"]) == 2

    # Staff user cannot access owner-only staff list
    res_staff = client.get(
        "/api/mobile/v1/staff",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert res_staff.status_code == 403


def test_reports_summary_endpoint(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    member = Member(
        gym_id=gym.id,
        full_name="John Active",
        phone="919876543210",
        status="active",
        membership_start=date.today() - timedelta(days=10),
        membership_end=date.today() + timedelta(days=20),
    )
    db.session.add(member)
    db.session.commit()

    owner_token = create_access_token(owner.id, gym.id, owner.role)
    res = client.get(
        "/api/mobile/v1/reports/summary?period=30d",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert "members" in data
    assert data["members"]["total"] == 1
    assert data["members"]["active"] == 1
    assert "revenue" in data


def test_bot_leads_and_conversations_flow(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    db.session.add(
        FeatureEntitlement(
            gym_id=gym.id,
            feature="whatsapp_bot",
            enabled=True,
        )
    )
    conv = BotConversation(
        gym_id=gym.id,
        phone="919999988888",
        customer_name="Prospective Member",
        state="plan_discovery",
        handover_status="bot_active",
    )
    db.session.add(conv)
    db.session.flush()

    lead = BotLead(
        gym_id=gym.id,
        conversation_id=conv.id,
        name="Prospective Member",
        phone="919999988888",
        intent="pricing_enquiry",
        status="new",
    )
    db.session.add(lead)
    db.session.commit()

    owner_token = create_access_token(owner.id, gym.id, owner.role)

    # List leads
    res = client.get(
        "/api/mobile/v1/bot/leads",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert res.status_code == 200
    leads = res.get_json()["data"]["leads"]
    assert len(leads) == 1
    assert leads[0]["phone"] == "919999988888"

    # Update lead status
    patch_res = client.patch(
        f"/api/mobile/v1/bot/leads/{lead.id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"status": "contacted", "notes": "Called prospect, offered free session"},
    )
    assert patch_res.status_code == 200
    assert patch_res.get_json()["data"]["lead"]["status"] == "contacted"

    # Handover toggle
    handover_res = client.post(
        f"/api/mobile/v1/bot/conversations/{conv.id}/handover",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"action": "take_over"},
    )
    assert handover_res.status_code == 200
    assert handover_res.get_json()["data"]["handover_status"] == "human_active"
    assert BotEvent.query.filter_by(
        gym_id=gym.id,
        conversation_id=conv.id,
        event_type="human_takeover",
    ).count() == 1


@patch("app.mobile_api.bot.WhatsAppService")
def test_staff_message_records_only_after_provider_accepts_it(mock_whatsapp, client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    gym.whatsapp_enabled = True
    db.session.add(
        FeatureEntitlement(gym_id=gym.id, feature="whatsapp_bot", enabled=True)
    )
    conversation = BotConversation(
        gym_id=gym.id,
        phone="919999977777",
        handover_status="bot_active",
    )
    db.session.add(conversation)
    db.session.commit()

    mock_whatsapp.return_value.send_text.return_value = WhatsAppResult(
        ok=True,
        provider_message_id="wamid.staff.1",
    )
    owner_token = create_access_token(owner.id, gym.id, owner.role)

    response = client.post(
        f"/api/mobile/v1/bot/conversations/{conversation.id}/message",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"body": "I can help with your visit."},
    )

    assert response.status_code == 200
    message = BotMessage.query.filter_by(conversation_id=conversation.id).one()
    assert message.sender == "staff"
    assert message.provider_message_id == "wamid.staff.1"
    assert BotEvent.query.filter_by(
        gym_id=gym.id,
        conversation_id=conversation.id,
        event_type="staff_message_sent",
        provider_message_id="wamid.staff.1",
    ).count() == 1


@patch("app.mobile_api.bot.WhatsAppService")
def test_staff_message_provider_failure_does_not_create_a_false_sent_message(
    mock_whatsapp, client, seed_gym
):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    gym.whatsapp_enabled = True
    db.session.add(
        FeatureEntitlement(gym_id=gym.id, feature="whatsapp_bot", enabled=True)
    )
    conversation = BotConversation(
        gym_id=gym.id,
        phone="919999966666",
        handover_status="bot_active",
    )
    db.session.add(conversation)
    db.session.commit()

    mock_whatsapp.return_value.send_text.return_value = WhatsAppResult(
        ok=False,
        error="Provider unavailable",
    )
    owner_token = create_access_token(owner.id, gym.id, owner.role)

    response = client.post(
        f"/api/mobile/v1/bot/conversations/{conversation.id}/message",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"body": "I can help with your visit."},
    )

    assert response.status_code == 502
    assert response.get_json()["error"]["code"] == "WHATSAPP_SEND_FAILED"
    assert BotMessage.query.filter_by(conversation_id=conversation.id).count() == 0
    assert BotEvent.query.filter_by(conversation_id=conversation.id).count() == 0
    assert db.session.get(BotConversation, conversation.id).handover_status == "bot_active"
