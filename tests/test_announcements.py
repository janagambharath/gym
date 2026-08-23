from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.extensions import db
from app.models import Announcement, AnnouncementDelivery, Gym, Member, User
from app.models.mixins import utcnow
from app.services.announcement_service import create_announcement, dispatch_announcement
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService


@pytest.fixture
def announcement_data(app):
    gym = Gym(
        name="Festival Fitness",
        slug="festival-fitness",
        status="active",
        trial_ends_at=date.today() + timedelta(days=30),
        whatsapp_enabled=True,
        whatsapp_business_account_id="100001",
        phone_number_id="111111",
        business_phone_number="+919000000001",
    )
    db.session.add(gym)
    db.session.flush()
    owner = User(
        gym_id=gym.id,
        email="owner@example.com",
        full_name="Festival Owner",
        role="gym_owner",
    )
    owner.set_password("StrongPassword123!")
    open_chat = Member(
        gym_id=gym.id,
        full_name="Open Chat",
        phone="+919111111111",
        membership_end=date.today() + timedelta(days=30),
        whatsapp_opted_in=True,
        whatsapp_opted_in_at=utcnow(),
        last_inbound_at=utcnow(),
    )
    closed_chat = Member(
        gym_id=gym.id,
        full_name="Closed Chat",
        phone="+919222222222",
        membership_end=date.today() + timedelta(days=30),
        whatsapp_opted_in=True,
        whatsapp_opted_in_at=utcnow() - timedelta(days=2),
        last_inbound_at=utcnow() - timedelta(days=2),
    )
    no_consent = Member(
        gym_id=gym.id,
        full_name="No Consent",
        phone="+919333333333",
        membership_end=date.today() + timedelta(days=30),
        whatsapp_opted_in=False,
    )
    db.session.add_all([owner, open_chat, closed_chat, no_consent])
    db.session.commit()
    return {
        "gym": gym,
        "owner": owner,
        "open_chat": open_chat,
        "closed_chat": closed_chat,
        "no_consent": no_consent,
    }


def test_normal_announcement_only_sends_to_consented_open_chat(announcement_data):
    gym = announcement_data["gym"]
    owner = announcement_data["owner"]
    announcement = create_announcement(
        gym=gym,
        actor_user_id=owner.id,
        title="Festival hours",
        delivery_mode="session_message",
        message_body="Hi {{ member_name }}, greetings from {{ gym_name }}!",
    )
    db.session.commit()

    with patch.object(WhatsAppService, "send_text") as send_text:
        send_text.return_value = WhatsAppResult(ok=True, provider_message_id="wamid-normal")
        assert dispatch_announcement(announcement.id) is True

    send_text.assert_called_once_with(
        to="919111111111",
        body="Hi Open Chat, greetings from Festival Fitness!",
    )
    db.session.refresh(announcement)
    assert announcement.status == "completed"
    assert announcement.sent_count == 1
    assert AnnouncementDelivery.query.filter_by(announcement_id=announcement.id).count() == 1


def test_template_announcement_reaches_consented_closed_chat_but_never_unconsented(announcement_data):
    gym = announcement_data["gym"]
    owner = announcement_data["owner"]
    announcement = create_announcement(
        gym=gym,
        actor_user_id=owner.id,
        title="Happy Diwali",
        delivery_mode="approved_template",
        message_body="Meta-approved Diwali campaign.",
        template_name="diwali_greeting",
        template_language="en_US",
        template_body_parameters=["member_name", "gym_name"],
    )
    db.session.commit()

    with patch.object(WhatsAppService, "send_template") as send_template:
        send_template.return_value = WhatsAppResult(ok=True, provider_message_id="wamid-template")
        assert dispatch_announcement(announcement.id) is True

    assert send_template.call_count == 2
    recipients = {call.kwargs["to"] for call in send_template.call_args_list}
    assert recipients == {"919111111111", "919222222222"}
    assert all(call.kwargs["template_name"] == "diwali_greeting" for call in send_template.call_args_list)
    assert all(
        call.kwargs["body_parameters"] in (
            ["Open Chat", "Festival Fitness"],
            ["Closed Chat", "Festival Fitness"],
        )
        for call in send_template.call_args_list
    )
    assert "919333333333" not in recipients


def test_dashboard_broadcast_is_owner_only_and_persists_before_dispatch(
    app, client, announcement_data
):
    owner = announcement_data["owner"]
    assert client.post(
        "/auth/login",
        data={"email": owner.email, "password": "StrongPassword123!"},
    ).status_code == 302

    with patch("app.gym.routes.start_announcement_dispatch") as start_dispatch:
        response = client.post(
            "/app/dashboard/announcements",
            data={
                "title": "Festival hours",
                "delivery_mode": "approved_template",
                "message_body": "Diwali campaign",
                "template_name": "diwali_greeting",
                "template_language": "en_US",
                "template_body_parameters": "member_name,gym_name",
                "test_member_id": "0",
                "confirm_broadcast": "y",
                "send_broadcast": "Send to all eligible members",
            },
        )

    assert response.status_code == 302
    announcement = Announcement.query.one()
    assert announcement.total_recipients == 2
    assert announcement.is_test is False
    start_dispatch.assert_called_once_with(app, announcement.id)


def test_announcement_rejects_members_without_recorded_consent(announcement_data):
    gym = announcement_data["gym"]
    owner = announcement_data["owner"]
    no_consent = announcement_data["no_consent"]

    with pytest.raises(ValueError, match="Record their WhatsApp consent"):
        create_announcement(
            gym=gym,
            actor_user_id=owner.id,
            title="Test",
            delivery_mode="approved_template",
            message_body="Test",
            template_name="festival_greeting",
            template_language="en_US",
            test_member_id=no_consent.id,
        )
