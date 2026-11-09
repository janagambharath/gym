"""Fix-all v11 — ADMS / door / scheduler findings (2026-11-09).

Covers V11-H3 (scheduler never re-queued a failed unblock), V11-L5
(/access/reconcile staff-open), V11-L6 (sticky-status device gate),
V11-L7 (no audit on serve-time guard cancels), V11-L8 (enroll_scan
in-flight guard), V11-L9 (unmapped_records ever-count), V11-L10
(USERINFO 256 KB cap + sync_users retry), V11-L11 (unbounded
full-gym reconcile).

Hard invariant pinned throughout: the unblock scan only ever touches
members proven enableable (active, not deleted, end date today or
later) — an expired/paused/deleted member is NEVER unblocked by it.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, User
from app.models.audit_log import AuditLog
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.models.rrr import RRRAdmsCommand, RRRAttendanceEvent, RRRIntegration
from app.services.bridge_service import (
    adms_command_text,
    invalidate_adms_enroll_index,
    queue_gym_reconciliation,
    reconcile_failed_membership_commands,
)


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _staff_headers(seed_gym):
    staff = User(
        gym_id=seed_gym["gym"].id,
        email="staff@testgym.com",
        full_name="Gym Staff",
        role="staff",
    )
    staff.set_password("SecurePass123!")
    db.session.add(staff)
    db.session.commit()
    return {"Authorization": f"Bearer {create_access_token(staff.id, seed_gym['gym'].id, 'staff')}"}


def _member(gym_id, plan_id, *, name, phone, enroll, status, end, deleted=False):
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
    if deleted:
        member.deleted_at = datetime.now(timezone.utc)
    db.session.add(member)
    db.session.commit()
    invalidate_adms_enroll_index(gym_id)
    return member


def _adms_integration(seed_gym, *, serial="V11-ADMS-1", token="v11-adms-token",
                      commands_enabled=True, last_success_at="now"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V11 ADMS",
        device_serial=serial,
        device_name="V11 X2008",
        status="connected",
        commands_enabled=commands_enabled,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=(
            datetime.now(timezone.utc) if last_success_at == "now"
            else last_success_at
        ),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _adms_row(integration, *, action, enroll, member=None, status="failed",
              requested_by_id=None):
    row = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=adms_command_text(action, enroll, member_name="Test Member")
        if action in ("block", "unblock")
        else f"C:TEST {action} PIN={enroll}",
        status=status,
        result_code="TIMEOUT" if status == "failed" else None,
        result_message="Timeout: no ack within 10 min" if status == "failed" else None,
        intended_member_id=member.id if member is not None else None,
        requested_by_id=requested_by_id,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _active_member(seed_gym, *, name="Active Member", phone="+919100000001",
                   enroll="101", end=None):
    return _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name=name, phone=phone,
        enroll=enroll, status="active",
        end=end or (date.today() + timedelta(days=20)),
    )


# ─── V11-H3: failed unblock re-drive ──────────────────────────────────────

def test_h3_failed_unblock_requeues_for_renewed_member(app, seed_gym):
    """A renewed member whose unblock failed once gets a fresh unblock."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    _adms_row(integration, action="unblock", enroll="101", member=member)
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 1
    assert counts["adms_blocks"] == 0
    with app.app_context():
        fresh = RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock",
            test_enroll_number="101", status="queued",
        ).all()
        assert len(fresh) == 1
        assert fresh[0].intended_member_id == member.id


def test_h3_no_requeue_when_unblock_already_acked(app, seed_gym):
    """An acked unblock for the same member means the door is already open."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    _adms_row(integration, action="unblock", enroll="101", member=member,
              status="acked")
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 0


def test_h3_queued_unblock_is_not_stacked(app, seed_gym):
    """A queued (in-flight) unblock is deduped, never stacked."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    _adms_row(integration, action="unblock", enroll="101", member=member,
              status="queued")
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 1


def test_h3_expired_member_is_never_unblocked(app, seed_gym):
    """FAIL-SAFE: an expired member with a failed unblock gets a block, never an unblock."""
    integration = _adms_integration(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Expired", phone="+919100000002",
        enroll="102", status="expired", end=date.today() - timedelta(days=5),
    )
    _adms_row(integration, action="unblock", enroll="102", member=member)
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock",
            test_enroll_number="102",
        ).count() == 1  # only the original failed row
        # The block leg still re-drives the block for the expired member.
        assert counts["adms_blocks"] == 1


