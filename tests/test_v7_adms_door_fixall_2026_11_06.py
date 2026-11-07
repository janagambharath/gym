"""Regression tests for the deep-review v7 ADMS / door-safety findings
(2026-11-06, fix-all v7, worker A1).

* V7-M1: a mapping-only deleted member's delete-time block queues but was
  cancelled at serve (CANCELLED_STALE_STATE) because the resolver could
  no longer find the member once its mappings were deleted. The fix stamps
  ``intended_member_id`` on the command row at queue time and the ADMS
  serve guard falls back to that stored intent (deleted members are
  blockable). The bridge leg previously never queued at all for a
  mapping-only member (no ``device_enroll_number``) — it now resolves the
  enroll mapping-preferred. Import-undo was still delete-first; it now
  queues before deleting mappings like the other delete paths.
* V7-M2: unenroll queued no terminal command while both clients promise
  it "will block terminal access". Unenroll now queues a manual (owner)
  block BEFORE clearing the identity. ADMS serves it through the owner
  branch (B-H1) even for a live active member; the bridge leg serves it
  for blockable members, and the lease guard still cancels it for a live
  active member (fail-closed invariant — no bridge owner-override exists;
  that gap is documented, not silently bypassed).
* V7-L8: ``create_user`` serve exemption race — a create queued for an
  unmapped ID, linked to an expired member before serve, opened the door
  for ~one poll cycle. Serve now re-runs the enable check for
  ``create_user`` when the enroll resolves to a member.
* V7-L9: admin "retry failed commands" used the strict disable guard, so
  a failed delete-time bridge block was re-stamped cancelled. It now uses
  the including-deleted lease guard (the V5-M5 fix).
* V7-L10: V6-M6 intent lived only in audit rows, purged after 90 days.
  Intent is now stamped on the command row; the audit row is only a
  fallback for legacy rows.

B-H1 (owner-override carve-out, adms/routes.py owner branch) is untouched
in shape; test_owner_block_for_its_own_member_still_serves in the v5+v6
file still pins it.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models.audit_log import AuditLog
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.services.bridge_service import (
    adms_command_intended_member_id,
    adms_command_text,
    lease_pending_commands,
    queue_membership_command,
    queue_manual_adms_member_command,
)
from app.services.rrr_service import delete_identity_mappings, remap_unresolved


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


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V7 ADMS",
        device_serial=serial,
        device_name="V7 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _bridge(seed_gym, serial="V7-BRIDGE-01"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V7 bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _getrequest_body(client, token, serial):
    res = client.get(f"/iclock/{token}/getrequest?SN={serial}")
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    return res.get_data(as_text=True)


def _mapping_only_member(seed_gym, *, enroll, name="Mapping Only", phone="+919100300001"):
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name=name, phone=phone,
        enroll=None, status="expired", end=date.today() - timedelta(days=3),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id=enroll, member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    return member


# ─── V7-M1: mapping-only delete-time block must SERVE, not just queue ─────

def test_v7m1_mapping_only_delete_block_serves_via_getrequest(client, seed_gym):
    """The v7 scratch-probe shape, made permanent: deactivate a
    mapping-only member, then poll getrequest — the block must be
    delivered as Grp=100, not failed/CANCELLED_STALE_STATE."""
    integration = _adms_integration(seed_gym, serial="V7M1-X2008", token="v7m1-token")
    gym_id = seed_gym["gym"].id
    member = _mapping_only_member(seed_gym, enroll="111")

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    cmd = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="111", action="block", status="queued"
    ).one()
    assert cmd.intended_member_id == member.id
    # Mappings are gone — the resolver alone can no longer find the member.
    assert RRRIdentityMapping.query.filter_by(gym_id=gym_id, member_id=member.id).count() == 0

    body = _getrequest_body(client, "v7m1-token", "V7M1-X2008")
    assert "C:" in body and "Grp=100" in body, body
    assert "PIN=111" in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "delivered"
    assert saved.result_code is None


def test_v7m1_mapping_only_delete_block_queues_and_leases_on_bridge(seed_gym):
    """Bridge leg: previously _queue_bridge_membership_command returned
    None for a mapping-only member (no device_enroll_number), so the
    block never even queued. It now queues via the mapping and leases."""
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _mapping_only_member(seed_gym, enroll="112")

    cmd = queue_membership_command(member)
    assert cmd is not None
    assert isinstance(cmd, BridgeCommand)
    assert cmd.command_type == "disable_user"
    assert cmd.enroll_number == "112"
    assert cmd.member_id == member.id
    db.session.commit()

    leased = lease_pending_commands(installation)
    assert [c.id for c in leased] == [cmd.id]
    assert db.session.get(BridgeCommand, cmd.id).status == "leased"


def test_v7m1_intended_member_fallback_never_blocks_live_holder(client, seed_gym):
    """Stored intent must not land a block on a NEW holder: if the enroll
    was recycled to a live active member before serve, the automatic
    branch resolves the live holder and the fail-closed guard cancels."""
    _adms_integration(seed_gym, serial="V7M1B-X2008", token="v7m1b-token")
    gym_id = seed_gym["gym"].id
    member = _mapping_only_member(seed_gym, enroll="113")

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    cmd = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="113", action="block", status="queued"
    ).one()
    assert cmd.intended_member_id == member.id

    # Recycle the enroll to a live ACTIVE member before the terminal polls.
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="New Holder",
        phone="+919100300002", enroll="113", status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.commit()

    body = _getrequest_body(client, "v7m1b-token", "V7M1B-X2008")
    assert "Grp=100" not in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "failed"
    assert saved.result_code == "CANCELLED_STALE_STATE"


# ─── V7-M2: unenroll queues a terminal block ──────────────────────────────

def test_v7m2_unenroll_queues_block_and_it_serves_adms(client, seed_gym):
    _adms_integration(seed_gym, serial="V7M2-X2008", token="v7m2-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    member = _member(
        gym_id, seed_gym["plan"].id, name="Unenroll A",
        phone="+919100300003", enroll="131", status="active",
        end=date.today() + timedelta(days=20),
    )

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unenroll",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    db.session.refresh(member)
    assert member.device_enroll_number is None
    assert RRRIdentityMapping.query.filter_by(gym_id=gym_id, member_id=member.id).count() == 0

    cmd = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="131", action="block", status="queued"
    ).one()
    assert cmd.requested_by_id == owner.id
    assert cmd.intended_member_id == member.id

    # The identity is freed, but the owner-branch stored-intent fallback
    # still serves the block against the terminal user (PIN 131).
    body = _getrequest_body(client, "v7m2-token", "V7M2-X2008")
    assert "C:" in body and "Grp=100" in body, body
    assert db.session.get(RRRAdmsCommand, cmd.id).status == "delivered"


def test_v7m2_unenroll_queues_block_on_bridge_for_blockable_member(client, seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Unenroll Bridge",
        phone="+919100300004", enroll="132", status="expired",
        end=date.today() - timedelta(days=3),
    )

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unenroll",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]

    cmd = BridgeCommand.query.filter_by(
        gym_id=gym_id, member_id=member.id, command_type="disable_user",
        status="pending",
    ).one()
    assert cmd.enroll_number == "132"
    leased = lease_pending_commands(installation)
    assert [c.id for c in leased] == [cmd.id]


def test_v7m2_unenroll_block_for_active_bridge_member_is_lease_cancelled(client, seed_gym):
    """Documents the bridge limit: there is no bridge owner-override, so
    the lease guard fail-closes an active member's unenroll block. The
    block IS queued (owner intent recorded); it must not silently serve
    against an active member, and it must not be mistaken for delivered."""
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Unenroll Active Bridge",
        phone="+919100300005", enroll="133", status="active",
        end=date.today() + timedelta(days=20),
    )

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unenroll",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    cmd = BridgeCommand.query.filter_by(
        gym_id=gym_id, member_id=member.id, command_type="disable_user",
    ).one()
    assert cmd.status == "pending"
    # Lease attempt cancels it (fail-closed), it is never handed out.
    from app.services.bridge_service import lease_pending_commands

    installation = BridgeInstallation.query.filter_by(gym_id=gym_id).first()
    assert lease_pending_commands(installation) == []
    assert db.session.get(BridgeCommand, cmd.id).status == "failed"


# ─── V7-L8: create_user serve-time re-check ───────────────────────────────

def test_v7l8_create_user_cancelled_when_linked_to_expired_member(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V7L8-X2008", token="v7l8-token")
    gym_id = seed_gym["gym"].id
    cmd = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="create_user",
        test_enroll_number="121",
        command_text=adms_command_text("create_user", "121", member_name="New Person"),
        requested_by_id=None,
    )
    db.session.add(cmd)
    db.session.commit()

    # Link the ID to an expired member before the terminal polls.
    _member(
        gym_id, seed_gym["plan"].id, name="Expired Link",
        phone="+919100300006", enroll="121", status="expired",
        end=date.today() - timedelta(days=3),
    )

    body = _getrequest_body(client, "v7l8-token", "V7L8-X2008")
    assert "C:" not in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "failed"
    assert saved.result_code == "CANCELLED_STALE_ENABLE"


def test_v7l8_create_user_still_serves_for_unmapped_id(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V7L8B-X2008", token="v7l8b-token")
    gym_id = seed_gym["gym"].id
    cmd = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="create_user",
        test_enroll_number="122",
        command_text=adms_command_text("create_user", "122", member_name="New Person"),
        requested_by_id=None,
    )
    db.session.add(cmd)
    db.session.commit()

    body = _getrequest_body(client, "v7l8b-token", "V7L8B-X2008")
    assert "C:" in body and "PIN=122" in body, body
    assert db.session.get(RRRAdmsCommand, cmd.id).status == "delivered"


# ─── V7-L9: admin retry re-drives a deleted member's bridge block ─────────

def test_v7l9_admin_retry_redrives_deleted_member_bridge_block(client, seed_gym):
    from app.models import User

    admin = User(
        email="superadmin@renewaldesk.com",
        full_name="Platform Super Admin",
        role="super_admin",
        is_active=True,
    )
    admin.set_password("AdminPass123!")
    db.session.add(admin)
    db.session.commit()

    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Retry Deleted",
        phone="+919100300007", enroll="141", status="expired",
        end=date.today() - timedelta(days=3),
    )
    cmd = queue_membership_command(member)
    assert cmd is not None and cmd.command_type == "disable_user"
    cmd.status = "failed"
    cmd.last_error = "terminal temporarily offline"
    db.session.commit()

    # Delete the member after the failure — the old strict guard would
    # re-stamp this cancelled instead of retrying it.
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()

    client.post(
        "/auth/login",
        data={"email": "superadmin@renewaldesk.com", "password": "AdminPass123!"},
        follow_redirects=True,
    )
    res = client.post(
        f"/admin/gyms/{gym_id}/commands/retry-failed", follow_redirects=True
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "pending"
    assert saved.not_before is not None


# ─── V7-L10: intent survives the audit purge ──────────────────────────────

def test_v7l10_intended_member_read_from_row_after_audit_purge(seed_gym):
    _adms_integration(seed_gym, serial="V7L10-X2008", token="v7l10-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    member = _member(
        gym_id, seed_gym["plan"].id, name="Purge A",
        phone="+919100300008", enroll="151", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = queue_manual_adms_member_command(member, "block", owner.id)
    assert cmd is not None
    assert cmd.intended_member_id == member.id
    db.session.commit()

    # Simulate the 90-day purge deleting every queue audit row.
    AuditLog.query.filter_by(
        resource_type="rrr_adms_command", resource_id=str(cmd.id)
    ).delete(synchronize_session=False)
    db.session.commit()

    assert adms_command_intended_member_id(cmd) == member.id


def test_v7l10_displace_still_cancels_stale_block_after_audit_purge(seed_gym):
    _adms_integration(seed_gym, serial="V7L10B-X2008", token="v7l10b-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Purge Old",
        phone="+919100300009", enroll="152", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    assert stale is not None
    assert stale.status == "queued"
    db.session.commit()

    AuditLog.query.filter_by(
        resource_type="rrr_adms_command", resource_id=str(stale.id)
    ).delete(synchronize_session=False)
    db.session.commit()

    # Recycle the enroll: displace must still know the block belonged to A.
    # (An acked row is deliberately NOT displaced — displace only cancels
    # queued/delivered rows; the V5-M4 corrective unblock covers acked
    # ones — so the stale block is left queued here, the displaceable case.)
    delete_identity_mappings(gym_id, holder_a.id)
    holder_a.device_enroll_number = None
    db.session.commit()
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Purge New",
        phone="+919100300010", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    remap_unresolved(gym_id, "152", holder_b, owner.id)
    db.session.commit()

    saved = db.session.get(RRRAdmsCommand, stale.id)
    assert saved.status == "failed"
    assert saved.result_code == "CANCELLED_SUPERSEDED"
