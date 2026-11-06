"""Regression tests for the deep-review-v4 BACKEND MONEY fixes (2026-11-06).

Worker 1 (money/backend) — fix-all v4. Each test is shaped like the
REAL case the review cited, not the easy case:

* V4-M19: case-variant UTRs ("UTR123" vs "utr123" vs "UTR 123") at
  every create path, plus a legacy mixed-case row stored pre-fix.
* V4-M20: a genuine first renewal of an imported member whose
  backfill flag was wrongly set (paid_on != membership_start) is
  un-flagged by the repair migration; a real signup keeps its flag.
* V4-M1: create_member with a duplicate UTR fails the WHOLE create
  (no member, no payment); an unparseable initial amount no longer
  leaves a payment-less member behind.
* V4-M2: recovery_rate denominator counts paid expected value only.
* V4-L1: a commit-time UTR race surfaces as DUPLICATE_REFERENCE 409,
  not a 500.
* V4-L2: _creation_row_ids (SQL push-down) agrees with the row-level
  heuristic.
* V4-L3: Date Repair prefers the is_creation flag; a genuine first
  renewal is not a creation row there either.
* V4-L4: paused members contribute nothing to revenue_at_risk in
  either branch.
* V4-L5: the same-day edge — paid_on == start but previous_start
  differs — is a renewal, not a signup.
* V4-L15: _revert_renewal branches on is_creation; refunding a
  genuine first renewal restores the pre-renewal dates.
* V4-L35: reject/cancel record their own audit trail and leave
  verified_* untouched.
"""
from __future__ import annotations

import importlib.util
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification
from app.models.renewal_history import RenewalHistory
from app.services.payment_service import (
    cancel_payment,
    reject_payment,
    verified_payment_with_reference,
)
from app.services.revenue_service import (
    _creation_row_ids,
    _row_is_creation,
    recovery_rate,
    revenue_at_risk,
    revenue_recovered,
)
from app.services.timezone_service import today_for_gym

_MIG_PATH = "migrations/versions/v4m20repairiscreation_repair_is_creation_backfill.py"
_spec = importlib.util.spec_from_file_location("v4m20_migration", _MIG_PATH)
_v4m20 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_v4m20)


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


def _history(gym_id, member_id, plan_id, *, previous_start=None, previous_end, new_start, new_end,
             amount, standard_price, payment_id=None, is_creation=False):
    row = RenewalHistory(
        gym_id=gym_id,
        member_id=member_id,
        plan_id=plan_id,
        payment_verification_id=payment_id,
        previous_start=previous_start,
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


def _payment_payload(member_id, *, reference=None, amount="1000.00", auto_verify=False):
    payload = {
        "member_id": member_id,
        "amount": amount,
        "method": "upi",
        "renewal_days": 30,
        "auto_verify": auto_verify,
    }
    if reference is not None:
        payload["reference"] = reference
    return payload


# ─── V4-M19: UTR duplicate check is canonical at every layer ────────────

def test_create_payment_rejects_case_variant_utr(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(gym.id, seed_member.id, 1000, reference="UTR-V4M19-1", paid_on=date.today())

    for variant in ("utr-v4m19-1", "UTR- V4M19-1", "  Utr-V4m19-1  "):
        res = client.post(
            "/api/mobile/v1/payments",
            headers=_owner_headers(seed_gym),
            json=_payment_payload(seed_member.id, reference=variant),
        )
        assert res.status_code == 409, variant
        assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"
    assert PaymentVerification.query.filter_by(gym_id=gym.id).count() == 1


def test_create_payment_stores_canonical_reference(client, seed_gym, seed_member):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json=_payment_payload(seed_member.id, reference=" utr-v4m19-2 "),
    )
    assert res.status_code == 201
    payment = PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).one()
    assert payment.reference == "UTR-V4M19-2"


def test_verified_lookup_matches_legacy_mixed_case_row(seed_gym, seed_member):
    # A row stored pre-fix with mixed case / spacing must still be
    # caught by the canonical lookup — the index alone cannot help
    # until the v4m19 migration runs in production.
    gym = seed_gym["gym"]
    legacy = _payment(gym.id, seed_member.id, 1000, reference="Utr-V4m19-3", paid_on=date.today())
    assert verified_payment_with_reference(gym.id, "UTR-V4M19-3") is not None
    assert verified_payment_with_reference(gym.id, "UTR- v4m19-3").id == legacy.id
    assert verified_payment_with_reference(gym.id, "UTR-V4M19-OTHER") is None


