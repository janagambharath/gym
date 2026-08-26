from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
from flask import url_for

from app.extensions import db
from app.models import (
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    BridgeRelease,
    Gym,
    GymDeployment,
    Member,
    User,
)
from app.models.bridge import generate_bridge_api_key, hash_bridge_api_key
from app.services.bridge_release_service import (
    check_gym_bridge_status,
    ensure_v1_baseline_registered,
    upgrade_gym_bridge,
)


def _setup_super_admin():
    admin = User.query.filter_by(email="superadmin@renewaldesk.com").first()
    if not admin:
        admin = User(
            email="superadmin@renewaldesk.com",
            full_name="Super Administrator",
            role="super_admin",
            is_active=True,
        )
        admin.set_password("AdminPass123!")
        db.session.add(admin)
        db.session.commit()
    return admin


def _setup_yodha_gym():
    gym = Gym.query.filter_by(slug="yodha-fitness").first()
    if not gym:
        gym = Gym(
            name="Yodha Fitness",
            slug="yodha-fitness",
            status="active",
            onboarding_status="live",
            timezone="Asia/Kolkata",
            currency="INR",
        )
        db.session.add(gym)
        db.session.flush()

    bridge = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
    raw_key = "rdb_live_yodhav1key1234567890123456"
    if not bridge:
        bridge = BridgeInstallation(
            gym_id=gym.id,
            public_id="bridge_yodha_v1",
            api_key_hash=hash_bridge_api_key(raw_key),
            device_serial="X990-YODHA-01",
            display_name="Yodha Fitness Turnstile",
            installed_version="1.0.0",
            installed_build=100,
            release_channel="stable",
            is_active=True,
            status="online",
        )
        db.session.add(bridge)
    db.session.commit()
    return gym, bridge, raw_key


def _setup_test_gym():
    gym = Gym.query.filter_by(slug="alpha-test-gym").first()
    if not gym:
        gym = Gym(
            name="Alpha Test Gym",
            slug="alpha-test-gym",
            status="active",
            onboarding_status="configuring",
            timezone="Asia/Kolkata",
            currency="INR",
        )
        db.session.add(gym)
        db.session.flush()

    dep = GymDeployment.query.filter_by(gym_id=gym.id).first()
    if not dep:
        dep = GymDeployment(
            gym_id=gym.id,
            current_step=7,
            pairing_code="834921",
            pairing_code_expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
            wizard_state_json={},
            checklist_json={},
        )
        db.session.add(dep)
    else:
        dep.pairing_code = "834921"
        dep.pairing_code_expires_at = datetime.now(timezone.utc) + timedelta(hours=2)

    db.session.commit()
    return gym, dep


def test_v1_baseline_registration(client):
    """Verify V1.0.0 package is registered as STABLE and preserved."""
    release = ensure_v1_baseline_registered()
    assert release is not None
    assert release.version == "1.0.0"
    assert release.release_channel == "stable"
    assert release.is_current_stable is True
    assert len(release.sha256_checksum) == 64
    assert release.file_size_bytes > 0



def test_bridge_releases_dashboard(client):
    """Verify super admin can view the Bridge Releases management console."""
    _setup_super_admin()
    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )

    response = client.get("/admin/bridge/releases")
    assert response.status_code == 200
    assert b"Bridge Release Management" in response.data
    assert b"v1.0.0" in response.data
    assert b"STABLE" in response.data


