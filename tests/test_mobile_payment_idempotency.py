"""Regression coverage for replay-safe mobile payment creation."""
from __future__ import annotations

from app.mobile_api.token_service import create_access_token
from app.models import PaymentVerification


def _headers(seed_gym, key: str) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": key,
    }


def test_mobile_payment_retries_replay_one_financial_record(client, seed_gym, seed_member):
    payload = {
        "member_id": seed_member.id,
        "amount": "1000.00",
        "method": "upi",
        "renewal_days": 30,
    }
    headers = _headers(seed_gym, "retry-safe-payment-001")

    first = client.post("/api/mobile/v1/payments", headers=headers, json=payload)
    second = client.post("/api/mobile/v1/payments", headers=headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json() == second.get_json()
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


def test_mobile_payment_rejects_key_reused_for_different_payload(client, seed_gym, seed_member):
    headers = _headers(seed_gym, "retry-safe-payment-002")
    initial = {
        "member_id": seed_member.id,
        "amount": "1000.00",
        "method": "cash",
        "renewal_days": 30,
    }
    changed = {**initial, "amount": "1200.00"}

    assert client.post("/api/mobile/v1/payments", headers=headers, json=initial).status_code == 201
    replay = client.post("/api/mobile/v1/payments", headers=headers, json=changed)

    assert replay.status_code == 409
    assert replay.get_json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1
