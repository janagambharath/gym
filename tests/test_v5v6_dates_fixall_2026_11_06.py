"""Regression tests for deep reviews v5+v6 — dates / renewals / Date Repair (worker A4, 2026-11-06).

Covers: V5-M2, V5-M8, V5-M9, V5-M10, V5-L6, V5-L14, V5-L15, V5-L16,
V5-L17, V5-L18, V5-L19, V6-M2, V6-M3, V6-M4, V6-M20, V6-L15, V6-L16,
V6-L17, V6-L18, V6-L19, V6-L20, V6-L21, V6-L22.
"""
from datetime import date, timedelta
from decimal import Decimal
import logging

import pytest

from app.extensions import db
from app.mobile_api.date_repair import (
    _correct_oversized_ledger,
    _creation_row_ids_for_ledger,
    classify_member,
)
from app.mobile_api.token_service import create_access_token
from app.models import (
    AuditLog,
    Gym,
    Member,
    MembershipPlan,
    PaymentVerification,
    RenewalHistory,
    User,
)
from app.services.payment_service import (
    apply_due_scheduled_renewals,
    refund_payment,
    verify_payment,
)


def _headers(user, gym):
    token = create_access_token(user_id=user.id, gym_id=gym.id, role=user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end, status="active", notes=None, price=1000, plan=None):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=(plan.id if plan else seed_gym["plan"].id),
        full_name=name,
        phone="+919999900001",
        membership_start=start,
        membership_end=end,
        status=status,
        price=price,
        notes=notes,
    )
    db.session.add(m)
    db.session.commit()
    return m


def _plan(seed_gym, name, duration_days, price=1000):
    p = MembershipPlan(
        gym_id=seed_gym["gym"].id,
        name=name,
        duration_days=duration_days,
        price=price,
    )
    db.session.add(p)
    db.session.commit()
    return p


def _row(seed_gym, member, owner, previous_start, previous_end, new_start, new_end,
         duration_days=30, payment=None, is_creation=False, override_reason=None):
    r = RenewalHistory(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        plan_id=seed_gym["plan"].id,
        payment_verification_id=payment.id if payment else None,
        renewed_by_id=owner.id,
        previous_start=previous_start,
        previous_end=previous_end,
        new_start=new_start,
        new_end=new_end,
        duration_days=duration_days,
        amount=1000,
        is_creation=is_creation,
        override_reason=override_reason,
    )
    db.session.add(r)
    db.session.commit()
    return r


def _payment(seed_gym, member, renewal_days=30, paid_on=None, status="verified",
             is_test=False, amount=1000, reference=None):
    p = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        amount=Decimal(str(amount)),
        paid_on=paid_on or date.today(),
        method="upi",
        reference=reference,
        status=status,
        renewal_days=renewal_days,
        is_test=is_test,
    )
    db.session.add(p)
    db.session.commit()
    return p


def _web_login(client, email, password):
    return client.post(
        "/auth/login",
        data={"email": email, "password": password},
        follow_redirects=True,
    )


