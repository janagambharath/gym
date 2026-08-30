from __future__ import annotations

from decimal import Decimal

import pytest

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


@pytest.mark.parametrize(
    "amount_payload",
    [
        {},
        {"amount": None},
        {"amount": ""},
        {"amount": "   "},
        {"amount": True},
        {"amount": "-0.01"},
        {"amount": "NaN"},
        {"amount": "Infinity"},
        {"amount": "10.001"},
        {"amount": "100000000.00"},
    ],
    ids=[
        "missing",
        "null",
        "empty",
        "whitespace",
        "boolean",
        "negative",
        "nan",
        "infinity",
        "fractional-cent",
        "too-large",
    ],
)
def test_mobile_direct_renewal_rejects_unsafe_amounts(
    client, seed_gym, seed_member, amount_payload
):
    headers = _headers(seed_gym, f"unsafe-renewal-amount-{str(amount_payload)}")
    response = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=headers,
        json={"renewal_days": 30, **amount_payload},
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert RenewalHistory.query.filter_by(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
    ).count() == 0


def test_mobile_direct_renewal_allows_explicit_complimentary_amount(
    client, seed_gym, seed_member
):
    response = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=_headers(seed_gym, "complimentary-manual-renewal"),
        json={"renewal_days": 30, "amount": "0.00"},
    )

    assert response.status_code == 201
    renewal = RenewalHistory.query.filter_by(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
    ).one()
    assert renewal.amount == Decimal("0.00")
