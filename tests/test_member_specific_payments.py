"""Comprehensive tests for member-specific pricing, automated UPI renewals, and revenue operations."""
from __future__ import annotations

from decimal import Decimal

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, MembershipPlan, PaymentVerification, QRSettings, RenewalHistory, User


def _staff_headers(seed_gym) -> dict[str, str]:
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    token = create_access_token(owner.id, gym.id, owner.role)
    return {"Authorization": f"Bearer {token}"}


def _member_headers(seed_member) -> dict[str, str]:
    token = create_access_token(seed_member.id, seed_member.gym_id, role="member")
    return {"Authorization": f"Bearer {token}"}


def test_custom_price_derives_discount_and_preserves_plan_catalog(client, seed_gym, seed_member):
    """PLAN PRICE != ACTUAL PAYMENT AMOUNT:
    When staff collects ₹1,800 for a ₹2,000 plan, discount is ₹200 and catalog plan price remains ₹2,000.
    """
    gym = seed_gym["gym"]
    headers = _staff_headers(seed_gym)

    # Create a ₹2,000 monthly plan
    plan = MembershipPlan(
        gym_id=gym.id,
        name="Monthly Pro",
        duration_days=30,
        price=Decimal("2000.00"),
        is_active=True,
    )
    db.session.add(plan)
    db.session.commit()

    seed_member.plan_id = plan.id
    db.session.commit()

    # Staff creates a renewal demand with final_payable = 1800.00
    res = client.post(
        "/api/mobile/v1/payments",
        headers=headers,
        json={
            "member_id": seed_member.id,
            "plan_id": plan.id,
            "final_payable": "1800.00",
            "channel": "online",
            "notes": "Negotiated retention offer",
        },
    )

    assert res.status_code == 201
    data = res.get_json()["data"]
    assert data["standard_price"] == "2000.00"
    assert data["discount"] == "200.00"
    assert data["final_payable"] == "1800.00"
    assert data["amount"] == "1800.00"
    assert data["channel"] == "online"
    assert data["status"] == "pending"

    # CRITICAL: Master catalog plan price must remain ₹2,000
    refreshed_plan = db.session.get(MembershipPlan, plan.id)
    assert refreshed_plan.price == Decimal("2000.00")


def test_auto_verify_counter_cash_renews_immediately(client, seed_gym, seed_member):
    """Staff records counter cash of ₹1,700 for a ₹2,000 plan with auto_verify=True."""
    headers = _staff_headers(seed_gym)
    plan = seed_gym["plan"]
    plan.price = Decimal("2000.00")
    db.session.commit()

    seed_member.plan_id = plan.id
    old_end = seed_member.membership_end
    db.session.commit()

    res = client.post(
        "/api/mobile/v1/payments",
        headers=headers,
        json={
            "member_id": seed_member.id,
            "plan_id": plan.id,
            "final_payable": "1700.00",
            "method": "cash",
            "channel": "offline",
            "auto_verify": True,
            "notes": "Counter cash payment received",
        },
    )

    assert res.status_code == 201
    payment_id = res.get_json()["data"]["id"]

    payment = db.session.get(PaymentVerification, payment_id)
    assert payment.status == "verified"
    assert payment.amount == Decimal("1700.00")
    assert payment.standard_price == Decimal("2000.00")
    assert payment.discount == Decimal("300.00")
    assert payment.channel == "offline"

    # Membership must be extended
    refreshed_member = db.session.get(Member, seed_member.id)
    assert refreshed_member.membership_end > old_end

    # RenewalHistory record has the custom pricing snapshot
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).first()
    assert renewal is not None
    assert renewal.amount == Decimal("1700.00")
    assert renewal.standard_price == Decimal("2000.00")
    assert renewal.discount == Decimal("300.00")


def test_vynla_receives_authoritative_discounted_demand_and_confirms_upi(client, seed_gym, seed_member):
    """End-to-end flow:
    1. Owner issues ₹1,800 demand in Renewal Desk.
    2. Member sees fixed ₹1,800 in VYNLA dashboard with ₹200 savings.
    3. Member initiates UPI renewal.
    4. Member confirms UPI payment -> membership automatically renews.
    5. Payments summary shows actual collected revenue ₹1,800.
    """
    staff_headers = _staff_headers(seed_gym)
    member_headers = _member_headers(seed_member)

    plan = seed_gym["plan"]
    plan.price = Decimal("2000.00")
    db.session.commit()

    qr = QRSettings(gym_id=seed_gym["gym"].id, upi_id="gymowner@okhdfcbank", is_active=True)
    db.session.add(qr)
    db.session.commit()

    seed_member.plan_id = plan.id
    db.session.commit()

    # 1. Staff creates online demand
    create_res = client.post(
        "/api/mobile/v1/payments",
        headers=staff_headers,
        json={
            "member_id": seed_member.id,
            "plan_id": plan.id,
            "final_payable": "1800.00",
            "channel": "online",
        },
    )
    assert create_res.status_code == 201
    payment_id = create_res.get_json()["data"]["id"]

    # 2. Member views dashboard in VYNLA
    dash_res = client.get("/api/member/v1/dashboard", headers=member_headers)
    assert dash_res.status_code == 200
    demand = dash_res.get_json()["data"]["active_renewal_demand"]
    assert demand is not None
    assert demand["id"] == payment_id
    assert demand["final_payable"] == "1800.00"
    assert demand["standard_price"] == "2000.00"
    assert demand["savings"] == "200.00"

    # 3. Member initiates UPI renewal
    init_res = client.post("/api/member/v1/renew/initiate-upi", headers=member_headers, json={})
    assert init_res.status_code == 200
    init_data = init_res.get_json()["data"]
    assert init_data["payable_amount"] == "1800.00"
    assert "am=1800.00" in init_data["upi_intent_uri"]

    # 4. Member confirms UPI payment
    old_end = seed_member.membership_end
    confirm_res = client.post(
        "/api/member/v1/renew/confirm-upi",
        headers=member_headers,
        json={"payment_id": payment_id, "reference": "UPI99887766"},
    )
    assert confirm_res.status_code == 200
    confirm_data = confirm_res.get_json()["data"]
    assert confirm_data["status"] == "verified"
    assert confirm_data["amount_paid"] == "1800.00"

    refreshed_member = db.session.get(Member, seed_member.id)
    assert refreshed_member.membership_end > old_end

    # 5. Revenue summary on Renewal Desk shows actual collected ₹1,800, NOT ₹2,000
    summary_res = client.get("/api/mobile/v1/payments/summary", headers=staff_headers)
    assert summary_res.status_code == 200
    summary = summary_res.get_json()["data"]["today"]
    assert summary["total_collected"] == "1800.00"
    assert summary["total_discount"] == "200.00"
    assert summary["channels"]["online"] == "1800.00"


