"""Regression tests for the deep-review-v5+v6 BACKEND MONEY fixes (2026-11-06).

Worker A1 (backend money/security) — fix-all v5+v6. Covers:

* V5-M1/V5-M2: corrected is_creation repair migration (anchor on the
  row's own new_start + previous_start guard) and the runtime heuristic
  fix in revenue_service (paid_on vs row new_start, not the member's
  current membership_start).
* V5-M3: create_member rejects a negative initial amount (400).
* V5-L1: confirm_upi rejects a colliding UTR (409).
* V5-L2: web payment create pre-checks duplicate UTR; web verify maps
  a verify-time index race to a duplicate flash, not a 500.
* V5-L3: IntegrityError is mapped to DUPLICATE_REFERENCE only when
  the constraint in the error IS the UTR index.
* V5-L4: the SQL canonicalisation strips all whitespace (tab/newline
  legacy rows are caught by the lookup).
* V5-L5: recovery_rate uses actual amounts on the recovered side — a
  fully-renewed-but-discounted cohort scores 100%.
* V6-M1: web bulk renew + web payment create are idempotent via a
  one-time form token (double-submit renews/saves once).
* V6-M16: campaign create honours Idempotency-Key (retry replays).
* V6-L1: member self-service claim endpoints replay a pending claim
  (member-row lock + pending check).
* V6-L2: standard_price / discount range checks on both money-write
  paths (create_payment, direct renew).
* V6-L3: create_member pins the amount actually paid as member.price.
* V6-L4: reports revenue_pending is scoped to the period; processing
  UPI demands are split out.
* V6-L5: web payment delete is owner-only (staff gets 403).
* V6-L6: web verify does not 500 when membership_end is NULL.
* V6-L7: member_renew_with_plan caps custom_amount (Decimal, not
  float) and stores plan linkage on the claim.
"""
from __future__ import annotations

import importlib.util
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification, User
from app.models.renewal_history import RenewalHistory
from app.services.payment_service import (
    is_duplicate_reference_error,
    verified_payment_with_reference,
)
from app.services.revenue_service import (
    _creation_row_ids,
    _row_is_creation,
    recovery_rate,
    revenue_recovered,
)
from app.services.timezone_service import today_for_gym

_MIG5_PATH = "migrations/versions/v5v6m1_correct_is_creation_repair.py"
_spec5 = importlib.util.spec_from_file_location("v5v6m1_migration", _MIG5_PATH)
_v5v6m1 = importlib.util.module_from_spec(_spec5)
_spec5.loader.exec_module(_v5v6m1)

_MIG4_PATH = "migrations/versions/v4m20repairiscreation_repair_is_creation_backfill.py"
_spec4 = importlib.util.spec_from_file_location("v4m20_migration", _MIG4_PATH)
_v4m20 = importlib.util.module_from_spec(_spec4)
_spec4.loader.exec_module(_v4m20)


def _owner_headers(seed_gym, key=None):
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def _member_token(member, gym_id):
    return {"Authorization": f"Bearer {create_access_token(user_id=member.id, gym_id=gym_id, role='member')}"}


def _member(gym_id, plan_id, *, name, phone, status="active", start=None, end=None, price=1000):
    today = date.today()
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=start or (today - timedelta(days=30)),
        membership_end=end,
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


def _login(client, email, password):
    client.post("/auth/login", data={"email": email, "password": password}, follow_redirects=True)


def _login_owner(client, seed_gym):
    _login(client, "owner@testgym.com", "SecurePass123!")