def test_h3_paused_and_deleted_members_are_never_unblocked(app, seed_gym):
    """FAIL-SAFE: paused / soft-deleted members are never unblocked by the scan."""
    integration = _adms_integration(seed_gym)
    paused = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Paused", phone="+919100000003",
        enroll="103", status="paused", end=date.today() + timedelta(days=20),
    )
    deleted = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Deleted", phone="+919100000004",
        enroll="104", status="expired", end=date.today() + timedelta(days=20),
        deleted=True,
    )
    _adms_row(integration, action="unblock", enroll="103", member=paused)
    _adms_row(integration, action="unblock", enroll="104", member=deleted)
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 0


def test_h3_active_member_with_past_end_is_never_unblocked(app, seed_gym):
    """FAIL-SAFE: status active but end date in the past is not enableable."""
    integration = _adms_integration(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Stale Active",
        phone="+919100000005", enroll="105", status="active",
        end=date.today() - timedelta(days=1),
    )
    _adms_row(integration, action="unblock", enroll="105", member=member)
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    assert counts["adms_blocks"] == 0  # active status is not blockable either
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, status="queued"
        ).count() == 0


def test_h3_unblock_scan_skips_newer_manual_block(app, seed_gym):
    """An owner's newer misconduct block is never undone by the scheduler."""
    from app.services.bridge_service import queue_manual_adms_member_command
    from app.models.mixins import utcnow

    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    manual = queue_manual_adms_member_command(member, "block", seed_gym["owner"].id)
    manual.status = "acked"
    manual.acknowledged_at = utcnow()
    db.session.commit()
    _adms_row(integration, action="unblock", enroll="101", member=member)
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 0


def test_h3_bridge_failed_unblock_requeues(app, seed_gym):
    """Bridge leg mirror: a failed enable_user for an active member re-drives."""
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "V11-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    member = _active_member(seed_gym)
    failed = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id,
        member_id=member.id, command_type="enable_user",
        enroll_number="101", member_name=member.full_name, status="failed",
    )
    db.session.add(failed)
    db.session.commit()
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["bridge_unblocks"] == 1
    assert counts["bridge_blocks"] == 0
    with app.app_context():
        assert BridgeCommand.query.filter_by(
            bridge_id=installation.id, member_id=member.id,
            command_type="enable_user", status="pending",
        ).count() == 1


def test_h3_cli_shares_the_reconcile(app, seed_gym):
    """`flask run-reminders` re-drives the failed unblock too (same function)."""
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = False
    db.session.commit()
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    _adms_row(integration, action="unblock", enroll="101", member=member)
    runner = app.test_cli_runner()
    result = runner.invoke(args=["run-reminders"])
    assert result.exit_code == 0, result.output
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock",
            test_enroll_number="101", status="queued",
        ).count() == 1


def test_h3_scheduler_job_shares_the_reconcile(app, seed_gym):
    """The APScheduler job itself re-drives the failed unblock."""
    from app.services.reminder_scheduler import _scheduled_reminder_job

    gym = seed_gym["gym"]
    gym.whatsapp_enabled = False
    db.session.commit()
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    _adms_row(integration, action="unblock", enroll="101", member=member)
    _scheduled_reminder_job(app)
    with app.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock",
            test_enroll_number="101", status="queued",
        ).count() == 1


# ─── V11-L5: reconcile is owner-only ──────────────────────────────────────

def test_l5_reconcile_staff_gets_403(client, seed_gym):
    _adms_integration(seed_gym)
    res = client.post("/api/mobile/v1/access/reconcile", headers=_staff_headers(seed_gym))
    assert res.status_code == 403


