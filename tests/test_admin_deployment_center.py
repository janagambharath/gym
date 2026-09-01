from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from flask import url_for

from app.extensions import db
from app.models import (
    AuditLog,
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    Gym,
    GymDeployment,
    Member,
    MembershipPlan,
    PaymentVerification,
    ReminderLog,
    RenewalHistory,
    User,
)
from app.models.bot import BotFAQ, FeatureEntitlement, GymBotConfig
from app.models.mixins import utcnow
from app.services.bridge_service import queue_membership_command




@pytest.fixture
def super_admin_user(app):
    admin = User(
        email="superadmin@renewaldesk.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()
    return admin


def login_super_admin(client, email="superadmin@renewaldesk.com", password="AdminPass123!"):
    return client.post(
        "/auth/login",
        data={"email": email, "password": password},
        follow_redirects=True,
    )


def test_super_admin_dashboard_metrics(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    res = client.get("/admin/")
    assert res.status_code == 200
    assert b"Renewal Desk Operations" in res.data
    assert b"Gym Footprint" in res.data
    assert b"Avg Onboarding Time" in res.data
    assert b"+ ONBOARD NEW GYM" in res.data


def test_gym_list_filtering_and_indicators(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    res = client.get("/admin/gyms?status=active")
    assert res.status_code == 200
    assert b"Test Gym" in res.data
    assert b"Health" in res.data


def test_complete_9_step_onboarding_wizard(app, client, super_admin_user):
    """Simulates a complete new gym onboarding workflow from scratch."""
    login_super_admin(client)
    start_time = time.time()

    # STEP 1: Gym Details
    step1_data = {
        "name": "Olympus Strength & Fitness",
        "country": "India",
        "city": "Bengaluru",
        "area": "Indiranagar",
        "address": "100ft Road, Indiranagar",
        "phone": "+919876543219",
        "email": "contact@olympusgym.in",
        "business_category": "Gym / Fitness Center",
        "timezone": "Asia/Kolkata",
        "currency": "INR",
        "internal_notes": "Founder onboarded via referral",
    }
    res = client.post("/admin/gyms/onboard/0/step/1", data=step1_data, follow_redirects=True)
    assert res.status_code == 200

    gym = Gym.query.filter_by(name="Olympus Strength & Fitness").first()
    assert gym is not None
    assert gym.city == "Bengaluru"
    assert gym.onboarding_status == "configuring"
    dep = GymDeployment.query.filter_by(gym_id=gym.id).first()
    assert dep is not None
    assert dep.checklist_json["gym_created"]["status"] == "passed"

    # STEP 2: Owner Account
    step2_data = {
        "owner_name": "Siddharth Rao",
        "owner_email": "siddharth@olympusgym.in",
        "temp_password": "TempSecret123!",
    }
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/2", data=step2_data, follow_redirects=True)
    assert res.status_code == 200
    owner = User.query.filter_by(email="siddharth@olympusgym.in").first()
    assert owner is not None
    assert owner.must_change_password is True
    assert owner.check_password("TempSecret123!") is True
    assert dep.checklist_json["owner_created"]["status"] == "passed"

    # STEP 3: Membership Plans
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/3", data={"_action": "populate_defaults"}, follow_redirects=True)
    assert res.status_code == 200
    assert len(gym.plans) >= 4

    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/3", data={}, follow_redirects=True)
    assert res.status_code == 200
    assert dep.checklist_json["plans_configured"]["status"] == "passed"

    # STEP 4: Member Import (Starter Data)
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/4", data={"_action": "seed_sample"}, follow_redirects=True)
    assert res.status_code == 200
    member_count = Member.query.filter_by(gym_id=gym.id, deleted_at=None).count()
    assert member_count == 3
    assert dep.checklist_json["members_imported"]["status"] == "passed"

    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/4", data={}, follow_redirects=True)
    assert res.status_code == 200

    # STEP 5: WhatsApp Setup
    step5_data = {
        "whatsapp_enabled": "on",
        "business_phone_number": "+919876543219",
        "phone_number_id": "109847291048",
        "whatsapp_business_account_id": "209847291048",
    }
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/5", data=step5_data, follow_redirects=True)
    assert res.status_code == 200
    assert gym.whatsapp_enabled is True
    assert gym.phone_number_id == "109847291048"
    assert dep.checklist_json["whatsapp_connected"]["status"] == "passed"

    # STEP 6: AI Receptionist Setup
    step6_data = {
        "greeting_message": "Welcome to Olympus Strength! How can I help you?",
        "opening_hours": "5:30 AM - 10:30 PM (Mon-Sat)",
        "trial_enabled": "on",
        "handover_enabled": "on",
    }
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/6", data=step6_data, follow_redirects=True)
    assert res.status_code == 200
    assert dep.checklist_json["ai_configured"]["status"] == "passed"

    # STEP 7: Biometric Setup
    step7_data = {
        "enable_biometric": "on",
        "device_serial": "X990-OLYMPUS-01",
    }
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/7", data=step7_data, follow_redirects=True)
    assert res.status_code == 200
    assert gym.bridge_installation is not None
    assert gym.bridge_installation.device_serial == "X990-OLYMPUS-01"
    assert dep.checklist_json["bridge_connected"]["status"] == "passed"

    # STEP 8: Testing Runner (Biometric Sync + Controlled Test Payment & Renewal)
    # Test Biometric Command
    res = client.post(f"/admin/gyms/{gym.id}/test-biometric-sync", follow_redirects=True)
    assert res.status_code == 200
    assert dep.checklist_json["test_member_synced"]["status"] == "passed"
    cmd = BridgeCommand.query.filter_by(gym_id=gym.id).first()
    assert cmd is not None
    assert cmd.command_type in ("enable_user", "disable_user")

    # Controlled Test Payment & Renewal
    res = client.post(f"/admin/gyms/{gym.id}/test-payment-renewal", follow_redirects=True)
    assert res.status_code == 200
    assert dep.checklist_json["test_payment_completed"]["status"] == "passed"
    assert dep.checklist_json["test_renewal_completed"]["status"] == "passed"

    # Verify isolated test payment flag
    test_pay = PaymentVerification.query.filter_by(gym_id=gym.id, is_test=True).first()
    assert test_pay is not None
    assert test_pay.status == "verified"
    test_ren = RenewalHistory.query.filter_by(gym_id=gym.id, is_test=True).first()
    assert test_ren is not None

    # Step 8 submit
    res = client.post(f"/admin/gyms/onboard/{gym.id}/step/8", data={}, follow_redirects=True)
    assert res.status_code == 200

    # STEP 9: GO LIVE GATE
    ready, blockers = dep.is_ready_for_golive()
    assert ready is True, f"Blockers remaining: {blockers}"

    res = client.post(f"/admin/gyms/{gym.id}/go-live", follow_redirects=True)
    assert res.status_code == 200
    assert b"is now LIVE" in res.data

    # Verify Gym state
    assert gym.onboarding_status == "live"
    assert gym.status == "active"
    assert gym.go_live_at is not None
    assert dep.completed_at is not None
    assert dep.setup_duration_seconds is not None

    elapsed = time.time() - start_time
    assert elapsed < 600, f"Setup took {elapsed}s (exceeded 10 minute benchmark)"


def test_owner_first_login_forced_password_reset(app, client):
    """Verifies that an onboarded gym owner is prompted to set their permanent password upon first login."""
    gym = Gym(
        name="Titan Fitness",
        slug="titan-fitness",
        email="titan@fitness.com",
        status="active",
        onboarding_status="live",
    )
    db.session.add(gym)
    db.session.flush()

    owner = User(
        gym_id=gym.id,
        email="owner@titanfitness.in",
        full_name="Vikram Seth",
        role="gym_owner",
        is_active=True,
        must_change_password=True,
        invitation_status="sent",
    )
    owner.set_password("TempPass789!")
    db.session.add(owner)
    db.session.commit()

    # Login as owner
    res = client.post(
        "/auth/login",
        data={"email": "owner@titanfitness.in", "password": "TempPass789!"},
        follow_redirects=False,
    )
    # Must redirect to change-password
    assert res.status_code == 302
    assert "/auth/change-password" in res.headers["Location"]

    # Follow redirect to change password
    res_follow = client.get("/auth/change-password")
    assert res_follow.status_code == 200

    # Change password
    res_change = client.post(
        "/auth/change-password",
        data={
            "current_password": "TempPass789!",
            "new_password": "PermanentSecret2026!",
            "confirm_new_password": "PermanentSecret2026!",
        },

        follow_redirects=True,
    )
    assert res_change.status_code == 200
    owner_reloaded = db.session.get(User, owner.id)
    assert owner_reloaded.must_change_password is False
    assert owner_reloaded.check_password("PermanentSecret2026!") is True



def test_member_import_batch_rollback(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    gym = seed_gym["gym"]
    batch_id = "IMPORT-20260826-120000"

    m1 = Member(gym_id=gym.id, full_name="Imported Member 1", phone="+919888800001", external_ref=batch_id, membership_start=date.today(), membership_end=date.today() + timedelta(days=30), status="active")
    m2 = Member(gym_id=gym.id, full_name="Imported Member 2", phone="+919888800002", external_ref=batch_id, membership_start=date.today(), membership_end=date.today() + timedelta(days=30), status="active")
    db.session.add_all([m1, m2])
    db.session.commit()

    res = client.post(f"/admin/gyms/{gym.id}/members/undo-batch/{batch_id}", follow_redirects=True)
    assert res.status_code == 200
    assert b"Rollback complete: 2 member(s)" in res.data

    assert m1.deleted_at is not None
    assert m1.status == "deleted"
    assert m2.deleted_at is not None


def test_super_admin_global_search(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    gym = seed_gym["gym"]

    res = client.get("/admin/search?q=Test")
    assert res.status_code == 200
    data = res.get_json()
    assert "gyms" in data
    assert any(g["name"] == "Test Gym" for g in data["gyms"])


def test_support_actions_invitation_and_password_reset(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    gym = seed_gym["gym"]
    owner = seed_gym["owner"]

    # Resend invitation
    res = client.post(f"/admin/gyms/{gym.id}/users/{owner.id}/resend-invite", follow_redirects=True)
    assert res.status_code == 200
    assert owner.invitation_status == "sent"

    # Reset password
    res = client.post(f"/admin/gyms/{gym.id}/users/{owner.id}/reset-password", data={"new_password": "NewResetPass123!"}, follow_redirects=True)
    assert res.status_code == 200
    assert owner.check_password("NewResetPass123!") is True
    assert owner.must_change_password is True


def test_bridge_key_rotation_and_revocation(app, client, super_admin_user, seed_gym):
    login_super_admin(client)
    gym = seed_gym["gym"]

    bridge, _ = BridgeInstallation.create_for_gym(gym_id=gym.id, display_name="Test Bridge", device_serial="TEST-SN-001")
    db.session.add(bridge)
    db.session.commit()

    old_hash = bridge.api_key_hash

    # Rotate
    res = client.post(f"/admin/gyms/{gym.id}/bridge/rotate-key", follow_redirects=True)
    assert res.status_code == 200
    assert bridge.api_key_hash != old_hash

    # Revoke
    res = client.post(f"/admin/gyms/{gym.id}/bridge/revoke", follow_redirects=True)
    assert res.status_code == 200
    assert bridge.is_active is False


def test_yodha_fitness_backward_compatibility(app, client):
    """Verifies that existing live gym structures (specifically Yodha Fitness reference) remain intact and operational."""
    yodha = Gym(
        name="Yodha Fitness",
        slug="yodha-fitness",
        email="admin@yodhafitness.com",
        phone="+919876500000",
        timezone="Asia/Kolkata",
        status="active",
        onboarding_status="live",
        subscription_status="active",
    )
    db.session.add(yodha)
    db.session.flush()

    bridge, raw_key = BridgeInstallation.create_for_gym(
        gym_id=yodha.id,
        display_name="Yodha Fitness Turnstile Bridge",
        device_serial="X990-YODHA-PROD",
    )
    bridge.last_heartbeat_at = utcnow()
    db.session.add(bridge)

    plan = MembershipPlan(gym_id=yodha.id, name="Annual Yodha Pass", duration_days=365, price=15000)
    db.session.add(plan)
    db.session.flush()

    member = Member(
        gym_id=yodha.id,
        plan_id=plan.id,
        full_name="Arjun Warrior",
        phone="+919876511111",
        membership_start=date.today(),
        membership_end=date.today() + timedelta(days=365),
        status="active",
        device_enroll_number="1001",
    )
    db.session.add(member)
    db.session.commit()

    # Biometric command lease test via Protocol v2
    cmd = queue_membership_command(member)
    db.session.flush()
    assert cmd.status == "pending"
    assert cmd.command_type == "enable_user"


    # Bridge heartbeat / poll simulation
    headers = {
        "X-Api-Key": raw_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "X990-YODHA-PROD",
    }
    res = client.post(
        "/api/bridge/v1/heartbeat",
        json={"gymId": bridge.public_id, "deviceSerial": "X990-YODHA-PROD", "status": "online"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json.get("ok") is True

