"""Test creating members with customizable money via the mobile API."""
from decimal import Decimal
from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification, RenewalHistory


def _auth_headers(owner) -> dict[str, str]:
    token = create_access_token(owner.id, owner.gym_id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def test_create_member_with_custom_money(client, seed_gym):
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    plan = seed_gym["plan"]
    headers = _auth_headers(owner)

    # Standard plan price is e.g. 50.00
    # Create member with custom discounted money 35.00 via UPI
    resp = client.post(
        "/api/mobile/v1/members",
        headers=headers,
        json={
            "full_name": "Custom Money Member",
            "phone": "+919876543299",
            "plan_id": plan.id,
            "amount": "35.00",
            "paid": True,
            "payment_method": "upi",
            "payment_reference": "UPI-TXN-123456",
            "notes": "VIP inaugural deal",
        },
    )
    assert resp.status_code == 201
    data = resp.get_json()["data"]
    member_id = data["id"]

    member = Member.query.get(member_id)
    assert member is not None
    assert member.full_name == "Custom Money Member"

    # Verify payment verification record was created with custom amount and discount
    payment = PaymentVerification.query.filter_by(member_id=member_id).first()
    assert payment is not None
    assert payment.amount == Decimal("35.00")
    assert payment.standard_price == Decimal(str(plan.price))
    assert payment.discount == Decimal(str(plan.price)) - Decimal("35.00")
    assert payment.method == "upi"
    assert payment.reference == "UPI-TXN-123456"
    assert payment.status == "verified"

    # Verify RenewalHistory record was created
    renewal = RenewalHistory.query.filter_by(member_id=member_id).first()
    assert renewal is not None
    assert renewal.amount == Decimal("35.00")
    assert renewal.payment_verification_id == payment.id


def test_create_member_unpaid_does_not_create_payment(client, seed_gym):
    owner = seed_gym["owner"]
    plan = seed_gym["plan"]
    headers = _auth_headers(owner)

    # Create member with custom money but paid=False (pay later)
    resp = client.post(
        "/api/mobile/v1/members",
        headers=headers,
        json={
            "full_name": "Unpaid Member",
            "phone": "+919876543298",
            "plan_id": plan.id,
            "amount": "50.00",
            "paid": False,
        },
    )
    assert resp.status_code == 201
    member_id = resp.get_json()["data"]["id"]

    payment = PaymentVerification.query.filter_by(member_id=member_id).first()
    assert payment is None
