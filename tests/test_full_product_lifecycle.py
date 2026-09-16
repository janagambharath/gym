from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, MembershipPlan, PaymentVerification, RenewalHistory, User
from app.services.payment_service import verify_payment


def test_complete_owner_and_member_lifecycle(client):
    """End-to-end simulation of the complete core product loop:
    1. Owner creates gym and plan.
    2. Owner adds member with standard plan.
    3. Renewal due: Custom renewal rate created (₹2,000 standard, ₹200 discount -> ₹1,800 final payable).
    4. Member logs in via VYNLA and views accurate negotiated price.
    5. Member claims payment.
    6. Payment verified -> membership extends by 30 days.
    7. Actual collected revenue updates to ₹1,800, NOT ₹2,000.
    """
    # 1. Setup Gym & Owner
    gym = Gym(
        name="Apex Fitness Club",
        slug="apex-fitness-club",
        country="India",
        currency="INR",
        phone="+919876543210",
        subscription_status="trial",
    )
    db.session.add(gym)
    db.session.commit()

    owner = User(
        gym_id=gym.id,
        email="owner@apexfitness.com",
        full_name="Rajesh Sharma",
        role="gym_owner",
    )
    owner.set_password("SecurePass123!")
    db.session.add(owner)

    # 2. Create standard membership plan (₹2,000 / 30 days)
    plan = MembershipPlan(
        gym_id=gym.id,
        name="Monthly Pro",
        duration_days=30,
        price=Decimal("2000.00"),
        is_active=True,
    )
    db.session.add(plan)
    db.session.commit()

    owner_token = create_access_token(user_id=owner.id, gym_id=gym.id, role="owner")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # 3. Add member joining today
    join_date = date.today() - timedelta(days=28)
    initial_end = join_date + timedelta(days=29)  # expires tomorrow
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Vikram Kumar",
        phone="+919123456780",
        membership_start=join_date,
        membership_end=initial_end,
        status="active",
    )
    db.session.add(member)
    db.session.commit()

    # 4. Gym owner sets up negotiated renewal pricing for the member:
    # Standard: ₹2,000, Member-specific discount: ₹200, Final payable: ₹1,800
    demand_resp = client.post(
        "/api/mobile/v1/payments",
        headers=owner_headers,
        json={
            "member_id": member.id,
            "plan_id": plan.id,
            "standard_price": "2000.00",
            "discount": "200.00",
            "final_payable": "1800.00",
            "amount": 1800.00,
            "channel": "online",
            "method": "upi",
            "renewal_days": 30,
            "notes": "Negotiated student discount",
        },
    )
    assert demand_resp.status_code == 201
    payment_id = demand_resp.get_json()["data"]["id"]

    # 5. Member logs into VYNLA and sees authoritative discounted demand
    member_token = create_access_token(user_id=member.id, gym_id=gym.id, role="member")
    member_headers = {"Authorization": f"Bearer {member_token}"}

    dash_resp = client.get("/api/member/v1/dashboard", headers=member_headers)
    assert dash_resp.status_code == 200
    dash_data = dash_resp.get_json()["data"]
    assert dash_data["member"]["full_name"] == "Vikram Kumar"
    assert dash_data["member"]["status"] == "active"
    assert dash_data["member"]["plan_name"] == "Monthly Pro"

    # Verify authoritative locked demand presented to member
    active_demand = dash_data["active_renewal_demand"]
    assert active_demand is not None
    assert active_demand["id"] == payment_id
    assert active_demand["standard_price"] == "2000.00"
    assert active_demand["discount"] == "200.00"
    assert active_demand["final_payable"] == "1800.00"
    assert active_demand["savings"] == "200.00"

    # 6. Verify duplicate demand prevention (P1-2 fix)
    duplicate_claim = client.post(
        "/api/member/v1/renew/claim",
        headers=member_headers,
        json={"plan_id": plan.id, "amount": "1800.00"},
    )
    assert duplicate_claim.status_code == 200
    assert duplicate_claim.get_json()["data"]["already_pending"] is True
    assert duplicate_claim.get_json()["data"]["payment_id"] == payment_id

    # 7. Gym owner verifies the payment
    payment = db.session.get(PaymentVerification, payment_id)
    assert payment.status == "pending"
    assert payment.amount == Decimal("1800.00")

    verify_payment(payment, verified_by_id=owner.id, renewal_days=30)
    db.session.commit()

    # 8. Member membership extended seamlessly
    db.session.refresh(member)
    assert member.status == "active"
    # End date should extend by 30 days from initial_end + 1
    assert member.membership_end == initial_end + timedelta(days=30)
    # Historical membership_start preserved!
    assert member.membership_start == join_date

    # 9. Verify financial ledger recorded actual collected revenue (₹1,800), NOT catalog price (₹2,000)
    renewal = RenewalHistory.query.filter_by(member_id=member.id, gym_id=gym.id).first()
    assert renewal is not None
    assert renewal.amount == Decimal("1800.00")
    assert renewal.new_end == member.membership_end

    # 10. Member views payment history in VYNLA
    history_resp = client.get("/api/member/v1/payments", headers=member_headers)
    assert history_resp.status_code == 200
    history_data = history_resp.get_json()["data"]["payments"]
    assert len(history_data) >= 1
    assert str(history_data[0]["amount"]) == "1800.00"


def test_whatsapp_status_returns_checklist_diagnostics(client, seed_gym):
    """Verify WhatsApp status returns the 5-point post-connection checklist."""
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    token = create_access_token(user_id=owner.id, gym_id=gym.id, role=owner.role)

    resp = client.get("/api/mobile/v1/whatsapp/status", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert "checklist" in data
    checklist = data["checklist"]
    assert "whatsapp_connected" in checklist
    assert "business_connected" in checklist
    assert "phone_connected" in checklist
    assert "messaging_ready" in checklist
    assert "reminders_ready" in checklist
