"""Regression tests for the deep-review-v3 BACKEND MONEY fixes (2026-11-06).

* V3-H1: revenue_recovered() excludes signup creation rows from
  total_amount, total_renewals AND payment_backed_amount.
* V3-H2: recovery_rate headline revenue_recovered + the rate are
  payment-backed only; direct renewals live in recorded_amount.
* V3-M1: reports renewals_completed / renewal_rate exclude signups.
* V3-M2: campaign total_revenue_recovered is payment-backed only;
  direct attributions count in total_recorded_revenue.
* V3-M3: two pending payments sharing one UTR cannot both verify
  (verify-time re-check + DUPLICATE_REFERENCE, partial unique index).
* V3-M5: an imported member's genuine first renewal backdated onto
  previous_end is NOT excluded; a real signup row still is.
* V3-M23: create_member honours Idempotency-Key (no double-create).
* V3-L1: create_member 400s on an unknown payment method.
* V3-L2: refund keeps verified_at/verified_by_id; refunded_at/by set.
* V3-L4: verified payments cannot be deleted (refund instead).
* V3-L5: dashboard marks failed money blocks with an explicit error.
* V3-L16: payments summary has a bank bucket from the method enum.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Campaign, CampaignRecipient, Member, PaymentVerification
from app.models.mixins import utcnow
from app.models.renewal_history import RenewalHistory
from app.services.revenue_service import recovery_rate, revenue_recovered
from app.services.timezone_service import today_for_gym


def _owner_headers(seed_gym, key=None):
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def _member(gym_id, plan_id, *, name, phone, status="active", start=None, end=None, price=1000):
    today = date.today()
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=start or (today - timedelta(days=30)),
        membership_end=end if end is not None else today + timedelta(days=30),
        status=status,
        price=price,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _payment(gym_id, member_id, amount, *, status="verified", reference=None, paid_on=None, method="upi"):
    row = PaymentVerification(
        gym_id=gym_id, member_id=member_id, amount=amount, status=status,
        reference=reference, paid_on=paid_on, method=method,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _history(gym_id, member_id, plan_id, *, previous_end, new_start, new_end,
             amount, standard_price, payment_id=None, is_creation=False):
    row = RenewalHistory(
        gym_id=gym_id,
        member_id=member_id,
        plan_id=plan_id,
        payment_verification_id=payment_id,
        previous_end=previous_end,
        new_start=new_start,
        new_end=new_end,
        standard_price=standard_price,
        amount=amount,
        is_test=False,
        is_creation=is_creation,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _money_fixture(seed_gym):
    """Signup (paid 1000) + genuine paid renewal (800) + direct renewal (500)."""
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    # Signup: mirrors create_member — membership_start == paid_on, and the
    # creation row has previous_end == new_start == membership_start.
    signup = _member(
        gym.id, plan_id, name="New Signup", phone="+919100060001",
        start=today - timedelta(days=5), end=today + timedelta(days=45),
    )
    paid_signup = _payment(gym.id, signup.id, 1000, paid_on=today - timedelta(days=5))
    _history(
        gym.id, signup.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid_signup.id,
    )
    renewed = _member(gym.id, plan_id, name="Renewed Paid", phone="+919100060002")
    paid_renewal = _payment(gym.id, renewed.id, 800)
    _history(
        gym.id, renewed.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=4),
        new_end=today + timedelta(days=45), amount=800, standard_price=1000,
        payment_id=paid_renewal.id,
    )
    direct = _member(gym.id, plan_id, name="Renewed Direct", phone="+919100060003")
    _history(
        gym.id, direct.id, plan_id,
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=45), amount=500, standard_price=1000,
    )
    return gym


# ─── V3-H1: revenue_recovered excludes signups ───────────────────────────

def test_revenue_recovered_excludes_signup_creation_rows(seed_gym):
    gym = _money_fixture(seed_gym)
    result = revenue_recovered(gym.id, gym.timezone, period_days=30)
    assert result["total_renewals"] == 2
    assert result["total_amount"] == "1300.00"
    assert result["recorded_amount"] == "1300.00"
    assert result["payment_backed_renewals"] == 1
    assert result["payment_backed_amount"] == "800.00"
    assert result["direct_renewals"] == 1
    assert result["direct_amount"] == "500.00"


# ─── V3-H2: recovery_rate headline is payment-backed only ────────────────

def test_recovery_rate_headline_is_payment_backed_only(seed_gym):
    gym = _money_fixture(seed_gym)
    result = recovery_rate(gym.id, gym.timezone)
    assert result["revenue_recovered"] == "800.00"
    assert result["recorded_amount"] == "1300.00"
    # V5-L5 (supersedes V4-M2's denominator): the denominator is
    # outstanding risk + the ACTUAL amount collected on paid renewals
    # (800) — not the standard-price expected value (1000). The paid
    # renewal was discounted (800 of 1000), so the rate is 800/800 =
    # 100.0. The direct renewal still counts as neither recovered
    # nor unrecovered risk.
    assert result["recovery_denominator"] == "800.00"
    assert result["recovery_rate"] == "100.0"
    assert result["risk_breakdown"]["renewed_cohort_expected"] == "1000.00"
    assert result["recovered_breakdown"]["payment_backed_amount"] == "800.00"
    assert result["recovered_breakdown"]["direct_amount"] == "500.00"


# ─── V3-M1: reports exclude signups ──────────────────────────────────────

def test_reports_renewals_exclude_signups(client, seed_gym):
    _money_fixture(seed_gym)
    res = client.get(
        "/api/mobile/v1/reports/summary?period=30d", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    renewals = res.get_json()["data"]["renewals"]
    assert renewals["completed"] == 2
    assert renewals["renewal_rate"] == 100.0


# ─── V3-M2: campaign revenue is payment-backed only ──────────────────────

def test_campaign_revenue_counts_only_verified_payments(seed_gym):
    from datetime import datetime, timezone

    from app.services.campaign_service import attribute_renewal_to_campaign

    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    campaign = Campaign(
        gym_id=gym.id, name="V3 M2", segment_type="expiring_7d", status="sent",
        created_by_id=seed_gym["owner"].id, sent_at=datetime.now(timezone.utc),
        attribution_window_days=7,
    )
    db.session.add(campaign)
    db.session.flush()

    # Direct (unpaid) renewal attributed first.
    direct_member = _member(gym.id, plan_id, name="Direct Cam", phone="+919100060011")
    db.session.add(CampaignRecipient(
        campaign_id=campaign.id, member_id=direct_member.id, gym_id=gym.id,
        sent_at=datetime.now(timezone.utc), status="sent",
    ))
    db.session.flush()
    direct_renewal = _history(
        gym.id, direct_member.id, plan_id,
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=45), amount=500, standard_price=1000,
    )
    assert attribute_renewal_to_campaign(
        member_id=direct_member.id, gym_id=gym.id,
        renewal_id=direct_renewal.id, renewal_amount=Decimal("500.00"),
    ) == campaign.id
    db.session.refresh(campaign)
    assert campaign.total_revenue_recovered == Decimal("0.00")
    assert campaign.total_recorded_revenue == Decimal("500.00")

    # Verified-paid renewal attributed second.
    paid_member = _member(gym.id, plan_id, name="Paid Cam", phone="+919100060012")
    db.session.add(CampaignRecipient(
        campaign_id=campaign.id, member_id=paid_member.id, gym_id=gym.id,
        sent_at=datetime.now(timezone.utc), status="sent",
    ))
    db.session.flush()
    paid = _payment(gym.id, paid_member.id, 2000)
    paid_renewal = _history(
        gym.id, paid_member.id, plan_id,
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=45), amount=2000, standard_price=2000,
        payment_id=paid.id,
    )
    assert attribute_renewal_to_campaign(
        member_id=paid_member.id, gym_id=gym.id,
        renewal_id=paid_renewal.id, renewal_amount=Decimal("2000.00"),
    ) == campaign.id
    db.session.refresh(campaign)
    assert campaign.total_revenue_recovered == Decimal("2000.00")
    assert campaign.total_recorded_revenue == Decimal("2500.00")


# ─── V3-M3: duplicate UTR cannot verify twice ────────────────────────────

def test_second_verify_with_same_utr_rejected(client, seed_gym, seed_member):
    from app.services.payment_service import verify_payment

    gym = seed_gym["gym"]
    first = _payment(gym.id, seed_member.id, 1000, status="pending", reference="UTR-V3M3-1")
    verify_payment(first, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()

    second = _payment(gym.id, seed_member.id, 1000, status="pending", reference="UTR-V3M3-1")
    with pytest.raises(ValueError, match="DUPLICATE_REFERENCE"):
        verify_payment(second, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.rollback()

    res = client.post(
        f"/api/mobile/v1/payments/{second.id}/verify", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"
    db.session.refresh(second)
    assert second.status == "pending"


# ─── V3-M5: imported member's backdated first renewal counts ─────────────

def test_imported_member_backdated_first_renewal_counts_as_recovery(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)

    # Imported member: no creation row at all; first genuine renewal is
    # backdated to start exactly on previous_end (continuous coverage).
    imported = _member(
        gym.id, plan_id, name="Imported", phone="+919100060021",
        status="expired", start=today - timedelta(days=60), end=today - timedelta(days=5),
        price=1000,
    )
    paid = _payment(gym.id, imported.id, 1000, paid_on=today)
    _history(
        gym.id, imported.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=25), amount=1000, standard_price=1000,
        payment_id=paid.id,
    )
    # Real signup in the same gym: backing payment paid_on == start, so
    # it is still excluded.
    signup = _member(
        gym.id, plan_id, name="Signup", phone="+919100060022",
        start=today - timedelta(days=5), end=today + timedelta(days=45),
    )
    paid_signup = _payment(gym.id, signup.id, 1000, paid_on=today - timedelta(days=5))
    _history(
        gym.id, signup.id, plan_id,
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid_signup.id,
    )

    result = recovery_rate(gym.id, gym.timezone)
    assert result["revenue_recovered"] == "1000.00"
    assert result["recovered_breakdown"]["total_renewals"] == 1
    assert result["recovered_breakdown"]["payment_backed_amount"] == "1000.00"


# ─── V3-M23: AddMember idempotency ───────────────────────────────────────

def test_create_member_retry_replays_one_member(client, seed_gym):
    plan_id = seed_gym["plan"].id
    payload = {
        "full_name": "Idempotent Member",
        "phone": "+919100060031",
        "plan_id": plan_id,
        "amount": "1000.00",
        "paid": True,
        "payment_method": "upi",
    }
    headers = _owner_headers(seed_gym, key="v3-m23-member-001")
    first = client.post("/api/mobile/v1/members", headers=headers, json=payload)
    second = client.post("/api/mobile/v1/members", headers=headers, json=payload)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.get_json() == second.get_json()
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


def test_create_member_rejects_key_reused_for_different_member(client, seed_gym):
    plan_id = seed_gym["plan"].id
    headers = _owner_headers(seed_gym, key="v3-m23-member-002")
    first = client.post("/api/mobile/v1/members", headers=headers, json={
        "full_name": "First Member", "phone": "+919100060032", "plan_id": plan_id,
    })
    assert first.status_code == 201
    replay = client.post("/api/mobile/v1/members", headers=headers, json={
        "full_name": "Other Member", "phone": "+919100060033", "plan_id": plan_id,
    })
    assert replay.status_code == 409
    assert replay.get_json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


# ─── V3-L1: unknown payment method is a 400 ──────────────────────────────

def test_create_member_rejects_unknown_payment_method(client, seed_gym):
    plan_id = seed_gym["plan"].id
    res = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Typo Method", "phone": "+919100060041", "plan_id": plan_id,
        "amount": "1000.00", "paid": True, "payment_method": "upii",
    })
    assert res.status_code == 400
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


# ─── V3-L2: refund keeps the verification audit trail ────────────────────

def test_refund_preserves_verification_audit_trail(seed_gym, seed_member):
    from app.services.payment_service import refund_payment, verify_payment

    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    verify_payment(payment, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()
    verified_at = payment.verified_at
    assert verified_at is not None
    assert payment.verified_by_id == seed_gym["owner"].id

    refund_payment(payment, refunded_by_id=seed_gym["owner"].id)
    db.session.commit()
    db.session.refresh(payment)
    assert payment.status == "refunded"
    assert payment.verified_at == verified_at
    assert payment.verified_by_id == seed_gym["owner"].id
    assert payment.refunded_at is not None
    assert payment.refunded_by_id == seed_gym["owner"].id


# ─── V3-L4: verified payments cannot be deleted ──────────────────────────

def test_delete_verified_payment_forbidden(client, seed_gym, seed_member):
    from app.services.payment_service import verify_payment

    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    verify_payment(payment, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()

    res = client.delete(
        f"/api/mobile/v1/payments/{payment.id}", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 409
    assert PaymentVerification.query.get(payment.id) is not None

    pending = _payment(gym.id, seed_member.id, 500, status="pending")
    res = client.delete(
        f"/api/mobile/v1/payments/{pending.id}", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    assert PaymentVerification.query.get(pending.id) is None


# ─── V3-L5: dashboard money failure is explicit ──────────────────────────

def test_dashboard_marks_failed_money_blocks_explicitly(client, seed_gym):
    with patch(
        "app.services.revenue_service.revenue_recovered",
        side_effect=RuntimeError("boom"),
    ):
        res = client.get("/api/mobile/v1/dashboard", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["revenue_recovered"]["error"]["code"] == "REVENUE_UNAVAILABLE"
    assert data["recovery_rate"]["error"]["code"] == "REVENUE_UNAVAILABLE"


# ─── V3-L16: payments summary has a bank bucket ──────────────────────────

def test_payments_summary_has_bank_bucket(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(
        gym.id, seed_member.id, 500, status="verified", method="bank",
    )
    payment = PaymentVerification.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, method="bank"
    ).one()
    payment.verified_at = utcnow()
    db.session.commit()

    res = client.get("/api/mobile/v1/payments/summary", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    methods = res.get_json()["data"]["today"]["methods"]
    assert methods["bank"] == "500.00"
    assert methods["bank_transfer"] == "0.00"
    assert methods["upi"] == "0.00"
