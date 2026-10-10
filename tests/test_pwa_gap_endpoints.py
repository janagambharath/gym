"""Tests for the PWA-gap endpoints added in the fix/pwa-gaps round.

The PWA called several endpoints the backend never implemented, leaving
screens dead (member home, member self-renew, subscription, bot overview,
WhatsApp logs, batch import, bot reply, campaign preview). These tests pin
the new backend endpoints; the PWA-side remaps are covered by the endpoint
audit (all PWA calls resolve against the Flask URL map).
"""
from datetime import date, timedelta

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, MembershipPlan, PaymentVerification
from app.models.bot import BotConversation, BotLead


def _member_headers(member):
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _owner_headers(client, seed_gym):
    # Log in through the mobile API like the PWA does.
    res = client.post(
        "/api/mobile/v1/auth/login",
        json={"email": "owner@testgym.com", "password": "SecurePass123!"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:200]
    token = res.json["data"]["access_token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def test_member_renew_with_plan_id(client, seed_member):
    """POST /api/member/v1/renew accepts a plan_id and creates a pending claim."""
    member = seed_member
    plan = db.session.get(MembershipPlan, member.plan_id)
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_headers(member),
        json={"plan_id": plan.id},
    )
    assert res.status_code == 201
    assert res.json["success"] is True
    payment = db.session.get(PaymentVerification, res.json["data"]["payment_id"])
    assert payment is not None
    assert payment.member_id == member.id
    assert payment.gym_id == member.gym_id
    assert payment.status == "pending"
    assert float(payment.amount) == float(plan.price)


def test_member_renew_with_plan_id_switches_plan(client, seed_member):
    """Member can renew onto a different active plan than their current one."""
    member = seed_member
    other = MembershipPlan(
        gym_id=member.gym_id,
        name="Quarterly",
        duration_days=90,
        price=2500,
        is_active=True,
    )
    db.session.add(other)
    db.session.commit()
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_headers(member),
        json={"plan_id": other.id},
    )
    assert res.status_code == 201
    payment = db.session.get(PaymentVerification, res.json["data"]["payment_id"])
    assert payment.renewal_days == 90
    assert float(payment.amount) == 2500.0


def test_member_renew_rejects_unknown_plan(client, seed_member):
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_headers(seed_member),
        json={"plan_id": 999999},
    )
    assert res.status_code == 404


def test_member_renew_rejects_missing_plan_id(client, seed_member):
    res = client.post(
        "/api/member/v1/renew", headers=_member_headers(seed_member), json={}
    )
    assert res.status_code == 422


def test_member_renew_rejects_cross_gym_plan(client, app, seed_member, seed_gym):
    """A plan_id from another gym must not be usable."""
    other_gym = seed_gym["gym"]
    # Create a second gym + plan via direct model use.
    from app.models import Gym

    gym2 = Gym(name="Other Gym", slug="other-gym", timezone="Asia/Kolkata")
    db.session.add(gym2)
    db.session.flush()
    plan2 = MembershipPlan(gym_id=gym2.id, name="X", duration_days=30, price=100, is_active=True)
    db.session.add(plan2)
    db.session.commit()
    res = client.post(
        "/api/member/v1/renew",
        headers=_member_headers(seed_member),
        json={"plan_id": plan2.id},
    )
    assert res.status_code == 404


def test_bot_overview_aggregates(client, seed_gym):
    """GET /api/mobile/v1/bot/overview returns conversation/lead/handover stats."""
    from app.models.bot import FeatureEntitlement

    gym_id = seed_gym["gym"].id
    db.session.add(FeatureEntitlement(gym_id=gym_id, feature="whatsapp_bot", enabled=True))
    for i, state in enumerate(["new", "closed", "closed"]):
        db.session.add(
            BotConversation(
                gym_id=gym_id,
                phone=f"+9190000000{i}",
                state=state,
                handover_status="human_active" if i == 0 else "bot_active",
            )
        )
    db.session.add(BotLead(gym_id=gym_id, phone="+91900000001", name="Lead One"))
    db.session.commit()

    res = client.get("/api/mobile/v1/bot/overview", headers=_owner_headers(client, seed_gym))
    assert res.status_code == 200
    data = res.json["data"]
    assert data["total_conversations"] == 3
    assert data["total_leads"] == 1
    assert data["handover_count"] == 1
    assert data["resolution_rate"] == round(2 / 3 * 100, 1)


def test_whatsapp_logs_shape(client, seed_gym, seed_member):
    """GET /api/mobile/v1/whatsapp/logs returns the PWA-shaped log list."""
    from app.models.reminder_log import ReminderLog

    log = ReminderLog(
        gym_id=seed_gym["gym"].id,
        member_id=seed_member.id,
        channel="whatsapp",
        reminder_stage="expiry_3d",
        cycle_end_date=date.today() + timedelta(days=3),
        scheduled_for=date.today(),
        phone_snapshot=seed_member.phone,
        status="sent",
    )
    db.session.add(log)
    db.session.commit()

    res = client.get(
        "/api/mobile/v1/whatsapp/logs?page_size=20",
        headers=_owner_headers(client, seed_gym),
    )
    assert res.status_code == 200
    logs = res.json["data"]["logs"]
    assert len(logs) == 1
    entry = logs[0]
    assert entry["member_name"] == seed_member.full_name
    assert entry["phone"] == seed_member.phone
    assert entry["status"] == "sent"
    assert entry["created_at"] is not None


def test_manual_member_block_queues_command(client, seed_gym, seed_member):
    """POST /rrr/members/<id>/access queues a block command when commissioned."""
    from app.models.rrr import RRRAdmsCommand, RRRIntegration

    gym_id = seed_gym["gym"].id
    integration = RRRIntegration(
        gym_id=gym_id,
        connector_type="adms_direct",
        display_name="Test Terminal",
        device_serial="TEST123",
        status="connected",
        commands_enabled=True,
        adms_path_token="test-token-123",
    )
    # Simulate a terminal that has checked in.
    from datetime import datetime, timezone

    integration.last_success_at = datetime.now(timezone.utc)
    db.session.add(integration)
    db.session.commit()

    seed_member.device_enroll_number = "101"
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/rrr/members/{seed_member.id}/access",
        headers=_owner_headers(client, seed_gym),
        json={"action": "block"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    cmd = RRRAdmsCommand.query.filter_by(integration_id=integration.id).first()
    assert cmd is not None
    assert cmd.action == "block"
    assert cmd.status == "queued"
    assert "101" in cmd.command_text


def test_manual_member_block_rejected_without_commissioning(client, seed_gym, seed_member):
    """409 when the terminal is not commissioned for commands."""
    seed_member.device_enroll_number = "101"
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/rrr/members/{seed_member.id}/access",
        headers=_owner_headers(client, seed_gym),
        json={"action": "block"},
    )
    assert res.status_code == 409
    assert res.json["error"]["code"] == "DEVICE_NOT_READY"


def test_manual_member_block_rejects_bad_action(client, seed_gym, seed_member):
    res = client.post(
        f"/api/mobile/v1/rrr/members/{seed_member.id}/access",
        headers=_owner_headers(client, seed_gym),
        json={"action": "explode"},
    )
    assert res.status_code == 422