def _make_staff(seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="staff@testgym.com",
        full_name="Gym Staff",
        role="staff",
    )
    staff.set_password("StaffPass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


def _token_from_html(html, field):
    match = re.search(rf'name="{field}" value="([^"]+)"', html)
    assert match, f"{field} not found in page"
    return match.group(1)


# ─── V5-M1 / V5-M2: corrected repair + runtime heuristic ─────────────────

def _m1_fixture(seed_gym):
    """Same shape as the v4 fixture, WITH the genuine signup renewed.

    Imported member: genuine first renewal wrongly flagged by the v3
    backfill. Signup member: genuine signup, then renewed (current
    membership_start moved to the new period) — the shape the v4m20
    repair over-corrected on.
    """
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)

    imported = _member(
        gym.id, plan_id, name="Imported", phone="+919100071021",
        status="expired", start=today - timedelta(days=60), end=today - timedelta(days=5),
        price=1000,
    )
    paid = _payment(gym.id, imported.id, 1000, paid_on=today)
    misflagged = _history(
        gym.id, imported.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=25), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=True,
    )
    signup = _member(
        gym.id, plan_id, name="Signup", phone="+919100071022",
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


def test_v5v6_repair_reflags_renewed_genuine_signup(seed_gym):
    gym, misflagged, genuine = _m1_fixture(seed_gym)
    # The old repair over-corrects: both rows get un-flagged.
    old = _v4m20._repair_is_creation_backfill(db.session.connection())
    assert old["unflagged"] == 2
    db.session.expire_all()
    assert db.session.get(RenewalHistory, genuine.id).is_creation is False
    # The flag is now corrupt (False on a genuine signup). With the
    # FIXED runtime heuristic the row is still excluded — paid_on ==
    # the row's own new_start — so payment_backed stays 1000 here;
    # the live overcount came from the OLD runtime comparing paid_on
    # to the member's current membership_start. The flag still needs
    # repairing: flag-first consumers (Date Repair) trust it.
    assert revenue_recovered(gym.id, gym.timezone)["payment_backed_amount"] == "1000.00"

    # The corrected repair re-flags exactly the genuine signup.
    result = _v5v6m1._repair_is_creation_v5v6(db.session.connection())
    assert result["wrongly_unflagged"] == 1
    assert result["reflagged"] == 1
    assert result["unflagged"] == 0
    db.session.expire_all()
    assert db.session.get(RenewalHistory, genuine.id).is_creation is True
    assert db.session.get(RenewalHistory, misflagged.id).is_creation is False
    recovered = revenue_recovered(gym.id, gym.timezone)
    assert recovered["payment_backed_amount"] == "1000.00"
    assert recovered["total_amount"] == "2000.00"


def test_v5v6_repair_is_idempotent(seed_gym):
    _m1_fixture(seed_gym)
    _v4m20._repair_is_creation_backfill(db.session.connection())
    first = _v5v6m1._repair_is_creation_v5v6(db.session.connection())
    assert first["reflagged"] == 1
    second = _v5v6m1._repair_is_creation_v5v6(db.session.connection())
    assert second == {"misflagged": 0, "unflagged": 0, "reflagged": 0, "wrongly_unflagged": 0}


def test_v5v6_repair_does_not_reflag_same_day_renewal(seed_gym):
    """The V6 correction: the re-flag pass needs the previous_start
    shape guard. An imported member created AND renewed the same day
    has a genuine first renewal with paid_on == new_start — but
    previous_start is the member's OLD start, so it must NOT be
    re-flagged as a signup."""
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    member = _member(
        gym.id, plan_id, name="Same Day", phone="+919100071031",
        status="expired", start=today, end=today, price=1000,
    )
    paid = _payment(gym.id, member.id, 1000, paid_on=today)
    row = _history(
        gym.id, member.id, plan_id,
        previous_start=today - timedelta(days=60),
        previous_end=today, new_start=today,
        new_end=today + timedelta(days=29), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=True,
    )
    # Member renews again, moving the current start away from today.
    member.membership_start = today + timedelta(days=30)
    member.membership_end = today + timedelta(days=59)
    db.session.commit()
    _history(
        gym.id, member.id, plan_id,
        previous_start=today,
        previous_end=today + timedelta(days=29), new_start=today + timedelta(days=30),
        new_end=today + timedelta(days=59), amount=1000, standard_price=1000,
        is_creation=False,
    )
    _v4m20._repair_is_creation_backfill(db.session.connection())
    db.session.expire_all()
    assert db.session.get(RenewalHistory, row.id).is_creation is False
    result = _v5v6m1._repair_is_creation_v5v6(db.session.connection())
    assert result["reflagged"] == 0
    db.session.expire_all()
    assert db.session.get(RenewalHistory, row.id).is_creation is False
    # …and the renewal still counts as a recovery.
    assert revenue_recovered(gym.id, gym.timezone)["payment_backed_amount"] == "1000.00"


def test_runtime_heuristic_uses_row_new_start_not_current_start(seed_gym):
    """V5-M2: an UNFLAGGED genuine signup row of a member who has
    since renewed is a creation row by the row's own new_start —
    even though paid_on != the member's current membership_start."""
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    member = _member(
        gym.id, plan_id, name="Renewed Signup", phone="+919100071041",
        start=today + timedelta(days=46), end=today + timedelta(days=75),
    )
    paid = _payment(gym.id, member.id, 1000, paid_on=today - timedelta(days=5))
    row = _history(
        gym.id, member.id, plan_id,
        previous_start=today - timedelta(days=5),
        previous_end=today - timedelta(days=5), new_start=today - timedelta(days=5),
        new_end=today + timedelta(days=45), amount=1000, standard_price=1000,
        payment_id=paid.id, is_creation=False,
    )
    assert _row_is_creation(row, {row.id}) is True
    assert _creation_row_ids(gym.id) == {row.id}
    assert revenue_recovered(gym.id, gym.timezone)["payment_backed_amount"] == "0.00"


# ─── V5-M3: negative initial amount ──────────────────────────────────────

def test_create_member_negative_amount_is_400(client, seed_gym):
    res = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Negative", "phone": "+919100071051", "plan_id": seed_gym["plan"].id,
        "amount": "-5.00", "paid": True, "payment_method": "upi",
    })
    assert res.status_code == 400
    assert Member.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


