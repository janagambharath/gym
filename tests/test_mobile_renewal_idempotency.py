from __future__ import annotations

from app.mobile_api.token_service import create_access_token
from app.models import RenewalHistory


def _headers(seed_gym, key: str) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": key,
    }


def test_mobile_direct_renewal_retries_replay_one_membership_extension(
    client, seed_gym, seed_member
):
    headers = _headers(seed_gym, "retry-safe-renewal-001")
    payload = {"renewal_days": 30, "amount": "1000.00", "notes": "Cash renewal"}
    original_end = seed_member.membership_end

    first = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}", headers=headers, json=payload
    )
    second = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}", headers=headers, json=payload
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json() == second.get_json()
    assert RenewalHistory.query.filter_by(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
    ).count() == 1
    assert first.get_json()["data"]["previous_end"] == original_end.isoformat()


def test_mobile_direct_renewal_rejects_reused_key_for_changed_payload(
    client, seed_gym, seed_member
):
    headers = _headers(seed_gym, "retry-safe-renewal-002")
    initial = {"renewal_days": 30, "amount": "1000.00"}

    assert (
        client.post(
            f"/api/mobile/v1/renewals/{seed_member.id}",
            headers=headers,
            json=initial,
        ).status_code
        == 201
    )
    replay = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=headers,
        json={**initial, "renewal_days": 60},
    )

    assert replay.status_code == 409
    assert replay.get_json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert RenewalHistory.query.filter_by(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
    ).count() == 1
