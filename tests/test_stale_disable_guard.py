"""Regression tests for the stale-disable serve-time guard.

Incident (2026-10-23): active members were blocked at gym doors by disable
commands queued against an earlier state.  Bharath's hard invariant —
"active members should not be blocked" — is implemented FAIL-SAFE: a
disable is served/queued/retried only for a PROVEN-blockable member
(paused, or status != active with membership_end strictly in the past).
Active on any date, future end, NULL end, and missing data all cancel.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Gym, Member
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.bridge_service import STALE_DISABLE_MARKER, lease_pending_commands
from app.services.reminder_scheduler import _scheduled_reminder_job


def _installation(gym_id: int, serial: str = "STALE-GUARD-BRIDGE-01"):
    installation, _api_key = BridgeInstallation.create_for_gym(
        gym_id, "Stale guard bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation


def _member(gym_id: int, plan_id: int | None, *, name: str, phone: str,
            enroll: str, status: str, end: date | None) -> Member:
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=(end or date.today()) - timedelta(days=30),
        membership_end=end,
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _bridge_command(installation, member: Member, *, status: str = "pending") -> BridgeCommand:
    command = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type="disable_user",
        enroll_number=member.device_enroll_number,
        member_name=member.full_name,
        status=status,
        last_error="terminal offline" if status == "failed" else None,
    )
    db.session.add(command)
    db.session.commit()
    return command


def _adms_integration(gym_id: int, *, serial: str, token: str) -> RRRIntegration:
    integration = RRRIntegration(
        gym_id=gym_id,
        connector_type="adms_direct",
        display_name="Stale guard ADMS",
        device_serial=serial,
        device_name="Stale guard X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(integration)
    db.session.commit()
    return integration


def test_bridge_lease_cancels_stale_disables_but_serves_freeze(seed_gym, seed_member):
    installation = _installation(seed_gym["gym"].id)
    today = date.today()

    # Ordinary renewed/active member (the original regression-test case).
    active = db.session.get(Member, seed_member.id)
    active.device_enroll_number = "42"
    active.status = "active"
    active.membership_end = today + timedelta(days=30)
    db.session.commit()
    active_command = _bridge_command(installation, active)

    # The incident population: stored status diverged from the dates.
    diverged = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Diverged Status",
        phone="+919100000043",
        enroll="43",
        status="expired",
        end=today + timedelta(days=11),
    )
    diverged_command = _bridge_command(installation, diverged)

    # Freeze is a deliberate hold: future end date, but the disable is real.
    paused = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Paused Member",
        phone="+919100000044",
        enroll="44",
        status="paused",
        end=today + timedelta(days=30),
    )
    paused_command = _bridge_command(installation, paused)

    leased = lease_pending_commands(installation)
    db.session.commit()

    assert [command.id for command in leased] == [paused_command.id]
    assert db.session.get(BridgeCommand, paused_command.id).status == "leased"
    for stale in (active_command, diverged_command):
        saved = db.session.get(BridgeCommand, stale.id)
        assert saved.status == "failed"
        assert saved.last_error.startswith(STALE_DISABLE_MARKER)


def test_adms_getrequest_cancels_stale_block_but_serves_freeze(client, seed_gym, seed_member):
    integration = _adms_integration(
        seed_gym["gym"].id, serial="STALE-GUARD-X2008", token="stale-guard-token"
    )
    today = date.today()

    diverged = db.session.get(Member, seed_member.id)
    diverged.device_enroll_number = "42"
    diverged.status = "expired"
    diverged.membership_end = today + timedelta(days=11)
    db.session.commit()

    paused = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Paused ADMS Member",
        phone="+919100000045",
        enroll="45",
        status="paused",
        end=today + timedelta(days=30),
    )

    stale_command = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        action="block",
        test_enroll_number="42",
        command_text="DATA DELETE USERINFO PIN=42",
        status="queued",
    )
    paused_command = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        action="block",
        test_enroll_number=paused.device_enroll_number,
        command_text="DATA DELETE USERINFO PIN=45",
        status="queued",
    )
    db.session.add_all([stale_command, paused_command])
    db.session.commit()

    response = client.get(
        f"/iclock/stale-guard-token/getrequest?SN=STALE-GUARD-X2008"
    )

    assert response.status_code == 200
    assert response.get_data(as_text=True) == (
        f"C:{paused_command.id}:DATA DELETE USERINFO PIN=45\n"
    )
    saved_stale = db.session.get(RRRAdmsCommand, stale_command.id)
    assert saved_stale.status == "failed"
    assert saved_stale.result_code == STALE_DISABLE_MARKER
    assert db.session.get(RRRAdmsCommand, paused_command.id).status == "delivered"


def test_reconciliation_requires_status_expired_and_past_end(app, seed_gym):
    today = date.today()
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id

    # ADMS gym (the seed gym): one diverged member, one genuinely expired.
    integration = _adms_integration(
        gym.id, serial="RECONCILE-X2008", token="reconcile-token"
    )
    _member(
        gym.id, plan_id, name="ADMS Future", phone="+919100000051",
        enroll="51", status="expired", end=today + timedelta(days=11),
    )
    adms_past = _member(
        gym.id, plan_id, name="ADMS Past", phone="+919100000052",
        enroll="52", status="expired", end=today - timedelta(days=1),
    )

    # Legacy bridge gym: same pair, exercised through the 95e0aa2 branch.
    bridge_gym = Gym(name="Bridge Reconcile Gym", slug="bridge-reconcile-gym")
    db.session.add(bridge_gym)
    db.session.commit()
    installation = _installation(bridge_gym.id, "RECONCILE-BRIDGE-01")
    _member(
        bridge_gym.id, None, name="Bridge Future", phone="+919100000053",
        enroll="53", status="expired", end=today + timedelta(days=11),
    )
    bridge_past = _member(
        bridge_gym.id, None, name="Bridge Past", phone="+919100000054",
        enroll="54", status="expired", end=today - timedelta(days=1),
    )

    _scheduled_reminder_job(app)

    adms_commands = RRRAdmsCommand.query.filter_by(integration_id=integration.id).all()
    assert [(cmd.action, cmd.test_enroll_number) for cmd in adms_commands] == [
        ("block", adms_past.device_enroll_number)
    ]

    bridge_commands = BridgeCommand.query.filter_by(bridge_id=installation.id).all()
    assert [(cmd.command_type, cmd.member_id) for cmd in bridge_commands] == [
        ("disable_user", bridge_past.id)
    ]


def test_bridge_lease_failsafe_active_past_and_null_end(seed_gym):
    """Final-invariant edge cases at the bridge lease (fail-open for blocks).

    (a) status=active + end PAST -> cancelled (plain desired-state would
        have served this disable; the invariant forbids it);
    (b) status=expired + end NULL -> cancelled (ambiguous data dies);
    (c) status=expired + end PAST -> served (the legitimate block).
    """
    installation = _installation(seed_gym["gym"].id, "FAILSAFE-BRIDGE-01")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()

    active_past = _member(
        gym_id, plan_id, name="Active Past End", phone="+919100000071",
        enroll="71", status="active", end=today - timedelta(days=5),
    )
    active_past_command = _bridge_command(installation, active_past)

    null_end = _member(
        gym_id, plan_id, name="Expired Null End", phone="+919100000072",
        enroll="72", status="expired", end=None,
    )
    null_end_command = _bridge_command(installation, null_end)

    expired_past = _member(
        gym_id, plan_id, name="Expired Past End", phone="+919100000073",
        enroll="73", status="expired", end=today - timedelta(days=5),
    )
    expired_past_command = _bridge_command(installation, expired_past)

    leased = lease_pending_commands(installation)
    db.session.commit()

    assert [command.id for command in leased] == [expired_past_command.id]
    for cancelled in (active_past_command, null_end_command):
        saved = db.session.get(BridgeCommand, cancelled.id)
        assert saved.status == "failed"
        assert saved.last_error.startswith(STALE_DISABLE_MARKER)


def test_adms_getrequest_failsafe_active_past_and_null_end(client, seed_gym):
    """Same fail-safe edges on the ADMS transport: only expired+past serves."""
    integration = _adms_integration(
        seed_gym["gym"].id, serial="FAILSAFE-X2008", token="failsafe-token"
    )
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()

    cases = [
        ("Active Past End", "+919100000081", "81", "active", today - timedelta(days=5)),
        ("Expired Null End", "+919100000082", "82", "expired", None),
        ("Expired Past End", "+919100000083", "83", "expired", today - timedelta(days=5)),
    ]
    commands = []
    for name, phone, enroll, status, end in cases:
        member = _member(
            gym_id, plan_id, name=name, phone=phone,
            enroll=enroll, status=status, end=end,
        )
        command = RRRAdmsCommand(
            gym_id=gym_id,
            integration_id=integration.id,
            action="block",
            test_enroll_number=member.device_enroll_number,
            command_text=f"DATA DELETE USERINFO PIN={enroll}",
            status="queued",
        )
        db.session.add(command)
        db.session.commit()
        commands.append(command)

    response = client.get("/iclock/failsafe-token/getrequest?SN=FAILSAFE-X2008")

    assert response.status_code == 200
    # The two unproven blocks are cancelled in ID order; the genuinely
    # expired member's block is the one served.
    assert response.get_data(as_text=True) == (
        f"C:{commands[2].id}:DATA DELETE USERINFO PIN=83\n"
    )
    for cancelled in commands[:2]:
        saved = db.session.get(RRRAdmsCommand, cancelled.id)
        assert saved.status == "failed"
        assert saved.result_code == STALE_DISABLE_MARKER
    assert db.session.get(RRRAdmsCommand, commands[2].id).status == "delivered"


def test_retry_sync_does_not_resurrect_stale_disables(client, seed_gym, seed_member):
    installation = _installation(seed_gym["gym"].id)
    today = date.today()

    active = db.session.get(Member, seed_member.id)
    active.device_enroll_number = "42"
    active.status = "active"
    active.membership_end = today + timedelta(days=30)
    db.session.commit()
    active_command = _bridge_command(installation, active, status="failed")

    diverged = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Diverged Retry",
        phone="+919100000063",
        enroll="63",
        status="expired",
        end=today + timedelta(days=11),
    )
    diverged_command = _bridge_command(installation, diverged, status="failed")

    expired = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Genuinely Expired",
        phone="+919100000064",
        enroll="64",
        status="expired",
        end=today - timedelta(days=1),
    )
    expired_command = _bridge_command(installation, expired, status="failed")

    # Fail-safe retry edges: active with a PAST end and expired with a NULL
    # end are both unproven — their failed disables must not flip either.
    active_past = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Active Past Retry",
        phone="+919100000065",
        enroll="65",
        status="active",
        end=today - timedelta(days=5),
    )
    active_past_command = _bridge_command(installation, active_past, status="failed")

    null_end = _member(
        seed_gym["gym"].id,
        seed_gym["plan"].id,
        name="Null End Retry",
        phone="+919100000066",
        enroll="66",
        status="expired",
        end=None,
    )
    null_end_command = _bridge_command(installation, null_end, status="failed")

    owner = seed_gym["owner"]
    headers = {
        "Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, owner.role)}"
    }
    response = client.post("/api/mobile/v1/access/retry-sync", headers=headers)

    assert response.status_code == 200
    assert response.get_json()["data"]["retried_count"] == 1
    assert db.session.get(BridgeCommand, active_command.id).status == "failed"
    assert db.session.get(BridgeCommand, diverged_command.id).status == "failed"
    assert db.session.get(BridgeCommand, active_past_command.id).status == "failed"
    assert db.session.get(BridgeCommand, null_end_command.id).status == "failed"
    assert db.session.get(BridgeCommand, expired_command.id).status == "pending"
