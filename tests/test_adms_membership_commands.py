"""Automatic block/unblock on the direct-ADMS path.

Expiry, renewal, payment and member-edit flows all funnel through
``queue_membership_command``; this suite proves the direct-ADMS leg fans out
from the same hook and stays gated on supervised commissioning.
"""
from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models.rrr import RRRAdmsCommand, RRRAttendanceEvent, RRRIdentityMapping, RRRIntegration
from app.services.bridge_service import (
    adms_command_text,
    queue_adms_membership_command,
    queue_membership_command,
)
from app.services.reminder_service import auto_expire_members_for_gym


def headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def make_integration(seed_gym, *, commands_enabled=True, connected=True):
    gym = seed_gym["gym"]
    row = RRRIntegration(
        gym_id=gym.id,
        connector_type="adms_direct",
        display_name="Direct eSSL ADMS",
        device_serial="ELITE-X2008-01",
        device_name="Elite Gym X2008",
        status="connected" if connected else "not_configured",
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed" if commands_enabled else "not_started",
    )
    if connected:
        row.last_success_at = datetime.now(timezone.utc)
    db.session.add(row)
    db.session.commit()
    return row


def test_expiry_queues_adms_block(seed_gym, seed_member):
    integration = make_integration(seed_gym)
    seed_member.device_enroll_number = "42"
    seed_member.membership_end = date.today() - timedelta(days=1)
    seed_member.status = "active"
    db.session.commit()

    assert auto_expire_members_for_gym(seed_gym["gym"]) == 1

    cmd = RRRAdmsCommand.query.filter_by(integration_id=integration.id).one()
    assert cmd.action == "block"
    assert cmd.test_enroll_number == "42"
    assert cmd.command_text == "DATA UPDATE USERINFO PIN=42\tPri=1"
    assert cmd.status == "queued"
    assert db.session.get(type(seed_member), seed_member.id).status == "expired"


def test_no_command_when_not_commissioned(seed_gym, seed_member):
    make_integration(seed_gym, commands_enabled=False)
    seed_member.device_enroll_number = "42"
    seed_member.membership_end = date.today() - timedelta(days=1)
    db.session.commit()

    assert auto_expire_members_for_gym(seed_gym["gym"]) == 1
    assert RRRAdmsCommand.query.count() == 0


def test_no_command_when_terminal_never_connected(seed_gym, seed_member):
    make_integration(seed_gym, connected=False)
    seed_member.device_enroll_number = "42"
    seed_member.membership_end = date.today() - timedelta(days=1)
    db.session.commit()

    assert auto_expire_members_for_gym(seed_gym["gym"]) == 1
    assert RRRAdmsCommand.query.count() == 0


def test_renewal_queues_unblock_and_dedupes(seed_gym, seed_member):
    integration = make_integration(seed_gym)
    seed_member.device_enroll_number = "42"
    db.session.commit()

    # Expired member -> block.
    seed_member.status = "expired"
    queue_membership_command(seed_member)
    db.session.commit()
    assert RRRAdmsCommand.query.filter_by(integration_id=integration.id).count() == 1

    # Same state again -> no duplicate.
    queue_membership_command(seed_member)
    db.session.commit()
    assert RRRAdmsCommand.query.filter_by(integration_id=integration.id).count() == 1

    # Renewed before delivery -> the queued block is replaced by unblock.
    seed_member.status = "active"
    seed_member.membership_end = date.today() + timedelta(days=30)
    queue_membership_command(seed_member)
    db.session.commit()
    cmds = RRRAdmsCommand.query.filter_by(integration_id=integration.id).all()
    assert len(cmds) == 1
    assert cmds[0].action == "unblock"
    assert cmds[0].command_text == "DATA UPDATE USERINFO PIN=42\tPri=0"

    # Terminal acknowledged the unblock; a later edit re-sends nothing.
    cmds[0].status = "acked"
    db.session.commit()
    queue_membership_command(seed_member)
    db.session.commit()
    assert RRRAdmsCommand.query.filter_by(integration_id=integration.id).count() == 1


def test_member_without_terminal_identity_queues_nothing(seed_gym, seed_member):
    make_integration(seed_gym)
    seed_member.device_enroll_number = None
    db.session.commit()
    assert queue_adms_membership_command(seed_member) is None
    assert RRRAdmsCommand.query.count() == 0


def test_identity_mapping_resolves_enroll_number(seed_gym, seed_member):
    integration = make_integration(seed_gym)
    # Member has no device_enroll_number; the confirmed mapping provides it.
    seed_member.device_enroll_number = None
    db.session.add(RRRIdentityMapping(
        gym_id=seed_gym["gym"].id, member_id=seed_member.id,
        external_id="777", source="adms_direct", status="confirmed",
    ))
    db.session.commit()

    cmd = queue_adms_membership_command(seed_member)
    db.session.commit()
    assert cmd is not None
    assert cmd.test_enroll_number == "777"
    assert cmd.integration_id == integration.id


def test_commission_adms_direct_requires_evidence(client, seed_gym, seed_member):
    integration = make_integration(seed_gym, commands_enabled=False)
    url = f"/api/mobile/v1/rrr/integrations/{integration.id}/commission"

    denied = client.post(url, headers=headers(seed_gym), json={})
    assert denied.status_code == 422  # physical_test_passed missing

    denied = client.post(url, headers=headers(seed_gym), json={"physical_test_passed": True})
    assert denied.status_code == 409  # no mapped attendance yet

    db.session.add(RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id, integration_id=integration.id, member_id=seed_member.id,
        source="adms_direct", device_serial="ELITE-X2008-01", biometric_user_id="42",
        punch_time=datetime.now(timezone.utc), dedupe_key="k1", processing_status="processed",
    ))
    db.session.commit()
    denied = client.post(url, headers=headers(seed_gym), json={"physical_test_passed": True})
    assert denied.status_code == 409  # no acknowledged test command yet

    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id, action="block_test",
        test_enroll_number="999", command_text=adms_command_text("block_test", "999"),
        status="acked",
    ))
    db.session.commit()
    ok = client.post(url, headers=headers(seed_gym), json={"physical_test_passed": True})
    assert ok.status_code == 200
    row = db.session.get(RRRIntegration, integration.id)
    assert row.commands_enabled is True
    assert row.commissioning_status == "physical_test_passed"


def test_mapping_resolve_records_adms_source(client, seed_gym, seed_member):
    event = RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id, integration_id=None, member_id=None,
        source="adms_direct", device_serial="ELITE-X2008-01", biometric_user_id="555",
        punch_time=datetime.now(timezone.utc), dedupe_key="k2", processing_status="unmapped",
    )
    db.session.add(event)
    db.session.commit()

    response = client.post(
        "/api/mobile/v1/rrr/mappings/555", headers=headers(seed_gym), json={"member_id": seed_member.id}
    )
    assert response.status_code == 200
    mapping = RRRIdentityMapping.query.filter_by(
        gym_id=seed_gym["gym"].id, external_id="555").one()
    assert mapping.source == "adms_direct"
    assert mapping.member_id == seed_member.id
