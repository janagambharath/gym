"""Fix-all v9 — money + dates (worker, 2026-11-07).

Covers: V9-M10 (campaign import skips paused members), V9-M11 (import
rewrite writes a zero-amount ledger marker so Date Repair Apply cannot
revert it), V9-M12 (web member form date/plan/pause fields are owner-only,
mirroring the mobile API 403), V9-L29 (create_payment 2-decimal check),
V9-L30 (rechain skips rows whose new current end is at/past the scheduled
start), V9-L31 (member-claim renewals carry paid_on, so the operations
monthly verified-revenue figure counts them), V9-L32 (gym-local today in
the add-member form defaults and admin trial_ends_at).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

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
from app.models.gym import DEFAULT_TRIAL_DAYS
from app.services.campaign_service import create_campaign
from app.services.payment_service import rechain_scheduled_renewals, verify_payment
from app.services.timezone_service import today_for_gym


def _headers(user, gym):
    return {"Authorization": f"Bearer {create_access_token(user.id, gym.id, user.role)}"}


def _member_token(member, gym_id):
    return {"Authorization": f"Bearer {create_access_token(user_id=member.id, gym_id=gym_id, role='member')}"}


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


def _row(seed_gym, member, owner, previous_start, previous_end, new_start, new_end,
         payment=None, is_creation=False, amount=1000, duration_days=30):
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
        amount=Decimal(str(amount)),
        is_creation=is_creation,
    )
    db.session.add(r)
    db.session.commit()
    return r


def _login(client, email, password):
    res = client.post("/auth/login",
                      data={"email": email, "password": password},
                      follow_redirects=True)
    assert res.status_code == 200, res.data
    return res


def _staff_user(seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="staff@testgym.com",
        full_name="Gym Staff",
        role="staff",
        is_active=True,
    )
    staff.set_password("StaffPass123!")
    db.session.add(staff)
    db.session.commit()
    return staff


def _edit_payload(member, plan, **overrides):
    payload = {
        "full_name": member.full_name,
        "phone": member.phone,
        "email": "",
        "gender": "",
        "plan_id": str(plan.id),
        "membership_start": member.membership_start.isoformat(),
        "membership_end": member.membership_end.isoformat(),
        "status": member.status,
        "notes": "",
    }
    payload.update(overrides)
    return payload


def _import_member_with_ledger(seed_gym):
    """Expired member whose ledger is clean before import: creation row
    + one 30-day renewal ending at the stored end (start is the
    renewal's start, as verify_payment writes it)."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "M11 Ledger", today - timedelta(days=39),
                     today - timedelta(days=10), status="expired",
                     phone="+919876500050")
    _row(seed_gym, member, owner, today - timedelta(days=70),
         today - timedelta(days=70), today - timedelta(days=70),
         today - timedelta(days=70), is_creation=True, duration_days=1)
    _row(seed_gym, member, owner, today - timedelta(days=70),
         today - timedelta(days=40), today - timedelta(days=39),
         today - timedelta(days=10), duration_days=30)
    return member, today


def _scan_findings(client, seed_gym):
    res = client.get("/api/mobile/v1/date-repair/scan",
                     headers=_headers(seed_gym["owner"], seed_gym["gym"]))
    assert res.status_code == 200, res.data
    return {f["member_id"]: f for f in res.get_json()["data"]["flagged"]}


# ─── V9-M10: campaign import skips paused members ───────────────────────

def test_v9m10_paused_member_import_leaves_freeze_intact(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "M10 Paused", today - timedelta(days=40),
                     today + timedelta(days=30), status="paused",
                     phone="+919876500040")
    create_campaign(
        gym_id=gym.id, name="M10 Paused", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "M10 Paused", "phone": "+919876500040",
             "expiry_date": (today - timedelta(days=5)).isoformat()},
        ],
    )
    db.session.commit()
    db.session.refresh(member)
    assert member.status == "paused"
    assert member.membership_end == today + timedelta(days=30)
    entry = AuditLog.query.filter_by(
        action="campaign_import_member_date_skipped", resource_id=str(member.id)
    ).first()
    assert entry is not None
    assert entry.metadata_json["reason"] == "member paused"


# ─── V9-M11: import rewrite leaves a ledger marker ──────────────────────

def test_v9m11_import_extend_then_date_repair_stays_clean(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    member, today = _import_member_with_ledger(seed_gym)
    assert member.id not in _scan_findings(client, seed_gym)
    create_campaign(
        gym_id=gym.id, name="M11 Extend", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "M11 Ledger", "phone": "+919876500050",
             "expiry_date": (today - timedelta(days=5)).isoformat()},
        ],
    )
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=5)
    marker = RenewalHistory.query.filter_by(
        member_id=member.id, amount=Decimal("0.00"),
        payment_verification_id=None).order_by(RenewalHistory.id.desc()).first()
    assert marker is not None
    assert marker.new_end == today - timedelta(days=5)
    assert marker.is_creation is False
    # The scan stays fully clean — no ledger_mismatch to revert.
    assert member.id not in _scan_findings(client, seed_gym)
    res = client.post("/api/mobile/v1/date-repair/apply",
                      headers=_headers(owner, gym),
                      json={"member_ids": [member.id]})
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=5)