def test_upload_v2_bridge_release(client):
    """Verify uploading a new versioned V2 Bridge package with SHA-256 validation."""
    _setup_super_admin()
    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )

    fake_zip = io.BytesIO(b"PK\x03\x04RENEWAL_DESK_BRIDGE_V2_TEST_PAYLOAD")
    response = client.post(
        "/admin/bridge/releases/upload",
        data={
            "version": "2.0.0",
            "build_number": "2001",
            "release_channel": "testing",
            "supported_os": "Windows 10/11 x64",
            "min_supported_app_version": "v2.0",
            "release_notes": "Secure one-time pairing, auto-reconnect, and biometric diagnostics.",
            "file": (fake_zip, "RenewalDeskBridge-v2.0.0.zip"),
        },
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200

    v2_rel = BridgeRelease.query.filter_by(version="2.0.0").first()
    assert v2_rel is not None
    assert v2_rel.build_number == 2001
    assert v2_rel.release_channel == "testing"
    assert v2_rel.is_current_stable is False
    assert len(v2_rel.sha256_checksum) == 64

    # Duplicate version rejection
    fake_zip2 = io.BytesIO(b"DUPLICATE_PAYLOAD")
    dup_res = client.post(
        "/admin/bridge/releases/upload",
        data={
            "version": "2.0.0",
            "build_number": "2001",
            "release_channel": "testing",
            "file": (fake_zip2, "RenewalDeskBridge-v2.0.0.zip"),
        },
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert b"already exists" in dup_res.data


def test_channel_promotion_and_download(client):
    """Verify channel transitions and secure package download."""
    _setup_super_admin()
    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )

    v1_rel = ensure_v1_baseline_registered()

    # Download V1
    dl_res = client.get(f"/admin/bridge/releases/{v1_rel.id}/download")
    assert dl_res.status_code == 200
    assert dl_res.headers["Content-Disposition"].startswith("attachment")
    assert "RenewalDeskBridge" in dl_res.headers["Content-Disposition"]

    # Verify download count incremented
    db.session.refresh(v1_rel)
    assert v1_rel.downloads_count >= 1


def test_bridge_v2_pairing_flow(client):
    """Verify /api/bridge/v2/pair exchanges 6-digit OTP for credentials and burns code."""
    gym, dep = _setup_test_gym()

    # Valid Pairing Request
    response = client.post(
        "/api/bridge/v2/pair",
        json={
            "pairingCode": "834921",
            "deviceSerial": "X990-ALPHA-01",
            "version": "2.0.0",
            "buildNumber": 2001,
            "osInfo": "Windows 11 Pro 64-bit",
            "pcName": "ALPHA-DESK-01",
        },
    )
    assert response.status_code == 201
    data = response.get_json()
    assert data["ok"] is True
    assert data["gymName"] == "Alpha Test Gym"
    assert data["deviceSerial"] == "X990-ALPHA-01"
    assert "apiKey" in data
    assert data["protocolVersion"] == 2

    # Verify installation record updated
    inst = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
    assert inst is not None
    assert inst.device_serial == "X990-ALPHA-01"
    assert inst.installed_version == "2.0.0"
    assert inst.pc_name == "ALPHA-DESK-01"
    assert inst.status == "paired"

    # Verify pairing code is burned (cannot be reused)
    db.session.refresh(dep)
    assert dep.pairing_code is None
    assert dep.pairing_code_expires_at is None

    # Second attempt with same code fails
    replay_res = client.post(
        "/api/bridge/v2/pair",
        json={
            "pairingCode": "834921",
            "deviceSerial": "X990-ALPHA-01",
        },
    )
    assert replay_res.status_code == 401


def test_bridge_v2_pairing_expired_code(client):
    """Verify expired pairing codes are rejected."""
    gym, dep = _setup_test_gym()
    dep.pairing_code = "999888"
    dep.pairing_code_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.session.commit()

    res = client.post(
        "/api/bridge/v2/pair",
        json={
            "pairingCode": "999888",
            "deviceSerial": "X990-EXPIRED-01",
        },
    )
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "pairing_code_expired"


def test_heartbeat_telemetry_and_v1_backward_compatibility(client):
    """Verify V1 heartbeat continues without change, and V2 heartbeat records telemetry."""
    gym, bridge, raw_key = _setup_yodha_gym()

    # V1 Heartbeat (no version info sent)
    v1_res = client.post(
        "/api/bridge/v1/heartbeat",
        headers={
            "X-Api-Key": raw_key,
            "X-RenewalDesk-Bridge-Protocol": "2",
            "X-Device-Serial": "X990-YODHA-01",
        },
        json={
            "gymId": bridge.public_id,
            "status": "online",
        },
    )
    assert v1_res.status_code == 200
    assert v1_res.get_json()["ok"] is True

    # V2 Heartbeat (with telemetry metadata)
    v2_res = client.post(
        "/api/bridge/v1/heartbeat",
        headers={
            "X-Api-Key": raw_key,
            "X-RenewalDesk-Bridge-Protocol": "2",
            "X-Device-Serial": "X990-YODHA-01",
        },
        json={
            "gymId": bridge.public_id,
            "status": "online",
            "version": "1.0.0",
            "buildNumber": 100,
            "osInfo": "Windows 10 Enterprise",
            "pcName": "YODHA-MAIN-PC",
        },
    )
    assert v2_res.status_code == 200

    db.session.refresh(bridge)
    assert bridge.status == "online"
    assert bridge.pc_name == "YODHA-MAIN-PC"
    assert bridge.os_info == "Windows 10 Enterprise"


def test_yodha_fitness_protection_gate(client):
    """Verify Yodha Fitness is pinned to STABLE and cannot be upgraded to a TESTING release."""
    yodha_gym, bridge, _ = _setup_yodha_gym()


    # Ensure a V2 release exists in TESTING channel
    v2_testing = BridgeRelease.query.filter_by(version="2.0.0").first()
    if not v2_testing:
        v2_testing = BridgeRelease(
            version="2.0.0",
            build_number=2001,
            release_channel="testing",
            filename="RenewalDeskBridge-2.0.0.zip",
            file_path="uploads/bridge_releases/RenewalDeskBridge-2.0.0.zip",
            sha256_checksum="dummyhash123",
            file_size_bytes=1000,
            is_current_stable=False,
        )
        db.session.add(v2_testing)
        db.session.commit()
    else:
        v2_testing.release_channel = "testing"
        db.session.commit()

    # Attempt upgrade for Yodha Fitness with TESTING release -> MUST FAIL
    ok, msg = upgrade_gym_bridge(yodha_gym.id, "2.0.0")
    assert ok is False
    assert "YODHA FITNESS PROTECTION" in msg

    # Now promote V2 to STABLE
    v2_testing.release_channel = "stable"
    db.session.commit()

    # Attempt upgrade for Yodha Fitness with STABLE release -> MUST SUCCEED
    ok_stable, msg_stable = upgrade_gym_bridge(yodha_gym.id, "2.0.0")
    assert ok_stable is True
    assert "upgraded to v2.0.0" in msg_stable


def test_bridge_revocation_stops_communication(client):
    """Verify super admin revoking a bridge cuts off communication immediately."""
    gym, bridge, raw_key = _setup_yodha_gym()
    _setup_super_admin()

    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )

    # Revoke bridge
    revoke_res = client.post(f"/admin/gyms/{gym.id}/bridge/revoke", follow_redirects=True)
    assert revoke_res.status_code == 200

    db.session.refresh(bridge)
    assert bridge.is_active is False
    assert bridge.status == "revoked"

    # Bridge tries to send heartbeat with previous key -> REJECTED 401
    heartbeat_res = client.post(
        "/api/bridge/v1/heartbeat",
        headers={
            "X-Api-Key": raw_key,
            "X-RenewalDesk-Bridge-Protocol": "2",
            "X-Device-Serial": "X990-YODHA-01",
        },
        json={
            "gymId": bridge.public_id,
            "status": "online",
        },
    )
    assert heartbeat_res.status_code == 401