@pytest.fixture
def super_admin(app, seed_gym):
    admin = User(
        email="superadmin@test.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    return admin


@pytest.fixture
def staff_user(app, seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="staff@testgym.com",
        full_name="Staff Member",
        role="staff",
        is_active=True,
    )
    staff.set_password("StaffPass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


# --- V5-M2: creation heuristic anchors on the row's own new_start ---

def test_v5m2_creation_row_uses_row_new_start_not_current_member_start(seed_gym):
    today = date.today()
    d0 = today - timedelta(days=60)
    r_creation = RenewalHistory(
        id=1, previous_start=d0, previous_end=d0, new_start=d0,
        new_end=d0 + timedelta(days=29), payment_verification_id=10,
        is_creation=False,
    )
    r_renewal = RenewalHistory(
        id=2, previous_start=d0, previous_end=d0 + timedelta(days=29),
        new_start=d0 + timedelta(days=30), new_end=d0 + timedelta(days=59),
        payment_verification_id=11, is_creation=False,
    )
    # Member has since renewed: current start is the renewal's start.
    member_start = d0 + timedelta(days=30)
    payments = {10: d0, 11: d0 + timedelta(days=30)}
    ids = _creation_row_ids_for_ledger([r_creation, r_renewal], member_start, payments)
    assert ids == {1}


# --- V5-L6: corrector uses refined creation_ids; None row resets prev_shift ---

def test_v5l6_corrector_uses_refined_creation_ids(seed_gym):
    today = date.today()
    d = today - timedelta(days=100)
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L6 Member", d, d + timedelta(days=99))
    r0 = _row(seed_gym, member, owner, d, d, d, d + timedelta(days=29))
    r1 = _row(seed_gym, member, owner, d, d + timedelta(days=29),
              d + timedelta(days=30), d + timedelta(days=69))
    # Genuine first renewal of an imported member, backdated onto
    # previous_end: previous_start != new_start, so the refined set
    # must NOT call it a creation row.
    r2 = _row(seed_gym, member, owner, d + timedelta(days=40), d + timedelta(days=70),
              d + timedelta(days=70), d + timedelta(days=99))
    rows = [r0, r1, r2]
    ids = _creation_row_ids_for_ledger(rows, member.membership_start, {})
    assert r2.id not in ids
    _correct_oversized_ledger(rows, 30, creation_ids=ids)
    assert r1.new_end == d + timedelta(days=59)  # shortened by the 10-day excess
    assert r2.new_start == d + timedelta(days=60)
    assert r2.previous_end == d + timedelta(days=60)
    # previous_start moves by prev_shift (0 — the previous row's start
    # never moved), NOT by shift_before (10) as the raw heuristic would.
    assert r2.previous_start == d + timedelta(days=40)


def test_v5l6_none_row_resets_prev_shift(seed_gym):
    today = date.today()
    d = today - timedelta(days=100)
    r_a = RenewalHistory(
        previous_start=d, previous_end=d, new_start=d,
        new_end=d + timedelta(days=34), duration_days=30, is_creation=True,
    )
    r_none = RenewalHistory(
        previous_start=d + timedelta(days=35), previous_end=d + timedelta(days=34),
        new_start=None, new_end=d + timedelta(days=70), duration_days=30,
    )
    r_c = RenewalHistory(
        previous_start=d + timedelta(days=35), previous_end=d + timedelta(days=70),
        new_start=d + timedelta(days=71), new_end=d + timedelta(days=100),
        duration_days=30,
    )
    _correct_oversized_ledger([r_a, r_none, r_c], 30)
    # The dateless row must not stale prev_shift: r_c.previous_start
    # stays put (shift 0), it is not dragged back by the 5-day excess.
    assert r_c.previous_start == d + timedelta(days=35)


# --- V5-M8: refund re-chains the live scheduled renewal ---

def test_v5m8_refund_rechains_scheduled_renewal(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M8 Member", today - timedelta(days=60), today - timedelta(days=1),
                     status="expired")
    p1 = _payment(seed_gym, member, renewal_days=30, paid_on=today - timedelta(days=30))
    r1 = _row(seed_gym, member, owner, today - timedelta(days=60), today - timedelta(days=31),
              today - timedelta(days=30), today - timedelta(days=1), payment=p1)
    p2 = _payment(seed_gym, member, renewal_days=30, paid_on=today)
    r2 = _row(seed_gym, member, owner, today - timedelta(days=30), today - timedelta(days=1),
              today, today + timedelta(days=29), payment=p2)
    refund_payment(p1, refunded_by_id=owner.id)
    db.session.commit()
    assert member.membership_end == today - timedelta(days=31)
    db.session.refresh(r2)
    assert r2.previous_end == today - timedelta(days=31)
    assert r2.new_start == today
    assert AuditLog.query.filter_by(action="scheduled_renewal_rechained").count() >= 1
    # And the re-chained row can now actually activate.
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 1
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=29)


# --- V5-M9 + V6-L18: freeze guard + expired-freeze rejection; manual edit re-chain ---

def test_v5m9_freeze_refused_with_live_scheduled_renewal(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M9 Member", today - timedelta(days=29), today)
    _row(seed_gym, member, owner, today - timedelta(days=29), today,
         today + timedelta(days=1), today + timedelta(days=30))
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/freeze",
        json={"days": 7},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 409
    assert b"future renewal scheduled" in res.data


def test_v5m9_manual_edit_rechains_scheduled_renewal(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M9 Edit", today - timedelta(days=29), today)
    sched = _row(seed_gym, member, owner, today - timedelta(days=29), today,
                 today + timedelta(days=1), today + timedelta(days=30))
    res = client.patch(
        f"/api/mobile/v1/members/{member.id}",
        json={"membership_end": (today + timedelta(days=1)).isoformat()},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(sched)
    assert sched.previous_end == today + timedelta(days=1)
    assert sched.new_start == today + timedelta(days=1)
    assert AuditLog.query.filter_by(action="scheduled_renewal_rechained").count() >= 1


def test_v6l18_freeze_expired_member_rejected(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L18 Member", today - timedelta(days=60), today - timedelta(days=5),
                     status="expired")
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/freeze",
        json={"days": 7},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 400
    assert b"already ended" in res.data
    assert member.notes is None or "[Paused on" not in (member.notes or "")


# --- V5-M10: expired scheduled rows are audited, not silently dropped ---

def test_v5m10_expired_scheduled_row_audited_not_dropped(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M10 Member", today - timedelta(days=50), today - timedelta(days=20),
                     status="expired")
    _row(seed_gym, member, owner, today - timedelta(days=50), today - timedelta(days=20),
         today - timedelta(days=10), today - timedelta(days=5))
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 0
    assert member.membership_end == today - timedelta(days=20)
    entry = AuditLog.query.filter_by(action="scheduled_renewal_expired_unactivated").first()
    assert entry is not None


# --- V5-L14 + V5-L15: corrector keeps pending dates; Apply start-follow never future ---

def test_v5l14_corrector_keeps_pending_row_dates():
    today = date.today()
    d = today - timedelta(days=100)
    r1 = RenewalHistory(
        previous_start=d, previous_end=d, new_start=d,
        new_end=d + timedelta(days=69), duration_days=30, is_creation=True,
    )
    r2 = RenewalHistory(
        previous_start=d, previous_end=d + timedelta(days=69),
        new_start=today + timedelta(days=10), new_end=today + timedelta(days=39),
        duration_days=30,
    )
    _correct_oversized_ledger([r1, r2], 30, today=today)
    assert r1.new_end == d + timedelta(days=29)  # 70d -> 30d
    assert r2.new_start == today + timedelta(days=10)
    assert r2.new_end == today + timedelta(days=39)
    assert r2.previous_end == d + timedelta(days=29)  # re-chained only


def test_v5l15_apply_follows_started_rows_only(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L15 Member", today - timedelta(days=29), today)
    _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=89),
         today - timedelta(days=89), today - timedelta(days=30))
    _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=30),
         today - timedelta(days=29), today)
    # Pending row chained contiguously (new_start = previous_end + 1),
    # so it is a scheduled future period, not a restart.
    _row(seed_gym, member, owner, today - timedelta(days=29), today,
         today + timedelta(days=1), today + timedelta(days=30))
    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        json={"member_ids": [member.id]},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    assert res.get_json()["data"]["results"][0]["applied"] is True
    db.session.refresh(member)
    # Followed the intermediate STARTED row's old start, shifted earlier.
    assert member.membership_start == today - timedelta(days=59)
    assert member.membership_end == today - timedelta(days=30)
    pending = RenewalHistory.query.filter_by(
        member_id=member.id, new_start=today + timedelta(days=1)
    ).first()
    assert pending.new_start == today + timedelta(days=1)
    assert pending.new_end == today + timedelta(days=30)


# --- V5-L16: owner-approved overrides are stored and skipped ---

def test_v5l16_override_row_skipped_by_oversized_check(seed_gym):
    today = date.today()
    member = _member(seed_gym, "L16 Member", today - timedelta(days=29), today + timedelta(days=15))
    owner = seed_gym["owner"]
    _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=59),
         today - timedelta(days=59), today - timedelta(days=30))
    override_row = _row(
        seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
        today - timedelta(days=29), today + timedelta(days=15),
        override_reason="loyalty extra days",
    )
    rows = RenewalHistory.query.filter_by(member_id=member.id).order_by(RenewalHistory.id).all()
    finding = classify_member(member, rows, today=today, payments=[])
    assert finding is None  # override row's 45 days are approved, not an error
    override_row.override_reason = None
    db.session.commit()
    finding = classify_member(member, rows, today=today, payments=[])
    assert finding is not None and finding["classification"] == "oversized_renewal"


