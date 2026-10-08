"""Owner operations API: front-desk leads, daily queue and cash close."""
from __future__ import annotations

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import GymCashClose
from app.models.bot import BotLead


def _headers(seed_gym):
    token = create_access_token(
        seed_gym["owner"].id, seed_gym["gym"].id, seed_gym["owner"].role
    )
    return {"Authorization": f"Bearer {token}"}


def test_owner_can_run_manual_lead_pipeline_without_bot_entitlement(client, seed_gym):
    headers = _headers(seed_gym)
    create = client.post(
        "/api/mobile/v1/owner/leads",
        headers=headers,
        json={
            "name": "Walk In Member",
            "phone": "9876543210",
            "source": "walk_in",
            "next_follow_up_at": "2026-10-09T09:00:00Z",
            "trial_requested": True,
        },
    )
    assert create.status_code == 201
    lead = create.get_json()["data"]["lead"]
    assert lead["phone"] == "+919876543210"
    assert lead["status"] == "trial_requested"

    update = client.patch(
        f"/api/mobile/v1/owner/leads/{lead['id']}",
        headers=headers,
        json={"status": "booked", "trial_scheduled_for": "2026-10-10T18:30:00+05:30"},
    )
    assert update.status_code == 200
    assert update.get_json()["data"]["lead"]["status"] == "booked"

    listed = client.get("/api/mobile/v1/owner/leads", headers=headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.get_json()["data"]["leads"]] == [lead["id"]]


def test_owner_today_and_cash_close_are_tenant_scoped(client, seed_gym):
    headers = _headers(seed_gym)
    gym_id = seed_gym["gym"].id
    db.session.add(BotLead(gym_id=gym_id, name="Due Follow-up", phone="+919811112222", source="phone"))
    db.session.commit()

    today = client.get("/api/mobile/v1/owner/today", headers=headers)
    assert today.status_code == 200
    payload = today.get_json()["data"]
    assert payload["follow_up_count"] == 1
    assert any(action["route"] == "owner-leads" for action in payload["actions"])

    close = client.post(
        "/api/mobile/v1/owner/cash-close",
        headers=headers,
        json={"counted_cash": "245.50", "notes": "Front desk close"},
    )
    assert close.status_code == 200
    assert close.get_json()["data"]["counted_cash"] == "245.50"
    row = GymCashClose.query.filter_by(gym_id=gym_id).one()
    assert str(row.counted_cash) == "245.50"
    assert row.notes == "Front desk close"
