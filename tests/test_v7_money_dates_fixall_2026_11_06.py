"""Fix-all v7 — money + dates (worker A3, 2026-11-06).

Covers: V7-M4 (expired-renewal start floor, all three paths),
V7-M5 (due-but-unactivated scheduled rows are live for guards /
re-chains; stale outcome audited), V7-M6 (refund after freeze /
manual edit reverts; genuine later renewal still protected),
V7-L6 (unfreeze claws back unused freeze days),
V7-L7 (future-dated INSIDE rows reset), V7-L15 (verify_payment
propagates is_test to the renewal row).
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import AuditLog, Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.models.member_access_state import MemberAccessState
from app.services.access_event_service import auto_reset_stale_inside_members
from app.services.payment_service import (
    active_scheduled_renewals,
    apply_due_scheduled_renewals,
    refund_payment,
    verify_payment,
)


def _headers(user, gym):
    token = create_access_token(user_id=user.id, gym_id=gym.id, role=user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end, status="active", price=1000, plan=None):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=(plan.id if plan else seed_gym["plan"].id),
        full_name=name,
        phone="+919999900001",
        membership_start=start,
        membership_end=end,
        status=status,
        price=price,
    )
    db.session.add(m)
    db.session.commit()
    return m


def _row(seed_gym, member, owner, previous_start, previous_end, new_start, new_end,
         duration_days=30, payment=None, is_creation=False):
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
    )
    db.session.add(r)
    db.session.commit()
    return r


def _payment(seed_gym, member, renewal_days=30, paid_on=None, status="pending",
             is_test=False, amount=1000, reference=None, renewal_start_date=None):
    p = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        amount=Decimal(str(amount)),
        paid_on=paid_on or date.today(),
        method="upi",
        reference=reference,
        status=status,
        renewal_days=renewal_days,
        renewal_start_date=renewal_start_date,
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


# --- V7-M4: expired-member renewals floored at previous_end + 1 ---

def test_v7m4_verify_rejects_expired_backdate_inside_previous_period(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    # Previous period today-30 .. today-1 (expired yesterday).
    member = _member(seed_gym, "M4 Verify", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    p = _payment(seed_gym, member, renewal_days=30,
                 renewal_start_date=today - timedelta(days=10))
    with pytest.raises(ValueError, match="overlap the previous paid period"):
        verify_payment(p, verified_by_id=owner.id, renewal_days=30)
    db.session.rollback()
    # A start before the previous period is rejected too.
    p2 = _payment(seed_gym, member, renewal_days=30,
                  renewal_start_date=today - timedelta(days=40))
    with pytest.raises(ValueError, match="overlap the previous paid period"):
        verify_payment(p2, verified_by_id=owner.id, renewal_days=30)
    db.session.rollback()
    # The floor itself (previous_end + 1 == today) still verifies.
    p3 = _payment(seed_gym, member, renewal_days=30,
                  renewal_start_date=today)
    renewal = verify_payment(p3, verified_by_id=owner.id, renewal_days=30)
    assert renewal.new_start == today
    assert renewal.new_end == today + timedelta(days=29)
    db.session.rollback()


def test_v7m4_verify_default_start_still_today_for_expired_member(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M4 Default", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    p = _payment(seed_gym, member, renewal_days=30)
    renewal = verify_payment(p, verified_by_id=owner.id, renewal_days=30)
    assert renewal.new_start == today
    db.session.rollback()


def test_v7m4_direct_renew_rejects_expired_backdate_inside_previous_period(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M4 Direct", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        json={"renewal_days": 30, "amount": "1000.00",
              "renewal_start_date": (today - timedelta(days=10)).isoformat()},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 400
    assert b"overlap the previous paid period" in res.data
    assert RenewalHistory.query.filter_by(member_id=member.id).count() == 0
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        json={"renewal_days": 30, "amount": "1000.00",
              "renewal_start_date": today.isoformat()},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 201, res.data
    db.session.refresh(member)
    assert member.membership_start == today


def test_v7m4_bulk_renew_rejects_expired_backdate_inside_previous_period(client, seed_gym):
    today = date.today()
    member = _member(seed_gym, "M4 Bulk", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    _web_login(client, "owner@testgym.com", "SecurePass123!")
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30",
              "amount": "1000",
              "start_date": (today - timedelta(days=10)).isoformat()},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"overlap the previous paid period" in res.data
    assert RenewalHistory.query.filter_by(member_id=member.id).count() == 0
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=1)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30",
              "amount": "1000", "start_date": today.isoformat()},
        follow_redirects=True,
    )
    assert res.status_code == 200
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=29)


# --- V7-M5: due-but-unactivated scheduled rows are live ---

def test_v7m5_due_scheduled_row_counts_as_live(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M5 Due", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    row = _row(seed_gym, member, owner, today - timedelta(days=30),
               today - timedelta(days=1), today, today + timedelta(days=29))
    live = active_scheduled_renewals(member, today)
    assert [r.id for r in live] == [row.id]


def test_v7m5_freeze_refused_on_due_date(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M5 Freeze", today - timedelta(days=29), today)
    _row(seed_gym, member, owner, today - timedelta(days=29), today,
         today, today + timedelta(days=29))
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/freeze",
        json={"days": 7},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 409
    assert b"future renewal scheduled" in res.data
    db.session.refresh(member)
    assert member.membership_end == today


def test_v7m5_manual_edit_rechains_due_row_after_missed_window(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M5 Edit", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    sched = _row(seed_gym, member, owner, today - timedelta(days=30),
                 today - timedelta(days=1), today - timedelta(days=5),
                 today + timedelta(days=24))
    res = client.patch(
        f"/api/mobile/v1/members/{member.id}",
        json={"membership_end": today.isoformat()},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(sched)
    assert sched.previous_end == today
    assert AuditLog.query.filter_by(action="scheduled_renewal_rechained").count() >= 1
    # And the re-chained row can now actually activate.
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 1
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=24)


def test_v7m5_stale_outcome_in_apply_due_is_audited(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M5 Stale", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    # Row chained to an end the member no longer has: stale, but due.
    _row(seed_gym, member, owner, today - timedelta(days=60),
         today - timedelta(days=10), today - timedelta(days=5),
         today + timedelta(days=24))
    assert apply_due_scheduled_renewals(seed_gym["gym"]) == 0
    entry = AuditLog.query.filter_by(
        action="scheduled_renewal_stale_unactivated").first()
    assert entry is not None
    assert entry.metadata_json["member_id"] == member.id


# --- V7-M6: refund after freeze / manual edit reverts; later renewal protected ---

def test_v7m6_refund_after_freeze_revokes_access(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M6 Freeze", today, today + timedelta(days=29))
    p1 = _payment(seed_gym, member, renewal_days=30, status="verified")
    _row(seed_gym, member, owner, today - timedelta(days=30),
         today - timedelta(days=1), today, today + timedelta(days=29), payment=p1)
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/freeze",
        json={"days": 14},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=43)
    assert member.status == "paused"
    refund_payment(p1, refunded_by_id=owner.id)
    db.session.commit()
    db.session.refresh(member)
    # The refunded period is gone, including the freeze extension.
    assert member.membership_end == today - timedelta(days=1)
    assert member.status == "paused"
    assert p1.status == "refunded"


def test_v7m6_refund_after_manual_edit_revokes_access(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M6 Edit", today, today + timedelta(days=29))
    p1 = _payment(seed_gym, member, renewal_days=30, status="verified")
    _row(seed_gym, member, owner, today - timedelta(days=30),
         today - timedelta(days=1), today, today + timedelta(days=29), payment=p1)
    res = client.patch(
        f"/api/mobile/v1/members/{member.id}",
        # Grid-valid edit: a 30-day plan starting today may end
        # today+29 or today+30; today+30 is the +1-day hand edit.
        json={"membership_end": (today + timedelta(days=30)).isoformat()},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    refund_payment(p1, refunded_by_id=owner.id)
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=1)


def test_v7m6_refund_of_earlier_row_keeps_genuine_later_renewal_after_freeze(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M6 Later", today, today + timedelta(days=29))
    p1 = _payment(seed_gym, member, renewal_days=30, status="verified")
    _row(seed_gym, member, owner, today - timedelta(days=60),
         today - timedelta(days=31), today - timedelta(days=30),
         today - timedelta(days=1), payment=p1)
    p2 = _payment(seed_gym, member, renewal_days=30, status="verified")
    _row(seed_gym, member, owner, today - timedelta(days=30),
         today - timedelta(days=1), today, today + timedelta(days=29), payment=p2)
    # Freeze moves the end past the later row's new_end.
    member.membership_end = today + timedelta(days=43)
    member.status = "paused"
    db.session.commit()
    refund_payment(p1, refunded_by_id=owner.id)
    db.session.commit()
    db.session.refresh(member)
    # The later (still-paid) period survives, freeze extension intact.
    assert member.membership_end == today + timedelta(days=43)
    assert member.membership_start == today


def test_v7m6_refund_of_scheduled_row_moves_no_dates(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "M6 Sched", today - timedelta(days=29), today)
    p1 = _payment(seed_gym, member, renewal_days=30, status="verified")
    _row(seed_gym, member, owner, today - timedelta(days=29), today,
         today + timedelta(days=1), today + timedelta(days=30), payment=p1)
    refund_payment(p1, refunded_by_id=owner.id)
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_start == today - timedelta(days=29)
    assert member.membership_end == today


# --- V7-L6: unfreeze claws back unused freeze days ---

def test_v7l6_unfreeze_same_day_returns_full_freeze_extension(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L6 Clawback", today, today + timedelta(days=60))
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/freeze",
        json={"days": 30},
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=90)
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unfreeze",
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    # Resumed the same day: 0 days actually paused, all 30 clawed back.
    assert member.membership_end == today + timedelta(days=60)
    assert member.status == "active"
    entry = AuditLog.query.filter_by(action="unfreeze_member").first()
    assert entry is not None and entry.metadata_json.get("clawed_back_days") == 30


def test_v7l6_unfreeze_after_partly_used_freeze_claws_back_rest(client, seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L6 Partial", today, today + timedelta(days=60))
    # Freeze 14 days, but backdate the marker 4 days: 4 used, 10 unused.
    member.membership_end = today + timedelta(days=74)
    member.status = "paused"
    member.notes = (
        f"\n[Paused on {(today - timedelta(days=4)).isoformat()} for 14 days]"
    )
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unfreeze",
        headers=_headers(owner, seed_gym["gym"]),
    )
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=64)
    assert member.status == "active"


# --- V7-L7: future-dated INSIDE rows are reset ---

def test_v7l7_future_dated_inside_row_is_reset(seed_gym):
    gym = seed_gym["gym"]
    now = datetime.now(timezone.utc)
    member = _member(seed_gym, "L7 Future", date.today(), date.today() + timedelta(days=29))
    future_state = MemberAccessState(
        gym_id=gym.id,
        member_id=member.id,
        current_state="INSIDE",
        last_entry_at=now + timedelta(days=2),
    )
    db.session.add(future_state)
    db.session.commit()
    assert auto_reset_stale_inside_members(gym.id, "Asia/Kolkata") == 1
    # The reset function mutates but does not commit (its docstring:
    # "The caller is responsible for committing the session") —
    # commit before refreshing, or the refresh discards the change.
    db.session.commit()
    db.session.refresh(future_state)
    assert future_state.current_state == "OUTSIDE"
    assert future_state.last_exit_at is not None


def test_v7l7_recent_inside_row_is_not_reset(seed_gym):
    gym = seed_gym["gym"]
    now = datetime.now(timezone.utc)
    member = _member(seed_gym, "L7 Recent", date.today(), date.today() + timedelta(days=29))
    state = MemberAccessState(
        gym_id=gym.id,
        member_id=member.id,
        current_state="INSIDE",
        last_entry_at=now,
    )
    db.session.add(state)
    db.session.commit()
    assert auto_reset_stale_inside_members(gym.id, "Asia/Kolkata") == 0
    db.session.refresh(state)
    assert state.current_state == "INSIDE"


# --- V7-L15: verify_payment propagates is_test ---

def test_v7l15_verify_payment_propagates_is_test(seed_gym):
    today = date.today()
    owner = seed_gym["owner"]
    member = _member(seed_gym, "L15 Test", today - timedelta(days=30),
                     today - timedelta(days=1), status="expired")
    p = _payment(seed_gym, member, renewal_days=30, is_test=True,
                 renewal_start_date=today)
    renewal = verify_payment(p, verified_by_id=owner.id, renewal_days=30)
    assert renewal.is_test is True
    db.session.rollback()
    member2 = _member(seed_gym, "L15 Real", today - timedelta(days=30),
                      today - timedelta(days=1), status="expired")
    p2 = _payment(seed_gym, member2, renewal_days=30, is_test=False,
                  renewal_start_date=today)
    renewal2 = verify_payment(p2, verified_by_id=owner.id, renewal_days=30)
    assert renewal2.is_test is False
    db.session.rollback()
