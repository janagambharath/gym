"""Test mobile push token registration, in-app notifications, and dispatch triggers."""
from __future__ import annotations

from unittest.mock import patch

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import AppNotification, UserPushToken
from app.models.bot import BotConversation, BotLead
from app.services.push_notification_service import (
    notify_expiring_members_daily,
    notify_handover_requested,
    notify_new_lead,
    notify_new_payment,
    notify_trial_requested,
)


def _auth_headers(user, gym) -> dict[str, str]:
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def test_register_and_unregister_push_token(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    headers = _auth_headers(owner, gym)

    # Register token
    res = client.post(
        "/api/mobile/v1/notifications/register-token",
        headers=headers,
        json={
            "push_token": "ExponentPushToken[test_token_12345]",
            "device_name": "Pixel 7",
            "platform": "android",
        },
    )
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    record = UserPushToken.query.filter_by(
        gym_id=gym.id, user_id=owner.id, push_token="ExponentPushToken[test_token_12345]"
    ).first()
    assert record is not None
    assert record.is_active is True

    # Unregister token
    unreg_res = client.post(
        "/api/mobile/v1/notifications/unregister-token",
        headers=headers,
        json={"push_token": "ExponentPushToken[test_token_12345]"},
    )
    assert unreg_res.status_code == 200
    db.session.refresh(record)
    assert record.is_active is False


def test_notification_inbox_and_mark_read(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    headers = _auth_headers(owner, gym)

    # Create dummy notification
    notif = AppNotification(
        gym_id=gym.id,
        user_id=owner.id,
        title="🚨 Test Handover Alert",
        body="Customer requested staff assistance",
        category="handover",
        data={"conversation_id": 99},
        is_read=False,
    )
    db.session.add(notif)
    db.session.commit()

    # Query unread count
    count_res = client.get("/api/mobile/v1/notifications/unread-count", headers=headers)
    assert count_res.status_code == 200
    assert count_res.get_json()["data"]["unread_count"] >= 1

    # List notifications
    list_res = client.get("/api/mobile/v1/notifications", headers=headers)
    assert list_res.status_code == 200
    items = list_res.get_json()["data"]["notifications"]
    assert any(n["id"] == notif.id for n in items)

    # Mark single notification as read
    read_res = client.post(f"/api/mobile/v1/notifications/{notif.id}/read", headers=headers)
    assert read_res.status_code == 200
    db.session.refresh(notif)
    assert notif.is_read is True


@patch("app.services.push_notification_service.send_expo_push_messages")
def test_push_triggers_dispatch_and_save_records(mock_expo_send, client, seed_gym):
    mock_expo_send.return_value = [{"status": "ok"}]
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    # Register active token
    token = UserPushToken(
        gym_id=gym.id,
        user_id=owner.id,
        push_token="ExponentPushToken[real_looking_token_abc]",
        is_active=True,
    )
    db.session.add(token)
    db.session.commit()

    conv = BotConversation(
        gym_id=gym.id,
        phone="919876543210",
        customer_name="Rohan Verma",
        handover_status="human_requested",
    )
    db.session.add(conv)
    db.session.commit()

    notify_handover_requested(gym, conv, "I want to talk to gym owner")

    # Verify AppNotification record created
    saved = AppNotification.query.filter_by(gym_id=gym.id, category="handover").first()
    assert saved is not None
    assert "Rohan Verma" in saved.title
    assert mock_expo_send.called