# ─── V6-L3: discounted signup pins the paid price ────────────────────────

def test_create_member_discounted_signup_pins_paid_price(client, seed_gym):
    res = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Discounted", "phone": "+919100071061", "plan_id": seed_gym["plan"].id,
        "amount": "800.00", "paid": True, "payment_method": "upi",
    })
    assert res.status_code == 201
    member = Member.query.filter_by(gym_id=seed_gym["gym"].id, phone="+919100071061").one()
    assert member.price == Decimal("800.00")


def test_create_member_full_price_signup_pins_plan_price(client, seed_gym):
    res = client.post("/api/mobile/v1/members", headers=_owner_headers(seed_gym), json={
        "full_name": "Full Price", "phone": "+919100071062", "plan_id": seed_gym["plan"].id,
        "amount": "1000.00", "paid": True, "payment_method": "upi",
    })
    assert res.status_code == 201
    member = Member.query.filter_by(gym_id=seed_gym["gym"].id, phone="+919100071062").one()
    assert member.price == Decimal("1000.00")


# ─── V6-L2: standard_price / discount ranges ─────────────────────────────

def test_create_payment_rejects_bad_standard_price_and_discount(client, seed_gym, seed_member):
    base = {
        "member_id": seed_member.id, "amount": "800.00", "method": "upi", "renewal_days": 30,
    }
    for payload, why in (
        ({**base, "standard_price": "-1"}, "negative standard_price"),
        ({**base, "standard_price": "1000.00", "discount": "-10"}, "negative discount"),
        ({**base, "standard_price": "1000.00", "discount": "1500"}, "discount above standard"),
    ):
        res = client.post("/api/mobile/v1/payments", headers=_owner_headers(seed_gym), json=payload)
        assert res.status_code == 400, why
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


def test_direct_renew_rejects_bad_standard_price_and_discount(client, seed_gym, seed_member):
    base = {"amount": "800.00", "renewal_days": 30}
    for payload, why in (
        ({**base, "standard_price": "-1"}, "negative standard_price"),
        ({**base, "standard_price": "1000.00", "discount": "-5"}, "negative discount"),
        ({**base, "standard_price": "1000.00", "discount": "1001"}, "discount above standard"),
    ):
        res = client.post(
            f"/api/mobile/v1/renewals/{seed_member.id}",
            headers=_owner_headers(seed_gym), json=payload,
        )
        assert res.status_code == 400, why
    assert RenewalHistory.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


# ─── V5-L3: constraint-name check before DUPLICATE_REFERENCE ─────────────

def test_is_duplicate_reference_error_checks_constraint_name():
    utr_sqlite = IntegrityError(
        "stmt", {}, Exception("UNIQUE constraint failed: payment_verifications.gym_id, payment_verifications.reference"),
    )
    assert is_duplicate_reference_error(utr_sqlite) is True
    utr_pg = IntegrityError(
        "stmt", {}, Exception('duplicate key value violates unique constraint "uq_payments_gym_reference_verified"'),
    )
    assert is_duplicate_reference_error(utr_pg) is True
    other = IntegrityError("stmt", {}, Exception("UNIQUE constraint failed: members.gym_id, members.phone"))
    assert is_duplicate_reference_error(other) is False
    generic = IntegrityError("stmt", {}, Exception("boom"))
    assert is_duplicate_reference_error(generic) is False


