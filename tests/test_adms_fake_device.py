"""Fake-device harness for the direct-ADMS integration.

Simulates an eSSL/ZK-style terminal's HTTP exchanges (init/GET OPTION,
ATTLOG POST, OPERLOG POST, USERINFO POST, getrequest polling, devicecmd ack)
against the Flask test client.  NOTHING here touches a physical terminal,
production data, or real biometrics: every serial, enroll number, member
name and phone is synthetic, and no fingerprint template, PIN, credential
or secret appears anywhere in this file.

Covered (the riskiest previously-unverified protocol paths):

* init/GET OPTION reply, including the TransFlag line added by commit
  4113d78 (``TransData AttLog OpLog EnrollUser ChgUser``);
* OPERLOG enrollment auto-link on a fresh enrollment (active member: link
  with no redundant command; expired member: link plus a block command);
* OPERLOG lines that are NOT enrollment records (ignored);
* getrequest serving order: delivered-before-queued re-send, iteration past
  a first candidate cancelled by the fail-safe guard, and the 10-minute ack
  timeout moving the queue on;
* devicecmd ack semantics for reversible USERINFO Group updates;
* ATTLOG dedup/replay (same punch twice -> one event);
* USERINFO sync_users round-trip, and a USERINFO upload with no outstanding
  sync_users command (harmless no-op).

The fail-safe guard is NEVER weakened here: every block served in these
tests belongs to a proven-blockable member (paused, or expired with a past
end date); stale blocks are expected to be cancelled, not served.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.models import Member
from app.models.rrr import RRRAdmsCommand, RRRDevice, RRRIntegration
from app.mobile_api.token_service import create_access_token
from app.services.bridge_service import STALE_DISABLE_MARKER, adms_command_text

FAKE_SERIAL = "FAKE-TEST-X2008"
FAKE_TOKEN = "fake-test-token"


def _integration(seed_gym, *, serial=FAKE_SERIAL, token=FAKE_TOKEN):
    gym = seed_gym["gym"]
    row = RRRIntegration(
        gym_id=gym.id,
        connector_type="adms_direct",
        display_name="Fake device ADMS",
        device_serial=serial,
        device_name="Fake Test X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _member(seed_gym, *, name, phone, enroll, status, end):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
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


def _command(integration, gym_id, *, action, enroll, text, status="queued",
             delivered_at=None):
    cmd = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=text,
        status=status,
        delivered_at=delivered_at,
    )
    db.session.add(cmd)
    db.session.commit()
    return cmd


def _cdata(token, serial, table=None):
    url = f"/iclock/{token}/cdata?SN={serial}"
    if table:
        url += f"&table={table}"
    return url


def _getrequest(token, serial):
    return f"/iclock/{token}/getrequest?SN={serial}"


def _devicecmd(token, serial, cmd_id, ret):
    return f"/iclock/{token}/devicecmd?SN={serial}&ID={cmd_id}&Return={ret}"


# ─── init / GET OPTION ─────────────────────────────────────────────────────

def test_init_get_returns_transflag_advertising_operlog_enroll(client, seed_gym):
    _integration(seed_gym)
    response = client.get(_cdata(FAKE_TOKEN, FAKE_SERIAL))
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    # Spec (PUSH SDK §4/§5): first line MUST be "GET OPTION FROM: <SN>" —
    # without it a strict firmware never starts its getrequest poll loop.
    assert body.startswith(f"GET OPTION FROM: {FAKE_SERIAL}\r\n")
    assert "ErrorDelay=60\r\n" in body
    assert "Delay=30\r\n" in body
    # Commit 4113d78: the terminal must be told to auto-upload OpLog and
    # user enroll/change records, or OPERLOG enrollments never arrive.
    assert "TransFlag=TransData\tAttLog\tOpLog\tEnrollUser\tChgUser\r\n" in body
    assert "Realtime=1\r\n" in body


def test_unknown_and_mismatched_devices_get_indistinguishable_ok(client, seed_gym):
    _integration(seed_gym)
    assert client.get(f"/iclock/cdata?SN=UNKNOWN-SERIAL").get_data(as_text=True) == "OK"
    assert client.get(_cdata(FAKE_TOKEN, "WRONG-SERIAL")).get_data(as_text=True) == "OK"
    # No device row is created for a serial that never authenticated.
    assert RRRDevice.query.filter_by(serial_number="UNKNOWN-SERIAL").count() == 0
    assert RRRDevice.query.filter_by(serial_number="WRONG-SERIAL").count() == 0
    assert RRRAdmsCommand.query.count() == 0


# ─── OPERLOG enrollment auto-link ──────────────────────────────────────────

def test_operlog_enrollment_auto_links_active_member_without_command(
    client, seed_gym, seed_member
):
    integration = _integration(seed_gym)
    # seed_member is "John Doe", active, no terminal identity yet.
    assert seed_member.device_enroll_number is None
    body = "PIN=901\tName=John Doe\tPri=0\tPasswd=\tCard=\tGrp=1\n"
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "OPERLOG"),
        data=body, content_type="text/plain",
    )
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "OK"

    linked = db.session.get(Member, seed_member.id)
    assert linked.device_enroll_number == "901"
    snapshot = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="operlog_snapshot").one()
    users = json.loads(snapshot.result_data)["users"]
    assert {"enroll_number": "901", "name": "John Doe"} in users
    # Active member + fresh enrollment: the terminal already holds the
    # correct state, so no redundant block/unblock command is queued.
    assert RRRAdmsCommand.query.filter(
        RRRAdmsCommand.integration_id == integration.id,
        RRRAdmsCommand.action.in_(["block", "unblock"]),
    ).count() == 0


def test_operlog_enrollment_links_and_blocks_expired_member(client, seed_gym):
    integration = _integration(seed_gym)
    member = _member(
        seed_gym, name="Fake Expired User", phone="+919100009001", enroll=None,
        status="expired", end=date.today() - timedelta(days=1),
    )
    body = "PIN=902\tName=Fake Expired User\tPri=0\tPasswd=\tCard=\tGrp=1\n"
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "OPERLOG"),
        data=body, content_type="text/plain",
    )
    assert response.status_code == 200

    assert db.session.get(Member, member.id).device_enroll_number == "902"
    cmd = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="block",
        test_enroll_number="902").one()
    assert cmd.status == "queued"
    assert cmd.command_text == "DATA UPDATE USERINFO PIN=902\tName=Fake Expired User\tGrp=100"


def test_operlog_non_enrollment_lines_are_ignored(client, seed_gym, seed_member):
    _integration(seed_gym)
    body = (
        "PIN=903\tName=No Pri Here\tGrp=1\n"          # no PRI= -> not enrollment
        "OPLOG admin PIN=904\tSomething=1\n"          # no NAME=/PRI= -> ignored
    )
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "OPERLOG"),
        data=body, content_type="text/plain",
    )
    assert response.status_code == 200
    assert RRRAdmsCommand.query.count() == 0
    assert db.session.get(Member, seed_member.id).device_enroll_number is None


# ─── ATTLOG dedup / replay ─────────────────────────────────────────────────

def test_attlog_replay_dedupes_to_one_event(client, seed_gym, seed_member):
    integration = _integration(seed_gym)
    seed_member.device_enroll_number = "905"
    db.session.commit()
    line = "905\t2026-10-24 10:00:00\t0\t1"
    for _ in range(2):  # terminal retries / replays the same punch
        response = client.post(
            _cdata(FAKE_TOKEN, FAKE_SERIAL, "ATTLOG"),
            data=line, content_type="text/plain",
        )
        assert response.status_code == 200
    from app.models.rrr import RRRAttendanceEvent
    events = RRRAttendanceEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, biometric_user_id="905").all()
    assert len(events) == 1
    assert events[0].processing_status == "processed"
    assert events[0].member_id == seed_member.id
    assert db.session.get(RRRIntegration, integration.id).records_synced == 1


def test_attlog_unmapped_replay_counts_once(client, seed_gym):
    integration = _integration(seed_gym)
    line = "999\t2026-10-24 10:05:00\t0\t1"
    for _ in range(2):
        assert client.post(
            _cdata(FAKE_TOKEN, FAKE_SERIAL, "ATTLOG"),
            data=line, content_type="text/plain",
        ).status_code == 200
    from app.models.rrr import RRRAttendanceEvent
    events = RRRAttendanceEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, biometric_user_id="999").all()
    assert len(events) == 1
    assert events[0].processing_status == "unmapped"
    assert db.session.get(RRRIntegration, integration.id).unmapped_records == 1


# ─── getrequest serving order, guard iteration, ack timeout ────────────────

def test_getrequest_resends_delivered_before_queued_then_advances_on_ack(
    client, seed_gym
):
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    paused = _member(
        seed_gym, name="Fake Paused One", phone="+919100009010", enroll="910",
        status="paused", end=date.today() + timedelta(days=30),
    )
    active = _member(
        seed_gym, name="Fake Active One", phone="+919100009011", enroll="911",
        status="active", end=date.today() + timedelta(days=30),
    )
    block = _command(
        integration, gym_id, action="block", enroll="910",
        text=adms_command_text("block", "910", member_name="Fake Paused One"), status="delivered",
        delivered_at=datetime.now(timezone.utc),
    )
    unblock = _command(
        integration, gym_id, action="unblock", enroll="911",
        text=adms_command_text("unblock", "911", member_name="Fake Active One"),
        status="queued",
    )
    # Delivered-before-queued: the in-flight block is re-served first.
    first = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert first.get_data(as_text=True) == f"C:{block.id}:{block.command_text}\n"
    assert db.session.get(RRRAdmsCommand, unblock.id).status == "queued"

    # Terminal acks the block; the next poll advances to the queued unblock.
    ack = client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, block.id, 0))
    assert ack.status_code == 200
    assert db.session.get(RRRAdmsCommand, block.id).status == "acked"
    second = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert second.get_data(as_text=True) == (
        f"C:{unblock.id}:{unblock.command_text}\n"
    )
    assert db.session.get(RRRAdmsCommand, unblock.id).status == "delivered"


def test_getrequest_skips_cancelled_first_candidate_to_next_servable(
    client, seed_gym
):
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    active = _member(
        seed_gym, name="Fake Active Two", phone="+919100009020", enroll="920",
        status="active", end=date.today() + timedelta(days=30),
    )
    paused = _member(
        seed_gym, name="Fake Paused Two", phone="+919100009021", enroll="921",
        status="paused", end=date.today() + timedelta(days=30),
    )
    _member(
        seed_gym, name="Fake Active Three", phone="+919100009022", enroll="922",
        status="active", end=date.today() + timedelta(days=30),
    )
    stale = _command(
        integration, gym_id, action="block", enroll="920",
        text=adms_command_text("block", "920", member_name="Fake Active Two"), status="queued",
    )
    freeze = _command(
        integration, gym_id, action="block", enroll="921",
        text=adms_command_text("block", "921", member_name="Fake Paused Two"), status="queued",
    )
    unblock = _command(
        integration, gym_id, action="unblock", enroll="922",
        text=adms_command_text("unblock", "922", member_name="Fake Active Three"),
        status="queued",
    )
    # First candidate is an ACTIVE member's block: cancelled in place, and
    # the same poll still serves the next (paused/freeze) command.
    first = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert first.get_data(as_text=True) == f"C:{freeze.id}:{freeze.command_text}\n"
    saved_stale = db.session.get(RRRAdmsCommand, stale.id)
    assert saved_stale.status == "cancelled"
    assert saved_stale.result_code == STALE_DISABLE_MARKER

    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, freeze.id, 0))
    second = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert second.get_data(as_text=True) == (
        f"C:{unblock.id}:{unblock.command_text}\n"
    )


def test_getrequest_group_test_requires_confirmed_fake_member_and_name(
    client, seed_gym
):
    """Safe Group tests serve an unlinked fake ID; a member ID needs an
    explicitly confirmed match and its exact current terminal name."""
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    _member(
        seed_gym, name="Fake Real Member", phone="+919100009030", enroll="930",
        status="active", end=date.today() + timedelta(days=30),
    )
    ghost_block = _command(
        integration, gym_id, action="essl_group_block_test", enroll="999",
        text=adms_command_text("essl_group_block_test", "999", member_name="Test Fake"), status="queued",
    )
    trapped_block = _command(
        integration, gym_id, action="essl_group_block_test", enroll="930",
        text=adms_command_text("essl_group_block_test", "930", member_name="Fake Real Member"), status="queued",
    )
    ghost_unblock = _command(
        integration, gym_id, action="essl_group_unblock_test", enroll="998",
        text=adms_command_text("essl_group_unblock_test", "998", member_name="Test Fake"),
        status="queued",
    )
    # Terminal-local 999: no member row -> served.
    first = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert first.get_data(as_text=True) == f"C:{ghost_block.id}:{ghost_block.command_text}\n"
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, ghost_block.id, 0))
    # 930 belongs to a real member -> cancelled in place, never served.
    second = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert second.get_data(as_text=True) == (
        f"C:{ghost_unblock.id}:{ghost_unblock.command_text}\n"
    )
    saved_trapped = db.session.get(RRRAdmsCommand, trapped_block.id)
    assert saved_trapped.status == "cancelled"
    assert "explicitly confirmed fake account" in (saved_trapped.result_message or "")


def test_getrequest_timeout_fails_stuck_command_and_moves_on(client, seed_gym):
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    _member(
        seed_gym, name="Fake Paused Three", phone="+919100009030", enroll="930",
        status="paused", end=date.today() + timedelta(days=30),
    )
    _member(
        seed_gym, name="Fake Active Four", phone="+919100009031", enroll="931",
        status="active", end=date.today() + timedelta(days=30),
    )
    stuck = _command(
        integration, gym_id, action="block", enroll="930",
        text=adms_command_text("block", "930", member_name="Fake Paused Three"), status="delivered",
        delivered_at=datetime.now(timezone.utc) - timedelta(minutes=11),
    )
    nxt = _command(
        integration, gym_id, action="unblock", enroll="931",
        text=adms_command_text("unblock", "931", member_name="Fake Active Four"),
        status="queued",
    )
    # No retry counter exists in the code: the 10-minute ack timeout IS the
    # retry-exhaustion mechanism. The stuck command fails terminally and
    # the queue moves to the next command instead of stalling behind it.
    response = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert response.get_data(as_text=True) == f"C:{nxt.id}:{nxt.command_text}\n"
    saved = db.session.get(RRRAdmsCommand, stuck.id)
    assert saved.status == "failed"
    assert saved.result_message == "Timeout: no ack within 10 min"
    # A later poll never resurrects the timed-out command.
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, nxt.id, 0))
    assert client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL)).get_data(as_text=True) == "OK"
    assert db.session.get(RRRAdmsCommand, stuck.id).status == "failed"


# ─── devicecmd ack semantics ───────────────────────────────────────────────

def test_devicecmd_ack_semantics(client, seed_gym):
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    ok_cmd = _command(
        integration, gym_id, action="block", enroll="940",
        text=adms_command_text("block", "940", member_name="Fake Block User"), status="delivered",
        delivered_at=datetime.now(timezone.utc),
    )
    absent_cmd = _command(
        integration, gym_id, action="block", enroll="941",
        text=adms_command_text("block", "941", member_name="Fake Block User"), status="delivered",
        delivered_at=datetime.now(timezone.utc),
    )
    fail_cmd = _command(
        integration, gym_id, action="block", enroll="942",
        text=adms_command_text("block", "942", member_name="Fake Block User"), status="delivered",
        delivered_at=datetime.now(timezone.utc),
    )
    unblock_absent = _command(
        integration, gym_id, action="unblock", enroll="943",
        text=adms_command_text("unblock", "943", member_name="Fake Active Five"),
        status="delivered", delivered_at=datetime.now(timezone.utc),
    )
    assert client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, ok_cmd.id, 0)).status_code == 200
    assert db.session.get(RRRAdmsCommand, ok_cmd.id).status == "acked"

    # Group updates never use DELETE's "already absent" success semantics.
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, absent_cmd.id, -1))
    saved = db.session.get(RRRAdmsCommand, absent_cmd.id)
    assert saved.status == "failed"

    # Any other non-zero result fails.
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, fail_cmd.id, 3))
    assert db.session.get(RRRAdmsCommand, fail_cmd.id).status == "failed"

    # A non-zero device result also fails an unblock.
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, unblock_absent.id, -1))
    assert db.session.get(RRRAdmsCommand, unblock_absent.id).status == "failed"

    # Unknown command id: indistinguishable OK, no crash.
    assert client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, 999999, 0)).status_code == 200


def test_member_profile_access_block_and_unblock_reach_direct_adms_and_refresh_state(
    client, seed_gym
):
    """Exercise the same member-profile route and device poll the apps use."""
    integration = _integration(seed_gym)
    member = _member(
        seed_gym, name="Fake Profile Member", phone="+919100009099", enroll="990",
        status="active", end=date.today() + timedelta(days=30),
    )
    owner = seed_gym["owner"]
    headers = {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, owner.role)}"}

    blocked = client.post(
        f"/api/mobile/v1/rrr/members/{member.id}/access",
        headers=headers,
        json={"action": "block"},
    )
    assert blocked.status_code == 201
    block_command = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="block", test_enroll_number="990"
    ).one()
    assert block_command.command_text == (
        "DATA UPDATE USERINFO PIN=990\tName=Fake Profile Member\tGrp=100"
    )
    served_block = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert served_block.get_data(as_text=True) == f"C:{block_command.id}:{block_command.command_text}\n"
    pending_profile = client.get(
        f"/api/mobile/v1/members/{member.id}", headers=headers
    ).get_json()["data"]
    assert pending_profile["door_blocked"] is True
    assert pending_profile["door_access_pending"] is True
    assert pending_profile["door_access_pending_action"] == "block"

    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, block_command.id, 0))
    blocked_profile = client.get(
        f"/api/mobile/v1/members/{member.id}", headers=headers
    ).get_json()["data"]
    assert blocked_profile["door_blocked"] is True
    assert blocked_profile["door_access_pending"] is False

    unblocked = client.post(
        f"/api/mobile/v1/rrr/members/{member.id}/access",
        headers=headers,
        json={"action": "unblock"},
    )
    assert unblocked.status_code == 201
    unblock_command = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="unblock", test_enroll_number="990"
    ).one()
    served_unblock = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert served_unblock.get_data(as_text=True) == (
        f"C:{unblock_command.id}:{unblock_command.command_text}\n"
    )
    assert unblock_command.command_text == (
        "DATA UPDATE USERINFO PIN=990\tName=Fake Profile Member\tGrp=1"
    )
    client.get(_devicecmd(FAKE_TOKEN, FAKE_SERIAL, unblock_command.id, 0))
    restored_profile = client.get(
        f"/api/mobile/v1/members/{member.id}", headers=headers
    ).get_json()["data"]
    assert restored_profile["door_blocked"] is False
    assert restored_profile["door_access_pending"] is False


def test_historical_destructive_adms_command_is_cancelled_before_delivery(client, seed_gym):
    integration = _integration(seed_gym)
    old_delete = _command(
        integration, seed_gym["gym"].id, action="delete_user", enroll="991",
        text="DATA DELETE USERINFO PIN=991", status="queued",
    )
    response = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert response.get_data(as_text=True) == "OK"
    assert db.session.get(RRRAdmsCommand, old_delete.id).status == "cancelled"


# ─── USERINFO sync round-trip ──────────────────────────────────────────────

def test_sync_users_round_trip_via_getrequest_and_userinfo_upload(client, seed_gym):
    integration = _integration(seed_gym)
    gym_id = seed_gym["gym"].id
    cmd = _command(
        integration, gym_id, action="sync_users", enroll=None,
        text=adms_command_text("sync_users", None), status="queued",
    )
    assert cmd.command_text == "DATA QUERY USERINFO PIN=ALL"

    served = client.get(_getrequest(FAKE_TOKEN, FAKE_SERIAL))
    assert served.get_data(as_text=True) == f"C:{cmd.id}:DATA QUERY USERINFO PIN=ALL\n"
    assert db.session.get(RRRAdmsCommand, cmd.id).status == "delivered"

    body = (
        "USER PIN=950\tName=Fake Sync One\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
        "USER PIN=951\tName=Fake Sync Two\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
    )
    upload = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "USERINFO"),
        data=body, content_type="text/plain",
    )
    assert upload.status_code == 200
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "acked"
    data = json.loads(saved.result_data)
    assert data["count"] == 2
    assert {u["enroll_number"] for u in data["users"]} == {"950", "951"}


def test_userinfo_upload_without_sync_command_is_harmless(client, seed_gym):
    _integration(seed_gym)
    body = "USER PIN=960\tName=Fake Orphan User\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "USERINFO"),
        data=body, content_type="text/plain",
    )
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "OK"
    assert RRRAdmsCommand.query.count() == 0


# ─── OPERLOG fix regressions (M1) ──────────────────────────────────────────

def test_get_adms_snapshot_sees_operlog_users(client, seed_gym):
    """get_adms_snapshot() must surface OPERLOG enrollments even when no
    USERINFO sync_users snapshot exists (the X2008 never answers USERINFO
    queries). Previously the snapshot row failed the CHECK at commit, so
    this returned None and auto-link never ran."""
    from app.services.enroll_match_service import get_adms_snapshot

    integration = _integration(seed_gym)
    body = "PIN=907\tName=Fake Snapshot Only\tPri=0\tPasswd=\tCard=\tGrp=1\n"
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "OPERLOG"),
        data=body, content_type="text/plain",
    )
    assert response.status_code == 200
    snapshot = get_adms_snapshot(seed_gym["gym"].id)
    assert snapshot is not None
    assert {"enroll_number": "907", "name": "Fake Snapshot Only"} in snapshot["users"]
    assert snapshot["command_id"] == RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="operlog_snapshot").one().id


def test_operlog_snapshot_flush_failure_does_not_poison_session(seed_gym):
    """A snapshot flush failure must be contained in its SAVEPOINT: the
    upsert returns without raising, no snapshot row persists, and the
    session can still commit unrelated work afterwards. This is the
    regression for the pre-fix behaviour, where the CHECK failure surfaced
    at the cdata commit as a PendingRollbackError and lost the whole POST.

    The failure is simulated by making Session.flush raise IntegrityError
    only for the flush that carries the pending operlog_snapshot row
    (query-time autoflushes, with nothing pending, pass through).
    """
    from unittest.mock import patch

    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    from app.services.enroll_match_service import upsert_terminal_snapshot

    integration = _integration(seed_gym)
    orig_flush = Session.flush

    def flaky_flush(self, *args, **kwargs):
        pending_snapshot = any(
            isinstance(obj, RRRAdmsCommand) and obj.action == "operlog_snapshot"
            for obj in self.new
        )
        if pending_snapshot:
            raise IntegrityError(
                "INSERT INTO rrr_adms_commands", {},
                Exception("CHECK constraint failed: ck_rrr_adms_command_action"),
            )
        return orig_flush(self, *args, **kwargs)

    with patch.object(Session, "flush", flaky_flush):
        # Must not raise: the SAVEPOINT rollback + expunge contains it.
        upsert_terminal_snapshot(seed_gym["gym"].id, "908", "Fake Flaky User")

    assert RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="operlog_snapshot").count() == 0
    # The session is still usable for unrelated work after the failure.
    probe = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        action="probe_info",
        command_text="probe",
        status="queued",
    )
    db.session.add(probe)
    db.session.commit()
    assert db.session.get(RRRAdmsCommand, probe.id) is not None
