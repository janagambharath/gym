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

    otp = data.get("test_otp")
    assert otp is not None

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


def test_member_membership_and_plans_endpoints(client, seed_member):
    """Test /api/member/v1/membership and /api/member/v1/plans."""
    member = seed_member
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    headers = {"Authorization": f"Bearer {token}"}

    # Membership details
    res = client.get("/api/member/v1/membership", headers=headers)
    assert res.status_code == 200
    data = res.json
    assert data["success"] is True
    assert "membership" in data["data"]
    assert "renewal_history" in data["data"]
    assert data["data"]["membership"]["status"] == member.status

    # Gym plans
    res = client.get("/api/member/v1/plans", headers=headers)
    assert res.status_code == 200
    data = res.json
    assert data["success"] is True
    assert "plans" in data["data"]
    assert len(data["data"]["plans"]) > 0


def test_member_payment_claim_endpoint(client, seed_member):
    """Test self-service payment claim /api/member/v1/renew/claim."""
    member = seed_member
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    res = client.post(
        "/api/member/v1/renew/claim",
        headers=headers,
        json={"reference": "UPI12345678"},
    )
    assert res.status_code == 201
    data = res.json
    assert data["success"] is True
    assert "payment_id" in data["data"]
    assert data["data"]["status"] == "pending"


def test_member_access_and_profile_endpoints(client, seed_member):
    """Test /api/member/v1/access, /api/member/v1/profile, and /api/member/v1/payment-info."""
    member = seed_member
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    headers = {"Authorization": f"Bearer {token}"}

    # Access history
    res = client.get("/api/member/v1/access", headers=headers)
    assert res.status_code == 200
    assert res.json["success"] is True
    assert "summary" in res.json["data"]
    assert "events" in res.json["data"]

    # Profile
    res = client.get("/api/member/v1/profile", headers=headers)
    assert res.status_code == 200
    assert res.json["success"] is True
    assert res.json["data"]["member"]["id"] == member.id

    # Payment Info
    res = client.get("/api/member/v1/payment-info", headers=headers)
    assert res.status_code == 200
    assert res.json["success"] is True


def test_privacy_and_account_deletion_routes(client):
    """Verify Google Play required compliance routes."""
    res = client.get("/privacy")
    assert res.status_code == 200
    assert b"Privacy Policy" in res.data

    res = client.get("/privacy-policy")
    assert res.status_code == 200

    res = client.get("/delete-account")
    assert res.status_code == 200
    assert b"Account Deletion" in res.data


def test_staff_phone_rejected_on_member_otp_request(client, seed_gym):
    """Gym staff/owner accounts must be gracefully rejected from logging into VYNLA."""
    gym = seed_gym["gym"]
    staff_phone = gym.business_phone_number or gym.phone
    assert staff_phone is not None

    res = client.post("/api/member/v1/auth/request-otp", json={"phone": staff_phone})
    assert res.status_code == 403
    data = res.json
    assert data["success"] is False
    assert data.get("is_staff") is True
    assert "gym staff" in data["error"]


def test_unknown_phone_returns_friendly_message(client):
    """Unregistered phone numbers must return friendly guidance without leaking internals."""
    res = client.post("/api/member/v1/auth/request-otp", json={"phone": "9999900000"})
    assert res.status_code == 404
    data = res.json
    assert data["success"] is False
    assert "We couldn't find a member account for this number. Please contact your gym." in data["error"]


def test_gym_branding_endpoint_and_tenant_isolation(client, seed_member, seed_gym):
    """Member can fetch dynamic gym branding, and Gym A branding never leaks to Gym B."""
    member = seed_member
    gym = seed_gym["gym"]
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Fetch gym branding
    res = client.get("/api/member/v1/gym-branding", headers=headers)
    assert res.status_code == 200
    data = res.json
    assert data["success"] is True
    branding = data["data"]["branding"]
    assert branding["gym_name"] == gym.name
    assert branding["powered_by"] == "VYNLA"
    assert "primary_color" in branding
    assert "opening_hours" in branding

    # 2. Dashboard also includes dynamic branding
    res = client.get("/api/member/v1/dashboard", headers=headers)
    assert res.status_code == 200
    dash_branding = res.json["data"]["branding"]
    assert dash_branding["gym_name"] == gym.name

