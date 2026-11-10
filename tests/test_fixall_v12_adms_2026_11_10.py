"""Fix-all v12 — ADMS / door / punch findings (2026-11-10).

Covers V12-A1 (scheduler / Re-sync erases a queued or delivered owner
misconduct block), V12-A2 (Retry All converts a failed manual block
into an unblock), V12-A3 (delivered-timeout failures leave no audit
row), V12-A4 (USERINFO_TOO_LARGE retry loops forever).

Hard invariants pinned throughout: the block fail-safe (an active
member is never auto-blocked) and the owner-override carve-out (B-H1)
are untouched — these fixes PROTECT owner blocks, they never auto-block
or auto-unblock anyone themselves.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models.audit_log import AuditLog
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.bridge_service import (
    adms_command_text,
    invalidate_adms_enroll_index,
    queue_gym_reconciliation,
    queue_manual_adms_member_command,
    queue_manual_bridge_member_command,
    reconcile_failed_membership_commands,
)


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


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


def _adms_integration(seed_gym, *, serial="V12-ADMS-1", token="v12-adms-token",
                      commands_enabled=True, last_success_at="now"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V12 ADMS",
        device_serial=serial,
        device_name="V12 X2008",
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
              requested_by_id=None, result_code=None, result_message=None):
    row = RRRAdmsCommand(
        gym_id=integration.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll,
        command_text=adms_command_text(action, enroll, member_name="Test Member")
        if action in ("block", "unblock")
        else f"C:TEST {action} PIN={enroll}",
        status=status,
        result_code=(
            result_code if result_code is not None
            else ("TIMEOUT" if status == "failed" else None)
        ),
        result_message=(
            result_message if result_message is not None
            else ("Timeout: no ack within 10 min" if status == "failed" else None)
        ),
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


def _manual_block(seed_gym, member, *, status="queued"):
    """Queue a real owner misconduct block, then park it in ``status``."""
    manual = queue_manual_adms_member_command(member, "block", seed_gym["owner"].id)
    assert manual is not None
    assert manual.action == "block"
    assert manual.requested_by_id == seed_gym["owner"].id
    if status != "queued":
        manual.status = status
        if status == "delivered":
            manual.delivered_at = datetime.now(timezone.utc)
    db.session.commit()
    return manual


def _skipped_by_id(res_json, command_id):
    for entry in res_json["data"]["skipped"]:
        if entry["command_id"] == command_id:
            return entry
    return None


# ─── V12-A1: queued/delivered manual blocks protect ───────────────────────

def test_a1_queued_manual_block_survives_scheduler_reconcile(app, seed_gym):
    """A queued owner block (terminal offline) survives the scheduler run.

    Before the fix the unblock scan's acked-only guard missed it and
    the queue rewrote the queued block into an unblock in place.
    """
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    manual = _manual_block(seed_gym, member, status="queued")
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    assert counts["adms_blocks"] == 0
    with app.app_context():
        row = db.session.get(RRRAdmsCommand, manual.id)
        assert row.status == "queued"
        assert row.action == "block"
        assert row.requested_by_id == seed_gym["owner"].id
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock"
        ).count() == 0


def test_a1_delivered_manual_block_is_not_followed_by_unblock(app, seed_gym):
    """A delivered-but-unacked owner block is not followed by an unblock.

    Before the fix the scan fell through to the delivered branch and
    minted a fresh unblock behind the block, reversing it one poll later.
    """
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    manual = _manual_block(seed_gym, member, status="delivered")
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["adms_unblocks"] == 0
    with app.app_context():
        row = db.session.get(RRRAdmsCommand, manual.id)
        assert row.status == "delivered"
        assert row.action == "block"
        assert row.requested_by_id == seed_gym["owner"].id
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock"
        ).count() == 0


def test_a1_resync_skips_queued_manual_block(app, seed_gym):
    """Re-sync reports the queued manual block as skipped, never queued."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    manual = _manual_block(seed_gym, member, status="queued")
    with app.app_context():
        result = queue_gym_reconciliation(seed_gym["gym"].id, batch_size=10)
    assert result["skipped_manual_block"] == 1
    assert result["queued"] == 0
    with app.app_context():
        row = db.session.get(RRRAdmsCommand, manual.id)
        assert row.status == "queued"
        assert row.action == "block"
        assert row.requested_by_id == seed_gym["owner"].id


def test_a1_bridge_pending_manual_block_survives_reconcile(app, seed_gym):
    """Bridge twin: a pending owner disable_user survives the reconcile."""
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Test bridge", "V12-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    member = _active_member(seed_gym)
    manual = queue_manual_bridge_member_command(member, "block", seed_gym["owner"].id)
    assert manual is not None
    assert manual.command_type == "disable_user"
    assert manual.status == "pending"
    db.session.commit()
    with app.app_context():
        counts = reconcile_failed_membership_commands(seed_gym["gym"])
    assert counts["bridge_unblocks"] == 0
    assert counts["bridge_blocks"] == 0
    with app.app_context():
        row = db.session.get(BridgeCommand, manual.id)
        assert row.status == "pending"
        assert row.command_type == "disable_user"
        assert BridgeCommand.query.filter_by(
            bridge_id=installation.id, member_id=member.id,
            command_type="enable_user",
        ).count() == 0


def test_a1_block_older_than_membership_change_does_not_protect(app, seed_gym):
    """Designed behaviour: a renewal after the block lifts protection.

    The membership-change path needs no guard — a renewal advances
    ``updated_at`` past the block by design, so the queued manual
    block is rewritten into the membership-derived unblock in place
    (no fresh row is minted, so the scan counts 0 — assert the row).
    """
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    manual = _manual_block(seed_gym, member, status="queued")
    member.updated_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    db.session.commit()
    with app.app_context():
        reconcile_failed_membership_commands(seed_gym["gym"])
    with app.app_context():
        row = db.session.get(RRRAdmsCommand, manual.id)
        assert row.action == "unblock"
        assert row.requested_by_id is None


