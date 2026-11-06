"""Regression tests for deep review v4 dates findings (2026-11-06).

- V4-H1: Date Repair flags EVERY member with a pending scheduled
  future renewal as ledger_mismatch; Apply jumps their end to the
  future period early. Pending rows (new_start > today) must be
  excluded from chain_last_end and from the ledger-end comparison,
  and Apply must never set membership_start to a future date.
- V4-M11: _correct_oversized_ledger doesn't update previous_*
  snapshots, so a later refund resurrects the oversized end.
- V4-M12: oversized repair doesn't converge when a scheduled future
  row exists (oversized masked entirely; Apply start-follow only
  tracked the latest row's old start).
- V4-M13: oversized measured against the plan's LIVE duration, and
  creation rows never checked. duration_days is snapshotted at write
  time; creation rows are included in the oversized check.
- V4-M18: restore un-pauses frozen members on every delete path
  except mobile. previous_status is now recorded on the web delete,
  import-undo, and admin undo paths too, and restore checks paused
  BEFORE expiry.
- V4-L14: S3 false negative — a stored start matching a pre-restart
  (old-chain) row passed. ledger_starts is built from chain_rows
  only.
"""
from datetime import date, timedelta
from decimal import Decimal

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import (
    Member,
    MembershipPlan,
    PaymentVerification,
    RenewalHistory,
    User,
)
from app.models.mixins import utcnow


def _headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _member(seed_gym, name, start, end, status="active", notes=None,
            price=1000, external_ref=None):
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
        external_ref=external_ref,
    )
    db.session.add(m)
    db.session.commit()
    return m


def _row(seed_gym, member, owner, previous_start, previous_end,
         new_start, new_end, duration_days=None, payment=None):
    db.session.add(
        RenewalHistory(
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
        )
    )


def _payment(seed_gym, member, owner, renewal_days=30, paid_on=None):
    p = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        plan_id=seed_gym["plan"].id,
        created_by_id=owner.id,
        standard_price=Decimal("1000.00"),
        amount=Decimal("1000.00"),
        paid_on=paid_on or date.today(),
        method="cash",
        channel="offline",
        status="verified",
        verified_by_id=owner.id,
        verified_at=utcnow(),
        renewal_days=renewal_days,
    )
    db.session.add(p)
    db.session.flush()
    return p


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


def _restore(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/rrr/restore-deleted-members",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    return res.get_json()["data"]


def _login(client, email, password="SecurePass123!"):
    client.post(
        "/auth/login",
        data={"email": email, "password": password},
        follow_redirects=True,
    )


def _create_member_via_api(client, seed_gym, start, end):
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


def _create_payment(client, seed_gym, member, start, renewal_days=30,
                    auto_verify=True):
    body = {
        "member_id": member.id,
        "plan_id": seed_gym["plan"].id,
        "amount": "1000.00",
        "method": "cash",
        "channel": "offline",
        "renewal_days": renewal_days,
        "renewal_start_date": start.isoformat(),
        "auto_verify": auto_verify,
    }
    if renewal_days != seed_gym["plan"].duration_days:
        body["override_reason"] = "v4 regression test: oversized ledger"
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
        json=body,
    )
    assert res.status_code == 201, res.get_json()
    return res.get_json()["data"]["id"]


def _rows(member_id):
    return (
        RenewalHistory.query.filter_by(member_id=member_id)
        .order_by(RenewalHistory.id)
        .all()
    )


# ─── V4-H1 ───────────────────────────────────────────────────────────────

def test_h1_scheduled_renewal_not_flagged_ledger_mismatch(client, seed_gym):
    # REAL scheduled-renewal ledger: signup + immediate renewal +
    # a verified future renewal (scheduled row). The member's stored
    # end is the CURRENT period's end, not the future period's.
    today = date.today()
    start0 = today - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    member = _create_member_via_api(client, seed_gym, start0, end0)
    current_start = end0 + timedelta(days=1)
    _create_payment(client, seed_gym, member, current_start)
    db.session.refresh(member)
    current_end = current_start + timedelta(days=29)
    assert member.membership_end == current_end
    future_start = current_end + timedelta(days=1)
    _create_payment(client, seed_gym, member, future_start)
    db.session.refresh(member)
    # The scheduled row must not move the stored dates.
    assert member.membership_start == current_start
    assert member.membership_end == current_end
    # The old bug: every such member flagged ledger_mismatch with
    # proposed_end = the future period's end.
    assert _scan(client, seed_gym) == []


