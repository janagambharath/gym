"""Automated tests for Renewal Desk monthly subscription pricing, base plans, trial lifecycle, and financial isolation."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification, RenewalHistory, User
from app.services.mobile_billing_service import catalog_for, entitlement_for, find_catalog_product


def test_monthly_subscription_catalog_pricing_and_base_plans(app):
    """Verify Starter (999/199/29.99), Growth (1999/399/59.99), Pro (3499/599/99.99) and base_plan_ids."""
    with app.app_context():
        # India (INR)
        inr_catalog = catalog_for("IN", "INR")
        assert len(inr_catalog) == 3
        assert [p["price"] for p in inr_catalog] == ["999.00", "1999.00", "3499.00"]
        assert [p["base_plan_id"] for p in inr_catalog] == ["monthly-starter", "monthly-growth", "monthly-pro"]
        assert [p["id"] for p in inr_catalog] == [
            "online.revorax.renewaldesk.sub.starter",
            "online.revorax.renewaldesk.sub.growth",
            "online.revorax.renewaldesk.sub.pro",
        ]

        # UAE (AED)
        aed_catalog = catalog_for("AE", "AED")
        assert len(aed_catalog) == 3
        assert [p["price"] for p in aed_catalog] == ["199.00", "399.00", "599.00"]
        assert [p["base_plan_id"] for p in aed_catalog] == ["monthly-starter", "monthly-growth", "monthly-pro"]

        # US (USD)
        usd_catalog = catalog_for("US", "USD")
        assert len(usd_catalog) == 3
        assert [p["price"] for p in usd_catalog] == ["29.99", "59.99", "99.99"]
        assert [p["base_plan_id"] for p in usd_catalog] == ["monthly-starter", "monthly-growth", "monthly-pro"]


def test_trial_lifecycle_states_and_notices(app):
    """Verify trial transitions: Active -> Ending Soon -> Expired."""
    with app.app_context():
        today = datetime.now(timezone.utc).date()

        # 1. Trial Active (7 days left)
        gym_active = Gym(name="Active Trial Gym", slug="trial-active-gym", subscription_status="trial", trial_ends_at=today + timedelta(days=7))
        ent_active = entitlement_for(gym_active)
        assert ent_active["subscription_status"] == "TRIAL"
        assert ent_active["trial_info"]["is_trial"] is True
        assert ent_active["trial_info"]["state"] == "ACTIVE"
        assert ent_active["trial_info"]["days_left"] == 7
        assert "7 days left" in ent_active["trial_info"]["notice"]

        # 2. Trial Ending Soon (2 days left)
        gym_soon = Gym(name="Ending Soon Gym", slug="trial-soon-gym", subscription_status="trial", trial_ends_at=today + timedelta(days=2))
        ent_soon = entitlement_for(gym_soon)
        assert ent_soon["trial_info"]["state"] == "ENDING_SOON"
        assert ent_soon["trial_info"]["days_left"] == 2
        assert "Your trial ends in 2 days." == ent_soon["trial_info"]["notice"]

        # 3. Trial Ending Today (0 days left)
        gym_today = Gym(name="Ending Today Gym", slug="trial-today-gym", subscription_status="trial", trial_ends_at=today)
        ent_today = entitlement_for(gym_today)
        assert ent_today["trial_info"]["state"] == "ENDING_SOON"
        assert ent_today["trial_info"]["days_left"] == 0
        assert "Your trial ends today." == ent_today["trial_info"]["notice"]

        # 4. Trial Expired (-1 days left)
        gym_expired = Gym(name="Expired Gym", slug="trial-expired-gym", subscription_status="trial", trial_ends_at=today - timedelta(days=1))
        ent_expired = entitlement_for(gym_expired)
        assert ent_expired["trial_info"]["state"] == "EXPIRED"
        assert ent_expired["trial_info"]["days_left"] == 0
        assert "Your free trial has ended." in ent_expired["trial_info"]["notice"]


def test_legacy_subscription_plans_endpoint_structure(client, app):
    """Verify GET /api/mobile/v1/subscription/plans formats features, base_plan_id, and positioning."""
    with app.app_context():
        gym = Gym(name="Feature Test Gym", slug="feature-test-gym", country="India", currency="INR", phone="+919871100001")
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="features.owner@example.com", full_name="Feature Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "features.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/mobile/v1/subscription/plans", headers=headers)
    assert resp.status_code == 200
    plans = resp.get_json()["data"]["plans"]
    assert len(plans) == 3

    # Growth plan must be recommended
    growth = next(p for p in plans if p["name"] == "Growth")
    assert growth["recommended"] is True
    assert growth["positioning"] == "Recover more renewals."
    assert growth["price"] == "1999.00"
    assert growth["base_plan_id"] == "monthly-growth"
    assert any("WhatsApp renewal reminders" in f for f in growth["features"])
    assert any("Revenue recovery analytics" in f for f in growth["features"])

    starter = next(p for p in plans if p["name"] == "Starter")
    assert starter["recommended"] is False
    assert starter["positioning"] == "Manage your members."
    assert starter["price"] == "999.00"
    assert starter["base_plan_id"] == "monthly-starter"

    pro = next(p for p in plans if p["name"] == "Pro")
    assert pro["recommended"] is False
    assert pro["positioning"] == "Run and optimize your revenue operation."
    assert pro["price"] == "3499.00"
    assert pro["base_plan_id"] == "monthly-pro"


def test_isolation_of_gym_member_revenue_from_subscription_billing(client, app):
    """Verify financial isolation: gym member collected payments NEVER affect subscription billing."""
    with app.app_context():
        gym = Gym(name="Isolation Gym", slug="iso-gym", country="India", currency="INR", phone="+919871100099", subscription_status="trial")
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="iso.owner@example.com", full_name="Iso Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)

        plan = MembershipPlan(gym_id=gym.id, name="Annual Master", duration_days=365, price=24000)
        db.session.add(plan)
        db.session.flush()
        plan_id = plan.id

        member = Member(
            gym_id=gym.id,
            plan_id=plan_id,
            full_name="High Networth Member",
            phone="+919871100088",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=365),
            status="active",
        )
        db.session.add(member)
        db.session.flush()

        # Member pays ₹22,000 (with ₹2,000 discount off ₹24,000 standard price)
        payment = PaymentVerification(
            gym_id=gym.id,
            member_id=member.id,
            plan_id=plan_id,
            standard_price=Decimal("24000.00"),
            discount=Decimal("2000.00"),
            amount=Decimal("22000.00"),
            method="upi",
            status="verified",
            verified_at=datetime.now(timezone.utc),
        )
        db.session.add(payment)
        db.session.commit()

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "iso.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Gym Dashboard reports member collected revenue as ₹22,000 (actual collected, not list price)
    dash_resp = client.get("/api/mobile/v1/dashboard", headers=headers)
    assert dash_resp.status_code == 200
    dash_data = dash_resp.get_json()["data"]
    assert Decimal(dash_data["total_collected"]) == Decimal("22000.00")

    # 2. Subscription entitlement remains completely distinct (TRIAL / Google Play Starter ₹999/mo)
    ent_resp = client.get("/api/mobile/v1/billing/entitlement", headers=headers)
    assert ent_resp.status_code == 200
    ent_data = ent_resp.get_json()["data"]
    assert ent_data["subscription_status"] == "TRIAL"
    assert ent_data["billing_source"] == "MANUAL"

    # 3. Base plan price remains unchanged at ₹24,000 even though individual member paid ₹22,000
    with app.app_context():
        retrieved_plan = db.session.get(MembershipPlan, plan_id)
        assert retrieved_plan.price == Decimal("24000.00")
