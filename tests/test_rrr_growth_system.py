from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models import BridgeInstallation
from app.models.rrr import RRRAttendanceEvent, RRRIntegration
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
        gym_id=gym.id, source="ebioserver", biometric_user_id="same", punch_time=when,
        external_event_id="same-log", device_serial="SERIAL",
    )
    db.session.commit()
    assert first_created is True
    assert second_created is False
    assert first.id == second.id
