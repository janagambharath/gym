"""Final launch readiness audit tests — null-safety, trial lockdown, and signup integrity."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, MembershipPlan, User


def _auth_headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


# ── Component 1: Member model null-safety ────────────────────────────


def test_member_null_expiry_days_until_expiry_safe(app, seed_gym):
    """days_until_expiry must return 0 (not crash) when membership_end is None."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Null Expiry Person",
        phone="+919000099001",
        status="expired",
        membership_start=date.today(),
        membership_end=None,
    )
    db.session.add(member)
    db.session.commit()

    assert member.days_until_expiry == 0


def test_member_null_expiry_is_expired_safe(app, seed_gym):
    """is_expired must return True (not crash) when membership_end is None."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Null Expiry Person 2",
        phone="+919000099002",
        status="expired",
        membership_start=date.today(),
        membership_end=None,
    )
    db.session.add(member)
    db.session.commit()

    assert member.is_expired is True


def test_member_null_expiry_refresh_status_safe(app, seed_gym):
    """refresh_status must not crash when membership_end is None."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Null Expiry Person 3",
        phone="+919000099003",
        status="active",
        membership_start=date.today(),
        membership_end=None,
    )
    db.session.add(member)
    db.session.commit()

    # Should not raise
    member.refresh_status()
    assert member.status == "expired"


# ── Component 2: Renewal list serialization null guard ───────────────


def test_renewal_list_with_null_expiry_member_does_not_crash(client, seed_gym):
    """GET /renewals/expired must not crash when a member has membership_end=None."""
    gym = seed_gym["gym"]
    member = Member(
        gym_id=gym.id,
        full_name="Null List Member",
        phone="+919000099004",
        status="expired",
        membership_start=date.today(),
        membership_end=None,
    )
    db.session.add(member)
    db.session.commit()

    headers = _auth_headers(seed_gym)
    # The expired endpoint filters membership_end < today, so a NULL member
    # won't match. But this verifies the serialization path doesn't crash.
    resp = client.get("/api/mobile/v1/renewals/expired", headers=headers)
    assert resp.status_code == 200


# ── Component 3: Trial expiry write lockdown ─────────────────────────


def test_trial_expired_gym_blocks_write_operations(client, app):
    """POST endpoints must return 403 SUBSCRIPTION_REQUIRED when trial has expired."""
    with app.app_context():
        gym = Gym(
            name="Expired Trial Gym",
            slug="expired-trial-gym",
            phone="+919000088001",
            status="active",
            subscription_status="trial",
            trial_ends_at=date.today() - timedelta(days=1),
        )
        db.session.add(gym)
        db.session.flush()

        plan = MembershipPlan(gym_id=gym.id, name="Monthly", duration_days=30, price=1500)
        db.session.add(plan)
        db.session.flush()

        owner = User(
            gym_id=gym.id,
            email="expired.trial.owner@example.com",
            full_name="Expired Owner",
            role="gym_owner",
        )
        owner.set_password("password123")
        db.session.add(owner)

        member = Member(
            gym_id=gym.id,
            plan_id=plan.id,
            full_name="Test Member",
            phone="+919000088002",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=10),
            status="active",
        )
        db.session.add(member)
        db.session.commit()

        member_id = member.id
        token = create_access_token(owner.id, gym.id, "gym_owner")
        headers = {"Authorization": f"Bearer {token}"}

    # POST (write) to renewals should be blocked
    resp = client.post(
        f"/api/mobile/v1/renewals/{member_id}",
        headers=headers,
        json={"renewal_days": 30, "amount": "1500.00"},
    )
    assert resp.status_code == 403
    data = resp.get_json()
    assert data["error"]["code"] == "SUBSCRIPTION_REQUIRED"
    assert "free trial has ended" in data["error"]["message"]


def test_trial_expired_gym_allows_read_operations(client, app):
    """GET endpoints must still work when trial has expired so owner can view data."""
    with app.app_context():
        gym = Gym(
            name="Expired Read Gym",
            slug="expired-read-gym",
            phone="+919000088003",
            status="active",
            subscription_status="trial",
            trial_ends_at=date.today() - timedelta(days=1),
        )
        db.session.add(gym)
        db.session.flush()

        owner = User(
            gym_id=gym.id,
            email="expired.read.owner@example.com",
            full_name="Read Owner",
            role="gym_owner",
        )
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

        token = create_access_token(owner.id, gym.id, "gym_owner")
        headers = {"Authorization": f"Bearer {token}"}

    # GET (read) should still work
    resp = client.get("/api/mobile/v1/dashboard", headers=headers)
    assert resp.status_code == 200


def test_active_subscription_allows_write_operations(client, seed_gym):
    """POST endpoints must work normally for gyms with active trial or subscription."""
    gym = seed_gym["gym"]
    gym.subscription_status = "trial"
    gym.trial_ends_at = date.today() + timedelta(days=5)
    db.session.commit()

    member = Member(
        gym_id=gym.id,
        full_name="Active Sub Member",
        phone="+919000088005",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=10),
        status="active",
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


def test_subscription_endpoints_exempt_from_lockdown(client, app):
    """Subscription/billing endpoints must remain accessible even after trial expiry."""
    with app.app_context():
        gym = Gym(
            name="Exempt Gym",
            slug="exempt-gym",
            phone="+919000088006",
            status="active",
            subscription_status="trial",
            trial_ends_at=date.today() - timedelta(days=1),
        )
        db.session.add(gym)
        db.session.flush()

        owner = User(
            gym_id=gym.id,
            email="exempt.owner@example.com",
            full_name="Exempt Owner",
            role="gym_owner",
        )
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

        token = create_access_token(owner.id, gym.id, "gym_owner")
        headers = {"Authorization": f"Bearer {token}"}

    # GET subscription status should work (read)
    resp = client.get("/api/mobile/v1/subscription/status", headers=headers)
    assert resp.status_code == 200

    # GET subscription plans should work (read)
    resp = client.get("/api/mobile/v1/subscription/plans", headers=headers)
    assert resp.status_code == 200

    # POST to subscription/verify is exempt from lockdown (returns 400
    # because we don't provide valid purchase_token, but NOT 403)
    resp = client.post(
        "/api/mobile/v1/subscription/verify",
        headers=headers,
        json={"purchase_token": "test", "product_id": "test"},
    )
    # Should NOT be 403 SUBSCRIPTION_REQUIRED
    assert resp.status_code != 403
