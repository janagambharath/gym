"""Regression tests for deep review v3 dates findings (2026-11-06).

- V3-H4: Date Repair S3 false-positives on every member renewed
  through the payment/renewal flow. The stored start is the CURRENT
  period's start, not the chain start.
- V3-H5: oversized_renewal Apply is self-reverting (ledger never
  corrected) + no freeze guard on Apply.
- V3-M16: "one verified future renewal" not enforced across the
  direct and payment paths; stale scheduled rows must not block.
- V3-M17: legacy bulk_renew clobbers dates without clearing a pending
  scheduled future renewal.
- V3-M18: _revert_renewal doesn't restore plan/price; refunding a
  signup leaves a 1-day active stub.
- V3-L15: legacy bulk_renew forces start=today for expired members.
- V3-L17: pending payments with an impossible start can never verify.
"""
from datetime import date, timedelta
from decimal import Decimal

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.services.payment_service import refund_payment


def _headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end, status="active", notes=None, price=1000):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
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


def _row(seed_gym, member, owner, previous_start, previous_end, new_start, new_end):
    db.session.add(
        RenewalHistory(
            gym_id=seed_gym["gym"].id,
            member_id=member.id,
            plan_id=seed_gym["plan"].id,
            renewed_by_id=owner.id,
            previous_start=previous_start,
            previous_end=previous_end,
            new_start=new_start,
            new_end=new_end,
            amount=1000,
        )
    )


def _scan(client, seed_gym):
    res = client.get(
        "/api/mobile/v1/date-repair/scan",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()["data"]["flagged"]


def _apply(client, seed_gym, member_id):
    res = client.post(
        "/api/mobile/v1/date-repair/apply",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={"member_ids": [member_id]},
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()["data"]["results"][0]


def _login_owner(client, seed_gym):
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )


def _create_member_via_api(client, seed_gym, start, end):
    """A REAL verify_payment-produced ledger: signup through the API
    (creation row) + nothing else. Production membership_start after
    a renewal is the new period's start, never the signup date."""
    res = client.post(
        "/api/mobile/v1/members",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "full_name": "Real Ledger",
            "phone": "+919999900301",
            "plan_id": seed_gym["plan"].id,
            "membership_start": start.isoformat(),
            "membership_end": end.isoformat(),
            "amount": "1000.00",
            "method": "upi",
        },
    )
    assert res.status_code == 201, res.get_json()
    return db.session.get(Member, res.get_json()["data"]["id"])


# ─── V3-H4 ───────────────────────────────────────────────────────────────

def test_h4_renewed_member_not_flagged_s3(client, seed_gym):
    # Signup 45 days ago for 30 days, then one chained renewal.
    start0 = date.today() - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    member = _create_member_via_api(client, seed_gym, start0, end0)
    new_start = end0 + timedelta(days=1)
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "member_id": member.id,
            "plan_id": seed_gym["plan"].id,
            "amount": "1000.00",
            "method": "cash",
            "channel": "offline",
            "renewal_days": 30,
            "renewal_start_date": new_start.isoformat(),
            "auto_verify": True,
        },
    )
    assert res.status_code == 201, res.get_json()
    db.session.refresh(member)
    # Production convention: stored start IS the current period start.
    assert member.membership_start == new_start
    assert member.membership_end == new_start + timedelta(days=29)
    rows = RenewalHistory.query.filter_by(member_id=member.id).order_by(RenewalHistory.id).all()
    assert len(rows) == 2
    assert rows[0].previous_end == rows[0].new_start == start0  # creation row
    assert rows[1].new_start == new_start
    # The old S3 flagged this member (stored start != chain start).
    assert _scan(client, seed_gym) == []


def test_h4_start_mismatch_still_flags_with_current_period_proposal(client, seed_gym):
    owner = seed_gym["owner"]
    start0 = date.today() - timedelta(days=60)
    first_end = start0 + timedelta(days=29)
    second_start = first_end + timedelta(days=1)
    second_end = second_start + timedelta(days=29)
    # Stored start matches NO ledger new_start: genuinely wrong.
    m = _member(seed_gym, "BadStart", start0 + timedelta(days=10), second_end)
    _row(seed_gym, m, owner, start0, start0, start0, first_end)
    _row(seed_gym, m, owner, start0, first_end, second_start, second_end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "start_ledger_mismatch"
    # Proposal is the CURRENT period start, not the signup date.
    assert flagged[0]["proposed_start"] == second_start.isoformat()
    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_start == second_start
    assert _scan(client, seed_gym) == []


def test_h4_bulk_renew_writes_current_period_start_for_active_member(client, seed_gym):
    today = date.today()
    m = _member(
        seed_gym, "BulkActive", today - timedelta(days=30), today + timedelta(days=5),
        status="active",
    )
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(m.id)], "renewal_days": "30", "amount": "1000"},
    )
    assert res.status_code == 302
    db.session.refresh(m)
    # One convention: bulk renew writes membership_start = new_start too.
    assert m.membership_start == today + timedelta(days=6)
    assert m.membership_end == today + timedelta(days=35)