def test_verify_utr_shaped_integrity_error_is_409_not_500(client, seed_gym, seed_member):
    """A UTR-index IntegrityError at verify time is still a 409 —
    the narrowing must not break the V4-L1 behaviour."""
    payment = _payment(seed_gym["gym"].id, seed_member.id, 1000, status="pending", reference="UTR-V5L3-1")
    with patch(
        "app.mobile_api.payments.verify_payment",
        side_effect=IntegrityError(
            "stmt", {}, Exception('duplicate key value violates unique constraint "uq_payments_gym_reference_verified"'),
        ),
    ):
        res = client.post(
            f"/api/mobile/v1/payments/{payment.id}/verify", headers=_owner_headers(seed_gym)
        )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"


def test_verify_non_utr_integrity_error_is_not_mapped_to_duplicate(client, seed_gym, seed_member):
    payment = _payment(seed_gym["gym"].id, seed_member.id, 1000, status="pending", reference="UTR-V5L3-2")
    with patch(
        "app.mobile_api.payments.verify_payment",
        side_effect=IntegrityError("stmt", {}, Exception("boom")),
    ):
        try:
            res = client.post(
                f"/api/mobile/v1/payments/{payment.id}/verify", headers=_owner_headers(seed_gym)
            )
        except IntegrityError:
            return  # Flask propagates in TESTING — the re-raise is the fix.
    assert res.status_code == 500


# ─── V5-L4: SQL norm strips all whitespace ───────────────────────────────

