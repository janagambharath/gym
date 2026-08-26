from __future__ import annotations

import json
from datetime import date, timedelta
from app.extensions import db
from app.models import (
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    Gym,
    Member,
    MembershipPlan,
    PaymentVerification,
    ReminderLog,
    User,
)
from app.models.bot import BotConversation, BotLead, BotMessage, BotFAQ, GymBotConfig


def _login_owner(client, seed_gym):
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )


def test_web_dashboard_operational_sections(client, seed_gym):
    _login_owner(client, seed_gym)
    res = client.get("/app/dashboard")
    assert res.status_code == 200
    assert b"Gym Operations Center" in res.data
    assert b"Gym Onboarding Checklist" in res.data
    assert b"WHATSAPP" in res.data
    assert b"BRIDGE" in res.data
    assert b"BIOMETRIC DEVICE" in res.data


def test_web_biometric_control_center(client, seed_gym, app):
    _login_owner(client, seed_gym)

    # 1. Overview without bridge provisioned
    res = client.get("/biometric/")
    assert res.status_code == 200
    assert b"Biometric Control Center" in res.data

    # 2. Provision bridge via Web Settings
    res = client.post(
        "/biometric/settings",
        data={
            "action": "provision",
            "display_name": "Front Desk PC",
            "device_serial": "X990-TEST-99",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"Bridge credentials generated" in res.data

    with app.app_context():
        gym = seed_gym["gym"]
        installation = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
        assert installation is not None
        assert installation.device_serial == "X990-TEST-99"

        # Create a test member
        member = Member(
            gym_id=gym.id,
            plan_id=seed_gym["plan"].id,
            full_name="Biometric Test User",
            phone="+919876543210",
            membership_start=date.today(),
            membership_end=date.today() + timedelta(days=30),
            status="active",
            device_enroll_number="101",
        )
        db.session.add(member)
        db.session.commit()

        # Add dummy punch and command
        db.session.add(
            BridgeAttendance(
                bridge_id=installation.id,
                gym_id=gym.id,
                member_id=member.id,
                event_id="punch-test-01",
                device_enroll_number="101",
                event_time=member.membership_start,
                verify_method=1,
                is_invalid=False,
            )
        )
        db.session.add(
            BridgeCommand(
                bridge_id=installation.id,
                gym_id=gym.id,
                member_id=member.id,
                command_type="enable_user",
                enroll_number="101",
                member_name=member.full_name,
                status="failed",
                last_error="Device connection timed out.",
            )
        )
        db.session.commit()
        member_id = member.id

    # 3. View Activity Punches
    res = client.get("/biometric/activity")
    assert res.status_code == 200
    assert b"Live Attendance Punches" in res.data
    assert b"101" in res.data

    # 4. View Commands Queue
    res = client.get("/biometric/commands")
    assert res.status_code == 200
    assert b"Biometric Command Queue" in res.data
    assert b"Device connection timed out" in res.data

    # 5. Retry Command
    with app.app_context():
        cmd = BridgeCommand.query.filter_by(status="failed").first()
        cmd_id = cmd.id

    res = client.post(f"/biometric/commands/{cmd_id}/retry", follow_redirects=True)
    assert res.status_code == 200
    assert b"queued for immediate retry" in res.data

    # 6. Manual Member Sync
    res = client.post(f"/biometric/sync-member/{member_id}", follow_redirects=True)
    assert res.status_code == 200
    assert b"Biometric access command queued" in res.data

    # 7. Download Support Package
    res = client.get("/biometric/support-package")
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    data = json.loads(res.data)
    assert "bridge" in data
    assert data["bridge"]["device_serial"] == "X990-TEST-99"


def test_web_bot_ai_receptionist_desk(client, seed_gym, app):
    _login_owner(client, seed_gym)

    with app.app_context():
        gym = db.session.get(Gym, seed_gym["gym"].id)
        gym.whatsapp_enabled = True
        gym.phone_number_id = "test_phone_id"
        gym.whatsapp_business_account_id = "test_waba_id"

        conv = BotConversation(
            gym_id=gym.id,
            phone="+919876543299",
            customer_name="Test Inbound Lead",
            handover_status="bot_active",
        )
        db.session.add(conv)
        db.session.flush()
        db.session.add(
            BotMessage(
                conversation_id=conv.id,
                sender="customer",
                body="Hi, what are your monthly membership prices?",
            )
        )
        db.session.add(
            BotLead(
                gym_id=gym.id,
                conversation_id=conv.id,
                name="Test Inbound Lead",
                phone="+919876543299",
                status="new",
            )
        )
        db.session.commit()
        conv_id = conv.id
        lead_id = BotLead.query.filter_by(conversation_id=conv.id).first().id

    # 1. Overview
    res = client.get("/bot/")
    assert res.status_code == 200
    assert b"AI Receptionist & WhatsApp Desk" in res.data

    # 2. Inbox Split View
    res = client.get(f"/bot/inbox?conv_id={conv_id}")
    assert res.status_code == 200
    assert b"Test Inbound Lead" in res.data
    assert b"what are your monthly membership prices" in res.data

    # 3. Take Over Toggle
    res = client.post(f"/bot/conversations/{conv_id}/handover", follow_redirects=True)
    assert res.status_code == 200
    assert b"Human Staff Takeover Active" in res.data

    # 4. Send Staff Reply
    res = client.post(
        f"/bot/conversations/{conv_id}/send",
        data={"message": "Hello! Monthly membership is Rs 1,500."},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"Message sent to WhatsApp" in res.data

    # 5. Leads Pipeline
    res = client.get("/bot/leads")
    assert res.status_code == 200
    assert b"Leads Pipeline" in res.data

    res = client.post(
        f"/bot/leads/{lead_id}/status",
        data={"status": "trial_booked", "notes": "Booked for tomorrow morning"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"Lead status updated" in res.data

    # 6. Bot Setup & Knowledge
    res = client.get("/bot/setup")
    assert res.status_code == 200
    assert b"Business & Receptionist Profile" in res.data

    res = client.post(
        "/bot/setup",
        data={
            "action": "add_faq",
            "question": "Is parking available?",
            "answer": "Yes, free dedicated parking is available.",
        },
        follow_redirects=True,
    )
    assert res.status_code == 200
    assert b"New FAQ added" in res.data


def test_web_operations_issues_and_search(client, seed_gym, app):
    _login_owner(client, seed_gym)

    # 1. Issues Hub
    res = client.get("/operations/issues")
    assert res.status_code == 200
    assert b"Operational Issues & Recovery Center" in res.data

    # 2. Reports & Outcome Funnels
    res = client.get("/operations/reports")
    assert res.status_code == 200
    assert b"Reports & Business Outcome Funnels" in res.data
    assert b"Membership Renewal Funnel" in res.data
    assert b"WhatsApp Inbound Lead Funnel" in res.data

    # 3. Global Search API
    res = client.get("/operations/search?q=Alice")
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    data = json.loads(res.data)
    assert "members" in data
    assert "payments" in data
    assert "leads" in data