def test_v5l16_direct_renew_stores_override_reason(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L16 Direct", today - timedelta(days=29), today)
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        json={"renewal_days": 45, "amount": "1500.00",
              "override_reason": "loyalty extra days"},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 201, res.data
    row = RenewalHistory.query.filter_by(member_id=member.id).first()
    assert row is not None and row.override_reason == "loyalty extra days"
    assert classify_member(member, [row], today=today, payments=[]) is None


# --- V5-L17: verify re-validates plan days ---

def test_v5l17_verify_revalidates_plan_days(seed_gym, staff_user):
    today = date.today()
    owner = seed_gym["owner"]
    m1 = _member(seed_gym, "L17 NoOverride", today - timedelta(days=29), today)
    p1 = _payment(seed_gym, m1, renewal_days=45, status="pending")
    with pytest.raises(ValueError):
        verify_payment(p1, verified_by_id=owner.id, renewal_days=45)
    db.session.rollback()
    m2 = _member(seed_gym, "L17 Override", today - timedelta(days=29), today)
    p2 = _payment(seed_gym, m2, renewal_days=45, status="pending")
    p2.override_reason = "owner approved extra days"
    db.session.commit()
    renewal = verify_payment(p2, verified_by_id=owner.id, renewal_days=45)
    assert renewal.override_reason == "owner approved extra days"
    db.session.rollback()
    m3 = _member(seed_gym, "L17 Staff", today - timedelta(days=29), today)
    p3 = _payment(seed_gym, m3, renewal_days=45, status="pending")
    with pytest.raises(ValueError):
        verify_payment(p3, verified_by_id=staff_user.id, renewal_days=45)
    db.session.rollback()


# --- V5-L18 + V6-L16: coverage counts only started, overlapping payments ---

def test_v5l18_future_payment_does_not_mask_gap(seed_gym):
    today = date.today()
    member = _member(seed_gym, "L18 Member", today - timedelta(days=59), today)
    owner = seed_gym["owner"]
    p_cur = _payment(seed_gym, member, renewal_days=30, paid_on=today - timedelta(days=59))
    p_future = _payment(seed_gym, member, renewal_days=30, paid_on=today)
    r1 = _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=59),
              today - timedelta(days=59), today - timedelta(days=30), payment=p_cur)
    r2 = _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
              today - timedelta(days=29), today)
    r_future = _row(seed_gym, member, owner, today - timedelta(days=29), today,
                    today + timedelta(days=30), today + timedelta(days=59), payment=p_future)
    finding = classify_member(
        member, [r1, r2, r_future], today=today, payments=[p_cur, p_future]
    )
    assert finding is not None and finding["classification"] == "payment_coverage_gap"
    assert finding["paid_periods"] == 1