def test_h1_scheduled_renewal_with_gap_not_flagged(client, seed_gym):
    # Same, but the scheduled renewal starts after a deliberate gap
    # (member away a fortnight): the gap must not be bridged by the
    # scan, and the scheduled row must never activate early.
    today = date.today()
    start0 = today - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    member = _create_member_via_api(client, seed_gym, start0, end0)
    current_start = end0 + timedelta(days=1)
    _create_payment(client, seed_gym, member, current_start)
    db.session.refresh(member)
    current_end = current_start + timedelta(days=29)
    gap_start = current_end + timedelta(days=15)
    _create_payment(client, seed_gym, member, gap_start)
    db.session.refresh(member)
    assert member.membership_end == current_end
    assert _scan(client, seed_gym) == []


def test_h1_hand_edited_end_proposes_current_end_not_future(client, seed_gym):
    # With a scheduled row present, a hand-edited stored end must be
    # proposed back to the CURRENT period's end — never the future
    # period's end — and Apply must not jump the end forward early.
    today = date.today()
    start0 = today - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    member = _create_member_via_api(client, seed_gym, start0, end0)
    current_start = end0 + timedelta(days=1)
    _create_payment(client, seed_gym, member, current_start)
    db.session.refresh(member)
    current_end = current_start + timedelta(days=29)
    future_start = current_end + timedelta(days=1)
    future_end = future_start + timedelta(days=29)
    _create_payment(client, seed_gym, member, future_start)
    # Hand-edit the stored end 10 days early.
    member.membership_end = current_end - timedelta(days=10)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "ledger_mismatch"
    assert flagged[0]["proposed_end"] == current_end.isoformat()
    assert flagged[0]["proposed_end"] != future_end.isoformat()
    result = _apply(client, seed_gym, member.id)
    assert result["applied"] is True
    db.session.refresh(member)
    assert member.membership_end == current_end
    rows = _rows(member.id)
    assert rows[-1].new_start == future_start  # scheduled row untouched
    assert rows[-1].new_end == future_end
    assert _scan(client, seed_gym) == []


