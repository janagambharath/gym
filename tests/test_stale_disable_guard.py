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


# ── Guard-extension batch (2026-10-24): C2 / H8 / M2 / H6 ─────────────

def _adms_command(integration, action, enroll, text):
    command = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=text,
        status="queued",
    )
    db.session.add(command)
    db.session.commit()
    return command


def test_adms_getrequest_cancels_test_deletes_for_active_member(client, seed_gym):
    """C2: block_test / template-delete tests cancel exactly like block."""
    integration = _adms_integration(
        seed_gym["gym"].id, serial="C2-X2008", token="c2-token"
    )
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()
    active = _member(
        gym_id, plan_id, name="Active Test Delete", phone="+919100000101",
        enroll="101", status="active", end=today + timedelta(days=30),
    )
    paused = _member(
        gym_id, plan_id, name="Paused Test Delete", phone="+919100000102",
        enroll="102", status="paused", end=today + timedelta(days=30),
    )
    test_cmds = [
        _adms_command(integration, "block_test", "101", "DATA DELETE USERINFO PIN=101"),
        _adms_command(integration, "delete_biodata_test", "101", "DATA DELETE FINGERTMP PIN=101"),
        _adms_command(integration, "delete_fingertmp_test", "101", "DATA DELETE FINGERTMP PIN=101\tFID=0"),
    ]
    legit = _adms_command(integration, "block", "102", "DATA DELETE USERINFO PIN=102")

    response = client.get("/iclock/c2-token/getrequest?SN=C2-X2008")
    assert response.status_code == 200
    assert response.get_data(as_text=True) == f"C:{legit.id}:DATA DELETE USERINFO PIN=102\n"
    for cmd in test_cmds:
        saved = db.session.get(RRRAdmsCommand, cmd.id)
        assert saved.status == "failed"
        assert saved.result_code == STALE_DISABLE_MARKER


def test_adms_getrequest_wire_text_delete_fallback(client, seed_gym):
    """C2 defence-in-depth: a DELETE wire under any action name cancels."""
    integration = _adms_integration(
        seed_gym["gym"].id, serial="C2W-X2008", token="c2w-token"
    )
    today = date.today()
    _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active Wire Fallback",
        phone="+919100000103", enroll="103", status="active",
        end=today + timedelta(days=30),
    )
    sneaky = _adms_command(integration, "probe_info", "103", "DATA DELETE USERINFO PIN=103")
    response = client.get("/iclock/c2w-token/getrequest?SN=C2W-X2008")
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "OK"
    saved = db.session.get(RRRAdmsCommand, sneaky.id)
    assert saved.status == "failed"
    assert saved.result_code == STALE_DISABLE_MARKER


def test_adms_getrequest_cancels_stale_enable_but_serves_active(client, seed_gym):
    """H8: unblock/create for an expired member cancels; active serves."""
    from app.services.bridge_service import STALE_ENABLE_MARKER

    integration = _adms_integration(
        seed_gym["gym"].id, serial="H8-X2008", token="h8-token"
    )
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()
    expired = _member(
        gym_id, plan_id, name="Expired Enable", phone="+919100000104",
        enroll="104", status="expired", end=today - timedelta(days=1),
    )
    active = _member(
        gym_id, plan_id, name="Active Enable", phone="+919100000105",
        enroll="105", status="active", end=today + timedelta(days=30),
    )
    stale_unblock = _adms_command(
        integration, "unblock", "104", "DATA UPDATE USERINFO PIN=104\tName=Expired Enable\tPri=0")
    stale_create = _adms_command(
        integration, "create_user", "104", "DATA UPDATE USERINFO PIN=104\tName=Expired Enable\tPri=0")
    legit_unblock = _adms_command(
        integration, "unblock", "105", "DATA UPDATE USERINFO PIN=105\tName=Active Enable\tPri=0")

    response = client.get("/iclock/h8-token/getrequest?SN=H8-X2008")
    assert response.status_code == 200
    assert response.get_data(as_text=True) == (
        f"C:{legit_unblock.id}:DATA UPDATE USERINFO PIN=105\tName=Active Enable\tPri=0\n"
    )
    for cmd in (stale_unblock, stale_create):
        saved = db.session.get(RRRAdmsCommand, cmd.id)
        assert saved.status == "failed"
        assert saved.result_code == STALE_ENABLE_MARKER


def test_bridge_lease_cancels_stale_enable_but_serves_active(seed_gym):
    """H8 on the bridge path: enable/create/set_valid_date need an active member."""
    from app.services.bridge_service import STALE_ENABLE_MARKER

    installation = _installation(seed_gym["gym"].id, "H8-BRIDGE-01")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()
    expired = _member(
        gym_id, plan_id, name="Expired Bridge Enable", phone="+919100000106",
        enroll="106", status="expired", end=today - timedelta(days=1),
    )
    active = _member(
        gym_id, plan_id, name="Active Bridge Enable", phone="+919100000107",
        enroll="107", status="active", end=today + timedelta(days=30),
    )

    def _cmd(member, command_type):
        command = BridgeCommand(
            bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
            command_type=command_type, enroll_number=member.device_enroll_number,
            member_name=member.full_name, status="pending",
        )
        db.session.add(command)
        db.session.commit()
        return command

    stale_enable = _cmd(expired, "enable_user")
    stale_create = _cmd(expired, "create_user")
    legit_enable = _cmd(active, "enable_user")

    leased = lease_pending_commands(installation)
    db.session.commit()
    assert [c.id for c in leased] == [legit_enable.id]
    for cmd in (stale_enable, stale_create):
        saved = db.session.get(BridgeCommand, cmd.id)
        assert saved.status == "failed"
        assert saved.last_error.startswith(STALE_ENABLE_MARKER)