def test_v6l16_old_chain_payments_do_not_mask_gap(seed_gym):
    today = date.today()
    member = _member(seed_gym, "L16Cov Member", today - timedelta(days=59), today)
    owner = seed_gym["owner"]
    p_old = _payment(seed_gym, member, renewal_days=30, paid_on=today - timedelta(days=89))
    p_cur = _payment(seed_gym, member, renewal_days=30, paid_on=today - timedelta(days=59))
    r_old = _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=89),
                 today - timedelta(days=89), today - timedelta(days=60), payment=p_old)
    r_cur1 = _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=60),
                  today - timedelta(days=59), today - timedelta(days=30), payment=p_cur)
    r_cur2 = _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
                  today - timedelta(days=29), today)
    finding = classify_member(
        member, [r_old, r_cur1, r_cur2], today=today, payments=[p_old, p_cur]
    )
    assert finding is not None and finding["classification"] == "payment_coverage_gap"
    assert finding["paid_periods"] == 1


# --- V6-L17: period_overlap scoped to the current chain ---

def test_v6l17_old_chain_overlap_does_not_mask_current_findings(seed_gym):
    today = date.today()
    member = _member(seed_gym, "L17 Member", today - timedelta(days=29), today)
    owner = seed_gym["owner"]
    r_old1 = _row(seed_gym, member, owner, today - timedelta(days=120), today - timedelta(days=120),
                  today - timedelta(days=120), today - timedelta(days=91))
    r_old2 = _row(seed_gym, member, owner, today - timedelta(days=120), today - timedelta(days=91),
                  today - timedelta(days=100), today - timedelta(days=71))
    r_cur = _row(seed_gym, member, owner, today - timedelta(days=120), today - timedelta(days=71),
                 today - timedelta(days=29), today)
    assert classify_member(member, [r_old1, r_old2, r_cur], today=today, payments=[]) is None


