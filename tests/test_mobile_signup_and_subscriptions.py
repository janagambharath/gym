"""Automated tests for Mobile Self-Service Signup, 3-Tier Subscriptions, Meta Onboarding & Progress Checklist."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from flask import Flask

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, User
from app.models.bot import FeatureEntitlement
from app.services.subscription_service import PLAN_CATALOG, get_available_plans, get_gym_subscription


def test_plan_catalog_structure():
    """Verify central 3-tier catalog has Starter, Growth, and Pro across supported currencies."""
    inr_plans = get_available_plans("INR")
    assert len(inr_plans) == 3
    assert [p["id"] for p in inr_plans] == ["starter", "growth", "pro"]
    assert inr_plans[0]["price"] == "999"
    assert inr_plans[1]["price"] == "1499"
    assert inr_plans[1]["recommended"] is True
    assert inr_plans[2]["price"] == "2499"

    aed_plans = get_available_plans("AED")
    assert len(aed_plans) == 3
    assert aed_plans[0]["price"] == "99"
    assert aed_plans[1]["price"] == "199"
    assert aed_plans[2]["price"] == "299"


def test_self_service_signup_success(client, app):
    """Test successful owner and gym registration via POST /api/mobile/v1/auth/signup."""
    payload = {
        "full_name": "Rajesh Kumar",
        "email": "rajesh.fit@example.com",
        "phone": "+919876543210",
        "password": "SecurePassword123!",
        "gym_name": "FitPulse Arena",
        "country": "India",
        "currency": "INR",
    }
    resp = client.post("/api/mobile/v1/auth/signup", json=payload)
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["success"] is True
    assert "access_token" in data["data"]
    assert "refresh_token" in data["data"]
    assert data["data"]["user"]["email"] == "rajesh.fit@example.com"
    assert data["data"]["user"]["role"] == "gym_owner"
    assert data["data"]["gym"]["name"] == "FitPulse Arena"
    assert data["data"]["gym"]["currency"] == "INR"
    assert data["data"]["is_new_signup"] is True

    with app.app_context():
        gym = Gym.query.filter_by(name="FitPulse Arena").first()
        assert gym is not None
        assert gym.subscription_status == "trial"
        # Seeded membership plans
        plans = MembershipPlan.query.filter_by(gym_id=gym.id).all()
        assert len(plans) == 3


def test_self_service_signup_validation_and_conflicts(client, app):
    """Test signup validation: missing fields, short password, duplicate email/phone."""
    # Missing fields
    resp = client.post("/api/mobile/v1/auth/signup", json={"email": "bad@example.com"})
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "VALIDATION_ERROR"

    # Short password
    resp = client.post("/api/mobile/v1/auth/signup", json={
        "full_name": "Test User",
        "email": "valid@example.com",
        "phone": "9876543211",
        "password": "123",
        "gym_name": "Test Gym",
    })
    assert resp.status_code == 400

    # Duplicate email conflict
    with app.app_context():
        gym = Gym(name="Existing Gym", slug="existing-gym-test", phone="+919999999999")
        db.session.add(gym)
        db.session.flush()
        user = User(gym_id=gym.id, email="existing@example.com", full_name="Old Owner", role="gym_owner")
        user.set_password("password123")
        db.session.add(user)
        db.session.commit()

    resp = client.post("/api/mobile/v1/auth/signup", json={
        "full_name": "New Owner",
        "email": "existing@example.com",
        "phone": "+919888888888",
        "password": "ValidPassword123",
        "gym_name": "New Gym",
    })
    assert resp.status_code == 409
    assert resp.get_json()["error"]["code"] == "CONFLICT"


def test_subscription_status_and_plans(client, app):
    """Test GET /api/mobile/v1/subscription/status and GET /api/mobile/v1/subscription/plans."""
    with app.app_context():
        gym = Gym(name="Iron Gym UAE", slug="iron-gym-uae", country="UAE", currency="AED", phone="+971501234567", subscription_status="active")
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="uae.owner@example.com", full_name="Ahmed Al", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    # Login
    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "uae.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Get status
    status_resp = client.get("/api/mobile/v1/subscription/status", headers=headers)
    assert status_resp.status_code == 200
    s_data = status_resp.get_json()["data"]
    assert s_data["billing_source"] == "MANUAL"
    assert s_data["subscription_status"] == "ACTIVE"
    assert s_data["plan"]["currency"] == "AED"

    # Get plans
    plans_resp = client.get("/api/mobile/v1/subscription/plans", headers=headers)
    assert plans_resp.status_code == 200
    p_data = plans_resp.get_json()["data"]
    assert p_data["currency"] == "AED"
    assert len(p_data["plans"]) == 3
    assert p_data["plans"][0]["price"] == "99"


def test_google_play_purchase_verification(client, app):
    """Test POST /api/mobile/v1/subscription/verify upgrades plan and feature entitlements."""
    with app.app_context():
        gym = Gym(name="Play Gym", slug="play-gym", country="India", currency="INR", phone="+919123456789", subscription_status="trial")
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="play.owner@example.com", full_name="Play Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "play.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    verify_payload = {
        "purchase_token": "mock_google_play_token_xyz",
        "product_id": "online.revorax.renewaldesk.pro.inr",
        "order_id": "GPA.1234-5678-9012",
    }
    verify_resp = client.post("/api/mobile/v1/subscription/verify", json=verify_payload, headers=headers)
    assert verify_resp.status_code == 200
    v_data = verify_resp.get_json()["data"]
    assert v_data["success"] is True

    with app.app_context():
        updated_gym = Gym.query.filter_by(name="Play Gym").first()
        assert updated_gym.subscription_status == "active"
        entitlements = FeatureEntitlement.query.filter_by(gym_id=updated_gym.id, enabled=True).all()
        ent_names = [e.feature for e in entitlements]
        assert "ai_receptionist" in ent_names


def test_whatsapp_onboarding_and_connection(client, app):
    """Test WhatsApp connection status, onboarding config, connect-waba, and profile."""
    with app.app_context():
        gym = Gym(name="WhatsApp Gym", slug="wa-gym", country="India", currency="INR", phone="+919871112233", whatsapp_enabled=False)
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="wa.owner@example.com", full_name="WA Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "wa.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Check initial status
    status_resp = client.get("/api/mobile/v1/whatsapp/connection-status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.get_json()["data"]["status"] == "NOT_CONNECTED"

    # Get onboarding config
    config_resp = client.get("/api/mobile/v1/whatsapp/onboarding-config", headers=headers)
    assert config_resp.status_code == 200
    assert "meta_app_id" in config_resp.get_json()["data"]
    assert len(config_resp.get_json()["data"]["supported_methods"]) == 2

    # Connect WABA
    connect_resp = client.post("/api/mobile/v1/whatsapp/connect-waba", json={
        "waba_id": "waba_12345",
        "phone_number_id": "phone_id_9988",
        "business_phone_number": "+919871112233",
    }, headers=headers)
    assert connect_resp.status_code == 200
    assert connect_resp.get_json()["data"]["status"] == "CONNECTED"

    # Profile update
    profile_resp = client.patch("/api/mobile/v1/whatsapp/profile", json={
        "about": "Premier CrossFit Gym",
        "address": "123 Fitness Way, Bangalore",
    }, headers=headers)
    assert profile_resp.status_code == 200
    assert profile_resp.get_json()["data"]["about"] == "Premier CrossFit Gym"


def test_onboarding_progress_checklist(client, app):
    """Test GET /api/mobile/v1/onboarding/progress calculation."""
    with app.app_context():
        gym = Gym(name="Checklist Gym", slug="check-gym", country="India", currency="INR", phone="+919873334455", subscription_status="trial")
        db.session.add(gym)
        db.session.flush()
        owner = User(gym_id=gym.id, email="check.owner@example.com", full_name="Check Owner", role="gym_owner")
        owner.set_password("password123")
        db.session.add(owner)
        db.session.commit()

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": "check.owner@example.com", "password": "password123"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/mobile/v1/onboarding/progress", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["total_count"] == 8
    assert data["completed_count"] >= 2  # account_created + plan_active