def test_retry_sync_does_not_resurrect_stale_enable(client, seed_gym):
    """H8 at a retry endpoint: a failed stale enable stays failed."""
    from app.services.bridge_service import STALE_ENABLE_MARKER

    installation = _installation(seed_gym["gym"].id, "H8-RETRY-BRIDGE-01")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()
    expired = _member(
        gym_id, plan_id, name="Expired Retry Enable", phone="+919100000108",
        enroll="108", status="expired", end=today - timedelta(days=1),
    )
    active = _member(
        gym_id, plan_id, name="Active Retry Enable", phone="+919100000109",
        enroll="109", status="active", end=today + timedelta(days=30),
    )

    def _failed(member):
        command = BridgeCommand(
            bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
            command_type="enable_user", enroll_number=member.device_enroll_number,
            member_name=member.full_name, status="failed", last_error="terminal offline",
        )
        db.session.add(command)
        db.session.commit()
        return command

    stale = _failed(expired)
    legit = _failed(active)
    owner = seed_gym["owner"]
    headers = {
        "Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, owner.role)}"
    }
    response = client.post("/api/mobile/v1/access/retry-sync", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["data"]["retried_count"] == 1
    saved_stale = db.session.get(BridgeCommand, stale.id)
    assert saved_stale.status == "failed"
    assert saved_stale.last_error.startswith(STALE_ENABLE_MARKER)
    assert db.session.get(BridgeCommand, legit.id).status == "pending"


def test_cross_gym_member_reference_never_resolves(seed_gym):
    """M2: a member_id/mapping belonging to another gym is unresolvable here."""
    from app.models.rrr import RRRIdentityMapping
    from app.services.bridge_service import (
        bridge_command_must_be_cancelled,
        resolve_adms_member,
    )
    from app.services.rrr_service import _mapped_member

    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    other_gym = Gym(name="Other Gym M2", slug="other-gym-m2")
    db.session.add(other_gym)
    db.session.commit()
    other_member = _member(
        other_gym.id, None, name="Other Gym Member", phone="+919100000110",
        enroll="110", status="active", end=date.today() + timedelta(days=30),
    )
    # A mapping row scoped to THIS gym but pointing at the other gym's member.
    mapping = RRRIdentityMapping(
        gym_id=gym_id, external_id="110", member_id=other_member.id, status="confirmed"
    )
    db.session.add(mapping)
    db.session.commit()

    assert resolve_adms_member(gym_id, "110") is None
    assert _mapped_member(gym_id, "110") is None

    installation = _installation(gym_id, "M2-BRIDGE-01")
    cross_cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=other_member.id,
        command_type="disable_user", enroll_number="110",
        member_name=other_member.full_name, status="pending",
    )
    db.session.add(cross_cmd)
    db.session.commit()
    # Cross-gym reference is unproven -> the disable must be cancelled.
    assert bridge_command_must_be_cancelled(cross_cmd) is True


def test_settings_bridge_command_validates_member_scope(client, seed_gym):
    """H6: queue-time existence + gym scope only — no blockable check."""
    installation = _installation(seed_gym["gym"].id, "H6-BRIDGE-01")
    gym_id, plan_id = seed_gym["gym"].id, seed_gym["plan"].id
    today = date.today()
    active = _member(
        gym_id, plan_id, name="Active Settings Member", phone="+919100000111",
        enroll="111", status="active", end=today + timedelta(days=30),
    )
    other_gym = Gym(name="Other Gym H6", slug="other-gym-h6")
    db.session.add(other_gym)
    db.session.commit()
    other_member = _member(
        other_gym.id, None, name="Other Gym H6 Member", phone="+919100000112",
        enroll="112", status="active", end=today + timedelta(days=30),
    )
    owner = seed_gym["owner"]
    headers = {
        "Authorization": f"Bearer {create_access_token(owner.id, gym_id, owner.role)}"
    }
    url = "/api/mobile/v1/settings/bridge/commands"

    # Unknown enroll -> 422, nothing queued.
    response = client.post(url, headers=headers, json={
        "command_type": "disable_user", "enroll_number": "999"})
    assert response.status_code == 422
    # Other gym's member_id -> 422.
    response = client.post(url, headers=headers, json={
        "command_type": "disable_user", "member_id": other_member.id})
    assert response.status_code == 422
    # member_id/enroll mismatch -> 422.
    response = client.post(url, headers=headers, json={
        "command_type": "disable_user", "member_id": active.id, "enroll_number": "112"})
    assert response.status_code == 422
    # Valid own-gym member queues — including a disable for an ACTIVE
    # member: queue-time validation is existence/scope only, the
    # serve-time guard remains the decider (it will cancel at lease).
    response = client.post(url, headers=headers, json={
        "command_type": "disable_user", "enroll_number": "111"})
    assert response.status_code == 201
    assert response.get_json()["data"]["enroll_number"] == "111"
    assert response.get_json()["data"]["member_name"] == "Active Settings Member"
    # member_id-only call fills the enroll number from the member.
    response = client.post(url, headers=headers, json={
        "command_type": "enable_user", "member_id": active.id})
    assert response.status_code == 201
    assert response.get_json()["data"]["enroll_number"] == "111"
