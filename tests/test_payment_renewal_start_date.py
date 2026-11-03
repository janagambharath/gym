from __future__ import annotations

from datetime import timedelta
from datetime import datetime, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.payment_service import apply_due_scheduled_renewals
from app.services.timezone_service import today_for_gym


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def _commissioned_adms(seed_gym):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Fake direct ADMS",
        device_serial="FAKE-RENEWAL-X2008",
        device_name="Fake eSSL",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_counter_renewal_uses_selected_start_date_and_queues_reversible_unblock(
    client, seed_gym, seed_member
):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone or "Asia/Kolkata")
    old_end = today - timedelta(days=4)
    start = today
    seed_member.device_enroll_number = "601"
    seed_member.membership_start = old_end - timedelta(days=25)
    seed_member.membership_end = old_end
    seed_member.status = "expired"
    _commissioned_adms(seed_gym)
    db.session.commit()

    plan = seed_gym["plan"]
    response = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={
            "member_id": seed_member.id,
            "plan_id": plan.id,
            "amount": str(plan.price),
            "method": "cash",
            "channel": "offline",
            "auto_verify": True,
            "renewal_days": plan.duration_days,
            "renewal_start_date": start.isoformat(),
        },
    )

    assert response.status_code == 201, response.get_json()
    payment = db.session.get(PaymentVerification, response.get_json()["data"]["id"])
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).one()
    db.session.refresh(seed_member)
    assert payment.status == "verified"
    assert payment.renewal_start_date == start
    assert renewal.new_start == start
    assert renewal.new_end == start + timedelta(days=plan.duration_days - 1)
    assert seed_member.membership_start == start
    assert seed_member.membership_end == renewal.new_end
    assert seed_member.status == "active"
    command = RRRAdmsCommand.query.filter_by(
        action="unblock", test_enroll_number="601"
    ).one()
    assert command.command_text.endswith("\tGrp=1")
    assert "DELETE" not in command.command_text.upper()


def test_future_counter_renewal_waits_until_start_then_auto_unblocks(
    client, seed_gym, seed_member, monkeypatch
):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone or "Asia/Kolkata")
    old_start = today - timedelta(days=28)
    old_end = today + timedelta(days=1)
    future_start = old_end + timedelta(days=1)
    seed_member.device_enroll_number = "602"
    seed_member.membership_start = old_start
    seed_member.membership_end = old_end
    seed_member.status = "active"
    _commissioned_adms(seed_gym)
    db.session.commit()

    plan = seed_gym["plan"]
    response = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={
            "member_id": seed_member.id,
            "plan_id": plan.id,
            "amount": str(plan.price),
            "method": "cash",
            "channel": "offline",
            "auto_verify": True,
            "renewal_days": plan.duration_days,
            "renewal_start_date": future_start.isoformat(),
        },
    )

    assert response.status_code == 201, response.get_json()
    payment = db.session.get(PaymentVerification, response.get_json()["data"]["id"])
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).one()
    db.session.refresh(seed_member)
    assert payment.status == "verified"
    assert seed_member.membership_start == old_start
    assert seed_member.membership_end == old_end
    assert RRRAdmsCommand.query.filter_by(test_enroll_number="602").count() == 0

    monkeypatch.setattr(
        "app.services.payment_service.today_for_gym",
        lambda _timezone: future_start,
    )
    assert apply_due_scheduled_renewals(gym) == 1
    db.session.refresh(seed_member)
    assert seed_member.membership_start == future_start
    assert seed_member.membership_end == future_start + timedelta(days=plan.duration_days - 1)
    assert seed_member.status == "active"
    command = RRRAdmsCommand.query.filter_by(
        action="unblock", test_enroll_number="602"
    ).one()
    assert command.command_text.endswith("\tGrp=1")
    assert apply_due_scheduled_renewals(gym) == 0


def test_direct_renewal_api_schedules_future_start_and_activates_it(
    client, seed_gym, seed_member, monkeypatch
):
    gym = seed_gym["gym"]
    today = today_for_gym(gym.timezone or "Asia/Kolkata")
    old_start = today - timedelta(days=28)
    old_end = today + timedelta(days=1)
    future_start = old_end + timedelta(days=1)
    seed_member.device_enroll_number = "603"
    seed_member.membership_start = old_start
    seed_member.membership_end = old_end
    seed_member.status = "active"
    _commissioned_adms(seed_gym)
    db.session.commit()
    old_plan = seed_gym["plan"]
    plan = MembershipPlan(
        gym_id=gym.id,
        name="Future 45 Day Plan",
        duration_days=45,
        price=old_plan.price,
        is_active=True,
    )
    db.session.add(plan)
    db.session.commit()

    response = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=_owner_headers(seed_gym),
        json={
            "plan_id": plan.id,
            "amount": str(plan.price),
            "renewal_days": plan.duration_days,
            "renewal_start_date": future_start.isoformat(),
        },
    )
    assert response.status_code == 201, response.get_json()
    assert response.get_json()["data"]["scheduled"] is True
    renewal = RenewalHistory.query.filter_by(member_id=seed_member.id).one()
    assert renewal.payment_verification_id is None
    db.session.refresh(seed_member)
    assert seed_member.membership_end == old_end
    assert seed_member.plan_id == old_plan.id
    assert renewal.plan_id == plan.id

    monkeypatch.setattr(
        "app.services.payment_service.today_for_gym",
        lambda _timezone: future_start,
    )
    assert apply_due_scheduled_renewals(gym) == 1
    db.session.refresh(seed_member)
    assert seed_member.membership_start == future_start
    assert seed_member.membership_end == future_start + timedelta(days=plan.duration_days - 1)
    assert seed_member.plan_id == plan.id
    assert RRRAdmsCommand.query.filter_by(
        action="unblock", test_enroll_number=seed_member.device_enroll_number
    ).one().command_text.endswith("\tGrp=1")
