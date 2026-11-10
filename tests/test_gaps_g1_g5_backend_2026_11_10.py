"""Gaps G1–G5 backend (2026-11-10) — Bharath: "Yes build all".

G1 self-serve ADMS decommission / terminal replacement.
G2 owner-facing audit-log read API.
G3 proactive terminal-offline alert (one per outage, auto-clear on resume).
G4 fingerprint restore rewired (same-member guard, V6-L9 hazard closed).
G5 "active member, door blocked" detector (detection only).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, Member, User
from app.models.app_notification import AppNotification
from app.models.audit_log import AuditLog
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRBiometricTemplate,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.services.bridge_service import (
    adms_command_text,
    find_blocked_active_members,
    invalidate_adms_enroll_index,
)
from app.services.rrr_service import scan_terminal_offline_alerts
from app.services.template_crypto import encrypt_template

SERIAL = "GAPS-X2008-01"
TOKEN = "gaps-adms-token"


def _owner_headers(seed_gym, role="gym_owner"):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, role)}"}


def _staff_headers(seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="gaps-staff@testgym.com",
        full_name="Gaps Staff",
        role="staff",
    )
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return {"Authorization": f"Bearer {create_access_token(staff.id, seed_gym['gym'].id, 'staff')}"}


def _integration(seed_gym, *, serial=SERIAL, commands_enabled=True,
                 last_success_at="now", status="connected", token=None):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Gaps ADMS",
        device_serial=serial,
        device_name="Gaps X2008",
        status=status,
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed",
        # adms_path_token is unique: extra integrations in one test need
        # their own token (the primary serial keeps TOKEN for getrequest).
        adms_path_token=token if token is not None else (
            TOKEN if serial == SERIAL else f"gaps-token-{serial}"
        ),
        last_success_at=(
            datetime.now(timezone.utc) if last_success_at == "now"
            else last_success_at
        ),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _member(seed_gym, *, name="Active Ana", phone="+919100000101",
            enroll="7", status="active", end=None):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        membership_start=date.today() - timedelta(days=30),
        membership_end=end if end is not None else date.today() + timedelta(days=30),
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    invalidate_adms_enroll_index(seed_gym["gym"].id)
    return member


def _second_gym_with_terminal(*, serial="GAPS-OTHER-01"):
    gym = Gym(
        name="Other Gym", slug="other-gym", email="owner@othergym.com",
        phone="+919876543211", status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=7),
        max_members=50,
    )
    db.session.add(gym)
    db.session.flush()
    row = RRRIntegration(
        gym_id=gym.id, connector_type="adms_direct",
        display_name="Other ADMS", device_serial=serial,
        status="connected", commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token="other-token",
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return gym, row


def _template(integration, member, *, enroll="7", fid=0, member_id="member"):
    row = RRRBiometricTemplate(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        member_id=member.id if member_id == "member" else member_id,
        enroll_number=enroll,
        finger_id=fid,
        template_data=encrypt_template("QUJDREVGRw=="),
        template_format="push_tmp",
    )
    db.session.add(row)
    db.session.commit()
    return row


def _adms_command(integration, *, action, enroll, member=None, status="acked"):
    row = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=(
            adms_command_text(action, enroll, member_name="Test Member")
            if action in ("block", "unblock")
            else f"C:TEST {action} PIN={enroll}"
        ),
        status=status,
        intended_member_id=member.id if member is not None else None,
    )
    db.session.add(row)
    db.session.commit()
    return row


# ─── G1: replace / decommission ─────────────────────────────────────────────

def test_g1_replace_happy_path(client, seed_gym):
    integration = _integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/replace",
        json={"device_serial": "GAPS-X2008-02", "device_name": "New X2008",
              "confirm": True},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_json()
    data = res.json["data"]
    assert data["integration"]["device_serial"] == "GAPS-X2008-02"
    assert data["integration"]["commands_enabled"] is False
    assert data["integration"]["commissioning_status"] == "not_started"
    assert data["terminal_settings"]["path"].startswith("/iclock/")
    # Old token revoked immediately; new token authenticates.
    db.session.expire_all()
    row = db.session.get(RRRIntegration, integration.id)
    assert row.adms_token_matches(TOKEN) is None
    new_token = data["terminal_settings"]["path"].split("/iclock/")[1]
    assert row.adms_token_matches(new_token) == "token"
    assert AuditLog.query.filter_by(
        gym_id=seed_gym["gym"].id, action="adms_terminal_replaced"
    ).count() == 1


def test_g1_replace_wrong_gym_serial_409(client, seed_gym):
    integration = _integration(seed_gym)
    _second_gym_with_terminal(serial="GAPS-OTHER-01")
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/replace",
        json={"device_serial": "GAPS-OTHER-01", "confirm": True},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 409
    assert res.json["error"]["code"] == "CONFLICT"


def test_g1_replace_missing_confirm_422_and_same_serial_422(client, seed_gym):
    integration = _integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/replace",
        json={"device_serial": "GAPS-X2008-02"},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 422
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/replace",
        json={"device_serial": SERIAL, "confirm": True},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 422


def test_g1_replace_staff_403(client, seed_gym):
    integration = _integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/replace",
        json={"device_serial": "GAPS-X2008-02", "confirm": True},
        headers=_staff_headers(seed_gym),
    )
    assert res.status_code == 403


def test_g1_decommission_happy_path_and_confirm_required(client, seed_gym):
    integration = _integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/decommission",
        json={},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 422
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/decommission",
        json={"confirm": True},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_json()
    assert res.json["data"]["integration"]["commands_enabled"] is False
    assert res.json["data"]["integration"]["commissioning_status"] == "not_started"
    assert res.json["data"]["integration"]["status"] == "disconnected"
    assert AuditLog.query.filter_by(
        gym_id=seed_gym["gym"].id, action="adms_terminal_decommissioned"
    ).count() == 1


# ─── G2: audit-log read API ─────────────────────────────────────────────────

def _audit_row(seed_gym, *, action, actor=None, created_at=None):
    row = AuditLog(
        gym_id=seed_gym["gym"].id,
        actor_user_id=actor.id if actor else None,
        action=action,
        resource_type="member",
        resource_id="1",
        metadata_json={"note": "gaps"},
    )
    if created_at is not None:
        row.created_at = created_at
    db.session.add(row)
    db.session.commit()
    return row


def test_g2_scoping_and_actor_names(client, seed_gym):
    _audit_row(seed_gym, action="member_renewed", actor=seed_gym["owner"])
    _audit_row(seed_gym, action="payment_verified", actor=None)
    other_gym, _ = _second_gym_with_terminal()
    db.session.add(AuditLog(
        gym_id=other_gym.id, actor_user_id=None, action="member_renewed",
        resource_type="member", resource_id="9", metadata_json={},
    ))
    db.session.commit()
    res = client.get("/api/mobile/v1/audit-logs", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    data = res.json["data"]
    assert data["total"] == 2
    assert data["page"] == 1 and data["per_page"] == 20
    by_action = {item["action"]: item for item in data["items"]}
    assert by_action["member_renewed"]["actor_name"] == "Gym Owner"
    assert by_action["payment_verified"]["actor_name"] == "System"
    assert by_action["member_renewed"]["metadata"] == {"note": "gaps"}
    # No other-gym row leaks, even though it shares the same action.
    assert all(item["resource_id"] != "9" for item in data["items"])


def test_g2_pagination_and_filters(client, seed_gym):
    _audit_row(seed_gym, action="member_renewed", actor=seed_gym["owner"])
    _audit_row(seed_gym, action="member_renewed", actor=seed_gym["owner"])
    _audit_row(
        seed_gym, action="payment_verified", actor=None,
        created_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    res = client.get(
        "/api/mobile/v1/audit-logs?per_page=2&page=1",
        headers=_owner_headers(seed_gym),
    )
    assert res.json["data"]["total"] == 3
    assert len(res.json["data"]["items"]) == 2
    res = client.get(
        "/api/mobile/v1/audit-logs?per_page=2&page=2",
        headers=_owner_headers(seed_gym),
    )
    assert len(res.json["data"]["items"]) == 1
    res = client.get(
        "/api/mobile/v1/audit-logs?action=payment_verified",
        headers=_owner_headers(seed_gym),
    )
    assert res.json["data"]["total"] == 1
    res = client.get(
        "/api/mobile/v1/audit-logs?from=" + date.today().isoformat(),
        headers=_owner_headers(seed_gym),
    )
    assert res.json["data"]["total"] == 2  # the 10-day-old row is excluded
    res = client.get(
        "/api/mobile/v1/audit-logs?from=not-a-date",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 422


def test_g2_staff_403(client, seed_gym):
    res = client.get("/api/mobile/v1/audit-logs", headers=_staff_headers(seed_gym))
    assert res.status_code == 403


# ─── G3: terminal-offline alert ─────────────────────────────────────────────

def test_g3_alert_created_once_per_outage(seed_gym):
    integration = _integration(
        seed_gym, last_success_at=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    first = scan_terminal_offline_alerts(seed_gym["gym"])
    db.session.commit()
    second = scan_terminal_offline_alerts(seed_gym["gym"])
    db.session.commit()
    assert first == {"alerts_created": 1, "alerts_cleared": 0}
    assert second == {"alerts_created": 0, "alerts_cleared": 0}
    rows = AppNotification.query.filter_by(
        gym_id=seed_gym["gym"].id, category="terminal_offline"
    ).all()
    assert len(rows) == 1
    assert rows[0].user_id is None
    assert rows[0].data["integration_id"] == integration.id
    assert rows[0].is_read is False


def test_g3_auto_cleared_on_resume(seed_gym):
    integration = _integration(
        seed_gym, last_success_at=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    scan_terminal_offline_alerts(seed_gym["gym"])
    db.session.commit()
    # Terminal polls again: last_success_at is fresh now.
    integration.last_success_at = datetime.now(timezone.utc)
    db.session.commit()
    cleared = scan_terminal_offline_alerts(seed_gym["gym"])
    db.session.commit()
    assert cleared == {"alerts_created": 0, "alerts_cleared": 1}
    row = AppNotification.query.filter_by(
        gym_id=seed_gym["gym"].id, category="terminal_offline"
    ).one()
    assert row.is_read is True


def test_g3_touch_clears_on_poll(seed_gym):
    from app.adms.routes import _touch

    integration = _integration(
        seed_gym, last_success_at=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    scan_terminal_offline_alerts(seed_gym["gym"])
    db.session.commit()
    _touch(integration, method="token", full=True)
    db.session.commit()
    row = AppNotification.query.filter_by(
        gym_id=seed_gym["gym"].id, category="terminal_offline"
    ).one()
    assert row.is_read is True


def test_g3_never_for_uncommissioned_or_never_polled(seed_gym):
    # One adms_direct integration per gym (unique gym+connector), so the
    # two never-alert states are exercised by mutating the same row.
    integration = _integration(
        seed_gym, commands_enabled=False,
        last_success_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    assert scan_terminal_offline_alerts(seed_gym["gym"]) == {
        "alerts_created": 0, "alerts_cleared": 0,
    }
    integration.commands_enabled = True
    integration.last_success_at = None
    integration.status = "not_configured"
    db.session.commit()
    assert scan_terminal_offline_alerts(seed_gym["gym"]) == {
        "alerts_created": 0, "alerts_cleared": 0,
    }
    assert AppNotification.query.filter_by(
        gym_id=seed_gym["gym"].id, category="terminal_offline"
    ).count() == 0


def test_g3_access_summary_carries_offline_state(client, seed_gym):
    _integration(
        seed_gym, last_success_at=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    res = client.get("/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    offline = res.json["data"]["terminal_offline"]
    assert offline is not None
    assert offline["last_success_at"] is not None
    assert offline["since"] == offline["last_success_at"]


def test_g3_access_summary_no_offline_when_healthy(client, seed_gym):
    _integration(seed_gym)  # polled just now
    res = client.get("/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["terminal_offline"] is None


# ─── G4: fingerprint restore ────────────────────────────────────────────────

def test_g4_restore_queues_only_same_member_templates(client, seed_gym):
    integration = _integration(seed_gym)
    member = _member(seed_gym)
    _template(integration, member)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/restore-fingerprints",
        json={}, headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201, res.get_json()
    assert len(res.json["data"]["queued"]) == 1
    assert res.json["data"]["skipped"] == []
    row = db.session.get(RRRAdmsCommand, res.json["data"]["queued"][0])
    assert row.action == "restore_template"
    assert row.test_enroll_number == "7"
    assert row.intended_member_id == member.id
    assert row.command_text == "DATA UPDATE FINGERTMP PIN=7\tFID=0\tTMP=QUJDREVGRw=="


def test_g4_restore_dedupe_repeated_taps(client, seed_gym):
    integration = _integration(seed_gym)
    member = _member(seed_gym)
    _template(integration, member)
    url = (
        f"/api/mobile/v1/rrr/integrations/{integration.id}"
        "/restore-fingerprints"
    )
    first = client.post(url, json={}, headers=_owner_headers(seed_gym))
    second = client.post(url, json={}, headers=_owner_headers(seed_gym))
    assert first.status_code == 201 and second.status_code == 201
    assert len(first.json["data"]["queued"]) == 1
    assert len(second.json["data"]["queued"]) == 0
    assert len(second.json["data"]["deduped"]) == 1
    assert RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="restore_template",
        status="queued",
    ).count() == 1


def test_g4_recycled_enroll_never_restores(client, seed_gym):
    integration = _integration(seed_gym)
    old_holder = _member(seed_gym, name="Old Holder", phone="+919100000102", enroll="7")
    new_holder = _member(seed_gym, name="New Holder", phone="+919100000103", enroll="8")
    _template(integration, old_holder)  # captured when 7 belonged to Old Holder
    # Enroll 7 is recycled: the confirmed mapping now points at New Holder.
    db.session.add(RRRIdentityMapping(
        gym_id=seed_gym["gym"].id, member_id=new_holder.id,
        external_id="7", source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    invalidate_adms_enroll_index(seed_gym["gym"].id)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/restore-fingerprints",
        json={}, headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201, res.get_json()
    assert res.json["data"]["queued"] == []
    assert res.json["data"]["skipped"][0]["reason"] == "enroll_recycled_or_unmapped"
    assert RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="restore_template",
    ).count() == 0


def test_g4_legacy_null_anchor_and_expired_member_skipped(client, seed_gym):
    integration = _integration(seed_gym)
    member = _member(seed_gym)
    _template(integration, member, member_id=None)  # pre-G4 capture: no anchor
    expired = _member(
        seed_gym, name="Expired Ed", phone="+919100000104", enroll="8",
        status="expired", end=date.today() - timedelta(days=5),
    )
    _template(integration, expired, enroll="8")
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/restore-fingerprints",
        json={}, headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201, res.get_json()
    assert res.json["data"]["queued"] == []
    reasons = {s["reason"] for s in res.json["data"]["skipped"]}
    assert reasons == {"no_member_anchor", "member_not_enableable"}


def test_g4_restore_serve_time_guard_cancels_on_remap(client, seed_gym):
    integration = _integration(seed_gym)
    old_holder = _member(seed_gym, name="Old Holder", phone="+919100000102", enroll="7")
    new_holder = _member(seed_gym, name="New Holder", phone="+919100000103", enroll="8")
    _template(integration, old_holder)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/restore-fingerprints",
        json={}, headers=_owner_headers(seed_gym),
    )
    assert len(res.json["data"]["queued"]) == 1
    # Recycled AFTER queueing, before the terminal polls.
    db.session.add(RRRIdentityMapping(
        gym_id=seed_gym["gym"].id, member_id=new_holder.id,
        external_id="7", source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    invalidate_adms_enroll_index(seed_gym["gym"].id)
    poll = client.get(f"/iclock/{TOKEN}/getrequest?SN={SERIAL}")
    assert poll.status_code == 200
    assert poll.get_data(as_text=True) == "OK"
    row = db.session.get(RRRAdmsCommand, res.json["data"]["queued"][0])
    assert row.status == "cancelled"
    assert "Superseded" in (row.result_message or "")


def test_g4_restore_staff_403_and_uncommissioned_403(client, seed_gym):
    integration = _integration(seed_gym)
    url = (
        f"/api/mobile/v1/rrr/integrations/{integration.id}"
        "/restore-fingerprints"
    )
    assert client.post(url, json={}, headers=_staff_headers(seed_gym)).status_code == 403
    integration.commands_enabled = False
    db.session.commit()
    res = client.post(url, json={}, headers=_owner_headers(seed_gym))
    assert res.status_code == 403
    assert res.json["error"]["code"] == "NOT_COMMISSIONED"


# ─── G5: blocked-active detector ────────────────────────────────────────────

def test_g5_detector_finds_active_blocked_and_ignores_rest(client, seed_gym):
    integration = _integration(seed_gym)
    active_blocked = _member(seed_gym, name="Blocked Bea", phone="+919100000105", enroll="7")
    expired_blocked = _member(
        seed_gym, name="Expired Ed", phone="+919100000106", enroll="8",
        status="expired", end=date.today() - timedelta(days=5),
    )
    paused_blocked = _member(
        seed_gym, name="Paused Pam", phone="+919100000107", enroll="9",
        status="paused", end=date.today() + timedelta(days=30),
    )
    active_open = _member(seed_gym, name="Open Oli", phone="+919100000108", enroll="10")
    _adms_command(integration, action="block", enroll="7", member=active_blocked)
    _adms_command(integration, action="block", enroll="8", member=expired_blocked)
    _adms_command(integration, action="block", enroll="9", member=paused_blocked)
    _adms_command(integration, action="unblock", enroll="10", member=active_open)
    res = client.get("/api/mobile/v1/rrr/blocked-active", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_json()
    members = res.json["data"]["members"]
    assert [m["id"] for m in members] == [active_blocked.id]
    assert members[0]["name"] == "Blocked Bea"
    assert members[0]["enroll_number"] == "7"
    assert members[0]["membership_end"] == (date.today() + timedelta(days=30)).isoformat()


def test_g5_detector_never_mutates_door_state(client, seed_gym):
    integration = _integration(seed_gym)
    member = _member(seed_gym)
    _adms_command(integration, action="block", enroll="7", member=member)
    before = [
        (row.id, row.status, row.action)
        for row in RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).all()
    ]
    res = client.get("/api/mobile/v1/rrr/blocked-active", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert find_blocked_active_members(seed_gym["gym"].id)
    after = [
        (row.id, row.status, row.action)
        for row in RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).all()
    ]
    assert before == after  # detection only: no row added, none changed


def test_g5_staff_can_read(client, seed_gym):
    _integration(seed_gym)
    res = client.get("/api/mobile/v1/rrr/blocked-active", headers=_staff_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["members"] == []
