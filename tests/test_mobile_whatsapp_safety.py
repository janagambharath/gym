from __future__ import annotations

from unittest.mock import patch

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import ReminderLog
from app.services.whatsapp_service import WhatsAppService


def test_disabled_whatsapp_delivery_never_claims_a_sent_message(seed_gym):
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    gym.phone_number_id = "test-phone-number-id"
    db.session.commit()

    service = WhatsAppService(gym)
    first = service.send_text(to="919999900001", body="First message")
    second = service.send_text(to="919999900002", body="Second message")
    template = service.send_template(
        to="919999900003",
        template_name="renewal_reminder",
        language_code="en_US",
    )
    image = service.send_image(
        to="919999900004",
        image_url="https://example.test/reminder.png",
        caption="Image message",
    )

    for result in (first, second, template, image):
        assert not result.ok
        assert result.provider_message_id is None
        assert result.error == "WhatsApp delivery is disabled by the server configuration"


@patch("app.mobile_api.whatsapp.send_reminder")
def test_mobile_manual_reminder_requires_member_whatsapp_opt_in(
    send_reminder, client, seed_gym, seed_member
):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    gym.whatsapp_enabled = True
    gym.phone_number_id = "test-phone-number-id"
    db.session.commit()

    token = create_access_token(owner.id, gym.id, owner.role)
    response = client.post(
        "/api/mobile/v1/whatsapp/send-reminder",
        headers={"Authorization": f"Bearer {token}"},
        json={"member_id": seed_member.id},
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "WHATSAPP_OPT_IN_REQUIRED"
    send_reminder.assert_not_called()
    assert ReminderLog.query.filter_by(
        gym_id=gym.id,
        member_id=seed_member.id,
    ).count() == 0