# ─── V3-H5 ───────────────────────────────────────────────────────────────

def test_h5_oversized_apply_corrects_ledger_and_converges(client, seed_gym):
    owner = seed_gym["owner"]
    start = date.today() - timedelta(days=15)
    first_end = start + timedelta(days=30)
    bad_end = first_end + timedelta(days=61)
    m = _member(seed_gym, "Oversized", start, bad_end)
    _row(seed_gym, m, owner, start, start, start, first_end)
    _row(seed_gym, m, owner, start, first_end, first_end + timedelta(days=1), bad_end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "oversized_renewal"
    proposed = bad_end - timedelta(days=31)
    assert flagged[0]["proposed_end"] == proposed.isoformat()

    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    assert result.get("ledger_corrected") is True
    db.session.refresh(m)
    assert m.membership_end == proposed
    # The ledger now agrees: chain_last_end == applied end.
    rows = RenewalHistory.query.filter_by(member_id=m.id).order_by(RenewalHistory.id).all()
    assert rows[-1].new_end == proposed
    # The old bug: the next scan proposed the oversized end back.
    assert _scan(client, seed_gym) == []


def test_h5_oversized_apply_shifts_later_chain_rows(client, seed_gym):
    owner = seed_gym["owner"]
    start0 = date.today() - timedelta(days=105)
    first_end = start0 + timedelta(days=29)
    second_start = first_end + timedelta(days=1)
    second_end = second_start + timedelta(days=60)  # 61 days: 31 excess
    third_start = second_end + timedelta(days=1)
    third_end = third_start + timedelta(days=29)
    # Production convention: stored start is the latest period's start.
    m = _member(seed_gym, "OversizedChain", third_start, third_end)
    _row(seed_gym, m, owner, start0, start0, start0, first_end)
    _row(seed_gym, m, owner, start0, first_end, second_start, second_end)
    _row(seed_gym, m, owner, first_end, second_end, third_start, third_end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "oversized_renewal"
    proposed = third_end - timedelta(days=31)
    assert flagged[0]["proposed_end"] == proposed.isoformat()

    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_end == proposed
    rows = RenewalHistory.query.filter_by(member_id=m.id).order_by(RenewalHistory.id).all()
    # Oversized row cut to 30 days; later row shifted earlier by 31.
    assert (rows[1].new_end - rows[1].new_start).days + 1 == 30
    assert rows[2].new_start == third_start - timedelta(days=31)
    assert rows[2].new_end == proposed
    # Stored start tracked the shifted current-period start.
    assert m.membership_start == rows[2].new_start
    # Chaining preserved: each period starts the day after the last ends.
    assert rows[1].new_start == rows[0].new_end + timedelta(days=1)
    assert rows[2].new_start == rows[1].new_end + timedelta(days=1)
    assert _scan(client, seed_gym) == []


def test_h5_apply_refuses_frozen_member(client, seed_gym):
    owner = seed_gym["owner"]
    start = date.today() - timedelta(days=15)
    end = start + timedelta(days=29)
    m = _member(
        seed_gym, "Frozen", start, end + timedelta(days=10),
        status="paused",
        notes=f"[Paused on {date.today().isoformat()} for 30 days]",
    )
    _row(seed_gym, m, owner, start, start, start, end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "ledger_mismatch"
    assert flagged[0]["confidence"] == "review"
    result = _apply(client, seed_gym, m.id)
    assert result == {"member_id": m.id, "applied": False, "reason": "frozen"}
    db.session.refresh(m)
    assert m.membership_end == end + timedelta(days=10)


def test_h5_apply_refuses_freeze_marker_on_active_member(client, seed_gym):
    owner = seed_gym["owner"]
    start = date.today() - timedelta(days=15)
    end = start + timedelta(days=29)
    m = _member(
        seed_gym, "FreezeMarked", start, end + timedelta(days=10),
        status="active",
        notes=f"[Paused on {date.today().isoformat()} for 30 days]",
    )
    _row(seed_gym, m, owner, start, start, start, end)
    db.session.commit()
    assert _scan(client, seed_gym)[0]["classification"] == "ledger_mismatch"
    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is False
    assert result["reason"] == "frozen"
    db.session.refresh(m)
    assert m.membership_end == end + timedelta(days=10)


# ─── V3-M16 ──────────────────────────────────────────────────────────────

def _schedule_direct_renewal(client, seed_gym, member, start):
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={"renewal_days": 30, "amount": "1000.00",
              "renewal_start_date": start.isoformat()},
    )
    assert res.status_code == 201, res.get_json()
    return res


def _create_payment(client, seed_gym, member, start):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "member_id": member.id,
            "plan_id": seed_gym["plan"].id,
            "amount": "1000.00",
            "method": "cash",
            "channel": "offline",
            "renewal_days": 30,
            "renewal_start_date": start.isoformat(),
        },
    )
    assert res.status_code == 201, res.get_json()
    return res.get_json()["data"]["id"]