# --- V6-M2: admin test payment never touches a real member ---

def test_v6m2_test_payment_uses_synthetic_member(client, seed_gym, seed_member, super_admin):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    real = seed_member
    real_end = real.membership_end
    real_price = real.price
    res = client.post(
        f"/admin/gyms/{seed_gym['gym'].id}/test-payment-renewal",
        follow_redirects=True,
    )
    assert res.status_code == 200, res.data
    db.session.refresh(real)
    assert real.membership_end == real_end
    assert real.price == real_price
    synth = Member.query.filter_by(gym_id=seed_gym["gym"].id, phone="+919999900001").first()
    assert synth is not None
    assert synth.full_name == "REvorax Test Member"
    assert synth.device_enroll_number is None
    assert AuditLog.query.filter_by(action="test_payment_renewal").count() == 1
    test_pay = PaymentVerification.query.filter_by(member_id=synth.id, is_test=True).first()
    assert test_pay is not None and test_pay.status == "verified"


# --- V6-M3: immediate verify / direct renew blocked by a live scheduled row ---

def test_v6m3_immediate_renewal_blocked_by_live_scheduled(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M3 Member", today - timedelta(days=60), today - timedelta(days=1),
                     status="expired")
    _row(seed_gym, member, owner, today - timedelta(days=60), today - timedelta(days=1),
         today + timedelta(days=10), today + timedelta(days=39))
    p_new = _payment(seed_gym, member, renewal_days=30, status="pending")
    with pytest.raises(ValueError, match="future renewal scheduled"):
        verify_payment(p_new, verified_by_id=owner.id, renewal_days=30)
    db.session.rollback()
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        json={"renewal_days": 30, "amount": "1000.00"},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 409
    assert b"future renewal scheduled" in res.data


# --- V6-M4: web create-payment enforces plan days ---

def test_v6m4_web_create_enforces_plan_days(client, seed_gym, staff_user):
    today = date.today()
    member = _member(seed_gym, "M4 Member", today - timedelta(days=29), today)
    _web_login(client, "owner@testgym.com", "SecurePass123!")
    base = {
        "member_id": str(member.id),
        "amount": "1000.00",
        "paid_on": today.isoformat(),
        "method": "upi",
        "reference": "",
        "renewal_days": "45",
        "notes": "",
        "override_reason": "",
    }
    res = client.post("/payments/new", data=base, follow_redirects=True)
    assert PaymentVerification.query.filter_by(member_id=member.id).count() == 0
    # Owner without a reason gets the "supply a reason" variant.
    assert b"Supply override_reason" in res.data
    res = client.post(
        "/payments/new",
        data={**base, "override_reason": "loyalty extra days"},
        follow_redirects=True,
    )
    pay = PaymentVerification.query.filter_by(member_id=member.id).first()
    assert pay is not None and pay.override_reason == "loyalty extra days"
    # Staff cannot override even with a reason. (The login route
    # short-circuits when already authenticated, so log out first.)
    client.post("/auth/logout", follow_redirects=True)
    _web_login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post(
        "/payments/new",
        data={**base, "reference": "STAFFUTR1", "override_reason": "staff override"},
        follow_redirects=True,
    )
    assert PaymentVerification.query.filter_by(member_id=member.id).count() == 1
    assert b"Only the gym owner can override" in res.data