def test_second_verify_with_case_variant_utr_rejected(client, seed_gym, seed_member):
    from app.services.payment_service import verify_payment

    gym = seed_gym["gym"]
    first = _payment(gym.id, seed_member.id, 1000, status="pending", reference="UTR-V4M19-4")
    verify_payment(first, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()

    second = _payment(gym.id, seed_member.id, 1000, status="pending", reference="utr-v4m19-4")
    with pytest.raises(ValueError, match="DUPLICATE_REFERENCE"):
        verify_payment(second, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.rollback()

    res = client.post(
        f"/api/mobile/v1/payments/{second.id}/verify", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"


def test_member_claim_rejects_case_variant_utr(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(gym.id, seed_member.id, 1000, reference="UTR-V4M19-5", paid_on=date.today())
    token = create_access_token(user_id=seed_member.id, gym_id=gym.id, role="member")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    res = client.post(
        "/api/member/v1/renew/claim", headers=headers, json={"reference": "utr-v4m19-5"}
    )
    assert res.status_code == 409
    assert PaymentVerification.query.filter_by(gym_id=gym.id).count() == 1


# ─── V4-M1: create_member initial-payment hole ───────────────────────────

def test_create_member_duplicate_case_variant_utr_fails_whole_create(client, seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    first = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "First Signup", "phone": "+919100070001", "plan_id": plan_id,
        "amount": "1000.00", "paid": True, "payment_method": "upi",
        "payment_reference": "UTR-V4M1-1",
    })
    assert first.status_code == 201

    second = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Second Signup", "phone": "+919100070002", "plan_id": plan_id,
        "amount": "1000.00", "paid": True, "payment_method": "upi",
        "payment_reference": "utr-v4m1-1",
    })
    assert second.status_code == 409
    assert second.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"
    # The whole create failed: no second member, no second payment.
    assert Member.query.filter_by(gym_id=gym.id).count() == 1
    assert PaymentVerification.query.filter_by(gym_id=gym.id).count() == 1


def test_create_member_unparseable_amount_creates_no_member(client, seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    res = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Bad Amount", "phone": "+919100070011", "plan_id": plan_id,
        "amount": "not-a-number", "paid": True, "payment_method": "upi",
    })
    assert res.status_code == 400
    # Old behaviour: the member was created and the payment failure
    # was swallowed (payment-less member, no creation ledger row).
    assert Member.query.filter_by(gym_id=gym.id).count() == 0
    assert PaymentVerification.query.filter_by(gym_id=gym.id).count() == 0
    assert RenewalHistory.query.filter_by(gym_id=gym.id).count() == 0


# ─── V4-M20: repair migration un-flags genuine first renewals ───────────

def _m20_fixture(seed_gym):
    """One mis-flagged genuine first renewal + one genuine signup."""
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)

    imported = _member(
        gym.id, plan_id, name="Imported", phone="+919100070021",
        status="expired", start=today - timedelta(days=60), end=today - timedelta(days=5),
        price=1000,
    )
    # Backdated first renewal (continuous coverage). The v3 backfill
    # flagged it is_creation=TRUE because previous_end == new_start;
    # its backing payment was paid TODAY, not on the member's start.
    paid = _payment(gym.id, imported.id, 1000, paid_on=today)
    misflagged = _history(
        gym.id, imported.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=25), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=True,
    )
    signup = _member(
        gym.id, plan_id, name="Signup", phone="+919100070022",
        start=today - timedelta(days=5), end=today + timedelta(days=45),
    )
    paid_signup = _payment(gym.id, signup.id, 1000, paid_on=today - timedelta(days=5))
    genuine = _history(
        gym.id, signup.id, plan_id,
        previous_start=today - timedelta(days=5),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid_signup.id, is_creation=True,
    )
    # V5-M1: the signup member has since RENEWED — their current
    # membership_start moved to the new period (today+46). The old
    # v4m20 repair anchored on that current start, so it un-flags
    # this genuine signup too: the live regression. The renewal row
    # below is a direct renewal (no backing payment) so it never
    # touches the payment-backed headline.
    signup.membership_start = today + timedelta(days=46)
    signup.membership_end = today + timedelta(days=75)
    db.session.commit()
    _history(
        gym.id, signup.id, plan_id,
        previous_start=today - timedelta(days=5),
        previous_end=today + timedelta(days=45), new_start=today + timedelta(days=46),
        new_end=today + timedelta(days=75), amount=1000, standard_price=1000,
        is_creation=False,
    )
    return gym, misflagged, genuine


