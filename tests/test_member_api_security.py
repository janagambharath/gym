"""Tests for Member API authentication, token security, and tenant isolation."""
import json
from datetime import date, timedelta
import pytest
from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification
from app.mobile_api.token_service import create_access_token


def test_unauthenticated_member_endpoints_rejected(client, seed_member):
    """Endpoints must reject unauthenticated requests without Bearer tokens."""
    # Dashboard
    res = client.get("/api/member/v1/dashboard")
    assert res.status_code == 401
    assert res.json["success"] is False

    # Payments
    res = client.get("/api/member/v1/payments")
    assert res.status_code == 401
    assert res.json["success"] is False

    # Renewal request
    res = client.post("/api/member/v1/renew/request", json={})
    assert res.status_code == 401
    assert res.json["success"] is False


def test_invalid_token_rejected(client, seed_member):
    """Invalid or spoofed tokens must be rejected with 401."""
    headers = {"Authorization": "Bearer not-a-valid-token"}
    res = client.get("/api/member/v1/dashboard", headers=headers)
    assert res.status_code == 401
    assert res.json["success"] is False


def test_otp_challenge_and_verification_flow(client, seed_member):
    """Full OTP request -> verify -> access dashboard with JWT token."""
    member = seed_member
    phone = member.phone

    # 1. Request OTP
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": phone})
    assert res.status_code == 200
    data = res.json
    assert data["success"] is True
    assert "challenge" in data
    challenge = data["challenge"]

    # In our test environment, we inspect the in-memory fallback to read the OTP
    from app.mobile_api.member_api import _otp_store
    clean_phone = phone.strip().lstrip("+")
    otp = _otp_store[clean_phone]["otp"]

    # 2. Verify OTP with wrong code -> fails
    res = client.post("/api/member/v1/auth/verify-otp", json={
        "phone": phone,
        "otp": "000000",
        "challenge": challenge,
    })
    assert res.status_code == 400
    assert res.json["success"] is False

    # 3. Verify OTP with correct code -> returns JWT access token
    res = client.post("/api/member/v1/auth/verify-otp", json={
        "phone": phone,
        "otp": otp,
        "challenge": challenge,
    })
    assert res.status_code == 200
    data = res.json
    assert data["success"] is True
    token = data["data"]["token"]
    assert token is not None

    # 4. Access dashboard with valid token
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/api/member/v1/dashboard", headers=headers)
    assert res.status_code == 200
    dash_data = res.json["data"]
    assert dash_data["member"]["id"] == member.id
    assert dash_data["member"]["full_name"] == member.full_name


def test_member_renewal_request_with_token(client, seed_member):
    """Authenticated member can submit a renewal request creating a payment verification."""
    member = seed_member
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    res = client.post("/api/member/v1/renew/request", headers=headers, json={})
    assert res.status_code == 201
    assert res.json["success"] is True
    payment_id = res.json["data"]["payment_id"]

    # Verify payment verification created in DB with correct gym_id and member_id
    payment = db.session.get(PaymentVerification, payment_id)
    assert payment is not None
    assert payment.gym_id == member.gym_id
    assert payment.member_id == member.id
    assert payment.status == "pending"


def test_member_token_isolation_between_gyms(client, app, seed_member):
    """A member token from Gym A cannot view or manipulate Gym B data."""
    # Create Gym B with Member B
    with app.app_context():
        gym_b = Gym(
            name="Gym B",
            slug="gym-b",
            email="b@gym.com",
            phone="+919000000001",
            status="active",
            subscription_status="active",
            max_members=50,
        )
        db.session.add(gym_b)
        db.session.flush()

        plan_b = MembershipPlan(gym_id=gym_b.id, name="Plan B", duration_days=30, price=2000)
        db.session.add(plan_b)
        db.session.flush()

        member_b = Member(
            gym_id=gym_b.id,
            plan_id=plan_b.id,
            full_name="Alice B",
            phone="+919000000002",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=30),
            status="active",
        )
        db.session.add(member_b)
        db.session.commit()

        # Token for Member A (Gym A)
        token_a = create_access_token(user_id=seed_member.id, gym_id=seed_member.gym_id, role="member")

        # When Member A requests dashboard, it must ONLY return Member A data, not Gym B
        headers = {"Authorization": f"Bearer {token_a}"}
        res = client.get("/api/member/v1/dashboard", headers=headers)
        assert res.status_code == 200
        assert res.json["data"]["member"]["id"] == seed_member.id
        assert res.json["data"]["gym"]["name"] == seed_member.gym.name
        assert res.json["data"]["member"]["id"] != member_b.id
