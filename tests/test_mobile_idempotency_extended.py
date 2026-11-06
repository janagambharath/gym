"""Regression coverage for the extended Idempotency-Key honouring.

Covers the endpoints added in the PWA-vs-Android parity gap fix: a
double-submit with the same key must execute once and replay the
stored response, a request without a key must work exactly as before,
and a key reused for a different request must 409.
"""
from __future__ import annotations

from datetime import timedelta

from app.mobile_api.token_service import create_access_token
from app.models import Member, MobileIdempotencyKey, RenewalHistory, User
from app.models.rrr import RRRIdentityMapping


def _headers(seed_gym, key: str | None = None) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    headers = {"Authorization": f"Bearer {token}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _create_pending_payment(client, seed_gym, seed_member, amount="1000.00"):
    payload = {
        "member_id": seed_member.id,
        "amount": amount,
        "method": "upi",
        "renewal_days": 30,
    }
    res = client.post("/api/mobile/v1/payments", headers=_headers(seed_gym), json=payload)
    assert res.status_code == 201, res.get_json()
    return res.get_json()["data"]["id"]


def test_verify_payment_retry_replays_one_verification(client, seed_gym, seed_member):
    payment_id = _create_pending_payment(client, seed_gym, seed_member)
    headers = _headers(seed_gym, "verify-retry-001")
    original_end = seed_member.membership_end

    first = client.post(f"/api/mobile/v1/payments/{payment_id}/verify", headers=headers)
    second = client.post(f"/api/mobile/v1/payments/{payment_id}/verify", headers=headers)

    assert first.status_code == 200, first.get_json()
    assert second.status_code == 200
    assert first.get_json() == second.get_json()
    # Exactly one renewal row: the retry did not verify (and extend) twice.
    # The member is still active, so the renewal is SCHEDULED (starts the
    # day after the current end) rather than applied immediately — the
    # end itself does not move until activation.
    history = RenewalHistory.query.filter_by(
        gym_id=seed_gym["gym"].id, member_id=seed_member.id
    ).all()
    assert len(history) == 1
    assert history[0].new_start == original_end + timedelta(days=1)
    assert history[0].new_end == original_end + timedelta(days=30)
    member = Member.query.get(seed_member.id)
    assert member.membership_end == original_end


def test_verify_payment_without_key_still_works(client, seed_gym, seed_member):
    payment_id = _create_pending_payment(client, seed_gym, seed_member)

    first = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify", headers=_headers(seed_gym)
    )
    assert first.status_code == 200, first.get_json()
    # No-key behaviour is unchanged: a second verify still 409s.
    second = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify", headers=_headers(seed_gym)
    )
    assert second.status_code == 409
    assert second.get_json()["error"]["code"] == "CONFLICT"


def test_verify_payment_key_reused_for_other_payment_409(client, seed_gym, seed_member):
    first_id = _create_pending_payment(client, seed_gym, seed_member)
    second_id = _create_pending_payment(client, seed_gym, seed_member)
    headers = _headers(seed_gym, "verify-reused-001")

    assert (
        client.post(f"/api/mobile/v1/payments/{first_id}/verify", headers=headers).status_code
        == 200
    )
    replay = client.post(f"/api/mobile/v1/payments/{second_id}/verify", headers=headers)

    assert replay.status_code == 409
    assert replay.get_json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    # The second payment was never verified.
    assert (
        RenewalHistory.query.filter_by(
            gym_id=seed_gym["gym"].id, member_id=seed_member.id
        ).count()
        == 1
    )


def test_staff_create_retry_replays_same_password(client, seed_gym):
    headers = _headers(seed_gym, "staff-retry-001")
    payload = {"full_name": "Test Staff", "email": "staff1@testgym.com"}

    first = client.post("/api/mobile/v1/staff", headers=headers, json=payload)
    second = client.post("/api/mobile/v1/staff", headers=headers, json=payload)

    assert first.status_code == 201, first.get_json()
    assert second.status_code == 201
    assert first.get_json() == second.get_json()
    # One account, and the replay returned the SAME temp password —
    # the retry did not generate (and set) a second one.
    assert User.query.filter_by(email="staff1@testgym.com").count() == 1
    assert first.get_json()["data"]["temp_password"]
    assert (
        first.get_json()["data"]["temp_password"]
        == second.get_json()["data"]["temp_password"]
    )


def test_freeze_member_retry_extends_end_once(client, seed_gym, seed_member):
    headers = _headers(seed_gym, "freeze-retry-001")
    original_end = seed_member.membership_end

    first = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )
    second = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )

    assert first.status_code == 200, first.get_json()
    assert second.status_code == 200
    assert first.get_json() == second.get_json()
    member = Member.query.get(seed_member.id)
    assert member.status == "paused"
    # Extended exactly once (14 days), not twice.
    assert member.membership_end == original_end + timedelta(days=14)


def test_bulk_resolve_retry_links_once(client, seed_gym, seed_member):
    headers = _headers(seed_gym, "bulk-resolve-retry-001")
    payload = {"mappings": [{"external_id": "77", "member_id": seed_member.id}]}

    first = client.post("/api/mobile/v1/rrr/mappings/bulk-resolve", headers=headers, json=payload)
    second = client.post("/api/mobile/v1/rrr/mappings/bulk-resolve", headers=headers, json=payload)

    assert first.status_code == 200, first.get_json()
    assert second.status_code == 200
    assert first.get_json() == second.get_json()
    assert first.get_json()["data"]["linked"] == 1
    assert (
        RRRIdentityMapping.query.filter_by(
            gym_id=seed_gym["gym"].id, external_id="77"
        ).count()
        == 1
    )


def test_overlong_key_rejected_on_new_endpoints(client, seed_gym, seed_member):
    headers = _headers(seed_gym, "x" * 129)
    res = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 14},
    )
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "VALIDATION_ERROR"
    # Nothing was frozen by the rejected request.
    assert Member.query.get(seed_member.id).status == "active"


def test_idempotency_records_are_scoped_per_endpoint(client, seed_gym, seed_member):
    """The same key on two different endpoints must not collide."""
    key = "shared-key-across-scopes-001"
    headers = _headers(seed_gym, key)

    freeze = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/freeze",
        headers=headers,
        json={"days": 7},
    )
    assert freeze.status_code == 200, freeze.get_json()
    # Same key, different endpoint (unfreeze): must execute, not replay.
    unfreeze = client.post(
        f"/api/mobile/v1/members/{seed_member.id}/unfreeze", headers=headers
    )
    assert unfreeze.status_code == 200, unfreeze.get_json()
    assert Member.query.get(seed_member.id).status == "active"
    assert (
        MobileIdempotencyKey.query.filter_by(
            gym_id=seed_gym["gym"].id, key=key
        ).count()
        == 2
    )