def test_m20_repair_unflags_genuine_first_renewal(seed_gym):
    gym, misflagged, genuine = _m20_fixture(seed_gym)
    result = _v4m20._repair_is_creation_backfill(db.session.connection())
    # V5-M1: the old repair over-corrects — with the genuine signup's
    # member renewed, BOTH rows satisfy its predicate (paid_on != the
    # member's CURRENT membership_start). The imported renewal is
    # correctly un-flagged; the genuine signup is wrongly un-flagged
    # too. The flag corruption is the durable defect (flag-first
    # consumers trust it); the live overcount came from the OLD
    # runtime heuristic using the same current-start anchor — with
    # the fixed runtime (paid_on vs the row's own new_start) the row
    # is still excluded here, so payment_backed stays 1000. The
    # corrected v5v6 repair (tests/test_v5v6_money_backend) re-flags
    # the signup.
    assert result["misflagged"] == 2
    assert result["unflagged"] == 2
    db.session.expire_all()
    assert db.session.get(RenewalHistory, misflagged.id).is_creation is False
    assert db.session.get(RenewalHistory, genuine.id).is_creation is False
    recovered = revenue_recovered(gym.id, gym.timezone)
    assert recovered["payment_backed_amount"] == "1000.00"


def test_m20_repair_is_idempotent(seed_gym):
    _m20_fixture(seed_gym)
    first = _v4m20._repair_is_creation_backfill(db.session.connection())
    assert first["unflagged"] == 2
    second = _v4m20._repair_is_creation_backfill(db.session.connection())
    assert second["misflagged"] == 0
    assert second["unflagged"] == 0


def test_m20_repair_does_not_flip_null_previous_end_rows(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    member = _member(gym.id, plan_id, name="Legacy Null", phone="+919100070031")
    row = _history(
        gym.id, member.id, plan_id,
        previous_start=None, previous_end=None,
        new_start=today - timedelta(days=5), new_end=today + timedelta(days=25),
        amount=1000, standard_price=1000, is_creation=False,
    )
    result = _v4m20._repair_is_creation_backfill(db.session.connection())
    assert result["null_previous_end_unflagged"] == 1
    db.session.expire_all()
    assert db.session.get(RenewalHistory, row.id).is_creation is False


# ─── V4-M2: recovery_rate denominator excludes direct ────────────────────

def test_recovery_rate_all_direct_cohort_scores_no_paid_recovery(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    direct = _member(gym.id, plan_id, name="Direct Only", phone="+919100070041")
    _history(
        gym.id, direct.id, plan_id,
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=45), amount=500, standard_price=1000,
    )
    result = recovery_rate(gym.id, gym.timezone)
    # No outstanding risk and no paid renewals: denominator 0, rate
    # 0.0 by convention — and the direct expected value is exposed,
    # not silently counted as unrecovered risk.
    assert result["recovery_denominator"] == "0.00"
    assert result["recovery_rate"] == "0.0"
    assert result["recovery_rate_basis"].startswith("payment-backed only")
    assert result["risk_breakdown"]["direct_cohort_expected"] == "1000.00"
    assert result["recorded_amount"] == "500.00"


# ─── V4-L1: commit-time UTR race is a 409, not a 500 ─────────────────────

def test_create_payment_auto_verify_race_returns_duplicate_reference(client, seed_gym, seed_member):
    """Simulates the race: the pre-check passes (no verified clash
    yet), then the flush hits the partial unique index. The endpoint
    must answer DUPLICATE_REFERENCE 409, never a 500."""
    gym = seed_gym["gym"]
    clash = _payment(gym.id, seed_member.id, 1000, reference="UTR-V4L1-1", paid_on=date.today())
    with (
        patch(
            "app.mobile_api.payments.verified_payment_with_reference",
            side_effect=[None, clash],
        ),
        patch(
            "app.mobile_api.payments.verify_payment",
            side_effect=IntegrityError("stmt", {}, Exception("boom")),
        ),
    ):
        res = client.post(
            "/api/mobile/v1/payments",
            headers=_owner_headers(seed_gym),
            json=_payment_payload(seed_member.id, reference="UTR-V4L1-1", auto_verify=True),
        )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"


# ─── V4-L2: SQL creation-row ids agree with the row heuristic ────────────

def test_creation_row_ids_sql_matches_row_heuristic(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)

    signup = _member(gym.id, plan_id, name="Signup", phone="+919100070051",
                     start=today - timedelta(days=5), end=today + timedelta(days=45))
    paid_signup = _payment(gym.id, signup.id, 1000, paid_on=today - timedelta(days=5))
    signup_row = _history(
        gym.id, signup.id, plan_id,
        previous_start=today - timedelta(days=5),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid_signup.id,
    )
    imported = _member(
        gym.id, plan_id, name="Imported", phone="+919100070052",
        status="expired", start=today - timedelta(days=60), end=today - timedelta(days=5),
    )
    paid = _payment(gym.id, imported.id, 1000, paid_on=today)
    renewal_row = _history(
        gym.id, imported.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=25), amount=1000, standard_price=1000,
        payment_id=paid.id,
    )
    assert _creation_row_ids(gym.id) == {signup_row.id}
    assert _row_is_creation(signup_row, {signup_row.id, renewal_row.id}) is True
    assert _row_is_creation(renewal_row, {signup_row.id, renewal_row.id}) is False


