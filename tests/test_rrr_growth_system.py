from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models import BridgeInstallation
from app.models.rrr import RRRAdmsCommand, RRRAttendanceEvent, RRRDevice, RRRIntegration
from app.services.rrr_service import normalize_attendance


def headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def test_rrr_dashboard_uses_real_expiry_and_no_visit_data(client, seed_gym, seed_member):
    seed_member.membership_end = date.today() + timedelta(days=5)
    seed_member.device_enroll_number = "42"
    db.session.commit()

    response = client.get("/api/mobile/v1/rrr/dashboard", headers=headers(seed_gym))
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert data["members"]["total"] == 1
    assert data["pillars"]["revenue"]["count"] >= 1
    assert data["pillars"]["retain"]["count"] >= 1
    assert any(x["reason_code"] == "expiry_approaching" for x in data["pillars"]["revenue"]["items"])


def test_unmapped_event_is_retained_then_resolved(client, seed_gym, seed_member):
    gym = seed_gym["gym"]
    event, created = normalize_attendance(
        gym_id=gym.id, source="ebioserver", biometric_user_id="BIO-77",
        punch_time=datetime.now(timezone.utc), external_event_id="log-77", device_serial="X2008",
    )
    db.session.commit()
    assert created and event.processing_status == "unmapped"

    unresolved = client.get("/api/mobile/v1/rrr/mappings/unresolved", headers=headers(seed_gym))
    assert unresolved.status_code == 200
    assert unresolved.get_json()["data"]["events"][0]["biometric_user_id"] == "BIO-77"

    resolved = client.post(
        "/api/mobile/v1/rrr/mappings/BIO-77", headers=headers(seed_gym), json={"member_id": seed_member.id}
    )
    assert resolved.status_code == 200
    assert resolved.get_json()["data"]["events_resolved"] == 1
    saved = db.session.get(RRRAttendanceEvent, event.id)
    assert saved.member_id == seed_member.id
    assert saved.processing_status == "processed"


def test_ebio_pairing_code_is_owner_scoped_and_expiring(client, seed_gym):
    response = client.post("/api/mobile/v1/rrr/integrations/ebioserver/pairing", headers=headers(seed_gym), json={})
    assert response.status_code == 200
    payload = response.get_json()["data"]
    assert len(payload["pairing_code"]) == 6
    row = RRRIntegration.query.filter_by(gym_id=seed_gym["gym"].id, connector_type="ebioserver").one()
    assert row.status == "pairing"
    assert row.pairing_code_hash is not None

    paired = client.post("/api/bridge/v2/pair", json={
        "pairingCode": payload["pairing_code"], "deviceSerial": "ELITE-X2008-01",
        "deviceName": "Elite Gym X2008", "version": "1.1.0-ebioserver",
    })
    assert paired.status_code == 201
    assert paired.get_json()["apiKey"].startswith("rdb_live_")
    installation = BridgeInstallation.query.filter_by(gym_id=seed_gym["gym"].id).one()
    assert installation.connector_type == "ebioserver"
    assert RRRIntegration.query.get(row.id).pairing_code_hash is None


def test_attendance_deduplication_is_source_neutral(seed_gym):
    gym = seed_gym["gym"]
    when = datetime.now(timezone.utc)
    first, first_created = normalize_attendance(
        gym_id=gym.id, source="ebioserver", biometric_user_id="same", punch_time=when,
        external_event_id="same-log", device_serial="SERIAL",
    )
    second, second_created = normalize_attendance(
        gym_id=gym.id, source="direct_bridge", biometric_user_id="same", punch_time=when,
        external_event_id="different-source-log", device_serial="SERIAL",
    )
    db.session.commit()
    assert first_created is True
    assert second_created is False
    assert first.id == second.id