# --- V5-L19: invalid timezone logs loudly; write paths reject it ---

def test_v5l19_invalid_timezone_logs_and_validates(caplog):
    from app.services.timezone_service import is_valid_timezone, today_for_gym

    assert is_valid_timezone("Asia/Kolkata") is True
    assert is_valid_timezone("Bogus/Zone") is False
    assert is_valid_timezone(None) is False
    assert is_valid_timezone("") is False
    with caplog.at_level(logging.ERROR, logger="app.services.timezone_service"):
        result = today_for_gym("Bogus/Zone")
    assert result == today_for_gym("Asia/Kolkata")
    assert "Invalid gym timezone" in caplog.text


def test_v5l19_admin_settings_reject_invalid_timezone(client, seed_gym, super_admin):
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    res = client.post(
        f"/admin/gyms/{seed_gym['gym'].id}/update-settings",
        data={"timezone": "Bogus/Zone"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"Invalid timezone" in res.data
    gym = db.session.get(Gym, seed_gym["gym"].id)
    assert gym.timezone != "Bogus/Zone"
    res = client.post(
        f"/admin/gyms/{seed_gym['gym'].id}/update-settings",
        data={"timezone": "America/New_York"},
        follow_redirects=True,
    )
    gym = db.session.get(Gym, seed_gym["gym"].id)
    assert gym.timezone == "America/New_York"


# --- V6-L19: apply_due per-row containment ---

def test_v6l19_apply_due_contains_per_row_failure(seed_gym, monkeypatch):
    today = date.today()
    owner = seed_gym["owner"]
    m1 = _member(seed_gym, "L19 One", today - timedelta(days=29), today - timedelta(days=1),
                 status="expired")
    r1 = _row(seed_gym, member=m1, owner=owner, previous_start=today - timedelta(days=29),
              previous_end=today - timedelta(days=1), new_start=today,
              new_end=today + timedelta(days=29))
    m2 = _member(seed_gym, "L19 Two", today - timedelta(days=29), today - timedelta(days=1),
                 status="expired")
    r2 = _row(seed_gym, member=m2, owner=owner, previous_start=today - timedelta(days=29),
              previous_end=today - timedelta(days=1), new_start=today,
              new_end=today + timedelta(days=29))

    import app.services.payment_service as ps

    real_queue = ps.queue_membership_command

    def _flaky(member, **kwargs):
        if member.id == m1.id:
            raise RuntimeError("terminal exploded")
        return real_queue(member, **kwargs)

    monkeypatch.setattr(ps, "queue_membership_command", _flaky)
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 1
    db.session.refresh(m1)
    db.session.refresh(m2)
    assert m1.membership_end == today - timedelta(days=1)  # rolled back
    assert m2.membership_end == today + timedelta(days=29)  # still activated
    assert AuditLog.query.filter_by(
        action="scheduled_renewal_activation_failed"
    ).count() == 1


# --- V6-L20: force-activation endpoint + reactivation catch-up ---

def test_v6l20_force_activate_endpoint(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L20 Member", today - timedelta(days=59), today - timedelta(days=30),
                     status="expired")
    sched = _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
                 today, today + timedelta(days=29))
    res = client.post(
        f"/api/mobile/v1/renewals/scheduled/{sched.id}/activate",
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    assert res.get_json()["data"]["outcome"] == "activated"
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=29)
    assert AuditLog.query.filter_by(action="scheduled_renewal_force_activated").count() == 1


def test_v6l20_force_activate_expired_window_row(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L20 Expired", today - timedelta(days=59), today - timedelta(days=30),
                     status="expired")
    sched = _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
                 today - timedelta(days=10), today - timedelta(days=5))
    res = client.post(
        f"/api/mobile/v1/renewals/scheduled/{sched.id}/activate",
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=5)
    assert member.status == "expired"