# ─── V12-A2: Retry All never converts a failed manual row ─────────────────

def test_a2_retry_all_skips_failed_manual_block(client, seed_gym):
    """A failed owner block is skipped as manual_action, not retried."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    row = _adms_row(integration, action="block", enroll="101", member=member,
                    requested_by_id=seed_gym["owner"].id)
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["retried_count"] == 0
    assert res.json["data"]["skipped_count"] == 1
    skipped = _skipped_by_id(res.json, row.id)
    assert skipped is not None
    assert skipped["reason"] == "manual_action"
    with client.application.app_context():
        kept = db.session.get(RRRAdmsCommand, row.id)
        assert kept.status == "failed"
        assert kept.action == "block"
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 0


def test_a2_retry_all_skips_failed_manual_unblock(client, seed_gym):
    """A failed owner unblock is skipped the same way (actor-based)."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    row = _adms_row(integration, action="unblock", enroll="101", member=member,
                    requested_by_id=seed_gym["owner"].id)
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["retried_count"] == 0
    skipped = _skipped_by_id(res.json, row.id)
    assert skipped is not None
    assert skipped["reason"] == "manual_action"
    with client.application.app_context():
        assert db.session.get(RRRAdmsCommand, row.id).status == "failed"


def test_a2_retry_all_still_retries_failed_automatic_block(client, seed_gym):
    """Control: an automatic failed block still re-derives (active → unblock)."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    row = _adms_row(integration, action="block", enroll="101", member=member)
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["retried_count"] == 1
    assert res.json["data"]["skipped_count"] == 0
    with client.application.app_context():
        assert db.session.get(RRRAdmsCommand, row.id).status == "cancelled"
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="unblock", status="queued"
        ).count() == 1


# ─── V12-A3: delivered-timeout failures are audited ───────────────────────

def test_a3_getrequest_stuck_delivered_timeout_writes_audit(client, seed_gym):
    """The getrequest reaper fails a stuck delivered row AND audits it."""
    integration = _adms_integration(seed_gym)
    member = _active_member(seed_gym)
    row = _adms_row(integration, action="block", enroll="101", member=member,
                    status="delivered", result_code=None, result_message=None)
    row.delivered_at = datetime.now(timezone.utc) - timedelta(minutes=15)
    db.session.commit()
    res = client.get("/iclock/v12-adms-token/getrequest?SN=V12-ADMS-1")
    assert res.status_code == 200
    with client.application.app_context():
        failed = db.session.get(RRRAdmsCommand, row.id)
        assert failed.status == "failed"
        assert failed.result_code == "TIMEOUT"
        assert failed.result_message == "Timeout: no ack within 10 min"
        assert AuditLog.query.filter_by(
            resource_type="rrr_adms_command",
            resource_id=str(row.id),
            action="adms_command_ack_timeout",
        ).count() == 1


def test_a3_test_endpoint_stuck_timeout_writes_audit_and_reason(client, seed_gym):
    """The test-endpoint stuck timeout fails the row, stamps TIMEOUT, audits."""
    integration = _adms_integration(seed_gym)
    row = _adms_row(integration, action="probe_info", enroll=None,
                    status="delivered", result_code=None, result_message=None)
    row.delivered_at = datetime.now(timezone.utc) - timedelta(minutes=15)
    db.session.commit()
    res = client.post(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/commands",
        json={"action": "probe_info"},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201
    with client.application.app_context():
        failed = db.session.get(RRRAdmsCommand, row.id)
        assert failed.status == "failed"
        assert failed.result_code == "TIMEOUT"
        assert failed.result_message == "Timeout: no ack within 10 min"
        assert AuditLog.query.filter_by(
            resource_type="rrr_adms_command",
            resource_id=str(row.id),
            action="adms_command_ack_timeout",
        ).count() == 1


# ─── V12-A4: USERINFO_TOO_LARGE never re-drives ───────────────────────────

def test_a4_retry_all_skips_userinfo_too_large_sync(client, seed_gym):
    """A USERINFO_TOO_LARGE scan is skipped, not re-driven to fail again."""
    from app.adms.routes import USERINFO_TOO_LARGE_CODE

    integration = _adms_integration(seed_gym)
    row = _adms_row(integration, action="sync_users", enroll=None,
                    result_code=USERINFO_TOO_LARGE_CODE,
                    result_message="USERINFO snapshot too large.")
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.json["data"]["retried_count"] == 0
    assert res.json["data"]["skipped_count"] == 1
    skipped = _skipped_by_id(res.json, row.id)
    assert skipped is not None
    assert skipped["reason"] == "userinfo_too_large"
    with client.application.app_context():
        assert db.session.get(RRRAdmsCommand, row.id).status == "failed"
        assert RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, action="sync_users", status="queued"
        ).count() == 0


def test_a4_userinfo_too_large_surfaces_in_commands_list(client, seed_gym):
    """The failure surfaces distinctly in the failed-commands data."""
    from app.adms.routes import USERINFO_TOO_LARGE_CODE

    integration = _adms_integration(seed_gym)
    row = _adms_row(integration, action="sync_users", enroll=None,
                    result_code=USERINFO_TOO_LARGE_CODE,
                    result_message="USERINFO snapshot too large.")
    res = client.get(
        f"/api/mobile/v1/rrr/integrations/{integration.id}/adms/commands",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    payloads = {cmd["id"]: cmd for cmd in res.json["data"]["commands"]}
    assert payloads[row.id]["result_code"] == USERINFO_TOO_LARGE_CODE
    assert payloads[row.id]["status"] == "failed"
