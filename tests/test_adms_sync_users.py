"""Tests for ADMS sync_users (PC-less smart matching).

The terminal uploads its USERINFO table in response to DATA QUERY USERINFO;
the cdata handler stores it as the command's result_data; smart matching
reads it like a bridge snapshot.
"""
import json

from app.adms.routes import _parse_userinfo_line
from app.extensions import db
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services import enroll_match_service
from app.services.bridge_service import adms_command_text


def test_adms_command_text_sync_users():
    assert adms_command_text("sync_users", None) == "DATA QUERY USERINFO PIN=ALL"


def test_parse_userinfo_line():
    parsed = _parse_userinfo_line("USER PIN=42\tName=Ramesh Kumar\tPri=0\tPasswd=\tCard=0\tGrp=1")
    assert parsed == {"enroll_number": "42", "name": "Ramesh Kumar"}
    assert _parse_userinfo_line("ATTLOG garbage") is None
    assert _parse_userinfo_line("USER Name=NoPin") is None


def _seed_adms(app, seed_gym):
    gym = seed_gym["gym"]
    with app.app_context():
        integration = RRRIntegration(
            gym_id=gym.id,
            connector_type="adms_direct",
            display_name="Test ADMS",
            device_serial="TEST-ADMS-1",
            status="not_configured",
            adms_path_token=f"test-adms-token-{gym.id}",
        )
        db.session.add(integration)
        db.session.flush()
        iid = integration.id
        db.session.commit()
        return iid


def test_userinfo_ingest_and_snapshot(client, app, seed_gym, seed_member):
    from app.mobile_api.token_service import create_access_token

    gym = seed_gym["gym"]
    iid = _seed_adms(app, seed_gym)

    # Simulate the terminal uploading its user table.
    body = (
        "USER PIN=7\tName=John Doe\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
        "USER PIN=8\tName=Jane Smith\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
    )
    with app.app_context():
        cmd = RRRAdmsCommand(
            integration_id=iid, gym_id=gym.id, action="sync_users",
            command_text="DATA QUERY USERINFO PIN=ALL",
        )
        db.session.add(cmd)
        db.session.commit()
        cmd_id = cmd.id
        token = RRRIntegration.query.get(iid).adms_path_token

    res = client.post(
        f"/iclock/{token}/cdata?SN=TEST-ADMS-1&table=USERINFO",
        data=body, content_type="text/plain",
    )
    assert res.status_code == 200

    with app.app_context():
        cmd = db.session.get(RRRAdmsCommand, cmd_id)
        assert cmd.status == "acked"
        data = json.loads(cmd.result_data)
        assert data["count"] == 2

        snapshot = enroll_match_service.get_adms_snapshot(gym.id)
        assert snapshot is not None
        assert snapshot["source"] == "adms"
        assert len(snapshot["users"]) == 2

        # Smart matching works off the ADMS snapshot.
        result = enroll_match_service.suggest_matches(gym.id)
        suggestions = {s["enroll_number"]: s for s in result["suggestions"]}
        assert "7" in suggestions
        assert suggestions["7"]["member_id"] == seed_member.id


def test_operlog_enrollment_persists_without_logging_member_data(client, app, seed_gym, caplog):
    """The OPERLOG path must save the snapshot without leaking names or PINs."""
    gym = seed_gym["gym"]
    iid = _seed_adms(app, seed_gym)
    with app.app_context():
        integration = db.session.get(RRRIntegration, iid)
        token = integration.adms_path_token

    body = (
        "PIN=73\tName=Private Fixture Member\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
    )
    with caplog.at_level("INFO"):
        response = client.post(
            f"/iclock/{token}/cdata?SN=TEST-ADMS-1&table=OPERLOG",
            data=body,
            content_type="text/plain",
        )

    assert response.status_code == 200
    with app.app_context():
        command = RRRAdmsCommand.query.filter_by(
            integration_id=iid, action="operlog_snapshot"
        ).first()
        assert command is not None
        snapshot = enroll_match_service.get_adms_snapshot(gym.id)
        assert snapshot is not None
        assert {"enroll_number": "73", "name": "Private Fixture Member"} in snapshot["users"]

    assert "Private Fixture Member" not in caplog.text
    assert "PIN=73" not in caplog.text


def test_enroll_scan_prefers_adms(client, app, seed_gym):
    from app.mobile_api.token_service import create_access_token

    gym = seed_gym["gym"]
    owner = seed_gym["owner"]
    _seed_adms(app, seed_gym)
    token = create_access_token(user_id=owner.id, gym_id=gym.id, role="gym_owner")
    headers = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/mobile/v1/rrr/enroll-scan", headers=headers)
    assert res.status_code == 201
    assert res.json["data"]["path"] == "adms"
    with app.app_context():
        cmd = RRRAdmsCommand.query.filter_by(gym_id=gym.id, action="sync_users").first()
        assert cmd is not None
        assert cmd.command_text == "DATA QUERY USERINFO"