def test_verified_lookup_matches_legacy_tab_reference(seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(gym.id, seed_member.id, 1000, reference="UTR\tV5L4-1", paid_on=date.today())
    assert verified_payment_with_reference(gym.id, "UTRV5L4-1") is not None
    assert verified_payment_with_reference(gym.id, "UTR V5L4-1") is not None


# ─── V5-L5: recovery_rate on actual amounts ──────────────────────────────

def test_recovery_rate_discounted_cohort_scores_100(seed_gym):
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    today = today_for_gym(gym.timezone)
    # Member renewed at a discount (800 of a 1000 plan); no outstanding
    # risk (active, expiring beyond 7 days) — the whole cohort recovered.
    member = _member(
        gym.id, plan_id, name="Discounted Cohort", phone="+919100071071",
        start=today - timedelta(days=2), end=today + timedelta(days=27),
    )
    paid = _payment(gym.id, member.id, 800, paid_on=today - timedelta(days=2))
    _history(
        gym.id, member.id, plan_id,
        previous_start=today - timedelta(days=32),
        previous_end=today - timedelta(days=3), new_start=today - timedelta(days=2),
        new_end=today + timedelta(days=27), amount=800, standard_price=1000,
        payment_id=paid.id, is_creation=False,
    )
    result = recovery_rate(gym.id, gym.timezone)
    assert result["recovery_denominator"] == "800.00"
    assert result["recovery_rate"] == "100.0"
    assert result["risk_breakdown"]["renewed_cohort_expected"] == "1000.00"


# ─── V5-L1: confirm_upi duplicate reference ─────────────────────────────

def test_confirm_upi_rejects_colliding_reference(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(gym.id, seed_member.id, 1000, reference="UTR-V5L1-1", paid_on=date.today())
    # A pending claim for the same member.
    res = client.post(
        "/api/member/v1/renew/claim",
        headers=_member_token(seed_member, gym.id),
        json={"reference": "UTR-V5L1-2"},
    )
    assert res.status_code == 201
    res = client.post(
        "/api/member/v1/renew/confirm-upi",
        headers=_member_token(seed_member, gym.id),
        json={"reference": "utr-v5l1-1"},
    )
    assert res.status_code == 409
    pending = PaymentVerification.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, status="pending"
    ).one()
    assert pending.reference == "UTR-V5L1-2"


# ─── V6-L1: claim endpoints replay a pending claim ───────────────────────

def test_member_claim_double_submit_replays_one_payment(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    headers = _member_token(seed_member, gym.id)
    first = client.post("/api/member/v1/renew/claim", headers=headers, json={})
    assert first.status_code == 201
    second = client.post("/api/member/v1/renew/claim", headers=headers, json={})
    assert second.status_code == 200
    assert second.get_json()["data"]["payment_id"] == first.get_json()["data"]["payment_id"]
    assert PaymentVerification.query.filter_by(gym_id=gym.id, member_id=seed_member.id).count() == 1


def test_member_renew_request_double_submit_replays_one_payment(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    headers = _member_token(seed_member, gym.id)
    first = client.post("/api/member/v1/renew/request", headers=headers, json={})
    assert first.status_code == 201
    second = client.post("/api/member/v1/renew/request", headers=headers, json={})
    assert second.status_code == 200
    assert second.get_json()["data"]["payment_id"] == first.get_json()["data"]["payment_id"]
    assert PaymentVerification.query.filter_by(gym_id=gym.id, member_id=seed_member.id).count() == 1


# ─── V6-L7: renew-with-plan cap + plan linkage ───────────────────────────

def test_member_renew_with_plan_caps_custom_amount(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    headers = _member_token(seed_member, gym.id)
    res = client.post(
        "/api/member/v1/renew",
        headers=headers,
        json={"plan_id": seed_gym["plan"].id, "custom_amount": "999999"},
    )
    assert res.status_code == 422
    assert PaymentVerification.query.filter_by(gym_id=gym.id, member_id=seed_member.id).count() == 0


def test_member_renew_with_plan_stores_plan_linkage(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_token(seed_member, gym.id),
        json={"plan_id": seed_gym["plan"].id, "custom_amount": "800.00"},
    )
    assert res.status_code == 201, res.get_json()
    payment = PaymentVerification.query.filter_by(gym_id=gym.id, member_id=seed_member.id).one()
    assert payment.plan_id == seed_gym["plan"].id
    assert payment.standard_price == Decimal("1000.00")
    assert payment.discount == Decimal("200.00")
    assert payment.amount == Decimal("800.00")
    assert payment.paid_on == today


def test_member_renew_with_plan_decimal_not_float(client, seed_gym, seed_member):
    """A paise-level custom amount survives exactly (float would not)."""
    gym = seed_gym["gym"]
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_token(seed_member, gym.id),
        json={"plan_id": seed_gym["plan"].id, "custom_amount": "799.99"},
    )
    assert res.status_code == 201, res.get_json()
    payment = PaymentVerification.query.filter_by(gym_id=gym.id, member_id=seed_member.id).one()
    assert payment.amount == Decimal("799.99")
    assert payment.discount == Decimal("200.01")


# ─── V6-L4: reports pending scoped to the period ─────────────────────────

def test_reports_pending_scoped_to_period_and_split(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    old = _payment(gym.id, seed_member.id, 500, status="pending")
    old.created_at = datetime.now(timezone.utc) - timedelta(days=60)
    db.session.commit()
    recent = _payment(gym.id, seed_member.id, 700, status="pending")
    processing = _payment(gym.id, seed_member.id, 900, status="processing")
    res = client.get("/api/mobile/v1/reports/summary?period=30d", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    revenue = res.get_json()["data"]["revenue"]
    assert revenue["pending"] == "700.00"
    assert revenue["processing"] == "900.00"


# ─── V6-M16: campaign create idempotency ─────────────────────────────────

def test_campaign_create_idempotency_key_replays(client, seed_gym):
    payload = {"name": "Recovery Test", "segment_type": "all_expired"}
    first = client.post(
        "/api/mobile/v1/campaigns", headers=_owner_headers(seed_gym, key="camp-key-1"), json=payload,
    )
    assert first.status_code == 201, first.get_json()
    second = client.post(
        "/api/mobile/v1/campaigns", headers=_owner_headers(seed_gym, key="camp-key-1"), json=payload,
    )
    assert second.status_code == 201
    assert second.get_json()["data"]["id"] == first.get_json()["data"]["id"]
    from app.models.campaign import Campaign

    assert Campaign.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


def test_campaign_create_key_reused_for_different_payload_is_409(client, seed_gym):
    payload = {"name": "Recovery Test", "segment_type": "all_expired"}
    first = client.post(
        "/api/mobile/v1/campaigns", headers=_owner_headers(seed_gym, key="camp-key-2"), json=payload,
    )
    assert first.status_code == 201
    second = client.post(
        "/api/mobile/v1/campaigns",
        headers=_owner_headers(seed_gym, key="camp-key-2"),
        json={"name": "Different Campaign", "segment_type": "all_expired"},
    )
    assert second.status_code == 409


# ─── V6-M1: web bulk renew double-submit ─────────────────────────────────

def test_web_bulk_renew_double_submit_renews_once(client, seed_gym, seed_member):
    today = date.today()
    seed_member.membership_start = today - timedelta(days=30)
    seed_member.membership_end = today + timedelta(days=5)
    db.session.commit()
    _login_owner(client, seed_gym)
    page = client.get("/members/bulk-renew")
    assert page.status_code == 200
    token = _token_from_html(page.get_data(as_text=True), "bulk_renew_token")
    form = {"member_ids": [str(seed_member.id)], "renewal_days": "30", "amount": "1000", "bulk_renew_token": token}
    first = client.post("/members/bulk-renew", data=form)
    assert first.status_code == 302
    second = client.post("/members/bulk-renew", data=form)
    assert second.status_code == 302
    db.session.refresh(seed_member)
    assert seed_member.membership_end == today + timedelta(days=35)
    assert RenewalHistory.query.filter_by(member_id=seed_member.id).count() == 1


def test_web_bulk_renew_without_token_still_works(client, seed_gym, seed_member):
    """Legacy POSTs without a token keep working (no replay guard)."""
    today = date.today()
    seed_member.membership_start = today - timedelta(days=30)
    seed_member.membership_end = today + timedelta(days=5)
    db.session.commit()
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(seed_member.id)], "renewal_days": "30", "amount": "1000"},
    )
    assert res.status_code == 302
    assert RenewalHistory.query.filter_by(member_id=seed_member.id).count() == 1


# ─── V6-M1: web payment create double-submit ─────────────────────────────

def test_web_payment_create_double_submit_saves_once(client, seed_gym, seed_member):
    _login_owner(client, seed_gym)
    page = client.get("/payments/new")
    assert page.status_code == 200
    token = _token_from_html(page.get_data(as_text=True), "idempotency_token")
    form = {
        "member_id": str(seed_member.id),
        "amount": "1000",
        "paid_on": date.today().isoformat(),
        "method": "upi",
        "reference": "",
        "renewal_days": "30",
        "notes": "",
        "idempotency_token": token,
    }
    first = client.post("/payments/new", data=form)
    assert first.status_code == 302
    second = client.post("/payments/new", data=form)
    assert second.status_code == 302
    assert PaymentVerification.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


# ─── V5-L2: web payment duplicate UTR ────────────────────────────────────

def test_web_payment_create_rejects_duplicate_utr(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    _payment(gym.id, seed_member.id, 1000, reference="UTR-V5L2-1", paid_on=date.today())
    _login_owner(client, seed_gym)
    page = client.get("/payments/new")
    token = _token_from_html(page.get_data(as_text=True), "idempotency_token")
    res = client.post(
        "/payments/new",
        data={
            "member_id": str(seed_member.id),
            "amount": "1000",
            "paid_on": date.today().isoformat(),
            "method": "upi",
            "reference": "utr-v5l2-1",
            "renewal_days": "30",
            "notes": "",
            "idempotency_token": token,
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"already exists" in res.data
    assert PaymentVerification.query.filter_by(gym_id=gym.id).count() == 1


# ─── V6-L6: web verify with NULL membership_end ──────────────────────────

def test_web_verify_null_membership_end_does_not_500(client, seed_gym, seed_member):
    seed_member.membership_end = None
    db.session.commit()
    payment = _payment(seed_gym["gym"].id, seed_member.id, 1000, status="pending")
    _login_owner(client, seed_gym)
    res = client.post(f"/payments/{payment.id}/verify")
    assert res.status_code == 302
    db.session.refresh(payment)
    assert payment.status == "verified"


# ─── V6-L5: web payment delete is owner-only ─────────────────────────────

def test_web_payment_delete_staff_forbidden_owner_allowed(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    payment = _payment(gym.id, seed_member.id, 1000, status="pending")
    _make_staff(seed_gym)
    _login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post(f"/payments/{payment.id}/delete")
    assert res.status_code == 403
    assert PaymentVerification.query.filter_by(id=payment.id).count() == 1
    # /auth/login short-circuits while authenticated — log out first.
    client.post("/auth/logout", follow_redirects=True)
    _login_owner(client, seed_gym)
    res = client.post(f"/payments/{payment.id}/delete")
    assert res.status_code == 302
    assert PaymentVerification.query.filter_by(id=payment.id).count() == 0
