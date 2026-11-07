"""Fix-all v8 — money + dates (worker A2, 2026-11-07).

Covers: V8-M4 (campaign import dates through the renewal flow),
V8-M6 (admin import-undo frees the terminal ID), V8-M7
(recovery_rate denominator double-count), V8-L6 (create_payment
V7-M4 floor), V8-L7 (unfreeze guard: gym-local boundary + manual
edit), V8-L8 (gym-local today in broadcast segmentation), V8-L9
(apply_due dead-row audit dedupe), V8-L13 (refunded line in
reports), V8-L14 (payment amount cap), V8-L15 (paid_on window).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.extensions import db
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
from app.models.campaign import CampaignRecipient
from app.models.rrr import RRRIdentityMapping
from app.services.campaign_service import create_campaign
from app.services.payment_service import apply_due_scheduled_renewals, refund_payment
from app.services.revenue_service import recovery_rate, revenue_at_risk
from app.services.timezone_service import today_for_gym


def _headers(user, gym):
    return {"Authorization": f"Bearer {create_access_token(user.id, gym.id, user.role)}"}


def _member(seed_gym, name, start, end, status="active", price=1000, plan=None, phone="+919999900001"):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=(plan.id if plan else seed_gym["plan"].id),
        full_name=name,
        phone=phone,
        membership_start=start,
        membership_end=end,
        status=status,
        price=price,
    )
    db.session.add(m)
    db.session.commit()
    return m


def _payment(seed_gym, member, amount=1000, status="verified", paid_on=None):
    p = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        amount=Decimal(str(amount)),
        paid_on=paid_on or date.today(),
        method="upi",
        status=status,
    )
    db.session.add(p)
    db.session.commit()
    return p


def _row(seed_gym, member, owner, previous_start, previous_end, new_start, new_end,
         payment=None, is_creation=False, amount=1000):
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
        duration_days=30,
        amount=Decimal(str(amount)),
        is_creation=is_creation,
    )
    db.session.add(r)
    db.session.commit()
    return r


# ─── V8-M7: recovery_rate denominator double-count ───────────────────────

def test_v8m7_full_recovery_gym_scores_100(seed_gym):
    today = today_for_gym(seed_gym["gym"].timezone)
    owner = seed_gym["owner"]
    # Renewed 25 days ago on a 30-day plan: previous_end 25d back (in
    # the paid cohort) and the new end 5d out (in the at-risk window).
    # The same ₹1000 used to land in the denominator twice (rate 50%).
    member = _member(seed_gym, "M7 Renewed", today - timedelta(days=55),
                     today + timedelta(days=5), price=1000)
    paid = _payment(seed_gym, member, 1000)
    _row(seed_gym, member, owner, today - timedelta(days=55),
         today - timedelta(days=25), today - timedelta(days=24),
         today + timedelta(days=5), payment=paid)
    assert revenue_at_risk(seed_gym["gym"].id, "Asia/Kolkata")["total"] == "1000.00"
    result = recovery_rate(seed_gym["gym"].id, "Asia/Kolkata")
    assert result["revenue_recovered"] == "1000.00"
    assert result["recovery_denominator"] == "1000.00"
    assert result["recovery_rate"] == "100.0"
    assert result["risk_breakdown"]["double_counted_risk_removed"] == "1000.00"


def test_v8m7_renewal_outside_risk_window_subtracts_nothing(seed_gym):
    today = today_for_gym(seed_gym["gym"].timezone)
    owner = seed_gym["owner"]
    # Renewed 5 days ago, new end 25d out: in the paid cohort but NOT
    # at risk — no overlap to remove, denominator is just the paid leg.
    member = _member(seed_gym, "M7 Fresh", today - timedelta(days=35),
                     today + timedelta(days=25), price=1000)
    paid = _payment(seed_gym, member, 1000)
    _row(seed_gym, member, owner, today - timedelta(days=35),
         today - timedelta(days=5), today - timedelta(days=4),
         today + timedelta(days=25), payment=paid)
    result = recovery_rate(seed_gym["gym"].id, "Asia/Kolkata")
    assert result["recovery_denominator"] == "1000.00"
    assert result["recovery_rate"] == "100.0"
    assert result["risk_breakdown"]["double_counted_risk_removed"] == "0.00"


# ─── V8-M4: campaign imported-contact ingest ────────────────────────────

def test_v8m4_future_expiry_contact_creates_nothing(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    create_campaign(
        gym_id=gym.id, name="M4 Future", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "Future Person", "phone": "9876500001",
             "expiry_date": (today + timedelta(days=10)).isoformat()},
            {"name": "Past Person", "phone": "9876500002",
             "expiry_date": (today - timedelta(days=20)).isoformat()},
        ],
    )
    db.session.commit()
    assert Member.query.filter_by(gym_id=gym.id, phone="+919876500001").first() is None
    assert Member.query.filter_by(gym_id=gym.id, phone="+919876500002").first() is not None
    assert CampaignRecipient.query.filter_by(gym_id=gym.id).count() == 1


def test_v8m4_new_member_gets_marker_dates_and_creation_row(seed_gym, client):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    exp = today - timedelta(days=20)
    create_campaign(
        gym_id=gym.id, name="M4 New", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "Imported One", "phone": "9876500010",
             "expiry_date": exp.isoformat(), "renewal_amount": "1500"},
        ],
    )
    db.session.commit()
    member = Member.query.filter_by(gym_id=gym.id, phone="+919876500010").one()
    # Only the known fact is recorded: a single-day marker at the
    # expiry date — no invented 30-day span, no plan.
    assert member.membership_start == exp
    assert member.membership_end == exp
    assert member.plan_id is None
    assert member.status == "expired"
    row = RenewalHistory.query.filter_by(member_id=member.id).one()
    assert row.is_creation is True
    assert row.previous_end == row.new_start == exp
    assert row.new_end == exp
    assert row.amount == Decimal("1500")
    # And Date Repair can now see the plan-less member (review-only).
    res = client.get("/api/mobile/v1/date-repair/scan", headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    findings = {f["member_id"]: f for f in res.get_json()["data"]["flagged"]}
    assert findings[member.id]["classification"] == "no_plan"


def test_v8m4_existing_member_rewrite_rechains_and_audits(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "M4 Existing", today - timedelta(days=40),
                     today - timedelta(days=10), status="expired",
                     phone="+919876500020")
    # Live scheduled renewal chained to the old end.
    row = _row(seed_gym, member, owner, today - timedelta(days=40),
               today - timedelta(days=10), today + timedelta(days=1),
               today + timedelta(days=30), amount=1000)
    create_campaign(
        gym_id=gym.id, name="M4 Rewrite", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "M4 Existing", "phone": "+919876500020",
             "expiry_date": (today - timedelta(days=5)).isoformat()},
        ],
    )
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=5)
    assert member.status == "expired"
    db.session.refresh(row)
    assert row.previous_end == today - timedelta(days=5)
    entry = AuditLog.query.filter_by(
        action="campaign_import_member_dates_updated", resource_id=str(member.id)
    ).first()
    assert entry is not None
    assert entry.metadata_json["old_end"] == (today - timedelta(days=10)).isoformat()


def test_v8m4_live_active_member_is_not_shortened_by_import(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "M4 Live", today - timedelta(days=10),
                     today + timedelta(days=30), status="active",
                     phone="+919876500030")
    create_campaign(
        gym_id=gym.id, name="M4 Live", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "M4 Live", "phone": "+919876500030",
             "expiry_date": (today - timedelta(days=5)).isoformat()},
        ],
    )
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=30)
    assert member.status == "active"
    assert AuditLog.query.filter_by(
        action="campaign_import_member_date_skipped", resource_id=str(member.id)
    ).first() is not None


# ─── V8-M6: admin import-undo frees the terminal ID ─────────────────────

@pytest.fixture
def super_admin_user(app):
    admin = User(
        email="superadmin@renewaldesk.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    return admin


def test_v8m6_admin_undo_import_batch_frees_terminal_id(client, seed_gym, super_admin_user):
    gym = seed_gym["gym"]
    batch_id = "IMPORT-V8M6-0001"
    member = Member(
        gym_id=gym.id, full_name="Imported Member", phone="+919888800001",
        external_ref=batch_id, membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30), status="active",
    )
    db.session.add(member)
    db.session.commit()
    mapping = RRRIdentityMapping(
        gym_id=gym.id, member_id=member.id, external_id="777",
        source="ebioserver", status="confirmed",
    )
    db.session.add(mapping)
    db.session.commit()
    client.post("/auth/login",
                data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
                follow_redirects=True)
    res = client.post(f"/admin/gyms/{gym.id}/members/undo-batch/{batch_id}",
                      follow_redirects=True)
    assert res.status_code == 200
    db.session.refresh(member)
    assert member.status == "deleted"
    assert member.deleted_at is not None
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym.id, member_id=member.id).first() is None


# ─── V8-L6 / L14 / L15: create_payment guards ───────────────────────────

def _pay_payload(seed_member, **overrides):
    payload = {
        "member_id": seed_member.id,
        "amount": "1000",
        "method": "cash",
        "channel": "offline",
        "renewal_days": 30,
    }
    payload.update(overrides)
    return payload


def test_v8l6_create_payment_rejects_overlapping_start(client, seed_gym, seed_member):
    today = today_for_gym(seed_gym["gym"].timezone)
    headers = _headers(seed_gym["owner"], seed_gym["gym"])
    # seed_member ends today+30; a start of today overlaps the paid period.
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, renewal_start_date=today.isoformat()))
    assert res.status_code == 400, res.data
    # Start at previous_end + 1 is the floor and is accepted (pending).
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, renewal_start_date=(today + timedelta(days=31)).isoformat()))
    assert res.status_code == 201, res.data


def test_v8l14_create_payment_rejects_amount_above_cap(client, seed_gym, seed_member):
    res = client.post("/api/mobile/v1/payments",
                      headers=_headers(seed_gym["owner"], seed_gym["gym"]),
                      json=_pay_payload(seed_member, amount="100000000.00"))
    assert res.status_code == 400, res.data


def test_v8l15_create_payment_rejects_future_and_ancient_paid_on(client, seed_gym, seed_member):
    today = today_for_gym(seed_gym["gym"].timezone)
    headers = _headers(seed_gym["owner"], seed_gym["gym"])
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, paid_on=(today + timedelta(days=1)).isoformat()))
    assert res.status_code == 400, res.data
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, paid_on=(today - timedelta(days=6 * 365)).isoformat()))
    assert res.status_code == 400, res.data
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, paid_on=today.isoformat()))
    assert res.status_code == 201, res.data


# ─── V8-L7: unfreeze guard gaps ─────────────────────────────────────────

def test_v8l7_renewal_early_ist_on_pause_date_blocks_clawback(client, seed_gym):
    # Pause date P (gym-local). A renewal at 03:00 IST on P is
    # 21:30 UTC on P-1 — before the old UTC-midnight boundary, after
    # the gym-local midnight boundary. It must block the clawback.
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "L7 Boundary", today, today + timedelta(days=60))
    res = client.post(f"/api/mobile/v1/members/{member.id}/freeze",
                      json={"days": 30}, headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=90)
    renewal_at = datetime.combine(today, time(3, 0), tzinfo=ZoneInfo("Asia/Kolkata"))
    row = RenewalHistory(
        gym_id=gym.id, member_id=member.id, plan_id=seed_gym["plan"].id,
        renewed_by_id=owner.id, previous_start=today - timedelta(days=60),
        previous_end=today - timedelta(days=31), new_start=today - timedelta(days=30),
        new_end=today - timedelta(days=1), duration_days=30,
        amount=Decimal("1000"), is_test=False,
        created_at=renewal_at.astimezone(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    res = client.post(f"/api/mobile/v1/members/{member.id}/unfreeze",
                      headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=90)


def test_v8l7_manual_edit_extending_end_blocks_clawback(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "L7 Edit", today, today + timedelta(days=29))
    res = client.post(f"/api/mobile/v1/members/{member.id}/freeze",
                      json={"days": 10}, headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today + timedelta(days=39)
    # Hand edit after the pause re-dates the period so the end lands
    # past the frozen end (the grid only allows one plan-period from
    # the start, so the start moves with it).
    res = client.patch(f"/api/mobile/v1/members/{member.id}",
                       json={"membership_start": (today + timedelta(days=10)).isoformat(),
                             "membership_end": (today + timedelta(days=40)).isoformat()},
                       headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    res = client.post(f"/api/mobile/v1/members/{member.id}/unfreeze",
                      headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    # No clawback: the end the owner hand-set after the pause stands.
    assert member.membership_end == today + timedelta(days=40)


# ─── V8-L8: gym-local today in broadcast segmentation ───────────────────

def test_v8l8_broadcast_uses_gym_local_today(seed_gym, monkeypatch):
    from app.services import broadcast_service

    gym = seed_gym["gym"]
    today = date.today()
    member = _member(seed_gym, "L8 Expiring", today - timedelta(days=30), today,
                     status="active")
    # Simulate a gym whose local today is tomorrow: the member whose
    # period ends today (server-local) is already expired gym-locally.
    monkeypatch.setattr(
        broadcast_service, "today_for_gym", lambda tz=None: today + timedelta(days=1)
    )
    assert member not in broadcast_service.get_target_members(gym.id, "active")
    assert member in broadcast_service.get_target_members(gym.id, "expired")


# ─── V8-L9: apply_due dead-row audit dedupe ─────────────────────────────

def test_v8l9_apply_due_audits_dead_row_once(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "L9 Dead", today - timedelta(days=40),
                     today - timedelta(days=10), status="expired")
    paid = _payment(seed_gym, member, 1000)
    row = _row(seed_gym, member, owner, today - timedelta(days=40),
               today - timedelta(days=10), today - timedelta(days=5),
               today - timedelta(days=1), payment=paid)
    assert apply_due_scheduled_renewals(gym) == 0
    db.session.commit()
    assert apply_due_scheduled_renewals(gym) == 0
    db.session.commit()
    assert AuditLog.query.filter_by(
        action="scheduled_renewal_expired_unactivated",
        resource_id=str(row.id),
    ).count() == 1


# ─── V8-L13: refunded line in reports ───────────────────────────────────

def test_v8l13_reports_show_refunded_line(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    payment = _payment(seed_gym, seed_member, 500)
    payment.verified_at = datetime.now(timezone.utc)
    db.session.commit()
    refund_payment(payment, refunded_by_id=owner.id)
    db.session.commit()
    res = client.get("/api/mobile/v1/reports/summary?period=30d",
                     headers=_headers(owner, gym))
    assert res.status_code == 200, res.data
    revenue = res.get_json()["data"]["revenue"]
    assert revenue["refunded"] == "500.00"
    assert revenue["refunded_count"] == 1
    assert revenue["collected"] == "0.00"
