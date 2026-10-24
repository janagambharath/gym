"""ADMS device-auth hardening (batch #3) regression tests.

Synthetic fixtures only: every serial, enroll number, name and phone is
invented; no real member biometrics, PINs, credentials or production
data appear here. Tokens in this file are generated per-test by the
model helpers and never reused across tests.

Coverage, mapped to the investigation findings:
* C1/H7 — hash-only token issuance, rotation with a grace window,
  rotation with zero grace (immediate revocation), legacy plaintext
  token lazy-migration to hash-only, and the serial-fallback gate
  (new integrations: serial-only changes nothing; legacy integrations
  with the flag on: serial still works, warning-logged path).
* C1 (forged punches) — wrong-token and serial-only requests cannot
  inject attendance, cannot pull commands, and cannot fake acks.
* H1 — a serial-provenance punch cannot satisfy the commissioning
  gate for a fallback-off integration; a token punch can.
* M10 — registry pings never clear error state; serial sessions
  never clear error state, even when they deliver data.
* M9/L1 — new pairing codes and bridge keys are salted; legacy
  unsalted values still verify (transition, no flag day).
* L3 — the per-device limiter key differs per device token/serial.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from flask import request

from app.adms.routes import _adms_rate_limit_key
from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeInstallation, GymDeployment, Member
from app.models.bridge import hash_bridge_api_key, verify_bridge_api_key
from app.models.rrr import (
    RRRAdmsCommand,
    RRRAttendanceEvent,
    RRRDevice,
    RRRIntegration,
    hash_adms_token,
    verify_pairing_code,
)
from app.services.bridge_service import adms_command_text

SERIAL = "AUTH-TEST-X2008"


def _headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def _integration(seed_gym, *, serial=SERIAL, fallback=False, token_mode="hash"):
    """Create an adms_direct integration.

    token_mode: "hash" (issue hash-only token, returns it), "legacy"
    (plaintext token column, returns it), or "none" (no token).
    """
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Auth test ADMS",
        device_serial=serial,
        device_name="Auth Test X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        allow_serial_fallback=fallback,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    token = None
    if token_mode == "hash":
        token = row.issue_adms_token()
        db.session.commit()
    elif token_mode == "legacy":
        token = "legacy-test-token-abcdef"
        row.adms_path_token = token
        db.session.commit()
    return row, token


def _member(seed_gym, *, name, phone, enroll, status="active", end=None):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        membership_start=(end or date.today()) - timedelta(days=30),
        membership_end=end if end is not None else date.today() + timedelta(days=30),
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _command(integration, gym_id, *, action, enroll, text, status="queued"):
    cmd = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=text,
        status=status,
        delivered_at=datetime.now(timezone.utc) if status == "delivered" else None,
    )
    db.session.add(cmd)
    db.session.commit()
    return cmd


def _attlog_line(enroll="701"):
    return f"{enroll}\t2026-10-24 10:00:00\t0\t1"


# ─── C1: forged / serial-only requests cannot inject ───────────────────────

def test_new_integration_serial_only_punch_is_rejected(client, seed_gym, seed_member):
    integration, _token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    response = client.post(
        f"/iclock/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "OK"  # indistinguishable
    assert RRRAttendanceEvent.query.count() == 0
    assert RRRDevice.query.count() == 0
    assert db.session.get(RRRIntegration, integration.id).records_synced == 0


def test_wrong_token_punch_is_rejected(client, seed_gym, seed_member):
    integration, token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    response = client.post(
        f"/iclock/WRONG-TOKEN/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert response.get_data(as_text=True) == "OK"
    assert RRRAttendanceEvent.query.count() == 0
    # The real token still works afterwards (the wrong attempt changed nothing).
    ok = client.post(
        f"/iclock/{token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert ok.status_code == 200
    event = RRRAttendanceEvent.query.one()
    assert event.processing_status == "processed"
    assert event.auth_method == "token"


def test_new_integration_serial_getrequest_and_devicecmd_do_nothing(client, seed_gym):
    integration, _token = _integration(seed_gym, fallback=False)
    gym_id = seed_gym["gym"].id
    _member(seed_gym, name="Fake Paused Auth", phone="+919100007001", enroll="710",
            status="paused")
    cmd = _command(integration, gym_id, action="block", enroll="710",
                   text="DATA DELETE USERINFO PIN=710")
    served = client.get(f"/iclock/getrequest?SN={SERIAL}")
    assert served.get_data(as_text=True) == "OK"
    assert db.session.get(RRRAdmsCommand, cmd.id).status == "queued"

    delivered = _command(integration, gym_id, action="block", enroll="710",
                         text="DATA DELETE USERINFO PIN=710", status="delivered")
    ack = client.get(f"/iclock/devicecmd?SN={SERIAL}&ID={delivered.id}&Return=0")
    assert ack.get_data(as_text=True) == "OK"
    assert db.session.get(RRRAdmsCommand, delivered.id).status == "delivered"


def test_token_hash_only_punch_and_commands_work(client, seed_gym, seed_member):
    integration, token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    # Stored as hash only: no plaintext token in the database row.
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.adms_path_token is None
    assert saved.adms_token_hash == hash_adms_token(token)
    response = client.post(
        f"/iclock/{token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert response.status_code == 200
    event = RRRAttendanceEvent.query.one()
    assert event.member_id == seed_member.id
    assert event.auth_method == "token"


# ─── Backward compatibility: legacy serial + legacy token ──────────────────

def test_legacy_serial_fallback_still_works(client, seed_gym, seed_member):
    integration, _token = _integration(seed_gym, fallback=True)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    response = client.post(
        f"/iclock/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert response.status_code == 200
    event = RRRAttendanceEvent.query.one()
    assert event.processing_status == "processed"
    assert event.auth_method == "serial"

    gym_id = seed_gym["gym"].id
    _member(seed_gym, name="Fake Paused Legacy", phone="+919100007002", enroll="711",
            status="paused")
    cmd = _command(integration, gym_id, action="block", enroll="711",
                   text="DATA DELETE USERINFO PIN=711")
    served = client.get(f"/iclock/getrequest?SN={SERIAL}")
    assert served.get_data(as_text=True) == f"C:{cmd.id}:DATA DELETE USERINFO PIN=711\n"


def test_legacy_plaintext_token_migrates_to_hash_on_first_use(client, seed_gym, seed_member):
    integration, token = _integration(seed_gym, fallback=False, token_mode="legacy")
    seed_member.device_enroll_number = "701"
    db.session.commit()
    assert db.session.get(RRRIntegration, integration.id).adms_path_token == token
    response = client.post(
        f"/iclock/{token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert response.status_code == 200
    assert RRRAttendanceEvent.query.count() == 1
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.adms_path_token is None  # migrated to hash-only
    assert saved.adms_token_hash == hash_adms_token(token)
    # The same token keeps working after migration (hash lookup).
    second = client.post(
        f"/iclock/{token}/cdata?SN={SERIAL}&table=ATTLOG",
        data="701\t2026-10-24 11:00:00\t0\t1", content_type="text/plain",
    )
    assert second.status_code == 200
    assert RRRAttendanceEvent.query.count() == 2


# ─── H7: rotation + grace window ───────────────────────────────────────────

def test_rotation_old_token_works_in_grace_then_expires(client, seed_gym, seed_member):
    integration, old_token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    new_token = db.session.get(RRRIntegration, integration.id).rotate_adms_token(grace_days=7)
    db.session.commit()
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.adms_path_token is None
    assert saved.adms_token_version == 2
    assert saved.adms_token_grace_until is not None

    # Old token still authenticates inside the grace window.
    in_grace = client.post(
        f"/iclock/{old_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    )
    assert in_grace.status_code == 200
    assert RRRAttendanceEvent.query.one().auth_method == "token_prev"
    # New token authenticates too.
    assert client.post(
        f"/iclock/{new_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data="701\t2026-10-24 12:00:00\t0\t1", content_type="text/plain",
    ).status_code == 200
    assert RRRAttendanceEvent.query.count() == 2

    # Grace window passes: old token is now rejected, new token still works.
    saved.adms_token_grace_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.session.commit()
    rejected = client.post(
        f"/iclock/{old_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data="701\t2026-10-24 13:00:00\t0\t1", content_type="text/plain",
    )
    assert rejected.get_data(as_text=True) == "OK"
    assert RRRAttendanceEvent.query.count() == 2
    assert client.post(
        f"/iclock/{new_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data="701\t2026-10-24 14:00:00\t0\t1", content_type="text/plain",
    ).status_code == 200
    assert RRRAttendanceEvent.query.count() == 3


def test_rotation_zero_grace_revokes_immediately(client, seed_gym, seed_member):
    integration, old_token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    new_token = db.session.get(RRRIntegration, integration.id).rotate_adms_token(grace_days=0)
    db.session.commit()
    assert db.session.get(RRRIntegration, integration.id).adms_token_hash_prev is None
    assert client.post(
        f"/iclock/{old_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    ).get_data(as_text=True) == "OK"
    assert RRRAttendanceEvent.query.count() == 0
    assert client.post(
        f"/iclock/{new_token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    ).status_code == 200
    assert RRRAttendanceEvent.query.count() == 1


# ─── Owner endpoints: rotate, fallback toggle, provision ───────────────────

def test_rotate_endpoint_returns_token_once_and_stores_hash_only(client, seed_gym):
    integration, old_token = _integration(seed_gym, fallback=False)
    response = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/rotate-token",
        headers=_headers(seed_gym), json={"grace_days": 7},
    )
    assert response.status_code == 200
    data = response.json["data"]
    new_token = data["token"]
    assert new_token and new_token != old_token
    assert data["token_version"] == 2
    assert data["previous_token_grace_until"] is not None
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.adms_path_token is None
    assert saved.adms_token_hash == hash_adms_token(new_token)
    # New token authenticates; old token is still in grace.
    assert client.get(f"/iclock/{new_token}/cdata?SN={SERIAL}").status_code == 200
    assert client.get(f"/iclock/{old_token}/cdata?SN={SERIAL}").status_code == 200


def test_serial_fallback_toggle_endpoint(client, seed_gym, seed_member):
    integration, _token = _integration(seed_gym, fallback=False)
    seed_member.device_enroll_number = "701"
    db.session.commit()
    url = f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/serial-fallback"
    assert client.post(url, headers=_headers(seed_gym), json={"enabled": "yes"}).status_code == 422

    ok = client.post(url, headers=_headers(seed_gym), json={"enabled": True})
    assert ok.status_code == 200
    assert ok.json["data"]["integration"]["allow_serial_fallback"] is True
    assert client.post(
        f"/iclock/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    ).status_code == 200
    assert RRRAttendanceEvent.query.count() == 1

    off = client.post(url, headers=_headers(seed_gym), json={"enabled": False})
    assert off.json["data"]["integration"]["allow_serial_fallback"] is False
    assert client.post(
        f"/iclock/cdata?SN={SERIAL}&table=ATTLOG",
        data="701\t2026-10-24 15:00:00\t0\t1", content_type="text/plain",
    ).get_data(as_text=True) == "OK"
    assert RRRAttendanceEvent.query.count() == 1  # no new event


def test_provision_new_integration_defaults_serial_off_hash_only(client, seed_gym):
    response = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=_headers(seed_gym),
        json={"device_serial": "PROV-NEW-X2008", "device_name": "Provisioned Terminal"},
    )
    assert response.status_code == 200
    data = response.json["data"]
    assert data["integration"]["allow_serial_fallback"] is False
    row = RRRIntegration.query.filter_by(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct").one()
    assert row.adms_path_token is None  # hash-only, never stored plaintext
    assert row.adms_token_hash is not None
    assert data["terminal_settings"]["path"].startswith("/iclock/")
    # The provisioned token authenticates the device.
    token = data["terminal_settings"]["path"].removeprefix("/iclock/")
    assert client.get(f"/iclock/{token}/cdata?SN=PROV-NEW-X2008").status_code == 200


# ─── H1: commissioning gate ────────────────────────────────────────────────

def test_commission_rejects_serial_provenance_accepts_token(client, seed_gym, seed_member):
    integration, token = _integration(
        seed_gym, fallback=False, token_mode="hash")
    # Re-open commissioning for this test (fixture starts commissioned).
    integration.commands_enabled = False
    integration.commissioning_status = "not_started"
    integration.status = "connected"
    seed_member.device_enroll_number = "701"
    db.session.commit()
    url = f"/api/mobile/v1/rrr/integrations/{integration.id}/commission"

    # A serial-provenance processed event must NOT satisfy the gate.
    db.session.add(RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id, integration_id=integration.id, member_id=seed_member.id,
        source="adms_direct", device_serial=SERIAL, biometric_user_id="701",
        punch_time=datetime.now(timezone.utc), dedupe_key="auth-k1",
        processing_status="processed", auth_method="serial",
    ))
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id, action="probe_info",
        command_text=adms_command_text("probe_info", None), status="acked",
    ))
    db.session.commit()
    denied = client.post(url, headers=_headers(seed_gym), json={"physical_test_passed": True})
    assert denied.status_code == 409

    # A token-authenticated punch does satisfy it (acked test already present).
    assert client.post(
        f"/iclock/{token}/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    ).status_code == 200
    ok = client.post(url, headers=_headers(seed_gym), json={"physical_test_passed": True})
    assert ok.status_code == 200
    assert db.session.get(RRRIntegration, integration.id).commands_enabled is True


# ─── M10: error state is only cleared by token-valid exchanges ─────────────

def test_registry_ping_never_clears_error(client, seed_gym):
    integration, token = _integration(seed_gym, fallback=False)
    integration.status = "degraded"
    integration.last_error = "Fake terminal error"
    db.session.commit()
    assert client.get(f"/iclock/{token}/registry?SN={SERIAL}").status_code == 200
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.last_error == "Fake terminal error"
    assert saved.status == "degraded"
    # But a real token exchange does clear it.
    assert client.get(f"/iclock/{token}/cdata?SN={SERIAL}").status_code == 200
    saved = db.session.get(RRRIntegration, integration.id)
    assert saved.last_error is None
    assert saved.status == "connected"


def test_serial_session_never_clears_error_even_with_data(client, seed_gym, seed_member):
    integration, _token = _integration(seed_gym, fallback=True)
    integration.status = "degraded"
    integration.last_error = "Fake terminal error"
    seed_member.device_enroll_number = "701"
    db.session.commit()
    assert client.post(
        f"/iclock/cdata?SN={SERIAL}&table=ATTLOG",
        data=_attlog_line(), content_type="text/plain",
    ).status_code == 200
    saved = db.session.get(RRRIntegration, integration.id)
    assert RRRAttendanceEvent.query.count() == 1  # data still ingested (legacy)
    assert saved.last_error == "Fake terminal error"  # but error state untouched


# ─── M9/L1: salted pairing codes and bridge keys, legacy still verifies ───

def test_new_pairing_code_is_salted_and_pairs(client, seed_gym):
    integration, code = RRRIntegration.issue_pairing_code(seed_gym["gym"].id)
    db.session.commit()
    assert integration.pairing_code_salt is not None
    assert integration.verify_pairing_code(code) is True
    assert integration.verify_pairing_code("000000") is False
    assert verify_pairing_code(code, integration.pairing_code_hash, integration.pairing_code_salt) is True
    response = client.post(
        "/api/bridge/v2/pair",
        json={"pairingCode": code, "deviceSerial": "PAIR-TEST-SERIAL-01"},
    )
    assert response.status_code == 201
    assert response.json["data"]["apiKey"]
    assert db.session.get(RRRIntegration, integration.id).pairing_code_hash is None


def test_legacy_unsalted_pairing_code_still_pairs(client, seed_gym):
    from app.models.rrr import RRRIntegration as _RI

    integration = RRRIntegration(
        gym_id=seed_gym["gym"].id, connector_type="ebioserver",
        display_name="Legacy pairing", device_serial="LEGACY-PAIR-SERIAL",
    )
    db.session.add(integration)
    db.session.commit()
    code = "123456"
    integration.pairing_code_hash = _RI.hash_pairing_code(code)  # unsalted, salt NULL
    integration.pairing_code_salt = None
    integration.pairing_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.session.commit()
    response = client.post(
        "/api/bridge/v2/pair",
        json={"pairingCode": code, "deviceSerial": "LEGACY-PAIR-SERIAL"},
    )
    assert response.status_code == 201


def test_bridge_keys_salted_new_and_legacy_verify(client, seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Salted bridge", "SALTED-TERMINAL-01")
    db.session.add(installation)
    db.session.commit()
    assert installation.api_key_salt is not None
    assert verify_bridge_api_key(api_key, installation.api_key_hash, installation.api_key_salt) is True
    headers = {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "SALTED-TERMINAL-01",
    }
    ok = client.post("/api/bridge/v1/heartbeat",
                     json={"gymId": installation.public_id, "status": "online"},
                     headers=headers)
    assert ok.status_code == 200

    # Legacy unsalted key still authenticates (second gym: one installation per gym).
    from app.models import Gym

    gym2 = Gym(name="Legacy Gym", slug="legacy-gym", email="legacy@testgym.com",
               phone="+919876543211", status="active")
    db.session.add(gym2)
    db.session.commit()
    legacy_key = "rdb_live_legacy-test-key-abcdef"
    legacy = BridgeInstallation(
        gym_id=gym2.id,
        public_id="bridge_legacytest",
        api_key_hash=hash_bridge_api_key(legacy_key),
        api_key_salt=None,
        device_serial="LEGACY-TERMINAL-01",
    )
    db.session.add(legacy)
    db.session.commit()
    legacy_headers = {
        "X-Api-Key": legacy_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "LEGACY-TERMINAL-01",
    }
    ok2 = client.post("/api/bridge/v1/heartbeat",
                      json={"gymId": legacy.public_id, "status": "online"},
                      headers=legacy_headers)
    assert ok2.status_code == 200
    wrong = client.post("/api/bridge/v1/heartbeat",
                        json={"gymId": legacy.public_id, "status": "online"},
                        headers={**legacy_headers, "X-Api-Key": "rdb_live_wrong"})
    assert wrong.status_code == 401


# ─── L3: per-device limiter key ────────────────────────────────────────────

def test_adms_rate_limit_key_is_per_device(app, seed_gym):
    with app.test_request_context("/iclock/TOKEN-A/getrequest?SN=SERIAL-A"):
        assert request.view_args is not None
        key_a = _adms_rate_limit_key()
    with app.test_request_context("/iclock/TOKEN-B/getrequest?SN=SERIAL-B"):
        key_b = _adms_rate_limit_key()
    with app.test_request_context("/iclock/TOKEN-A/getrequest?SN=SERIAL-A"):
        key_a2 = _adms_rate_limit_key()
    with app.test_request_context("/iclock/getrequest?SN=SERIAL-A"):
        key_serial = _adms_rate_limit_key()
    assert key_a != key_b
    assert key_a == key_a2
    assert key_serial != key_a
    # Raw tokens/serials never appear in the key itself.
    assert "TOKEN-A" not in key_a and "SERIAL-A" not in key_serial