def test_cancel_payment_voids_demand_without_membership_extension(client, seed_gym, seed_member):
    """Cancelling a demand marks it cancelled and leaves membership dates unchanged."""
    headers = _staff_headers(seed_gym)
    old_end = seed_member.membership_end

    create_res = client.post(
        "/api/mobile/v1/payments",
        headers=headers,
        json={
            "member_id": seed_member.id,
            "final_payable": "1500.00",
            "channel": "online",
        },
    )
    payment_id = create_res.get_json()["data"]["id"]

    # Cancel payment
    cancel_res = client.post(f"/api/mobile/v1/payments/{payment_id}/cancel", headers=headers)
    assert cancel_res.status_code == 200

    payment = db.session.get(PaymentVerification, payment_id)
    assert payment.status == "cancelled"

    refreshed_member = db.session.get(Member, seed_member.id)
    assert refreshed_member.membership_end == old_end


def test_member_payments_history_includes_savings(client, seed_gym, seed_member):
    """Member payments history includes catalog standard price, discount, and savings."""
    member_headers = _member_headers(seed_member)

    # Seed a payment verification
    payment = PaymentVerification(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
        plan_id=seed_gym["plan"].id,
        standard_price=Decimal("2000.00"),
        discount=Decimal("200.00"),
        amount=Decimal("1800.00"),
        method="upi",
        channel="online",
        status="verified",
    )
    db.session.add(payment)
    db.session.commit()

    # Member fetches payments
    history_res = client.get("/api/member/v1/payments", headers=member_headers)
    assert history_res.status_code == 200
    # Verify savings calculation
    payments = history_res.get_json()["data"]["payments"]
    assert len(payments) >= 1
    p = payments[0]
    assert p["standard_price"] == "2000.00"
    assert p["discount"] == "200.00"
    assert p["savings"] == "200.00"
    assert p["channel"] == "online"


def test_initiate_upi_fails_if_gym_has_no_active_upi_receiver(client, seed_gym, seed_member):
    """If gym has not configured an active UPI ID, VYNLA must not route to dummy account."""
    member_headers = _member_headers(seed_member)
    # Ensure no QRSettings exist
    QRSettings.query.filter_by(gym_id=seed_gym["gym"].id).delete()
    db.session.commit()

    res = client.post("/api/member/v1/renew/initiate-upi", headers=member_headers, json={})
    assert res.status_code == 400
    err = res.get_json()["error"]
    assert "not configured an active UPI payment receiver" in err


def test_staff_cannot_delete_payments_strictly_gym_owner(client, seed_gym, seed_member):
    """Regular staff must NOT be able to delete payment records. Strictly reserved for gym_owner."""
    gym = seed_gym["gym"]
    staff_user = User(
        gym_id=gym.id,
        email="staff_tester@gym.com",
        full_name="Staff Member",
        password_hash="fake_hash",
        role="staff",
        is_active=True,
    )
    db.session.add(staff_user)
    db.session.commit()

    staff_token = create_access_token(staff_user.id, gym.id, role="staff")
    staff_headers = {"Authorization": f"Bearer {staff_token}"}
    owner_headers = _staff_headers(seed_gym)

    # Create payment
    payment = PaymentVerification(
        gym_id=gym.id,
        member_id=seed_member.id,
        amount=Decimal("1500.00"),
        status="pending",
    )
    db.session.add(payment)
    db.session.commit()

    # Staff attempts DELETE -> 403 Forbidden
    del_res = client.delete(f"/api/mobile/v1/payments/{payment.id}", headers=staff_headers)
    assert del_res.status_code == 403

    # Owner attempts DELETE -> 200 OK
    owner_del_res = client.delete(f"/api/mobile/v1/payments/{payment.id}", headers=owner_headers)
    assert owner_del_res.status_code == 200