def test_v6l20_resume_gym_catches_up_due_rows(client, seed_gym, super_admin):
    today = date.today()
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    member = _member(seed_gym, "L20 Resume", today - timedelta(days=59), today - timedelta(days=30),
                     status="expired")
    _row(seed_gym, member, owner, today - timedelta(days=59), today - timedelta(days=30),
         today, today + timedelta(days=29))
    gym.status = "suspended"
    db.session.commit()
    _web_login(client, "superadmin@test.com", "AdminPass123!")
    res = client.post(f"/admin/gyms/{gym.id}/resume", follow_redirects=True)
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=29)


# --- V6-L21: member UPI-confirm falls back to the plan duration ---

def test_v6l21_upi_confirm_falls_back_to_plan_duration(client, seed_gym):
    from sqlalchemy import text

    today = date.today()
    plan90 = _plan(seed_gym, "Quarterly", 90, price=2700)
    # Expired member, so the renewal is immediate (not scheduled for
    # tomorrow) and the fallback duration is observable in the end.
    member = _member(seed_gym, "L21 Member", today - timedelta(days=90), today - timedelta(days=1),
                     status="expired", plan=plan90)
    pay = _payment(seed_gym, member, renewal_days=30, paid_on=today, status="pending",
                   amount=2700)
    # Simulate a legacy row with renewal_days 0 (bypassing the CHECK).
    db.session.execute(text("PRAGMA ignore_check_constraints=ON"))
    db.session.execute(
        text("UPDATE payment_verifications SET renewal_days=0 WHERE id=:id"),
        {"id": pay.id},
    )
    db.session.commit()
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    res = client.post(
        "/api/member/v1/renew/confirm-upi",
        json={"payment_id": pay.id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=89)


# --- V6-L22: already-applied rows still pin price/plan/audit ---

def test_v6l22_already_applied_row_pins_price_and_audits(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L22 Member", today, today + timedelta(days=29), price=500)
    _row(seed_gym, member, owner, today - timedelta(days=1), today - timedelta(days=1),
         today, today + timedelta(days=29), payment=None)
    # Renewal row amount defaults to 1000 in _row; make the gap visible.
    row = RenewalHistory.query.filter_by(member_id=member.id).first()
    row.amount = Decimal("1500.00")
    db.session.commit()
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 1
    db.session.refresh(member)
    assert member.price == Decimal("1500.00")
    entry = AuditLog.query.filter_by(action="scheduled_renewal_activated").first()
    assert entry is not None and entry.metadata_json.get("already_applied") is True


# --- V6-L15: scan and Apply agree when a test payment backs the row ---

def test_v6l15_scan_and_apply_agree_with_test_payment(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L15b Member", today - timedelta(days=29), today)
    p_test = _payment(seed_gym, member, renewal_days=60, paid_on=today - timedelta(days=84),
                      status="verified", is_test=True)
    _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=89),
         today - timedelta(days=89), today - timedelta(days=30), payment=p_test)
    _row(seed_gym, member, owner, today - timedelta(days=89), today - timedelta(days=30),
         today - timedelta(days=29), today)
    scan = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert scan.status_code == 200
    flagged = {f["member_id"]: f for f in scan.get_json()["data"]["flagged"]}
    assert member.id in flagged
    assert flagged[member.id]["classification"] == "oversized_renewal"
    proposed_end = flagged[member.id]["proposed_end"]
    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        json={"member_ids": [member.id]},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    result = res.get_json()["data"]["results"][0]
    assert result["applied"] is True
    assert result["new_end"] == proposed_end
    db.session.refresh(member)
    assert member.membership_end.isoformat() == proposed_end