# ─── V4-L3: Date Repair prefers the flag ─────────────────────────────────

def test_date_repair_creation_ids_prefer_flag_over_heuristic(seed_gym):
    from app.mobile_api.date_repair import _creation_row_ids_for_ledger, _is_creation_row

    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    imported = _member(
        gym.id, plan_id, name="Imported", phone="+919100070061",
        status="expired", start=today - timedelta(days=60), end=today - timedelta(days=5),
    )
    paid = _payment(gym.id, imported.id, 1000, paid_on=today)
    row = _history(
        gym.id, imported.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=25), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=False,
    )
    ids = _creation_row_ids_for_ledger(
        [row], imported.membership_start, {paid.id: paid.paid_on}
    )
    assert ids == set()
    assert _is_creation_row(row, ids) is False
    # …while a flagged row is a creation row even if the heuristic
    # would say otherwise.
    row.is_creation = True
    assert _is_creation_row(row, {row.id}) is True


def test_date_repair_scan_flags_oversized_genuine_first_renewal(client, seed_gym):
    """The V4-L3 consequence: a genuine first renewal backdated onto
    previous_end used to be excluded from the chain checks here, so
    an oversized first renewal was never flagged. It is now."""
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    imported = _member(
        gym.id, plan_id, name="Imported Oversized", phone="+919100070062",
        status="expired", start=today - timedelta(days=74), end=today - timedelta(days=44),
    )
    paid = _payment(gym.id, imported.id, 1000, paid_on=today - timedelta(days=40))
    _history(
        gym.id, imported.id, plan_id,
        previous_start=today - timedelta(days=74),
        previous_end=today - timedelta(days=44), new_start=today - timedelta(days=44),
        new_end=today, amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=False,
    )
    # Stored dates track the ledger exactly (45-day span on a 30-day
    # plan); only the oversized span should fire.
    imported.membership_start = today - timedelta(days=44)
    imported.membership_end = today
    db.session.commit()
    res = client.get("/api/mobile/v1/date-repair/scan", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    findings = [f for f in res.get_json()["data"]["flagged"] if f["member_id"] == imported.id]
    assert findings, "oversized genuine first renewal was not flagged"
    assert findings[0]["classification"] == "oversized_renewal"


# ─── V4-L4: paused members excluded from both at-risk branches ───────────

def test_revenue_at_risk_excludes_paused_members(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    _member(gym.id, plan_id, name="Paused Expired", phone="+919100070071",
            status="paused", start=today - timedelta(days=60), end=today - timedelta(days=4),
            price=2000)
    _member(gym.id, plan_id, name="Paused Expiring", phone="+919100070072",
            status="paused", start=today - timedelta(days=20), end=today + timedelta(days=3),
            price=3000)
    _member(gym.id, plan_id, name="Active Expired", phone="+919100070073",
            status="expired", start=today - timedelta(days=60), end=today - timedelta(days=4),
            price=1000)
    result = revenue_at_risk(gym.id, gym.timezone)
    assert result["total"] == "1000.00"
    assert result["expired_count"] == 1


# ─── V4-L5: same-day edge ────────────────────────────────────────────────

def test_row_is_creation_same_day_edge_with_previous_start(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    # Imported today, renewed today, backdated start on previous_end,
    # backing payment dated today == membership_start: the old
    # paid_on test alone calls this a signup. previous_start differs
    # from new_start (the member's old start), so it is a renewal.
    member = _member(
        gym.id, plan_id, name="Same Day", phone="+919100070081",
        status="expired", start=today, end=today, price=1000,
    )
    paid = _payment(gym.id, member.id, 1000, paid_on=today)
    row = _history(
        gym.id, member.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today, new_start=today,
        new_end=today + timedelta(days=29), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=False,
    )
    assert _row_is_creation(row, {row.id}) is False
    assert revenue_recovered(gym.id, gym.timezone)["payment_backed_amount"] == "1000.00"

    # The create_member shape (previous_start == new_start) still
    # counts: same dates, but the row really is a signup.
    signup_row = SimpleNamespace(
        id=999001, is_creation=False, previous_end=today, new_start=today,
        previous_start=today, paid_on=today, membership_start=today,
    )
    assert _row_is_creation(signup_row, {999001}) is True


# ─── V4-L15: _revert_renewal branches on is_creation ─────────────────────

def test_revert_renewal_restores_dates_for_genuine_first_renewal(seed_gym):
    from app.services.payment_service import _revert_renewal

    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    member = _member(
        gym.id, plan_id, name="Refund Renewal", phone="+919100070091",
        start=today - timedelta(days=60), end=today + timedelta(days=40),
    )
    # Genuine first renewal: previous_end == new_start (the heuristic
    # shape) but previous_start is the member's old start — and the
    # flag says it is NOT a creation row.
    renewal = _history(
        gym.id, member.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today + timedelta(days=10), new_start=today + timedelta(days=10),
        new_end=today + timedelta(days=40), amount=1000, standard_price=1000,
        is_creation=False,
    )
    member.membership_end = today + timedelta(days=40)
    db.session.commit()
    _revert_renewal(member, renewal)
    assert member.membership_end == today + timedelta(days=10)
    assert member.status == "active"

    # A real creation row reverts to expired instead.
    member.membership_end = today + timedelta(days=40)
    member.membership_start = today + timedelta(days=10)
    creation = _history(
        gym.id, member.id, plan_id,
        previous_start=today + timedelta(days=10),
        previous_end=today + timedelta(days=10), new_start=today + timedelta(days=10),
        new_end=today + timedelta(days=40), amount=1000, standard_price=1000,
        is_creation=True,
    )
    _revert_renewal(member, creation)
    assert member.status == "expired"


# ─── V4-L35: reject/cancel keep the verification audit trail ─────────────

def test_reject_preserves_verification_audit_trail(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/reject", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    db.session.refresh(payment)
    assert payment.status == "rejected"
    assert payment.verified_at is None
    assert payment.verified_by_id is None
    assert payment.rejected_at is not None
    assert payment.rejected_by_id == seed_gym["owner"].id


def test_cancel_preserves_verification_audit_trail(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/cancel", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    db.session.refresh(payment)
    assert payment.status == "cancelled"
    assert payment.verified_at is None
    assert payment.verified_by_id is None
    assert payment.cancelled_at is not None
    assert payment.cancelled_by_id == seed_gym["owner"].id


def test_reject_service_writes_rejected_fields_not_verified(seed_gym, seed_member):
    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    reject_payment(payment, verified_by_id=seed_gym["owner"].id)
    db.session.commit()
    db.session.refresh(payment)
    assert payment.rejected_at is not None
    assert payment.rejected_by_id == seed_gym["owner"].id
    assert payment.verified_at is None
    assert payment.verified_by_id is None
    assert payment.cancelled_at is None
    assert payment.cancelled_by_id is None


def test_cancel_service_writes_cancelled_fields_not_verified(seed_gym, seed_member):
    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    cancel_payment(payment, cancelled_by_id=seed_gym["owner"].id)
    db.session.commit()
    db.session.refresh(payment)
    assert payment.cancelled_at is not None
    assert payment.cancelled_by_id == seed_gym["owner"].id
    assert payment.verified_at is None
    assert payment.verified_by_id is None
    assert payment.rejected_at is None
    assert payment.rejected_by_id is None