def test_ebio_reports_devices_and_owner_selection_reaches_connector_config(client, seed_gym):
    issued = client.post(
        "/api/mobile/v1/rrr/integrations/ebioserver/pairing", headers=headers(seed_gym), json={}
    ).get_json()["data"]
    paired = client.post("/api/bridge/v2/pair", json={
        "pairingCode": issued["pairing_code"], "deviceSerial": "INITIAL-SERIAL",
        "deviceName": "Initial device", "version": "1.1.0-ebioserver",
    })
    assert paired.status_code == 201
    api_key = paired.get_json()["apiKey"]
    installation = BridgeInstallation.query.filter_by(gym_id=seed_gym["gym"].id).one()
    bridge_headers = {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "INITIAL-SERIAL",
    }
    heartbeat = client.post("/api/bridge/v1/heartbeat", headers=bridge_headers, json={
        "gymId": installation.public_id, "status": "online",
        "devices": [{"serialNumber": "ELITE-X2008", "deviceName": "Elite Gym X2008", "status": "Connected"}],
    })
    assert heartbeat.status_code == 200
    device = RRRDevice.query.filter_by(gym_id=seed_gym["gym"].id, serial_number="ELITE-X2008").one()
    integration = RRRIntegration.query.filter_by(gym_id=seed_gym["gym"].id, connector_type="ebioserver").one()

    selected = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/device",
        headers=headers(seed_gym), json={"device_id": device.id},
    )
    assert selected.status_code == 200
    config = client.get("/api/bridge/v1/config", headers=bridge_headers)
    assert config.status_code == 200
    assert config.get_json()["selectedDeviceSerial"] == "ELITE-X2008"


def test_direct_adms_provisions_device_and_ingests_attendance(client, seed_gym, seed_member):
    seed_member.device_enroll_number = "42"
    db.session.commit()

    provision = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=headers(seed_gym),
        json={"device_serial": "ELITE-X2008-01", "device_name": "Elite Gym X2008"},
    )
    assert provision.status_code == 200
    settings = provision.get_json()["data"]["terminal_settings"]
    assert settings["server_mode"] == "ADMS"
    assert settings["path"] == "/iclock"
    assert settings["warning"].startswith("Attendance plus owner-controlled")

    hello = client.get("/iclock/cdata?SN=ELITE-X2008-01&options=all")
    assert hello.status_code == 200
    assert "~SerialNumber=ELITE-X2008-01" in hello.get_data(as_text=True)

    uploaded = client.post(
        "/iclock/cdata?SN=ELITE-X2008-01&table=ATTLOG",
        data="42\t2026-10-08 10:30:00\t0\t1\t0\t0\n",
        content_type="text/plain",
    )
    assert uploaded.status_code == 200
    event = RRRAttendanceEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, source="adms_direct", biometric_user_id="42"
    ).one()
    assert event.member_id == seed_member.id
    integration = RRRIntegration.query.filter_by(
        gym_id=seed_gym["gym"].id, connector_type="adms_direct"
    ).one()
    assert integration.status == "connected"
    assert integration.commands_enabled is False

    # A cloud terminal must never receive guessed access commands.
    no_command = client.get("/iclock/getrequest?SN=ELITE-X2008-01")
    assert no_command.status_code == 200
    assert no_command.get_data(as_text=True) == "OK"


def test_direct_adms_test_queue_delivers_and_records_terminal_ack(client, seed_gym):
    provision = client.post(
        "/api/mobile/v1/rrr/integrations/adms/provision",
        headers=headers(seed_gym), json={"device_serial": "ELITE-X2008-CMD"},
    )
    integration_id = provision.get_json()["data"]["integration"]["id"]
    assert client.get("/iclock/cdata?SN=ELITE-X2008-CMD").status_code == 200

    queued = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration_id}/adms/commands",
        headers=headers(seed_gym), json={"action": "block_test", "test_enroll_number": "98765"},
    )
    assert queued.status_code == 201
    command_id = queued.get_json()["data"]["command"]["id"]
    assert RRRAdmsCommand.query.get(command_id).status == "queued"

    delivered = client.get("/iclock/getrequest?SN=ELITE-X2008-CMD")
    assert delivered.status_code == 200
    assert delivered.get_data(as_text=True) == f"C:{command_id}:DATA UPDATE USERINFO PIN=98765\tPri=1\n"
    ack = client.post(f"/iclock/devicecmd?SN=ELITE-X2008-CMD&ID={command_id}&Return=0&CMD=DATA")
    assert ack.status_code == 200
    saved = db.session.get(RRRAdmsCommand, command_id)
    assert saved.status == "acked"
    assert saved.result_code == "0"
