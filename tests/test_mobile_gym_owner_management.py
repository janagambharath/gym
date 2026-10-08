"""Tests for Mobile-First Gym Owner Management features:
- Staff Management CRUD and WhatsApp invite
- Remote Gate Unlock & Hardware Health Retry
- Digital WhatsApp Payment Receipt
- Membership Freeze / Pause and Resume
"""
from datetime import date, timedelta
from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification, User
from app.models.access_event import AccessEvent


def _create_owner_and_headers(client, app, email="testowner@gym.com"):
    with app.app_context():
        gym = Gym(
            name="Fitness Matrix",
            slug="fitness-matrix",
            country="India",
            currency="INR",
            phone="+919876543210",
            subscription_status="active",
        )
        db.session.add(gym)
        db.session.flush()

        plan = MembershipPlan(gym_id=gym.id, name="Gold Annual", duration_days=365, price=12000, is_active=True)
        db.session.add(plan)
        db.session.flush()

        owner = User(
            gym_id=gym.id,
            email=email,
            full_name="Matrix Owner",
            role="gym_owner",
            is_active=True,
        )
        owner.set_password("OwnerPassword123!")
        db.session.add(owner)
        db.session.commit()

        gym_id = gym.id
        plan_id = plan.id
        owner_id = owner.id

    login_resp = client.post("/api/mobile/v1/auth/login", json={"email": email, "password": "OwnerPassword123!"})
    token = login_resp.get_json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return gym_id, plan_id, owner_id, headers


def test_mobile_staff_management_flow(client, app):
    gym_id, plan_id, owner_id, headers = _create_owner_and_headers(client, app, "staffmgr@gym.com")

    # 1. Add staff member
    resp = client.post(
        "/api/mobile/v1/staff",
        json={"full_name": "Ramesh Trainer", "email": "ramesh@gym.com", "role": "staff", "phone": "9876543210"},
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.get_json()["data"]
    staff_id = data["id"]
    assert data["full_name"] == "Ramesh Trainer"
    assert data["role"] == "staff"
    assert "temp_password" in data
    assert "invite_whatsapp_url" in data

    # 2. List staff
    list_resp = client.get("/api/mobile/v1/staff", headers=headers)
    assert list_resp.status_code == 200
    staff_list = list_resp.get_json()["data"]["staff"]
    assert any(s["id"] == staff_id for s in staff_list)

    # 3. Reset staff password
    reset_resp = client.post(f"/api/mobile/v1/staff/{staff_id}/reset-password", headers=headers)
    assert reset_resp.status_code == 200
    assert "new_password" in reset_resp.get_json()["data"]

    # 4. Deactivate staff
    deact_resp = client.patch(f"/api/mobile/v1/staff/{staff_id}", json={"is_active": False}, headers=headers)
    assert deact_resp.status_code == 200
    assert deact_resp.get_json()["data"]["is_active"] is False


def test_mobile_remote_unlock_and_sync(client, app):
    gym_id, plan_id, owner_id, headers = _create_owner_and_headers(client, app, "unlockowner@gym.com")

    # 1. Remote unlock
    unlock_resp = client.post("/api/mobile/v1/access/remote-unlock", headers=headers)
    assert unlock_resp.status_code == 200
    assert unlock_resp.get_json()["data"]["pulse_seconds"] == 5

    # 2. Verify audit event
    with app.app_context():
        event = AccessEvent.query.filter_by(gym_id=gym_id, verify_method=15).first()
        assert event is not None
        assert event.event_type == "ENTRY"
        assert event.is_invalid is False

    # 3. Retry sync
    retry_resp = client.post("/api/mobile/v1/access/retry-sync", headers=headers)
    assert retry_resp.status_code == 200
    assert "retried_count" in retry_resp.get_json()["data"]


def test_mobile_membership_freeze_and_unfreeze(client, app):
    gym_id, plan_id, owner_id, headers = _create_owner_and_headers(client, app, "freezeowner@gym.com")

    # Create active member
    today = date.today()
    initial_end = today + timedelta(days=60)
    with app.app_context():
        member = Member(
            gym_id=gym_id,
            plan_id=plan_id,
            full_name="Vikram Fitness",
            phone="+919876543222",
            status="active",
            membership_start=today,
            membership_end=initial_end,
            device_enroll_number="101",
        )
        db.session.add(member)
        db.session.commit()
        member_id = member.id

    # 1. Freeze member for 14 days
    freeze_resp = client.post(
        f"/api/mobile/v1/members/{member_id}/freeze",
        json={"days": 14, "reason": "Annual vacation"},
        headers=headers,
    )
    assert freeze_resp.status_code == 200
    data = freeze_resp.get_json()["data"]
    assert data["status"] == "paused"
    expected_new_end = (initial_end + timedelta(days=14)).isoformat()
    assert data["membership_end"] == expected_new_end

    # 2. Unfreeze member
    unfreeze_resp = client.post(f"/api/mobile/v1/members/{member_id}/unfreeze", headers=headers)
    assert unfreeze_resp.status_code == 200
    unfreeze_data = unfreeze_resp.get_json()["data"]
    assert unfreeze_data["status"] == "active"


def test_mobile_payment_receipt_generator(client, app):
    gym_id, plan_id, owner_id, headers = _create_owner_and_headers(client, app, "receiptowner@gym.com")

    with app.app_context():
        member = Member(
            gym_id=gym_id,
            plan_id=plan_id,
            full_name="Pooja Sharma",
            phone="+919988776655",
            status="active",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=90),
        )
        db.session.add(member)
        db.session.commit()
        member_id = member.id

    # 1. Record payment
    pay_resp = client.post(
        "/api/mobile/v1/payments",
        json={"member_id": member_id, "amount": 3500, "method": "upi", "reference": "UPI998877"},
        headers=headers,
    )
    assert pay_resp.status_code == 201
    pay_data = pay_resp.get_json()["data"]
    payment_id = pay_data["id"]
    assert "receipt" in pay_data
    assert "whatsapp_url" in pay_data
    assert "wa.me" in pay_data["whatsapp_url"]

    # 2. Fetch standalone receipt endpoint
    receipt_resp = client.get(f"/api/mobile/v1/payments/{payment_id}/receipt", headers=headers)
    assert receipt_resp.status_code == 200
    receipt_data = receipt_resp.get_json()["data"]
    assert receipt_data["member_name"] == "Pooja Sharma"
    assert receipt_data["amount"] == "3500.00"
    assert "PAYMENT RECEIPT" in receipt_data["receipt_text"]
    assert "Fitness Matrix" in receipt_data["receipt_text"]
    assert "wa.me" in receipt_data["whatsapp_url"]