def test_m16_verify_payment_blocked_by_direct_scheduled_renewal(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "Scheduled", today - timedelta(days=30), today + timedelta(days=30))
    future = today + timedelta(days=31)
    _schedule_direct_renewal(client, seed_gym, m, future)
    payment_id = _create_payment(client, seed_gym, m, future)
    res = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 409, res.get_json()
    assert "already has a verified future renewal scheduled" in res.get_json()["error"]["message"]
    db.session.refresh(m)
    assert m.membership_end == today + timedelta(days=30)


def test_m16_direct_renewal_blocked_by_verified_scheduled_payment(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "PayScheduled", today - timedelta(days=30), today + timedelta(days=30))
    future = today + timedelta(days=31)
    payment_id = _create_payment(client, seed_gym, m, future)
    res = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    res = client.post(
        f"/api/mobile/v1/renewals/{m.id}",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={"renewal_days": 30, "amount": "1000.00",
              "renewal_start_date": future.isoformat()},
    )
    assert res.status_code == 409, res.get_json()


def test_m16_stale_scheduled_row_does_not_block_direct_renewal(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "StaleDirect", today - timedelta(days=30), today + timedelta(days=30))
    future = today + timedelta(days=31)
    _schedule_direct_renewal(client, seed_gym, m, future)
    # The scheduled row's previous_end no longer matches: it can never
    # activate (apply_due skips it), so it must not block scheduling.
    m.membership_end = today + timedelta(days=40)
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/renewals/{m.id}",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={"renewal_days": 30, "amount": "1000.00",
              "renewal_start_date": (today + timedelta(days=41)).isoformat()},
    )
    assert res.status_code == 201, res.get_json()


def test_m16_stale_scheduled_row_does_not_block_verify(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "StaleVerify", today - timedelta(days=30), today + timedelta(days=30))
    future = today + timedelta(days=31)
    _schedule_direct_renewal(client, seed_gym, m, future)
    m.membership_end = today + timedelta(days=40)
    db.session.commit()
    payment_id = _create_payment(client, seed_gym, m, today + timedelta(days=41))
    res = client.post(
        f"/api/mobile/v1/payments/{payment_id}/verify",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()


# ─── V3-M17 / V3-L15 ─────────────────────────────────────────────────────

def test_m17_bulk_renew_refuses_pending_scheduled_renewal(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "BulkBlocked", today - timedelta(days=30), today + timedelta(days=30))
    _schedule_direct_renewal(client, seed_gym, m, today + timedelta(days=31))
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(m.id)], "renewal_days": "30", "amount": "1000"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"already has a future renewal scheduled" in res.data
    db.session.refresh(m)
    assert m.membership_end == today + timedelta(days=30)
    assert RenewalHistory.query.filter_by(member_id=m.id).count() == 1


def test_m17_bulk_renew_allows_stale_scheduled_renewal(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "BulkStale", today - timedelta(days=30), today + timedelta(days=30))
    _schedule_direct_renewal(client, seed_gym, m, today + timedelta(days=31))
    m.membership_end = today + timedelta(days=40)
    db.session.commit()
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(m.id)], "renewal_days": "30", "amount": "1000"},
    )
    assert res.status_code == 302
    db.session.refresh(m)
    assert m.membership_start == today + timedelta(days=41)
    assert m.membership_end == today + timedelta(days=70)


def test_l15_bulk_renew_expired_defaults_to_previous_end_plus_one(client, seed_gym):
    today = date.today()
    m = _member(
        seed_gym, "ExpiredBulk", today - timedelta(days=60), today - timedelta(days=5),
        status="expired",
    )
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(m.id)], "renewal_days": "30", "amount": "1000"},
    )
    assert res.status_code == 302
    db.session.refresh(m)
    assert m.membership_start == today - timedelta(days=4)
    assert m.membership_end == today + timedelta(days=25)
    assert m.status == "active"


