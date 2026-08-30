from __future__ import annotations

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token


def _headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


@pytest.mark.parametrize(
    ("stored", "enabled", "phone_id", "expected"),
    [
        ("NOT_CONNECTED", False, None, "NOT_CONNECTED"),
        ("PENDING", False, None, "PENDING"),
        ("ACTION_REQUIRED", False, None, "ACTION_REQUIRED"),
        ("FAILED", False, None, "FAILED"),
        ("NOT_CONNECTED", True, "phone-id", "CONNECTED"),
    ],
)
def test_mobile_whatsapp_status_is_backend_confirmed(
    client, seed_gym, stored, enabled, phone_id, expected
):
    gym = seed_gym["gym"]
    gym.whatsapp_connection_status = stored
    gym.whatsapp_enabled = enabled
    gym.phone_number_id = phone_id
    db.session.commit()

    response = client.get("/api/mobile/v1/whatsapp/status", headers=_headers(seed_gym))
    assert response.status_code == 200
    assert response.get_json()["data"]["state"] == expected
