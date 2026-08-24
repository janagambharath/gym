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


def test_mobile_delete_payment_cleans_up_safely(client, seed_gym, seed_member):
    headers = _headers(seed_gym, "del-payment-key-01")
    payload = {
        "member_id": seed_member.id,
        "amount": "500.00",
        "method": "upi",
        "renewal_days": 30,
    }
    create_res = client.post("/api/mobile/v1/payments", headers=headers, json=payload)
    assert create_res.status_code == 201
    payment_id = create_res.get_json()["data"]["id"]

    # Delete payment
    del_res = client.delete(f"/api/mobile/v1/payments/{payment_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.get_json()["success"] is True
    assert PaymentVerification.query.get(payment_id) is None