def test_l15_bulk_renew_accepts_per_member_start_date(client, seed_gym):
    today = date.today()
    m = _member(
        seed_gym, "BackdatedBulk", today - timedelta(days=60), today - timedelta(days=5),
        status="expired",
    )
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={
            "member_ids": [str(m.id)],
            "renewal_days": "30",
            "amount": "1000",
            f"start_date_{m.id}": (today - timedelta(days=10)).isoformat(),
        },
    )
    assert res.status_code == 302
    db.session.refresh(m)
    assert m.membership_start == today - timedelta(days=10)
    assert m.membership_end == today + timedelta(days=19)
    assert m.status == "active"


def test_l15_bulk_renew_rejects_period_shortening_start(client, seed_gym):
    today = date.today()
    m = _member(seed_gym, "ShortenBulk", today - timedelta(days=30), today + timedelta(days=30))
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={
            "member_ids": [str(m.id)],
            "renewal_days": "30",
            "amount": "1000",
            "start_date": today.isoformat(),
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"would shorten the current paid membership" in res.data
    db.session.refresh(m)
    assert m.membership_end == today + timedelta(days=30)
    assert RenewalHistory.query.filter_by(member_id=m.id).count() == 0


# ─── V3-M18 ──────────────────────────────────────────────────────────────

def test_m18_refund_signup_leaves_member_expired_not_active_stub(client, seed_gym):
    start = date.today()
    member = _create_member_via_api(client, seed_gym, start, start + timedelta(days=29))
    payment = PaymentVerification.query.filter_by(member_id=member.id).one()
    res = client.post(
        f"/api/mobile/v1/payments/{payment.id}/refund",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(member)
    assert member.status == "expired"
    assert member.membership_start == start
    assert member.membership_end == start
    assert RenewalHistory.query.filter_by(member_id=member.id).count() == 0


def test_m18_revert_restores_plan_and_price(client, seed_gym):
    today = date.today()
    plan_b = MembershipPlan(
        gym_id=seed_gym["gym"].id, name="Monthly Premium",
        duration_days=30, price=2000,
    )
    db.session.add(plan_b)
    db.session.commit()
    m = _member(
        seed_gym, "PlanChange", today - timedelta(days=35), today - timedelta(days=5),
        status="expired", price=1000,
    )
    assert m.plan_id == seed_gym["plan"].id
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "member_id": m.id,
            "plan_id": plan_b.id,
            "amount": "2000.00",
            "method": "cash",
            "channel": "offline",
            "renewal_days": 30,
            "auto_verify": True,
        },
    )
    assert res.status_code == 201, res.get_json()
    db.session.refresh(m)
    assert m.plan_id == plan_b.id
    assert m.price == Decimal("2000.00")
    assert m.membership_start == today
    assert m.membership_end == today + timedelta(days=29)
    renewal = RenewalHistory.query.filter_by(member_id=m.id).one()
    assert renewal.previous_plan_id == seed_gym["plan"].id
    assert renewal.previous_price == Decimal("1000.00")
    payment = PaymentVerification.query.filter_by(member_id=m.id).one()
    refund_payment(payment, refunded_by_id=seed_gym["owner"].id)
    db.session.commit()
    db.session.refresh(m)
    assert m.plan_id == seed_gym["plan"].id
    assert m.price == Decimal("1000.00")
    assert m.membership_start == today - timedelta(days=35)
    assert m.membership_end == today - timedelta(days=5)
    assert m.status == "expired"


# ─── V3-L17 ──────────────────────────────────────────────────────────────

def test_l17_create_payment_rejects_already_expired_period(client, seed_gym):
    today = date.today()
    m = _member(
        seed_gym, "ImpossibleStart", today - timedelta(days=90), today - timedelta(days=60),
        status="expired",
    )
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "member_id": m.id,
            "plan_id": seed_gym["plan"].id,
            "amount": "1000.00",
            "method": "cash",
            "channel": "offline",
            "renewal_days": 30,
            "renewal_start_date": (today - timedelta(days=60)).isoformat(),
        },
    )
    assert res.status_code == 400, res.get_json()
    assert "already be expired" in res.get_json()["error"]["message"]
    assert PaymentVerification.query.filter_by(member_id=m.id).count() == 0


def test_l17_create_payment_accepts_backdated_but_live_period(client, seed_gym):
    today = date.today()
    m = _member(
        seed_gym, "LiveBackdate", today - timedelta(days=90), today - timedelta(days=60),
        status="expired",
    )
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json={
            "member_id": m.id,
            "plan_id": seed_gym["plan"].id,
            "amount": "1000.00",
            "method": "cash",
            "channel": "offline",
            "renewal_days": 30,
            "renewal_start_date": (today - timedelta(days=10)).isoformat(),
        },
    )
    assert res.status_code == 201, res.get_json()
