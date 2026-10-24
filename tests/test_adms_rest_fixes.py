"""Regression tests for the REMAINING-FINDINGS track (2026-10-24).

Covers H2/H3/H4/H5, M3/M4/M5/M6/M7/M8/M11/M12, L2/L4/L5/L6. The guard
invariant is untouched: no test here weakens it, and the OPERLOG CHECK
failure (other track) is deliberately not depended on — OPERLOG log
assertions below do not assert the response status.
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import AuditLog, BridgeInstallation, Gym, Member, User
from app.models.rrr import (
    RRRAdmsCommand,
    RRRBiometricTemplate,
    RRRDevice,
    RRRIntegration,
)
from app.services.bridge_service import (
    ADMS_ACKED_ABSENT_RESULT_CODE,
    adms_command_text,
    sanitize_terminal_name,
)

SERIAL = "REST-X2008-01"
TOKEN = "rest-test-token"


def _owner_headers(seed_gym, role="gym_owner"):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, role)}"}


def _staff_headers(seed_gym):
    staff = User(gym_id=seed_gym["gym"].id, email="staff@testgym.com",
                 full_name="Staff One", role="staff")
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return {"Authorization": f"Bearer {create_access_token(staff.id, seed_gym['gym'].id, 'staff')}"}


def _integration(seed_gym, *, commands_enabled=True, status="connected"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Rest ADMS",
        device_serial=SERIAL,
        status=status,
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed" if commands_enabled else "not_started",
        adms_path_token=TOKEN,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _bridge(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "TEST-TERMINAL-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key, serial="TEST-TERMINAL-SERIAL-01"):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


def _member(seed_gym, name, enroll, status, end):
    m = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone="+919100009999",
        membership_start=(end or date.today()) - timedelta(days=30),
        membership_end=end,
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(m)
    db.session.commit()
    return m


# ─── M6: name sanitisation ───────────────────────────────────────────────

def test_sanitize_terminal_name_strips_controls():
    assert sanitize_terminal_name("A\tB\nC\rD\x01E\x7f") == "ABCDE"
    assert sanitize_terminal_name("  John Doe  ") == "John Doe"
    assert sanitize_terminal_name("X" * 30) == "X" * 24
    assert sanitize_terminal_name(None) == ""


def test_command_text_cannot_inject_tab_field_via_name():
    text = adms_command_text("create_user", "42", member_name="Evil\tPri=1\nInject")
    assert text == "DATA UPDATE USERINFO PIN=42\tName=EvilPri=1Inject\tPri=0"
    assert text.count("\t") == 2  # PIN / Name / Pri only


# ─── M3: sensitive logging ───────────────────────────────────────────────

def test_userinfo_upload_logs_no_raw_lines(client, seed_gym, caplog):
    integration = _integration(seed_gym)
    cmd = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="sync_users", command_text="DATA QUERY USERINFO PIN=ALL",
    )
    db.session.add(cmd)
    db.session.commit()
    body = "USER PIN=7\tName=John Doe\tPri=0\tPasswd=secret\tCard=0\tGrp=1\n"
    with caplog.at_level(logging.INFO):
        client.post(
            f"/iclock/{TOKEN}/cdata?SN={SERIAL}&table=USERINFO",
            data=body, content_type="text/plain",
        )
    assert "USERINFO_RAW" not in caplog.text
    assert "Passwd=secret" not in caplog.text


def test_operlog_log_line_has_pin_but_no_name(client, seed_gym, caplog):
    _integration(seed_gym)
    body = "PIN=901\tName=John Doe\tPri=0\tPasswd=\tCard=\tGrp=1\n"
    with caplog.at_level(logging.INFO):
        # The OPERLOG CHECK failure is another track's fix; in the test
        # client it propagates as an exception from the commit. The log
        # line is emitted before it, which is all this test asserts.
        try:
            client.post(
                f"/iclock/{TOKEN}/cdata?SN={SERIAL}&table=OPERLOG",
                data=body, content_type="text/plain",
            )
        except Exception:
            pass
    records = [r for r in caplog.records if "OPERLOG enrollment" in r.getMessage()]
    assert records, "expected an OPERLOG enrollment log line"
    assert "901" in records[0].getMessage()
    assert "John Doe" not in records[0].getMessage()


# ─── M4: stray USERINFO uploads ──────────────────────────────────────────

def test_stray_userinfo_upload_applies_nothing(client, seed_gym):
    integration = _integration(seed_gym)
    old = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="sync_users", command_text="DATA QUERY USERINFO PIN=ALL",
        status="acked",
        result_data=json.dumps({"users": [{"enroll_number": "1", "name": "Old"}], "count": 1}),
    )
    db.session.add(old)
    db.session.commit()
    body = (
        "USER PIN=2\tName=New User\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
        "USER PIN=9999\tName=Planted\tPri=0\tTMP=QUJDREVGRw==\n"
    )
    res = client.post(
        f"/iclock/{TOKEN}/cdata?SN={SERIAL}&table=USERINFO",
        data=body, content_type="text/plain",
    )
    assert res.status_code == 200
    after = db.session.get(RRRAdmsCommand, old.id)
    assert after.result_data == old.result_data  # snapshot not overwritten
    assert RRRBiometricTemplate.query.count() == 0  # no planted template


def test_oversized_userinfo_snapshot_is_rejected_not_truncated(client, seed_gym):
    integration = _integration(seed_gym)
    cmd = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="sync_users", command_text="DATA QUERY USERINFO PIN=ALL",
    )
    db.session.add(cmd)
    db.session.commit()
    # Short raw lines (~20 chars) expand to ~45-char JSON entries, so
    # 8000 lines stay under the 256 KB body cap but over the snapshot cap.
    lines = "".join(f"USER PIN={i}\tName=U{i}\n" for i in range(1, 8001))
    assert len(lines) < 262144
    res = client.post(
        f"/iclock/{TOKEN}/cdata?SN={SERIAL}&table=USERINFO",
        data=lines, content_type="text/plain",
    )
    assert res.status_code == 200
    after = db.session.get(RRRAdmsCommand, cmd.id)
    assert after.status == "queued"  # left unacked, not truncated-acked
    assert after.result_data is None


# ─── H4 + M11: acked-absent + serve/ack audit ────────────────────────────

def test_devicecmd_delete_absent_is_distinct_and_audited(client, seed_gym):
    integration = _integration(seed_gym)
    cmd = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="block", test_enroll_number="942",
        command_text="DATA DELETE USERINFO PIN=942", status="delivered",
    )
    db.session.add(cmd)
    db.session.commit()
    res = client.get(
        f"/iclock/{TOKEN}/devicecmd?ID={cmd.id}&Return=-1&SN={SERIAL}")
    assert res.status_code == 200
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "acked"
    assert saved.result_code == ADMS_ACKED_ABSENT_RESULT_CODE
    assert saved.result_message.endswith("[treated as success: already absent]")
    ack = AuditLog.query.filter_by(action="adms_command_acked").one()
    assert ack.metadata_json["result_code"] == ADMS_ACKED_ABSENT_RESULT_CODE
    assert ack.metadata_json["session"] == "token"


def test_getrequest_serve_is_audited(client, seed_gym):
    integration = _integration(seed_gym)
    cmd = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="check", command_text="CHECK",
    )
    db.session.add(cmd)
    db.session.commit()
    res = client.get(f"/iclock/{TOKEN}/getrequest?SN={SERIAL}")
    assert res.status_code == 200
    assert res.get_data(as_text=True) == f"C:{cmd.id}:CHECK\n"
    audit_row = AuditLog.query.filter_by(action="adms_command_served").one()
    assert audit_row.metadata_json["action"] == "check"
    assert audit_row.metadata_json["session"] == "token"


# ─── L5/L6: timeout alignment + re-send bound ────────────────────────────

def test_test_endpoint_frees_only_after_shared_timeout(client, seed_gym):
    integration = _integration(seed_gym)
    url = f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/commands"
    headers = _owner_headers(seed_gym)
    # 9 minutes delivered: still in flight under the shared 10-min timeout.
    stuck = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="probe_info", command_text="INFO", status="delivered",
        delivered_at=datetime.now(timezone.utc) - timedelta(minutes=9),
    )
    db.session.add(stuck)
    db.session.commit()
    res = client.post(url, headers=headers, json={"action": "probe_info"})
    assert res.status_code == 409
    # 11 minutes delivered: freed, a new test can be queued.
    stuck.delivered_at = datetime.now(timezone.utc) - timedelta(minutes=11)
    db.session.commit()
    res = client.post(url, headers=headers, json={"action": "probe_info"})
    assert res.status_code == 201
    assert db.session.get(RRRAdmsCommand, stuck.id).status == "failed"


def test_getrequest_resend_bounded_by_stuck_timeout(client, seed_gym):
    integration = _integration(seed_gym)
    old = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="check", command_text="CHECK", status="delivered",
        delivered_at=datetime.now(timezone.utc) - timedelta(minutes=11),
    )
    nxt = RRRAdmsCommand(
        integration_id=integration.id, gym_id=seed_gym["gym"].id,
        action="check", command_text="CHECK",
    )
    db.session.add_all([old, nxt])
    db.session.commit()
    res = client.get(f"/iclock/{TOKEN}/getrequest?SN={SERIAL}")
    assert res.get_data(as_text=True) == f"C:{nxt.id}:CHECK\n"
    after = db.session.get(RRRAdmsCommand, old.id)
    assert after.status == "failed"
    assert "Timeout: no ack within 10 min" in (after.result_message or "")


# ─── H3/H5: destructive labelling + confirmation + owner-only unlock ────

def test_manual_block_response_carries_destructive_warning(client, seed_gym, seed_member):
    _integration(seed_gym)
    seed_member.device_enroll_number = "101"
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/rrr/members/{seed_member.id}/access",
        headers=_owner_headers(seed_gym), json={"action": "block"},
    )
    assert res.status_code == 201
    assert "re-enrollment" in res.json["data"]["warning"]
    audit_row = AuditLog.query.filter_by(action="adms_manual_block_queued").one()
    assert audit_row.metadata_json["destructive"] is True


def test_advanced_destructive_commands_require_confirmation(client, seed_gym):
    integration = _integration(seed_gym)
    url = f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/device-command"
    headers = _owner_headers(seed_gym)
    res = client.post(url, headers=headers, json={"action": "clear_log"})
    assert res.status_code == 422
    assert res.json["error"]["code"] == "CONFIRMATION_REQUIRED"
    res = client.post(url, headers=headers, json={"action": "clear_log", "confirm": True})
    assert res.status_code == 201


def test_remote_unlock_is_owner_only(client, seed_gym):
    _bridge(seed_gym)
    res = client.post("/api/mobile/v1/access/remote-unlock",
                      headers=_staff_headers(seed_gym), json={"delay_seconds": 5})
    assert res.status_code == 403
    res = client.post("/api/mobile/v1/access/remote-unlock",
                      headers=_owner_headers(seed_gym),
                      json={"delay_seconds": 5, "reason": "member locked out"})
    assert res.status_code == 201
    audit_row = AuditLog.query.filter_by(action="remote_door_unlock_dispatched").one()
    assert audit_row.metadata_json["reason"] == "member locked out"


def test_settings_commands_require_active_bridge_and_confirmation(client, seed_gym):
    installation, _ = _bridge(seed_gym)
    url = "/api/mobile/v1/settings/bridge/commands"
    headers = _owner_headers(seed_gym)
    res = client.post(url, headers=headers, json={"command_type": "clear_log"})
    assert res.status_code == 422
    res = client.post(url, headers=headers,
                      json={"command_type": "clear_log", "confirm": True})
    assert res.status_code == 201
    installation.is_active = False
    db.session.commit()
    res = client.post(url, headers=headers,
                      json={"command_type": "clear_log", "confirm": True})
    assert res.status_code == 404


# ─── M8: bulk + single remove ────────────────────────────────────────────

def test_bulk_remove_uses_blockable_filter_and_never_mutates_status(client, seed_gym):
    _integration(seed_gym)
    _bridge(seed_gym)
    expired = _member(seed_gym, "Expired One", "201", "expired", date.today() - timedelta(days=1))
    overdue = _member(seed_gym, "Overdue Active", "202", "active", date.today() - timedelta(days=1))
    _member(seed_gym, "Current Active", "203", "active", date.today() + timedelta(days=30))
    res = client.post("/api/mobile/v1/rrr/bulk-remove-expired",
                      headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    data = res.json["data"]
    assert data["queued"] == 1
    assert data["skipped_not_blockable"] == 1
    assert db.session.get(Member, overdue.id).status == "active"  # not mutated
    assert RRRAdmsCommand.query.filter_by(
        test_enroll_number="201", action="block").count() == 1
    assert RRRAdmsCommand.query.filter_by(
        test_enroll_number="202", action="block").count() == 0


def test_single_remove_refuses_active_members(client, seed_gym, seed_member):
    _integration(seed_gym)
    _bridge(seed_gym)
    seed_member.device_enroll_number = "202"
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/rrr/members/{seed_member.id}/remove-from-terminal",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 400
    assert "still active" in res.json["error"]
    expired = _member(seed_gym, "Expired One", "201", "expired", date.today() - timedelta(days=1))
    res = client.post(
        f"/api/mobile/v1/rrr/members/{expired.id}/remove-from-terminal",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    assert res.json["data"]["queued"] is True


# ─── M12: enroll-scan gate + bridge payload cap ──────────────────────────

def test_enroll_scan_requires_commissioning(client, seed_gym):
    _integration(seed_gym, commands_enabled=False, status="connected")
    res = client.post("/api/mobile/v1/rrr/enroll-scan", headers=_owner_headers(seed_gym))
    assert res.status_code == 403
    assert RRRAdmsCommand.query.filter_by(action="sync_users").count() == 0


def test_bridge_payload_cap_rejects_oversized_body(client, seed_gym):
    installation, api_key = _bridge(seed_gym)
    payload = {"gymId": installation.public_id, "status": "online",
               "pad": "x" * 300000}
    res = client.post("/api/bridge/v1/heartbeat", json=payload,
                      headers=_bridge_headers(api_key))
    assert res.status_code == 413
    assert res.json["error"]["code"] == "payload_too_large"


# ─── L4: heartbeat-reported rows are inert until owner selection ────────
# Corrected 2026-10-24: the first L4 implementation skipped unknown serials
# entirely, which broke the real discovery flow (bridge reports a device →
# owner selects it → bridge config picks it up; see
# test_ebio_reports_devices_and_owner_selection_reaches_connector_config).
# RRRDevice's designed purpose IS bridge-reported inventory, and a row
# confers no trust on its own: selection is an owner-gated endpoint. So the
# fix asserts inertness, not absence: a heartbeat-created row is unselected
# and the integration's selected serial is unchanged.

def test_heartbeat_reported_device_is_inert_until_owner_selects(client, seed_gym):
    installation, api_key = _bridge(seed_gym)
    installation.connector_type = "ebioserver"
    ebio = RRRIntegration(
        gym_id=seed_gym["gym"].id, connector_type="ebioserver",
        display_name="eBio", device_serial="TEST-TERMINAL-SERIAL-01",
        status="connected",
    )
    db.session.add(ebio)
    db.session.flush()
    db.session.add(RRRDevice(
        gym_id=seed_gym["gym"].id, integration_id=ebio.id,
        serial_number="TEST-TERMINAL-SERIAL-01", device_name="Known",
    ))
    db.session.commit()
    payload = {"gymId": installation.public_id, "status": "online", "devices": [
        {"serialNumber": "TEST-TERMINAL-SERIAL-01", "status": "online"},
        {"serialNumber": "UNKNOWN-XYZ", "status": "online"},
    ]}
    res = client.post("/api/bridge/v1/heartbeat", json=payload,
                      headers=_bridge_headers(api_key))
    assert res.status_code == 200
    new = RRRDevice.query.filter_by(serial_number="UNKNOWN-XYZ").one()
    assert new.is_selected is False
    assert new.gym_id == seed_gym["gym"].id
    db.session.refresh(ebio)
    assert ebio.device_serial == "TEST-TERMINAL-SERIAL-01"
    known = RRRDevice.query.filter_by(
        serial_number="TEST-TERMINAL-SERIAL-01").one()
    assert known.status == "online"


# ─── M5: exact-only auto-link ─────────────────────────────────────────────

def _seed_bridge_snapshot(seed_gym, terminal_users):
    gym = seed_gym["gym"]
    bridge = BridgeInstallation(
        gym_id=gym.id, public_id="test-pub-id-2", api_key_hash="y" * 64,
        device_serial="TEST-SERIAL-2", display_name="Test Bridge", is_active=True,
    )
    db.session.add(bridge)
    db.session.flush()
    from app.models.bridge import BridgeCommand

    db.session.add(BridgeCommand(
        bridge_id=bridge.id, gym_id=gym.id, command_type="sync_users",
        enroll_number="SYSTEM", status="acked",
        result_data=json.dumps({"users": terminal_users, "count": len(terminal_users)}),
    ))
    db.session.commit()


def test_auto_link_links_exact_only(app, seed_gym, seed_member):
    from app.services import enroll_match_service

    _seed_bridge_snapshot(seed_gym, [{"user_id": "42", "name": "John Doe"}])
    result = enroll_match_service.auto_link_high_confidence(seed_gym["gym"].id)
    assert [l["enroll_number"] for l in result["linked"]] == ["42"]
    assert db.session.get(Member, seed_member.id).device_enroll_number == "42"
    audit_row = AuditLog.query.filter_by(action="enroll_match_confirmed").one()
    assert audit_row.metadata_json["auto_linked"] is True
    assert audit_row.metadata_json["confidence"] == 100


def test_auto_link_skips_fuzzy_match_for_owner_review(app, seed_gym, seed_member):
    from app.services import enroll_match_service

    # "Jon Doe" vs member "John Doe" = 92% — above the old 90% bar.
    _seed_bridge_snapshot(seed_gym, [{"user_id": "43", "name": "Jon Doe"}])
    suggestions = enroll_match_service.suggest_matches(seed_gym["gym"].id)["suggestions"]
    assert suggestions and suggestions[0]["confidence"] == 92
    assert suggestions[0]["auto_linkable"] is False
    result = enroll_match_service.auto_link_high_confidence(seed_gym["gym"].id)
    assert result["linked"] == []
    assert result["skipped"][0]["reason"] == (
        "not an exact normalized match, needs owner confirmation")
    assert db.session.get(Member, seed_member.id).device_enroll_number is None
