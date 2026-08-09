from __future__ import annotations

from datetime import datetime, timezone

from app.extensions import db
from app.models import BridgeAttendance, BridgeCommand, BridgeInstallation, Member
from app.services.bridge_service import queue_gym_reconciliation, queue_membership_command


def _installation(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "TEST-TERMINAL-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _headers(api_key: str, serial: str = "TEST-TERMINAL-SERIAL-01") -> dict[str, str]:
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


def test_bridge_rejects_missing_or_wrong_key(client, seed_gym):
    installation, _api_key = _installation(seed_gym)
    payload = {"gymId": installation.public_id, "status": "online"}

    missing = client.post("/api/bridge/v1/heartbeat", json=payload)
    wrong = client.post(
        "/api/bridge/v1/heartbeat", json=payload, headers=_headers("not-the-real-key")
    )

    assert missing.status_code == 401
    assert missing.json["error"]["code"] == "unauthorized"
    assert wrong.status_code == 401


def test_bridge_rejects_old_protocol_or_wrong_terminal(client, seed_gym):
    installation, api_key = _installation(seed_gym)
    payload = {"gymId": installation.public_id, "status": "online"}
    old_protocol = client.post(
        "/api/bridge/v1/heartbeat",
        json=payload,
        headers={"X-Api-Key": api_key, "X-Device-Serial": "TEST-TERMINAL-SERIAL-01"},
    )
    wrong_terminal = client.post(
        "/api/bridge/v1/heartbeat", json=payload, headers=_headers(api_key, "OTHER-TERMINAL")
    )

    assert old_protocol.status_code == 426
    assert wrong_terminal.status_code == 403


def test_bridge_api_remains_usable_when_browser_csrf_is_enabled(client, seed_gym):
    installation, api_key = _installation(seed_gym)
    client.application.config["WTF_CSRF_ENABLED"] = True

    response = client.post(
        "/api/bridge/v1/heartbeat",
        json={"gymId": installation.public_id, "status": "online"},
        headers=_headers(api_key),
    )

    assert response.status_code == 200


def test_bridge_leases_and_acknowledges_membership_command(client, seed_gym, seed_member):
    installation, api_key = _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    command = queue_membership_command(member)
    db.session.commit()

    pending = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}",
        headers=_headers(api_key),
    )

    assert pending.status_code == 200
    assert len(pending.json) == 1
    assert pending.json[0]["id"] == command.id
    assert pending.json[0]["commandType"] == "enable_user"
    assert pending.json[0]["leaseToken"]

    ack = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={"status": "acked", "leaseToken": pending.json[0]["leaseToken"]},
        headers=_headers(api_key),
    )

    assert ack.status_code == 200
    assert db.session.get(BridgeCommand, command.id).status == "acked"

    repeat = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={"status": "acked", "leaseToken": pending.json[0]["leaseToken"]},
        headers=_headers(api_key),
    )
    assert repeat.status_code == 200


def test_bridge_attendance_is_idempotent_and_scoped(client, seed_gym, seed_member):
    installation, api_key = _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    db.session.commit()
    payload = {
        "gymId": installation.public_id,
        "eventId": "evt-42-1",
        "deviceEnrollNumber": "42",
        "eventTime": datetime.now(timezone.utc).isoformat(),
        "verifyMethod": 1,
        "isInvalid": False,
    }

    created = client.post("/api/bridge/v1/attendance", json=payload, headers=_headers(api_key))
    duplicate = client.post("/api/bridge/v1/attendance", json=payload, headers=_headers(api_key))
    wrong_id = client.post(
        "/api/bridge/v1/attendance",
        json={**payload, "gymId": "some-other-bridge"},
        headers=_headers(api_key),
    )

    assert created.status_code == 201
    assert created.json["knownMember"] is True
    assert duplicate.status_code == 200
    assert duplicate.json["duplicate"] is True
    assert wrong_id.status_code == 403
    assert BridgeAttendance.query.count() == 1


def test_enrollment_confirmation_queues_current_access(client, seed_gym, seed_member):
    installation, api_key = _installation(seed_gym)

    response = client.post(
        "/api/bridge/v1/enrollment/confirm",
        json={
            "gymId": installation.public_id,
            "memberId": seed_member.id,
            "deviceEnrollNumber": "00042",
        },
        headers=_headers(api_key),
    )

    assert response.status_code == 200
    assert response.json["deviceEnrollNumber"] == "42"
    member = db.session.get(Member, seed_member.id)
    assert member.device_enroll_number == "42"
    command = BridgeCommand.query.filter_by(member_id=member.id).one()
    assert command.command_type == "enable_user"


def test_failed_command_schedules_a_new_delayed_retry(client, seed_gym, seed_member):
    installation, api_key = _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    command = queue_membership_command(member)
    db.session.commit()

    delivery = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}", headers=_headers(api_key)
    )
    failed = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={
            "status": "failed",
            "leaseToken": delivery.json[0]["leaseToken"],
            "errorMessage": "terminal temporarily offline",
        },
        headers=_headers(api_key),
    )

    retries = BridgeCommand.query.filter_by(member_id=member.id).order_by(BridgeCommand.created_at).all()
    assert failed.status_code == 200
    assert failed.json["retryScheduled"] is True
    assert len(retries) == 2
    assert retries[0].status == "failed"
    assert retries[1].status == "pending"
    assert retries[1].retry_attempt == 1
    assert retries[1].not_before is not None


def test_reconciliation_resends_an_already_acknowledged_access_state(client, seed_gym, seed_member):
    installation, api_key = _installation(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    original = queue_membership_command(member)
    db.session.commit()

    delivery = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}", headers=_headers(api_key)
    )
    ack = client.post(
        f"/api/bridge/v1/commands/{original.id}/ack",
        json={"status": "acked", "leaseToken": delivery.json[0]["leaseToken"]},
        headers=_headers(api_key),
    )
    assert ack.status_code == 200

    assert queue_gym_reconciliation(seed_gym["gym"].id) == 1
    db.session.commit()
    commands = BridgeCommand.query.filter_by(member_id=member.id).order_by(BridgeCommand.created_at).all()
    assert [command.status for command in commands] == ["acked", "pending"]
    assert commands[1].command_type == "enable_user"


def test_naive_terminal_attendance_uses_gym_timezone(client, seed_gym):
    installation, api_key = _installation(seed_gym)
    response = client.post(
        "/api/bridge/v1/attendance",
        json={
            "gymId": installation.public_id,
            "eventId": "naive-device-time",
            "deviceEnrollNumber": "42",
            "eventTime": "2026-08-09T12:00:00",
            "verifyMethod": 1,
            "isInvalid": False,
        },
        headers=_headers(api_key),
    )

    event = BridgeAttendance.query.one()
    assert response.status_code == 201
    # Test gyms use Asia/Kolkata; noon local is 06:30 UTC.
    assert event.event_time.hour == 6
    assert event.event_time.minute == 30