def test_v9m11_import_shorten_apply_does_not_revert_end(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    member, today = _import_member_with_ledger(seed_gym)
    create_campaign(
        gym_id=gym.id, name="M11 Shorten", segment_type="custom_import",
        created_by_id=owner.id, campaign_type="recovery",
        imported_contacts=[
            {"name": "M11 Ledger", "phone": "+919876500050",
             "expiry_date": (today - timedelta(days=20)).isoformat()},
        ],
    )
    db.session.commit()
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=20)
    findings = _scan_findings(client, seed_gym)
    # The 1-day shortening marker may leave a review-only overlap
    # flag, but never a ledger_mismatch with a proposal to revert.
    assert findings.get(member.id, {}).get("classification") != "ledger_mismatch"
    res = client.post("/api/mobile/v1/date-repair/apply",
                      headers=_headers(owner, gym),
                      json={"member_ids": [member.id]})
    assert res.status_code == 200, res.data
    db.session.refresh(member)
    assert member.membership_end == today - timedelta(days=20)


# ─── V9-M12: web member form date/plan/pause is owner-only ──────────────

def test_v9m12_staff_edit_changing_dates_is_403(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    staff = _staff_user(seed_gym)
    _login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post(f"/members/{seed_member.id}/edit",
                      data=_edit_payload(seed_member, seed_gym["plan"],
                                         membership_end=(today + timedelta(days=29)).isoformat()))
    assert res.status_code == 403, res.data
    db.session.refresh(seed_member)
    assert seed_member.membership_end == today + timedelta(days=30)


def test_v9m12_staff_edit_changing_status_to_paused_is_403(client, seed_gym, seed_member):
    _staff_user(seed_gym)
    _login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post(f"/members/{seed_member.id}/edit",
                      data=_edit_payload(seed_member, seed_gym["plan"], status="paused"))
    assert res.status_code == 403, res.data
    db.session.refresh(seed_member)
    assert seed_member.status == "active"


def test_v9m12_owner_edit_changing_dates_works(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    _login(client, "owner@testgym.com", "SecurePass123!")
    res = client.post(f"/members/{seed_member.id}/edit",
                      data=_edit_payload(seed_member, seed_gym["plan"],
                                         membership_end=(today + timedelta(days=29)).isoformat()),
                      follow_redirects=True)
    assert res.status_code == 200, res.data
    db.session.refresh(seed_member)
    assert seed_member.membership_end == today + timedelta(days=29)


def test_v9m12_staff_edit_of_name_only_still_works(client, seed_gym, seed_member):
    _staff_user(seed_gym)
    _login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post(f"/members/{seed_member.id}/edit",
                      data=_edit_payload(seed_member, seed_gym["plan"],
                                         full_name="John Renamed"),
                      follow_redirects=True)
    assert res.status_code == 200, res.data
    db.session.refresh(seed_member)
    assert seed_member.full_name == "John Renamed"


def test_v9m12_staff_create_with_paused_status_is_downgraded(client, seed_gym):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    _staff_user(seed_gym)
    _login(client, "staff@testgym.com", "StaffPass123!")
    res = client.post("/members/new", data={
        "full_name": "Staff Created",
        "phone": "+919876500060",
        "email": "",
        "gender": "",
        "plan_id": str(seed_gym["plan"].id),
        "membership_start": today.isoformat(),
        "membership_end": today.isoformat(),
        "status": "paused",
        "notes": "",
    }, follow_redirects=True)
    assert res.status_code == 200, res.data
    member = Member.query.filter_by(gym_id=gym.id, phone="+919876500060").one()
    assert member.status != "paused"


# ─── V9-L29: create_payment 2-decimal check ─────────────────────────────

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


def test_v9l29_create_payment_rejects_three_decimal_amount(client, seed_gym, seed_member):
    res = client.post("/api/mobile/v1/payments",
                      headers=_headers(seed_gym["owner"], seed_gym["gym"]),
                      json=_pay_payload(seed_member, amount="100.999"))
    assert res.status_code == 400, res.data


def test_v9l29_create_payment_rejects_three_decimal_standard_and_discount(client, seed_gym, seed_member):
    headers = _headers(seed_gym["owner"], seed_gym["gym"])
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, amount="100", standard_price="100.999"))
    assert res.status_code == 400, res.data
    res = client.post("/api/mobile/v1/payments", headers=headers,
                      json=_pay_payload(seed_member, amount="100",
                                        standard_price="1000", discount="0.999"))
    assert res.status_code == 400, res.data


def test_v9l29_create_payment_accepts_two_decimal_amount(client, seed_gym, seed_member):
    res = client.post("/api/mobile/v1/payments",
                      headers=_headers(seed_gym["owner"], seed_gym["gym"]),
                      json=_pay_payload(seed_member, amount="100.99"))
    assert res.status_code == 201, res.data


# ─── V9-L30: rechain skips rows past their scheduled start ──────────────