def test_l5_reconcile_owner_ok(client, seed_gym):
    _adms_integration(seed_gym)
    _active_member(seed_gym)
    res = client.post("/api/mobile/v1/access/reconcile", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["queued_count"] == 1
    assert res.json["data"]["remaining_count"] == 0


# ─── V11-L6: live online gate ─────────────────────────────────────────────

def _offline_integration(seed_gym):
    # Sticky stored status says "connected", but the last sighting was
    # 10 minutes ago — the old gate 201'd on the stored status alone.
    return _adms_integration(
        seed_gym, last_success_at=datetime.now(timezone.utc) - timedelta(minutes=10)
    )


def test_l6_advanced_command_offline_terminal_409s(client, seed_gym):
    integration = _offline_integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/device-command",
        json={"action": "check"}, headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 409
    assert res.json["error"]["code"] == "DEVICE_OFFLINE"


def test_l6_advanced_command_online_terminal_201s(client, seed_gym):
    integration = _adms_integration(seed_gym)
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/device-command",
        json={"action": "check"}, headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201


def test_l6_enroll_scan_offline_terminal_409s(client, seed_gym):
    _offline_integration(seed_gym)
    res = client.post("/api/mobile/v1/rrr/enroll-scan", headers=_owner_headers(seed_gym))
    assert res.status_code == 409
    assert res.json["error"]["code"] == "DEVICE_OFFLINE"


# ─── V11-L7: guard cancels are audited ────────────────────────────────────

def test_l7_getrequest_guard_cancel_writes_audit(client, seed_gym):
    """A stale automatic block cancelled at serve leaves an audit row."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)  # active: an automatic block must cancel
    row = _adms_row(integration, action="block", enroll="101", member=member,
                    status="queued")
    res = client.get("/iclock/v11-adms-token/getrequest?SN=V11-ADMS-1")
    assert res.status_code == 200
    assert res.get_data(as_text=True) == "OK"
    with client.application.app_context():
        cancelled = db.session.get(RRRAdmsCommand, row.id)
        assert cancelled.status == "cancelled"
        assert AuditLog.query.filter_by(
            resource_type="rrr_adms_command",
            resource_id=str(row.id),
            action="adms_command_cancelled_at_serve",
        ).count() == 1


def test_l7_displace_cancel_writes_audit(app, seed_gym):
    """Displacing a previous holder's queued block leaves an audit row."""
    from app.services.bridge_service import displace_stale_enroll_commands

    integration = _adms_integration(seed_gym)
    old_member = _active_member(seed_gym, name="Old Holder", phone="+919100000010", enroll="101")
    new_member = _active_member(seed_gym, name="New Holder", phone="+919100000011", enroll="102")
    row = _adms_row(integration, action="block", enroll="101", member=old_member,
                    status="queued")
    with app.app_context():
        cancelled = displace_stale_enroll_commands(
            seed_gym["gym"].id, "101", new_member_id=new_member.id
        )
        db.session.commit()
    assert cancelled >= 1
    with app.app_context():
        assert db.session.get(RRRAdmsCommand, row.id).status == "cancelled"
        assert AuditLog.query.filter_by(
            resource_type="rrr_adms_command",
            resource_id=str(row.id),
            action="adms_command_displaced",
        ).count() == 1


# ─── V11-L8: enroll_scan in-flight guard ──────────────────────────────────

def test_l8_second_enroll_scan_409s(client, seed_gym):
    _adms_integration(seed_gym)
    headers = _owner_headers(seed_gym)
    first = client.post("/api/mobile/v1/rrr/enroll-scan", headers=headers)
    assert first.status_code == 201
    second = client.post("/api/mobile/v1/rrr/enroll-scan", headers=headers)
    assert second.status_code == 409
    assert second.json["error"]["code"] == "COMMAND_PENDING"


# ─── V11-L9: unmapped counter decrements on resolve ───────────────────────

def _unmapped_event(seed_gym, integration, *, enroll="77"):
    event = RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        source="adms_direct",
        device_serial="V11-ADMS-1",
        biometric_user_id=enroll,
        punch_time=datetime.now(timezone.utc),
        dedupe_key=f"v11-{enroll}-{seed_gym['gym'].id}",
        processing_status="unmapped",
    )
    db.session.add(event)
    db.session.commit()
    return event


def test_l9_resolve_decrements_unmapped_count(app, seed_gym):
    """Linking an unknown punch drops the stored unmapped_records count."""
    from app.services.rrr_service import remap_unresolved

    integration = _adms_integration(seed_gym)
    integration.unmapped_records = 5
    db.session.commit()
    member = _active_member(seed_gym, name="Mapped", phone="+919100000020", enroll=None)
    member.device_enroll_number = None
    db.session.commit()
    _unmapped_event(seed_gym, integration, enroll="77")
    with app.app_context():
        backfilled = remap_unresolved(seed_gym["gym"].id, "77", member, seed_gym["owner"].id)
        db.session.commit()
    assert backfilled == 1
    with app.app_context():
        assert db.session.get(RRRIntegration, integration.id).unmapped_records == 4


