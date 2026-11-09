"""Fix-all v11 backend regressions (2026-11-09).

Covers the backend findings of deep-review v11 (task scope):

* V11-H1 — duplicate phones: 409 DUPLICATE_PHONE on create/PATCH/web
  form (excluding soft-deleted), no-challenge generic OTP response when
  >1 live member in one gym shares a phone (never bind to matches[0]).
* V11-H2 — staff ₹0 direct renew / web bulk renew is 403; owner ₹0 is
  allowed and audited.
* V11-M1 — verify_payment 409s when the member was deactivated.
* V11-L1 — direct renew standard_price/discount: non-finite / 3dp are
  400s, not 500s / silent rounding.
* V11-L2 — PATCH plan_id: null is 422.
* V11-L3 — remote_unlock honours Idempotency-Key (replay, no second
  door command) and the pending-command guard still 409s.
* V11-L4 — per-endpoint limiters (verify 10/min pinned here).
* V11-L37 — announcements carry the full text + a real subject.
* V11-L38 — confirm-upi appends its note instead of overwriting.
* V11-L39 — fail-upi returns the actual outcome.
* V11-L41 — claim/renew/UPI endpoints are rate-limited (claim pinned).
* V11-L45 — ONE expiry semantic: end None -> expired, everywhere.
* V11-L46 — member money actions are audited before commit.
* V11-M10 — reject_payment records a reason and surfaces it.
* V11-M9 — gym branding logo_url is null, never the payment QR.
* V11-M8 — POST /auth/logout revokes the member refresh token.
* V11-L27 (event-rows half, follow-up addition) — `profile_photo_url`
  on the access-events payload (`_serialize_access_event`).
* V11-M6 — DOCUMENTED ONLY (product call: gym-picker vs per-gym
  login). No code, no test — see fix-all-v11-backend-state.md.

Migration note: the partial unique index
uq_members_gym_phone_active lives in migration v11backendfixall only
(defensive: skipped when live duplicates exist). It is deliberately
NOT declared on the model — the suite reuses the reserved synthetic
test phone for many members per gym, so a model-level index built by
db.create_all() would break dozens of pre-existing tests.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

import pytest

from app.extensions import db
from app.mobile_api.token_service import (
    create_access_token,
    create_member_refresh_token,
)
from app.models import Member, PaymentVerification
from app.models.audit_log import AuditLog
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.models.member import SYNTHETIC_TEST_MEMBER_PHONE
from app.models.mixins import utcnow
from app.models.qr_settings import QRSettings
from app.models.user import User


def _owner_headers(seed_gym, role="gym_owner"):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, role)}"}


def _make_staff(seed_gym):
    staff = User(gym_id=seed_gym["gym"].id, email="staff@testgym.com",
                 full_name="Staff One", role="staff")
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


def _staff_headers(seed_gym):
    return {"Authorization": f"Bearer {create_access_token(_make_staff(seed_gym).id, seed_gym['gym'].id, 'staff')}"}


def _member_headers(member):
    return {"Authorization": f"Bearer {create_access_token(member.id, member.gym_id, 'member')}"}


def _fresh_audit(action):
    """Re-query AuditLog from a FRESH session (v10 pattern)."""
    db.session.remove()
    return AuditLog.query.filter_by(action=action).all()


def _create_member_api(client, seed_gym, *, name, phone, plan_id=None):
    res = client.post(
        "/api/mobile/v1/members",
        headers=_owner_headers(seed_gym),
        json={"full_name": name, "phone": phone, **({"plan_id": plan_id} if plan_id else {})},
    )
    return res


def _expired_member(seed_gym, *, name="Expired One", phone="+919100000001", end_days_ago=31):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        membership_start=date.today() - timedelta(days=60),
        membership_end=date.today() - timedelta(days=end_days_ago),
        status="expired",
    )
    db.session.add(m)
    db.session.commit()
    return m


def _pending_payment(seed_gym, member, *, amount="1000.00", status="pending", notes=None):
    p = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        plan_id=seed_gym["plan"].id,
        amount=Decimal(amount),
        method="cash",
        channel="offline",
        status=status,
        renewal_days=30,
        notes=notes,
    )
    db.session.add(p)
    db.session.commit()
    return p


def _login_web(client, email):
    client.post(
        "/auth/login",
        data={"email": email, "password": "SecurePass123!"},
        follow_redirects=True,
    )


# ─── V11-H1: duplicate phones ─────────────────────────────────────────

def test_h1_create_duplicate_phone_409(client, seed_gym):
    res = _create_member_api(client, seed_gym, name="Asha", phone="+919999999999")
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    dup = _create_member_api(client, seed_gym, name="Bina", phone="+919999999999")
    assert dup.status_code == 409, dup.get_data(as_text=True)[:300]
    assert dup.get_json()["error"]["code"] == "DUPLICATE_PHONE"


def test_h1_patch_duplicate_phone_409(client, seed_gym):
    a = _create_member_api(client, seed_gym, name="Asha", phone="+919999999991").get_json()["data"]
    b = _create_member_api(client, seed_gym, name="Bina", phone="+919999999992").get_json()["data"]
    res = client.patch(
        f"/api/mobile/v1/members/{b['id']}",
        headers=_owner_headers(seed_gym),
        json={"phone": "+919999999991"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "DUPLICATE_PHONE"
    db.session.refresh(db.session.get(Member, b["id"]))
    assert db.session.get(Member, b["id"]).phone == "+919999999992"


def test_h1_duplicate_allowed_after_soft_delete(client, seed_gym):
    res = _create_member_api(client, seed_gym, name="Asha", phone="+919999999993")
    member_id = res.get_json()["data"]["id"]
    member = db.session.get(Member, member_id)
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()
    again = _create_member_api(client, seed_gym, name="Asha Again", phone="+919999999993")
    assert again.status_code == 201, again.get_data(as_text=True)[:300]


def test_h1_request_otp_ambiguous_same_gym_phone_gets_no_challenge(client, seed_gym):
    """Pre-existing live duplicates (writer guard + index stop NEW
    ones) must never bind the OTP challenge to an arbitrary member:
    generic no-challenge response, same as an unknown number."""
    gym_id = seed_gym["gym"].id
    for name in ("Asha", "Bina"):
        db.session.add(Member(
            gym_id=gym_id, full_name=name, phone="+919999999994",
            membership_start=date.today(), membership_end=date.today() + timedelta(days=30),
            status="active",
        ))
    db.session.commit()
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": "+919999999994"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["challenge"] is None
    assert body["success"] is True


def test_h1_request_otp_single_member_still_gets_challenge(client, seed_gym, seed_member):
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": seed_member.phone})
    assert res.status_code == 200
    assert res.get_json()["challenge"] is not None


# ─── V11-H2: staff free memberships ───────────────────────────────────

def test_h2_staff_zero_direct_renew_403(client, seed_gym):
    member = _expired_member(seed_gym)
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_staff_headers(seed_gym),
        json={"amount": "0", "renewal_days": 30},
    )
    assert res.status_code == 403, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "FORBIDDEN"
    db.session.refresh(member)
    assert member.status == "expired"
    assert member.membership_end == date.today() - timedelta(days=31)


def test_h2_owner_zero_direct_renew_allowed_and_audited(client, seed_gym):
    member = _expired_member(seed_gym)
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_owner_headers(seed_gym),
        json={"amount": "0", "renewal_days": 30, "override_reason": "Goodwill: founder's friend"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    db.session.refresh(member)
    assert member.status == "active"
    rows = _fresh_audit("renew_member")
    assert rows and rows[-1].metadata_json.get("amount") == "0"


def test_h2_staff_zero_bulk_renew_blocked_web(client, seed_gym):
    member = _expired_member(seed_gym)
    staff = _make_staff(seed_gym)
    _login_web(client, staff.email)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30", "amount": "0"},
    )
    assert res.status_code == 302
    db.session.refresh(member)
    assert member.status == "expired"
    assert member.membership_end == date.today() - timedelta(days=31)


def test_h2_owner_zero_bulk_renew_allowed_web(client, seed_gym):
    # Expired 2 days ago: a 30-day bulk renew starting at prev_end+1
    # lands active (an end 31 days ago would renew into a period that
    # already ended — still "expired" by the V3-L15 status rule).
    member = _expired_member(seed_gym, end_days_ago=2)
    _login_web(client, seed_gym["owner"].email)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30", "amount": "0"},
    )
    assert res.status_code == 302
    db.session.refresh(member)
    assert member.status == "active"
    assert member.membership_end > date.today()


# ─── V11-M1: verify after deactivate ──────────────────────────────────

def test_m1_verify_payment_deleted_member_409(client, seed_gym):
    member = _expired_member(seed_gym)
    payment = _pending_payment(seed_gym, member)
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/verify",
        headers=_owner_headers(seed_gym),
        json={},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    db.session.refresh(payment)
    assert payment.status == "pending"
    db.session.refresh(member)
    assert member.status == "deleted"


# ─── V11-L1: direct renew money fields ────────────────────────────────

@pytest.mark.parametrize("field,value", [
    ("standard_price", "NaN"),
    ("standard_price", "Infinity"),
    ("standard_price", "100.999"),
    ("discount", "NaN"),
    ("discount", "100.999"),
])
def test_l1_direct_renew_bad_money_fields_400(client, seed_gym, field, value):
    member = _expired_member(seed_gym)
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_owner_headers(seed_gym),
        json={"amount": "1000", "renewal_days": 30, field: value},
    )
    assert res.status_code == 400, res.get_data(as_text=True)[:300]
    assert res.status_code != 500


def test_l1_direct_renew_valid_standard_price_and_discount_ok(client, seed_gym):
    member = _expired_member(seed_gym)
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_owner_headers(seed_gym),
        json={"amount": "800", "renewal_days": 30, "standard_price": "1000.00", "discount": "200.00"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]


# ─── V11-L2: PATCH plan_id null ───────────────────────────────────────

def test_l2_patch_plan_id_null_422(client, seed_gym, seed_member):
    res = client.patch(
        f"/api/mobile/v1/members/{seed_member.id}",
        headers=_owner_headers(seed_gym),
        json={"plan_id": None},
    )
    assert res.status_code == 422, res.get_data(as_text=True)[:300]
    db.session.refresh(seed_member)
    assert seed_member.plan_id == seed_gym["plan"].id


# ─── V11-L3: remote_unlock idempotency ────────────────────────────────

def _online_bridge(seed_gym):
    bridge = BridgeInstallation(
        gym_id=seed_gym["gym"].id,
        public_id="v11-test-bridge",
        api_key_hash="b" * 64,
        device_serial="V11-TEST-01",
        display_name="V11 Test Bridge",
        is_active=True,
        last_heartbeat_at=datetime.now(timezone.utc),
    )
    db.session.add(bridge)
    db.session.commit()
    return bridge


def test_l3_remote_unlock_idempotent_replay(client, seed_gym):
    bridge = _online_bridge(seed_gym)
    headers = {**_owner_headers(seed_gym), "Idempotency-Key": "v11-unlock-1"}
    payload = {"confirm": True, "delay_seconds": 5}
    first = client.post("/api/mobile/v1/access/remote-unlock", headers=headers, json=payload)
    assert first.status_code == 201, first.get_data(as_text=True)[:300]
    command_id = first.get_json()["data"]["command_id"]
    second = client.post("/api/mobile/v1/access/remote-unlock", headers=headers, json=payload)
    assert second.status_code == 201
    assert second.get_json()["data"]["command_id"] == command_id
    bridge_id = bridge.id
    db.session.remove()
    rows = BridgeCommand.query.filter_by(
        bridge_id=bridge_id, command_type="unlock_door"
    ).all()
    assert len(rows) == 1


def test_l3_remote_unlock_second_key_still_409_pending(client, seed_gym):
    _online_bridge(seed_gym)
    first = client.post(
        "/api/mobile/v1/access/remote-unlock",
        headers={**_owner_headers(seed_gym), "Idempotency-Key": "v11-unlock-a"},
        json={"confirm": True, "delay_seconds": 5},
    )
    assert first.status_code == 201
    second = client.post(
        "/api/mobile/v1/access/remote-unlock",
        headers={**_owner_headers(seed_gym), "Idempotency-Key": "v11-unlock-b"},
        json={"confirm": True, "delay_seconds": 5},
    )
    assert second.status_code == 409
    assert second.get_json()["error"]["code"] == "COMMAND_PENDING"


# ─── V11-L4: per-endpoint limiters ────────────────────────────────────

def test_l4_verify_payment_limited_to_10_per_minute(client, seed_gym):
    member = _expired_member(seed_gym)
    payment = _pending_payment(seed_gym, member)
    headers = _owner_headers(seed_gym)
    statuses = []
    for _ in range(11):
        res = client.post(f"/api/mobile/v1/payments/{payment.id}/verify", headers=headers, json={})
        statuses.append(res.status_code)
    assert statuses[0] == 200, statuses
    assert statuses[-1] == 429, statuses


# ─── V11-L37: announcements, full text + subject ─────────────────────

def test_l37_broadcast_stores_full_text_and_subject(client, seed_gym, seed_member):
    from app.services.broadcast_service import send_broadcast_announcement

    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    gym.phone_number_id = "12345"
    db.session.commit()
    long_text = "Holiday hours update! " + "The gym will open late on Monday. " * 8
    assert len(long_text) > 80
    fake_wa = mock.Mock()
    fake_wa.send_template.return_value = SimpleNamespace(ok=True, error=None)
    with mock.patch(
        "app.services.broadcast_service.WhatsAppService", return_value=fake_wa
    ):
        result = send_broadcast_announcement(gym, long_text, audience="active")
    assert result["success"] is True
    rows = _fresh_audit("whatsapp_broadcast_announcement")
    assert rows
    details = rows[-1].metadata_json
    assert details["announcement_text"] == long_text.strip()
    assert details["subject"] == "Holiday hours update!"
    assert details["preview"] == long_text.strip()[:80]


def test_l37_branding_returns_full_announcement_text(client, seed_gym, seed_member):
    long_text = "Holiday hours update! " + "The gym will open late on Monday. " * 8
    db.session.add(AuditLog(
        gym_id=seed_gym["gym"].id,
        action="whatsapp_broadcast_announcement",
        resource_type="gym",
        resource_id=str(seed_gym["gym"].id),
        metadata_json={
            "preview": long_text[:80],
            "announcement_text": long_text,
            "subject": "Holiday hours update!",
        },
    ))
    db.session.commit()
    res = client.get("/api/member/v1/gym-branding", headers=_member_headers(seed_member))
    assert res.status_code == 200
    announcements = res.get_json()["data"]["branding"]["announcements"]
    assert announcements
    assert announcements[0]["message"] == long_text
    assert announcements[0]["title"] == "Holiday hours update!"


# ─── V11-L38: confirm-upi appends notes ──────────────────────────────

def test_l38_confirm_upi_appends_notes(app, client, seed_gym, seed_member):
    app.config["TESTING"] = False  # pending branch only runs outside TESTING
    payment = _pending_payment(
        seed_gym, seed_member, amount="1000.00", status="processing",
        notes="Self-service payment claim from John Doe · Plan: Monthly Standard",
    )
    res = client.post(
        "/api/member/v1/renew/confirm-upi",
        headers=_member_headers(seed_member),
        json={"payment_id": payment.id},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    db.session.refresh(payment)
    assert payment.status == "pending"
    assert "Self-service payment claim" in payment.notes
    assert "Payment confirmation submitted via VYNLA UPI" in payment.notes


# ─── V11-L39: fail-upi actual outcome ────────────────────────────────

def test_l39_fail_upi_verified_payment_reports_actual_outcome(client, seed_gym, seed_member):
    payment = _pending_payment(seed_gym, seed_member, amount="1000.00", status="verified")
    res = client.post(
        "/api/member/v1/renew/fail-upi",
        headers=_member_headers(seed_member),
        json={"payment_id": payment.id},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is False
    assert body["data"]["status"] == "verified"
    assert body["data"]["cancelled"] is False


def test_l39_fail_upi_unknown_payment_404(client, seed_gym, seed_member):
    res = client.post(
        "/api/member/v1/renew/fail-upi",
        headers=_member_headers(seed_member),
        json={"payment_id": 999999},
    )
    assert res.status_code == 404


def test_l39_fail_upi_processing_still_cancels(client, seed_gym, seed_member):
    payment = _pending_payment(
        seed_gym, seed_member, amount="1000.00", status="processing", notes="Initial note",
    )
    res = client.post(
        "/api/member/v1/renew/fail-upi",
        headers=_member_headers(seed_member),
        json={"payment_id": payment.id, "reason": "user_cancelled"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert body["data"]["cancelled"] is True
    db.session.refresh(payment)
    assert payment.status == "pending"
    assert "Initial note" in payment.notes


def test_l39_fail_upi_nothing_in_flight_reports_so(client, seed_gym, seed_member):
    res = client.post(
        "/api/member/v1/renew/fail-upi",
        headers=_member_headers(seed_member),
        json={},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is False
    assert body["data"]["cancelled"] is False


# ─── V11-L41: claim/UPI limiters ──────────────────────────────────────

def test_l41_claim_payment_limited_to_10_per_minute(client, seed_gym, seed_member):
    headers = _member_headers(seed_member)
    statuses = []
    for _ in range(11):
        res = client.post(
            "/api/member/v1/renew/claim", headers=headers,
            json={"plan_id": seed_gym["plan"].id},
        )
        statuses.append(res.status_code)
    assert statuses[0] == 201, statuses
    assert statuses[-1] == 429, statuses


# ─── V11-L45: one expiry semantic ─────────────────────────────────────

def test_l45_no_end_date_is_expired_everywhere(client, seed_gym):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name="No End Date",
        phone="+919100000099",
        membership_start=date.today(),
        membership_end=None,
        status="active",
    )
    db.session.add(member)
    db.session.commit()
    assert member.is_expired is True
    headers = _member_headers(member)
    membership = client.get("/api/member/v1/membership", headers=headers)
    assert membership.status_code == 200
    assert membership.get_json()["data"]["membership"]["is_expired"] is True
    assert membership.get_json()["data"]["membership"]["membership_end"] is None
    dashboard = client.get("/api/member/v1/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert dashboard.get_json()["data"]["member"]["is_expired"] is True


# ─── V11-L46: member money audit trail ────────────────────────────────

def test_l46_claim_payment_audited(client, seed_gym, seed_member):
    res = client.post(
        "/api/member/v1/renew/claim",
        headers=_member_headers(seed_member),
        json={"plan_id": seed_gym["plan"].id},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    assert _fresh_audit("member_payment_claimed")


def test_l46_request_renewal_audited(client, seed_gym, seed_member):
    res = client.post("/api/member/v1/renew/request", headers=_member_headers(seed_member), json={})
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    assert _fresh_audit("member_renewal_requested")


def test_l46_initiate_upi_audited(client, seed_gym, seed_member):
    db.session.add(QRSettings(gym_id=seed_gym["gym"].id, upi_id="gymowner@okhdfcbank", is_active=True))
    db.session.commit()
    res = client.post(
        "/api/member/v1/renew/initiate-upi",
        headers=_member_headers(seed_member),
        json={"plan_id": seed_gym["plan"].id},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert _fresh_audit("member_upi_renewal_initiated")


def test_l46_confirm_upi_pending_audited(app, client, seed_gym, seed_member):
    app.config["TESTING"] = False
    payment = _pending_payment(seed_gym, seed_member, amount="1000.00", status="processing")
    res = client.post(
        "/api/member/v1/renew/confirm-upi",
        headers=_member_headers(seed_member),
        json={"payment_id": payment.id},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert _fresh_audit("member_upi_payment_confirmed_pending")


# ─── V11-M10: reject reason ───────────────────────────────────────────

def test_m10_reject_payment_reason_stored_and_surfaced(client, seed_gym, seed_member):
    payment = _pending_payment(seed_gym, seed_member)
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/reject",
        headers=_owner_headers(seed_gym),
        json={"reason": "UTR does not match our records"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["rejected_reason"] == "UTR does not match our records"
    db.session.refresh(payment)
    assert payment.status == "rejected"
    assert payment.rejected_reason == "UTR does not match our records"
    detail = client.get(
        f"/api/mobile/v1/payments/{payment.id}", headers=_owner_headers(seed_gym)
    )
    assert detail.status_code == 200
    assert detail.get_json()["data"]["rejected_reason"] == "UTR does not match our records"
    mine = client.get("/api/member/v1/payments", headers=_member_headers(seed_member))
    assert mine.status_code == 200
    mine_rows = mine.get_json()["data"]["payments"]
    assert mine_rows and mine_rows[0]["rejected_reason"] == "UTR does not match our records"


def test_m10_reject_without_reason_ok(client, seed_gym, seed_member):
    payment = _pending_payment(seed_gym, seed_member)
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/reject",
        headers=_owner_headers(seed_gym),
        json={},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    db.session.refresh(payment)
    assert payment.status == "rejected"
    assert payment.rejected_reason is None


# ─── V11-L27 (event-rows half): access-events carry profile_photo_url ──

def test_l27_access_event_carries_member_photo_url(client, seed_gym, seed_member):
    """Follow-up to the Android crew's V11-L27: the access-events
    payload had no profile_photo_url, so Android event rows could not
    render member photos even though the member payload has it."""
    from app.models.access_event import AccessEvent
    from app.services.access_event_service import _serialize_access_event

    seed_member.profile_photo_path = "https://example.com/member-photo.jpg"
    db.session.commit()
    evt = AccessEvent(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
        member_name=seed_member.full_name,
        event_type="ENTRY",
        direction="IN",
        event_timestamp=datetime.now(timezone.utc),
        device_enroll_number="15",
        source_event_id="v11-l27-1",
    )
    db.session.add(evt)
    db.session.commit()
    data = _serialize_access_event(evt)
    assert data["member_id"] == seed_member.id
    assert data["profile_photo_url"] == "https://example.com/member-photo.jpg"


def test_l27_access_event_photo_url_null_when_unknown(client, seed_gym, seed_member):
    from app.models.access_event import AccessEvent
    from app.services.access_event_service import _serialize_access_event

    evt = AccessEvent(
        gym_id=seed_gym["gym"].id,
        member_id=None,
        member_name=None,
        event_type="ENTRY",
        direction="IN",
        event_timestamp=datetime.now(timezone.utc),
        device_enroll_number="103",
        source_event_id="v11-l27-2",
    )
    db.session.add(evt)
    db.session.commit()
    assert _serialize_access_event(evt)["profile_photo_url"] is None

    # Member with no photo: null, not a broken URL.
    evt2 = AccessEvent(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
        member_name=seed_member.full_name,
        event_type="ENTRY",
        direction="IN",
        event_timestamp=datetime.now(timezone.utc),
        device_enroll_number="15",
        source_event_id="v11-l27-3",
    )
    db.session.add(evt2)
    db.session.commit()
    assert _serialize_access_event(evt2)["profile_photo_url"] is None


# ─── V11-M9: branding logo is not the payment QR ─────────────────────

def test_m9_gym_branding_logo_url_is_null(client, seed_gym, seed_member):
    db.session.add(QRSettings(
        gym_id=seed_gym["gym"].id,
        upi_id="gymowner@okhdfcbank",
        qr_public_url="https://example.com/payment-qr.png",
        is_active=True,
    ))
    db.session.commit()
    res = client.get("/api/member/v1/gym-branding", headers=_member_headers(seed_member))
    assert res.status_code == 200
    assert res.get_json()["data"]["branding"]["logo_url"] is None


# ─── V11-M8: member logout revokes the refresh token ─────────────────

def test_m8_logout_revokes_refresh_token(app, client, seed_gym, seed_member):
    raw = create_member_refresh_token(seed_member.id, seed_gym["gym"].id)
    db.session.commit()
    res = client.post(
        "/api/member/v1/auth/logout",
        headers=_member_headers(seed_member),
        json={"refresh_token": raw},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["refresh_token_revoked"] is True
    refresh = client.post("/api/member/v1/auth/refresh", json={"refresh_token": raw})
    assert refresh.status_code == 401


def test_m8_logout_without_token_still_200(client, seed_gym, seed_member):
    res = client.post(
        "/api/member/v1/auth/logout",
        headers=_member_headers(seed_member),
        json={},
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["refresh_token_revoked"] is False