def test_v9l30_rechain_skips_row_when_current_end_reaches_scheduled_end(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "L30 Skip", today - timedelta(days=40),
                     today - timedelta(days=10), status="expired",
                     phone="+919876500070")
    row = _row(seed_gym, member, owner, today - timedelta(days=40),
               today - timedelta(days=10), today + timedelta(days=5),
               today + timedelta(days=34), amount=1000)
    # Manual edit moves the current end onto the scheduled row's end:
    # re-pointing would let activation write the dates backwards
    # (start back to new_start, end no further than today).
    member.membership_end = today + timedelta(days=34)
    db.session.commit()
    rechain_scheduled_renewals(member, old_end=today - timedelta(days=10),
                               today=today, actor_id=owner.id)
    db.session.commit()
    db.session.refresh(row)
    assert row.previous_end == today - timedelta(days=10)
    assert AuditLog.query.filter_by(
        action="scheduled_renewal_rechain_skipped", resource_id=str(row.id)
    ).first() is not None


def test_v9l30_rechain_still_repoints_row_when_current_end_before_start(seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    member = _member(seed_gym, "L30 Keep", today - timedelta(days=40),
                     today - timedelta(days=10), status="expired",
                     phone="+919876500071")
    row = _row(seed_gym, member, owner, today - timedelta(days=40),
               today - timedelta(days=10), today + timedelta(days=5),
               today + timedelta(days=34), amount=1000)
    member.membership_end = today + timedelta(days=1)
    db.session.commit()
    rechain_scheduled_renewals(member, old_end=today - timedelta(days=10),
                               today=today, actor_id=owner.id)
    db.session.commit()
    db.session.refresh(row)
    assert row.previous_end == today + timedelta(days=1)


# ─── V9-L31: claim renewals carry paid_on ────────────────────────────────

def test_v9l31_claim_renewal_appears_in_monthly_verified_revenue(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    res = client.post("/api/member/v1/renew/claim",
                      headers=_member_token(seed_member, gym.id), json={})
    assert res.status_code == 201, res.data
    payment = PaymentVerification.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, status="pending").one()
    assert payment.paid_on == today
    res = client.post(f"/api/mobile/v1/payments/{payment.id}/verify",
                      headers=_headers(owner, gym), json={})
    assert res.status_code == 200, res.data
    db.session.refresh(payment)
    assert payment.status == "verified"
    assert payment.paid_on == today
    _login(client, "owner@testgym.com", "SecurePass123!")
    res = client.get("/operations/reports")
    assert res.status_code == 200, res.data
    assert b"1,000.00" in res.data


def test_v9l31_legacy_request_carries_paid_on(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone)
    res = client.post("/api/member/v1/renew/request",
                      headers=_member_token(seed_member, gym.id), json={})
    assert res.status_code == 201, res.data
    payment = PaymentVerification.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id, status="pending").one()
    assert payment.paid_on == today


def test_v9l31_verify_backfills_null_paid_on(seed_gym, seed_member):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    today = today_for_gym(gym.timezone)
    payment = PaymentVerification(
        gym_id=gym.id, member_id=seed_member.id, amount=Decimal("1000"),
        paid_on=None, method="member_claim", status="pending",
        renewal_days=30,
    )
    db.session.add(payment)
    db.session.commit()
    verify_payment(payment, verified_by_id=owner.id, renewal_days=30)
    db.session.commit()
    db.session.refresh(payment)
    assert payment.status == "verified"
    assert payment.paid_on == today


# ─── V9-L32: gym-local today in member-facing date writes ───────────────

def test_v9l32_add_member_form_defaults_use_gym_local_today(client, seed_gym, monkeypatch):
    from app.members import routes as member_routes

    monkeypatch.setattr(member_routes, "today_for_gym",
                        lambda tz=None: date(2031, 5, 17))
    _login(client, "owner@testgym.com", "SecurePass123!")
    res = client.get("/members/new")
    assert res.status_code == 200, res.data
    assert b"2031-05-17" in res.data


def test_v9l32_admin_create_gym_trial_uses_gym_local_today(client, seed_gym, monkeypatch):
    from app.admin import routes as admin_routes

    monkeypatch.setattr(admin_routes, "today_for_gym",
                        lambda tz=None: date(2031, 5, 17))

    # Create the super admin directly (same pattern as the v8 M6 test).
    admin = User(
        email="superadmin@renewaldesk.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    _login(client, "superadmin@renewaldesk.com", "AdminPass123!")
    res = client.post("/admin/gyms/create", data={
        "gym_name": "L32 Trial Gym",
        "owner_name": "Trial Owner",
        "email": "trialowner@testgym.com",
        "password": "TrialPass123!",
        "phone": "+919876500080",
        "address": "",
        "subscription_status": "trial",
        "max_members": "500",
    }, follow_redirects=True)
    assert res.status_code == 200, res.data
    gym = Gym.query.filter_by(email="trialowner@testgym.com").one()
    assert gym.trial_ends_at == date(2031, 5, 17) + timedelta(days=DEFAULT_TRIAL_DAYS)