def test_l9_clear_unmapped_decrements_count(client, seed_gym):
    integration = _adms_integration(seed_gym)
    integration.unmapped_records = 2
    db.session.commit()
    _unmapped_event(seed_gym, integration, enroll="77")
    _unmapped_event(seed_gym, integration, enroll="78")
    res = client.delete("/api/mobile/v1/rrr/attendance/unmapped",
                        headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["deleted"] == 2
    with client.application.app_context():
        assert db.session.get(RRRIntegration, integration.id).unmapped_records == 0


# ─── V11-L10: USERINFO cap + sync_users retry ─────────────────────────────

def test_l10_oversized_userinfo_fails_distinguishably(client, seed_gym, monkeypatch):
    """An over-cap snapshot fails the scan as USERINFO_TOO_LARGE (not silent)."""
    from app.adms.routes import USERINFO_TOO_LARGE_CODE

    monkeypatch.setattr("app.adms.routes.USERINFO_SNAPSHOT_MAX_BYTES", 80)
    integration = _adms_integration(seed_gym)
    with client.application.app_context():
        cmd = RRRAdmsCommand(
            integration_id=integration.id, gym_id=seed_gym["gym"].id,
            action="sync_users", command_text="DATA QUERY USERINFO",
        )
        db.session.add(cmd)
        db.session.commit()
        cmd_id = cmd.id
    body = (
        "USER PIN=7\tName=John Doe\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
        "USER PIN=8\tName=Jane Smith\tPri=0\tPasswd=\tCard=0\tGrp=1\n"
    )
    res = client.post(
        "/iclock/v11-adms-token/cdata?SN=V11-ADMS-1&table=USERINFO",
        data=body, content_type="text/plain",
    )
    assert res.status_code == 200
    with client.application.app_context():
        cmd = db.session.get(RRRAdmsCommand, cmd_id)
        assert cmd.status == "failed"
        assert cmd.result_code == USERINFO_TOO_LARGE_CODE


def test_l10_failed_sync_users_retries_via_retry_sync(client, seed_gym):
    """A failed scan re-drives as a fresh sync_users row from Retry All."""
    integration = _adms_integration(seed_gym)
    _adms_row(integration, action="sync_users", enroll=None)
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["retried_count"] == 1
    with client.application.app_context():
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="sync_users", status="queued"
        ).count() == 1


# ─── V11-L11: batched reconcile ───────────────────────────────────────────

def test_l11_reconcile_batches_and_reports_remaining(app, seed_gym):
    integration = _adms_integration(seed_gym)
    members = [
        _active_member(seed_gym, name=f"Batch {i}", phone=f"+9191000001{i:02d}",
                       enroll=f"20{i}")
        for i in range(3)
    ]
    with app.app_context():
        first = queue_gym_reconciliation(seed_gym["gym"].id, batch_size=2)
    assert first["queued"] == 2
    assert first["total"] == 3
    assert first["remaining"] == 1
    assert first["next_start_after_member_id"] == members[1].id
    with app.app_context():
        second = queue_gym_reconciliation(
            seed_gym["gym"].id, batch_size=2,
            start_after_member_id=first["next_start_after_member_id"],
        )
    assert second["queued"] == 1
    assert second["remaining"] == 0
    assert second["next_start_after_member_id"] is None


def test_l11_one_bad_row_does_not_abort_reconcile(app, seed_gym, monkeypatch):
    """Per-row isolation: a queue failure for one member skips just that row."""
    import app.services.bridge_service as bridge_service

    integration = _adms_integration(seed_gym)
    good = _active_member(seed_gym, name="Good", phone="+919100000031", enroll="301")
    bad = _active_member(seed_gym, name="Bad", phone="+919100000032", enroll="302")
    real_queue = bridge_service.queue_membership_command

    def _flaky(member, *, force=False):
        if member.id == bad.id:
            raise RuntimeError("boom")
        return real_queue(member, force=force)

    monkeypatch.setattr(bridge_service, "queue_membership_command", _flaky)
    with app.app_context():
        result = queue_gym_reconciliation(seed_gym["gym"].id, batch_size=10)
    assert result["queued"] == 1
    assert result["failed"] == [bad.id]
    assert result["remaining"] == 0
