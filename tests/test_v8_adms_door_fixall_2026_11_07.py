"""Regression tests for the deep-review v8 ADMS / door-safety findings
(2026-11-07, fix-all v8, worker A3).

* V8-M5: the V7-L9 fix (admin "retry failed commands" uses the
  including-deleted lease guard) missed two sibling retry paths — the web
  ``POST /biometric/commands/<id>/retry`` and the mobile
  ``POST /api/mobile/v1/access/retry-sync`` both judged disables with the
  strict guard, so a failed delete-time block for a soft-deleted member
  was re-stamped CANCELLED_STALE_STATE instead of re-queued. Both now
  use ``bridge_disable_must_be_cancelled_at_lease``. The fail-closed
  invariant is pinned too: a live active member's failed disable is
  still cancelled on both paths.
* V8-L10: a legacy manual block with unknown intent was returned as-is
  by the manual same-action branch, never re-stamped — so displace +
  the V6-M6 intent check could not catch it when the enroll was
  recycled. The manual branch now stamps ``intended_member_id`` like
  the automatic path.
* V8-L11: a queued ``create_user`` was silently replaced by a membership
  queue (dedupe included ``create_user`` and the replace branch
  overwrote action/text). A queued create_user is now preserved and the
  membership command queues as a fresh row behind it; the preservation
  is audited. The normal replace path (queued unblock -> block) still
  replaces in place with the ``replaced=True`` audit.
* V8-L12: raw bridge ``delete_user`` needed no confirmation although it
  deletes the terminal user including the fingerprint. It now joins the
  confirm set ({unlock_door, restart, clear_log, delete_user}).

B-H1 is untouched in shape; the guard swap only changes which members
count as blockable on retry (soft-deleted members, as on the admin path
and at lease time) — live active members are still never re-driven.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models.audit_log import AuditLog
from app.models.mixins import utcnow
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.services.bridge_service import (
    adms_command_intended_member_id,
    adms_command_text,
    queue_adms_membership_command,
    queue_manual_adms_member_command,
    queue_membership_command,
)


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _member(gym_id, plan_id, *, name, phone, enroll=None, status="active",
            start=None, end="__default__", price=1000):
    today = date.today()
    if end == "__default__":
        end = today + timedelta(days=30)
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=start if start is not None else (today - timedelta(days=30)),
        membership_end=end,
        status=status,
        price=price,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    from app.services.bridge_service import invalidate_adms_enroll_index

    invalidate_adms_enroll_index(gym_id)
    return member


def _bridge(seed_gym, serial="V8-BRIDGE-01"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V8 bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V8 ADMS",
        device_serial=serial,
        device_name="V8 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _failed_delete_time_block(seed_gym, *, enroll, phone):
    """A bridge disable for an expired member, failed, then soft-deleted
    — the exact V8-M5 shape (delete-time block that failed before the
    member row was deleted)."""
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Retry Deleted",
        phone=phone, enroll=enroll, status="expired",
        end=date.today() - timedelta(days=3),
    )
    cmd = queue_membership_command(member)
    assert cmd is not None and cmd.command_type == "disable_user"
    cmd.status = "failed"
    cmd.last_error = "terminal temporarily offline"
    db.session.commit()

    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()
    return member, cmd


# ─── V8-M5: sibling retry paths re-drive a deleted member's block ────────

def test_v8m5_mobile_retry_sync_redrives_deleted_member_bridge_block(client, seed_gym):
    member, cmd = _failed_delete_time_block(seed_gym, enroll="141", phone="+919100400001")

    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["retried_count"] == 1
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "pending"
    assert "CANCELLED_STALE_STATE" not in (saved.last_error or "")


def test_v8m5_web_retry_command_redrives_deleted_member_bridge_block(client, seed_gym):
    member, cmd = _failed_delete_time_block(seed_gym, enroll="142", phone="+919100400002")

    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )
    res = client.post(
        f"/biometric/commands/{cmd.id}/retry", follow_redirects=True
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "pending"
    assert saved.retry_attempt == 1
    assert "CANCELLED_STALE_STATE" not in (saved.last_error or "")


def test_v8m5_retry_paths_still_cancel_active_member_disable(client, seed_gym):
    """Fail-closed pin: swapping in the at-lease guard must not resurrect
    a disable for a LIVE active member on either retry path."""
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Retry Active",
        phone="+919100400003", enroll="143", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=BridgeInstallation.query.filter_by(gym_id=gym_id).first().id,
        gym_id=gym_id,
        member_id=member.id,
        command_type="disable_user",
        enroll_number="143",
        member_name=member.full_name,
        status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd)
    db.session.commit()

    # Mobile path: not retried, re-stamped cancelled.
    res = client.post("/api/mobile/v1/access/retry-sync", headers=_owner_headers(seed_gym))
    assert res.status_code == 200
    assert res.get_json()["data"]["retried_count"] == 0
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert "CANCELLED_STALE_STATE" in (saved.last_error or "")

    # Web path: same outcome for a fresh failed copy.
    cmd2 = BridgeCommand(
        bridge_id=BridgeInstallation.query.filter_by(gym_id=gym_id).first().id,
        gym_id=gym_id,
        member_id=member.id,
        command_type="disable_user",
        enroll_number="143",
        member_name=member.full_name,
        status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd2)
    db.session.commit()
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )
    res = client.post(f"/biometric/commands/{cmd2.id}/retry", follow_redirects=True)
    assert res.status_code == 200
    saved2 = db.session.get(BridgeCommand, cmd2.id)
    assert saved2.status == "failed"
    assert "CANCELLED_STALE_STATE" in (saved2.last_error or "")


# ─── V8-L10: manual same-action branch re-stamps unknown intent ──────────

def test_v8l10_manual_same_action_restamps_unknown_intent(seed_gym):
    integration = _adms_integration(seed_gym, serial="V8L10-X2008", token="v8l10-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    member = _member(
        gym_id, seed_gym["plan"].id, name="Legacy Block",
        phone="+919100400004", enroll="151", status="active",
        end=date.today() + timedelta(days=20),
    )
    # Legacy pre-v7 row: queued block, no intent stamped anywhere
    # (no audit row to fall back to either).
    legacy = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="block",
        test_enroll_number="151",
        command_text=adms_command_text("block", "151", member_name="Old Name"),
        requested_by_id=owner.id,
        intended_member_id=None,
        status="queued",
    )
    db.session.add(legacy)
    db.session.commit()
    assert adms_command_intended_member_id(legacy) is None

    returned = queue_manual_adms_member_command(member, "block", owner.id)
    assert returned is not None
    assert returned.id == legacy.id
    assert returned.status == "queued"
    saved = db.session.get(RRRAdmsCommand, legacy.id)
    assert saved.intended_member_id == member.id
    assert adms_command_intended_member_id(saved) == member.id


# ─── V8-L11: queued create_user survives a membership queue ──────────────

def test_v8l11_membership_queue_preserves_queued_create_user(seed_gym):
    integration = _adms_integration(seed_gym, serial="V8L11-X2008", token="v8l11-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    member = _member(
        gym_id, seed_gym["plan"].id, name="Enroll Pending",
        phone="+919100400005", enroll="161", status="expired",
        end=date.today() - timedelta(days=3),
    )
    create = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="create_user",
        test_enroll_number="161",
        command_text=adms_command_text("create_user", "161", member_name=member.full_name),
        requested_by_id=owner.id,
        intended_member_id=member.id,
        status="queued",
    )
    db.session.add(create)
    db.session.commit()

    block = queue_adms_membership_command(member)
    assert block is not None
    assert block.id != create.id
    assert block.action == "block"
    assert block.status == "queued"
    # The enrollment is untouched: still queued, still create_user.
    saved_create = db.session.get(RRRAdmsCommand, create.id)
    assert saved_create.status == "queued"
    assert saved_create.action == "create_user"
    # And the preservation was audited, not silent.
    rows = AuditLog.query.filter_by(
        resource_type="rrr_adms_command", action="adms_membership_block_queued"
    ).all()
    assert any(
        (r.metadata_json or {}).get("create_user_preserved") is True for r in rows
    ), "expected a create_user_preserved audit row"


def test_v8l11_normal_replace_still_replaces_with_audit(seed_gym):
    """Regression pin for the kept behaviour: a queued unblock IS
    replaced in place by the newest membership state, with the
    replaced=True audit."""
    integration = _adms_integration(seed_gym, serial="V8L11B-X2008", token="v8l11b-token")
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Replace Me",
        phone="+919100400006", enroll="162", status="expired",
        end=date.today() - timedelta(days=3),
    )
    unblock = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="unblock",
        test_enroll_number="162",
        command_text=adms_command_text("unblock", "162", member_name=member.full_name),
        requested_by_id=None,
        intended_member_id=member.id,
        status="queued",
    )
    db.session.add(unblock)
    db.session.commit()

    block = queue_adms_membership_command(member)
    assert block is not None
    assert block.id == unblock.id
    assert block.action == "block"
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="162", status="queued"
    ).count() == 1
    rows = AuditLog.query.filter_by(
        resource_type="rrr_adms_command", resource_id=str(unblock.id),
        action="adms_membership_block_queued",
    ).all()
    assert any((r.metadata_json or {}).get("replaced") is True for r in rows)


# ─── V8-L12: raw bridge delete_user needs confirmation ───────────────────

def test_v8l12_delete_user_requires_confirmation(client, seed_gym):
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Delete Confirm",
        phone="+919100400007", enroll="171", status="expired",
        end=date.today() - timedelta(days=3),
    )

    # No confirm flag: refused, nothing queued.
    res = client.post(
        "/api/mobile/v1/settings/bridge/commands",
        json={"command_type": "delete_user", "enroll_number": "171"},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 422, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert BridgeCommand.query.filter_by(
        gym_id=gym_id, command_type="delete_user"
    ).count() == 0

    # Explicit confirmation: queued as before (guards unchanged —
    # owner-only, ADMS gyms rejected, lease-guarded at serve time).
    res = client.post(
        "/api/mobile/v1/settings/bridge/commands",
        json={"command_type": "delete_user", "enroll_number": "171", "confirm": True},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    cmd = BridgeCommand.query.filter_by(
        gym_id=gym_id, command_type="delete_user"
    ).one()
    assert cmd.enroll_number == "171"
    assert cmd.member_id == member.id
