from __future__ import annotations

from datetime import date, timedelta, datetime, timezone
import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import AuditLog, Campaign, Member, PaymentVerification, RenewalHistory


def _auth_headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def test_renewal_null_membership_end_does_not_crash(client, seed_gym):
    """P0-1: Member with NULL membership_end can be renewed via direct mobile renewal without crash."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Null Expiry Member",
        phone="+919876543210",
        status="expired",
        membership_start=date.today(),
        membership_end=None,
    )
    db.session.add(member)
    db.session.commit()

    headers = _auth_headers(seed_gym)
    resp = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=headers,
        json={"renewal_days": 30, "amount": "1500.00", "notes": "First renewal"},
    )
    assert resp.status_code == 201
    data = resp.get_json()["data"]
    assert data["previous_end"] is None
    assert data["new_start"] == date.today().isoformat()

    db.session.refresh(member)
    assert member.status == "active"
    assert member.membership_start == date.today()
    assert member.membership_end == date.today() + timedelta(days=29)


def test_active_member_renewal_preserves_membership_start(client, seed_gym):
    """P1-1: Active member renewal does not overwrite original membership_start."""
    gym = seed_gym["gym"]
    original_start = date.today() - timedelta(days=60)
    current_end = date.today() + timedelta(days=10)

    member = Member(
        gym_id=gym.id,
        full_name="Active Longtime Member",
        phone="+919876543211",
        status="active",
        membership_start=original_start,
        membership_end=current_end,
    )
    db.session.add(member)
    db.session.commit()

    headers = _auth_headers(seed_gym)
    resp = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=headers,
        json={"renewal_days": 30, "amount": "1200.00"},
    )
    assert resp.status_code == 201

    db.session.refresh(member)
    assert member.membership_start == original_start  # preserved!
    assert member.membership_end == current_end + timedelta(days=30)


def test_reviewer_bypass_disabled_by_default(client, seed_gym, monkeypatch):
    """P0-2: Reviewer OTP bypass 123456 is rejected when bypass is disabled."""
    monkeypatch.delenv("ENABLE_REVIEWER_BYPASS", raising=False)
    client.application.config["ENABLE_REVIEWER_BYPASS"] = False

    resp = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": "+919999999999", "otp": "123456"},
    )
    assert resp.status_code in (400, 404)
    assert resp.get_json()["success"] is False


def test_reviewer_bypass_enabled_with_flag(client, seed_gym, monkeypatch):
    """P0-2 & P0-3: Reviewer bypass works when ENABLE_REVIEWER_BYPASS is true."""
    client.application.config["ENABLE_REVIEWER_BYPASS"] = True

    # Request OTP triggers reviewer member auto-creation
    req_resp = client.post(
        "/api/member/v1/auth/request-otp",
        json={"phone": "+919999999999"},
    )
    assert req_resp.status_code == 200

    # Verify OTP logs in successfully
    verify_resp = client.post(
        "/api/member/v1/auth/verify-otp",
        json={"phone": "+919999999999", "otp": "123456"},
    )
    assert verify_resp.status_code == 200
    assert verify_resp.get_json()["success"] is True
    assert "token" in verify_resp.get_json()["data"]


def test_legacy_request_renewal_detects_processing_status(client, seed_gym):
    """P1-2: Legacy request_renewal endpoint detects payments in processing status."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Claim Member",
        phone="+919876543212",
        status="active",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=5),
    )
    db.session.add(member)
    db.session.commit()

    # Create a processing payment
    payment = PaymentVerification(
        gym_id=gym.id,
        member_id=member.id,
        amount=1000,
        status="processing",
        method="member_request",
    )
    db.session.add(payment)
    db.session.commit()

    # Member token
    member_token = create_access_token(user_id=member.id, gym_id=gym.id, role="member")
    resp = client.post(
        "/api/member/v1/renew/request",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "already have a pending renewal request" in data["message"]


def test_branding_has_no_hardcoded_opening_hours_and_filters_draft_campaigns(client, seed_gym):
    """P1-3 & P2-4: Branding endpoint returns opening_hours=None and excludes draft campaigns."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Branding Member",
        phone="+919876543213",
        status="active",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
    )
    db.session.add(member)

    # Add a draft campaign and a sent campaign
    draft_c = Campaign(
        gym_id=gym.id,
        name="Secret Draft Promo",
        campaign_type="promo",
        segment_type="all_active",
        status="draft",
    )
    sent_c = Campaign(
        gym_id=gym.id,
        name="Live Public Promo",
        campaign_type="promo",
        segment_type="all_active",
        status="sent",
    )
    db.session.add_all([draft_c, sent_c])
    db.session.commit()

    member_token = create_access_token(user_id=member.id, gym_id=gym.id, role="member")
    resp = client.get(
        "/api/member/v1/gym-branding",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert resp.status_code == 200
    data = resp.get_json()["data"]["branding"]
    assert data["opening_hours"] is None

    offer_titles = [o["title"] for o in data["offers"]]
    assert "Live Public Promo" in offer_titles
    assert "Secret Draft Promo" not in offer_titles


def test_fail_upi_payment_adds_audit_log_and_notes(client, seed_gym):
    """P1-7: fail_upi_payment records an audit log and appends notes."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="UPI Member",
        phone="+919876543214",
        status="active",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=30),
    )
    db.session.add(member)
    db.session.commit()

    payment = PaymentVerification(
        gym_id=gym.id,
        member_id=member.id,
        amount=1500,
        status="processing",
        method="upi",
        notes="Initial note",
    )
    db.session.add(payment)
    db.session.commit()

    member_token = create_access_token(user_id=member.id, gym_id=gym.id, role="member")
    resp = client.post(
        "/api/member/v1/renew/fail-upi",
        headers={"Authorization": f"Bearer {member_token}"},
        json={"payment_id": payment.id, "reason": "user_cancelled"},
    )
    assert resp.status_code == 200

    db.session.refresh(payment)
    assert payment.status == "pending"
    assert "Initial note" in payment.notes
    assert "UPI payment cancelled or failed" in payment.notes

    # Check audit log
    audit_entry = AuditLog.query.filter_by(
        gym_id=gym.id,
        action="upi_payment_failed",
        resource_id=str(payment.id),
    ).first()
    assert audit_entry is not None
    assert audit_entry.metadata_json["reason"] == "user_cancelled"