def test_h1_s3_proposes_current_start_not_scheduled_start(client, seed_gym):
    # Stored start matches NO ledger start, with a scheduled row
    # present: the S3 proposal must be the current period's start,
    # never the future scheduled start (Apply must never set a
    # future membership_start).
    owner = seed_gym["owner"]
    today = date.today()
    start0 = today - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    current_start = end0 + timedelta(days=1)
    current_end = current_start + timedelta(days=29)
    future_start = current_end + timedelta(days=1)
    future_end = future_start + timedelta(days=29)
    assert future_start > today  # genuinely scheduled, not started
    m = _member(seed_gym, "BadStartScheduled", today - timedelta(days=40),
                current_end)
    _row(seed_gym, m, owner, start0, start0, start0, end0)
    _row(seed_gym, m, owner, start0, end0, current_start, current_end)
    _row(seed_gym, m, owner, current_start, current_end, future_start,
         future_end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "start_ledger_mismatch"
    assert flagged[0]["proposed_start"] == current_start.isoformat()
    assert flagged[0]["proposed_start"] != future_start.isoformat()
    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_start == current_start
    assert m.membership_start <= today
    assert _scan(client, seed_gym) == []


# ─── V4-M11 ──────────────────────────────────────────────────────────────

def test_m11_oversized_apply_then_refund_rescan_stays_clean(client, seed_gym):
    # Oversized row followed by a chained renewal: Apply shortens the
    # oversized row and shifts the later row — INCLUDING its
    # previous_* snapshots. Refunding the later renewal must then
    # restore the CORRECTED end, not resurrect the oversized one.
    owner = seed_gym["owner"]
    today = date.today()
    start0 = today - timedelta(days=105)
    end0 = start0 + timedelta(days=29)
    second_start = end0 + timedelta(days=1)
    second_end = second_start + timedelta(days=60)  # 61 days: 31 excess
    third_start = second_end + timedelta(days=1)
    third_end = third_start + timedelta(days=29)
    m = _member(seed_gym, "OversizedRefund", third_start, third_end)
    pay2 = _payment(seed_gym, m, owner, renewal_days=61)
    pay3 = _payment(seed_gym, m, owner, renewal_days=30)
    _row(seed_gym, m, owner, start0, start0, start0, end0)
    _row(seed_gym, m, owner, start0, end0, second_start, second_end,
         payment=pay2)
    _row(seed_gym, m, owner, second_start, second_end, third_start,
         third_end, payment=pay3)
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
    rows = _rows(m.id)
    assert (rows[1].new_end - rows[1].new_start).days + 1 == 30
    assert rows[2].new_start == third_start - timedelta(days=31)
    assert rows[2].new_end == proposed
    # V4-M11: the shifted row's snapshots moved with it — previous_end
    # by the row's own shift (it tracks the shortened row's end) and
    # previous_start by the previous row's start shift (the shortened
    # row's start never moved, so neither does it).
    assert rows[2].previous_end == rows[1].new_end
    assert rows[2].previous_start == rows[1].new_start

    # Refund the next renewal through the real endpoint: the member
    # must land on the CORRECTED previous end, and the rescan must
    # stay clean. The old bug restored the oversized end.
    res = client.post(
        f"/api/mobile/v1/payments/{pay3.id}/refund",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(m)
    assert m.membership_end == rows[1].new_end
    assert m.membership_start == rows[1].new_start
    assert _scan(client, seed_gym) == []


# ─── V4-M12 ──────────────────────────────────────────────────────────────

def test_m12_oversized_with_scheduled_row_converges(client, seed_gym):
    # Oversized current chain + a scheduled future row: the scan must
    # flag oversized_renewal (not ledger_mismatch — the old bug
    # masked oversized entirely in this shape), and Apply must
    # converge, moving the stored start when it tracked an
    # INTERMEDIATE shifted row's old start.
    owner = seed_gym["owner"]
    today = date.today()
    start0 = today - timedelta(days=67)
    end0 = start0 + timedelta(days=29)
    second_start = end0 + timedelta(days=1)
    second_end = second_start + timedelta(days=31)  # 32 days: 2 excess
    third_start = second_end + timedelta(days=1)
    third_end = third_start + timedelta(days=29)
    fourth_start = third_end + timedelta(days=1)
    fourth_end = fourth_start + timedelta(days=29)
    assert third_start <= today  # current period has started
    assert fourth_start > today  # scheduled row stays future
    # Stored start is the CURRENT period's start (row 3's old start).
    m = _member(seed_gym, "OversizedScheduled", third_start, third_end)
    _row(seed_gym, m, owner, start0, start0, start0, end0)
    _row(seed_gym, m, owner, start0, end0, second_start, second_end)
    _row(seed_gym, m, owner, second_start, second_end, third_start,
         third_end)
    _row(seed_gym, m, owner, third_start, third_end, fourth_start,
         fourth_end)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "oversized_renewal"
    proposed = third_end - timedelta(days=2)
    assert flagged[0]["proposed_end"] == proposed.isoformat()

    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_end == proposed
    rows = _rows(m.id)
    assert (rows[1].new_end - rows[1].new_start).days + 1 == 30
    assert rows[2].new_start == third_start - timedelta(days=2)
    assert rows[2].new_end == proposed
    # V4-M12: the stored start tracked row 3's old start, not the
    # latest (scheduled) row's — it must still move with the ledger.
    assert m.membership_start == rows[2].new_start
    # The scheduled row shifts with the chain but stays pending, and
    # its previous_end still matches the member's end so it can
    # activate later.
    assert rows[3].new_start == fourth_start - timedelta(days=2)
    assert rows[3].new_start > today
    assert rows[3].previous_end == proposed
    assert _scan(client, seed_gym) == []


# ─── V4-M13 ──────────────────────────────────────────────────────────────

def test_m13_plan_duration_edit_does_not_rewrite_history(client, seed_gym):
    # Rows written while the plan was 30 days carry a duration_days
    # snapshot of 30. Editing the plan to 28 days must not make the
    # historical renewals read as oversized.
    today = date.today()
    start0 = today - timedelta(days=45)
    end0 = start0 + timedelta(days=29)
    member = _create_member_via_api(client, seed_gym, start0, end0)
    _create_payment(client, seed_gym, member, end0 + timedelta(days=1))
    rows = _rows(member.id)
    assert len(rows) == 2
    assert all(r.duration_days == 30 for r in rows)
    assert _scan(client, seed_gym) == []
    seed_gym["plan"].duration_days = 28
    db.session.commit()
    # The old bug: applied 30 > 28 + 1 flagged oversized_renewal.
    assert _scan(client, seed_gym) == []


def test_m13_oversized_creation_row_flagged_and_repaired(client, seed_gym):
    # A signup that applied more than one period is a real error:
    # the creation row is now included in the oversized check, with
    # proposal start + duration - 1, and Apply corrects it.
    owner = seed_gym["owner"]
    today = date.today()
    start0 = today - timedelta(days=60)
    end0 = start0 + timedelta(days=60)  # 61 days on a 30-day plan
    m = _member(seed_gym, "OversizedSignup", start0, end0)
    _row(seed_gym, m, owner, start0, start0, start0, end0)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "oversized_renewal"
    proposed = start0 + timedelta(days=29)
    assert flagged[0]["proposed_end"] == proposed.isoformat()
    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_end == proposed
    rows = _rows(m.id)
    assert rows[0].new_end == proposed
    assert _scan(client, seed_gym) == []


# ─── V4-M18 ──────────────────────────────────────────────────────────────

def test_m18_web_delete_restores_paused(client, seed_gym):
    # The web delete path now records previous_status, so a frozen
    # member deleted from the web UI comes back paused — not active
    # with an unblock queued.
    today = date.today()
    m = _member(seed_gym, "WebPaused", today - timedelta(days=30),
                today + timedelta(days=10), status="paused",
                notes=f"[Paused on {today.isoformat()} for 30 days]")
    _login(client, "owner@testgym.com")
    res = client.post(f"/members/{m.id}/delete", follow_redirects=True)
    assert res.status_code == 200
    db.session.refresh(m)
    assert m.status == "deleted"
    assert m.deleted_at is not None
    data = _restore(client, seed_gym)
    assert data["restored"] == 1
    db.session.refresh(m)
    assert m.deleted_at is None
    assert m.status == "paused"


def test_m18_import_undo_restores_paused(client, seed_gym):
    # The import-undo path now records previous_status per member.
    today = date.today()
    m = _member(seed_gym, "ImportPaused", today - timedelta(days=30),
                today + timedelta(days=10), status="paused",
                external_ref="batch-v4m18")
    _login(client, "owner@testgym.com")
    res = client.post("/members/import/undo/batch-v4m18",
                      follow_redirects=True)
    assert res.status_code == 200
    db.session.refresh(m)
    assert m.status == "deleted"
    data = _restore(client, seed_gym)
    assert data["restored"] == 1
    db.session.refresh(m)
    assert m.deleted_at is None
    assert m.status == "paused"


def test_m18_admin_undo_restores_paused(client, seed_gym):
    # The admin undo path now records previous_status per member.
    today = date.today()
    admin = User(
        gym_id=seed_gym["gym"].id,
        email="admin@testgym.com",
        full_name="Super Admin",
        role="super_admin",
    )
    admin.set_password("SecurePass123!")
    db.session.add(admin)
    m = _member(seed_gym, "AdminPaused", today - timedelta(days=30),
                today + timedelta(days=10), status="paused",
                external_ref="batch-v4m18-admin")
    db.session.commit()
    _login(client, "admin@testgym.com")
    res = client.post(
        f"/admin/gyms/{seed_gym['gym'].id}/members/undo-batch/batch-v4m18-admin",
        follow_redirects=True,
    )
    assert res.status_code == 200
    db.session.refresh(m)
    assert m.status == "deleted"
    data = _restore(client, seed_gym)
    assert data["restored"] == 1
    db.session.refresh(m)
    assert m.deleted_at is None
    assert m.status == "paused"


def test_m18_paused_with_passed_end_restores_paused_not_expired(client, seed_gym):
    # A member frozen while their end passed must restore as paused,
    # not expired: restore checks paused BEFORE the expiry branch.
    today = date.today()
    m = _member(seed_gym, "PausedExpired", today - timedelta(days=30),
                today - timedelta(days=5), status="paused",
                notes=f"[Paused on {today.isoformat()} for 30 days]")
    res = client.post(
        f"/api/mobile/v1/members/{m.id}/deactivate",
        headers=_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert res.status_code == 200, res.get_json()
    db.session.refresh(m)
    assert m.status == "deleted"
    data = _restore(client, seed_gym)
    assert data["restored"] == 1
    db.session.refresh(m)
    assert m.deleted_at is None
    assert m.status == "paused"


# ─── V4-L14 ──────────────────────────────────────────────────────────────

def test_l14_stale_start_matching_old_chain_row_flags(client, seed_gym):
    # Stored start equals a PRE-RESTART (old-chain) row's new_start:
    # that is stale, not legitimate — S3 must flag it with the
    # current chain's start as the proposal.
    owner = seed_gym["owner"]
    today = date.today()
    start0 = today - timedelta(days=120)
    end0 = start0 + timedelta(days=29)
    start1 = end0 + timedelta(days=1)
    end1 = start1 + timedelta(days=29)
    start2 = today - timedelta(days=30)  # restart: gap after end1
    end2 = start2 + timedelta(days=29)
    assert start2 > end1 + timedelta(days=1)
    m = _member(seed_gym, "OldChainStart", start1, end2)
    _row(seed_gym, m, owner, start0, start0, start0, end0)
    _row(seed_gym, m, owner, start0, end0, start1, end1)
    _row(seed_gym, m, owner, start1, end1, start2, end2)
    db.session.commit()
    flagged = _scan(client, seed_gym)
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "start_ledger_mismatch"
    assert flagged[0]["proposed_start"] == start2.isoformat()
    result = _apply(client, seed_gym, m.id)
    assert result["applied"] is True
    db.session.refresh(m)
    assert m.membership_start == start2
    assert _scan(client, seed_gym) == []
