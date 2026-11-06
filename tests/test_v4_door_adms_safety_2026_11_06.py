"""Regression tests for the deep-review v4 door-safety / ADMS findings
(2026-11-06, Worker 2).

* V4-H2: soft-deleted members keep door access forever — the delete-time
  block must SERVE (ADMS getrequest automatic branch + bridge lease), while
  the active-member invariant still holds (active members must NOT be
  blocked). A stale block served after a restore self-corrects.
* V4-M3: a stale queued manual block must not survive a terminal-ID recycle
  — remap/enroll displaces it, and the bridge lease refuses a command whose
  enroll now belongs to a different live member.
* V4-M4: bridge set_valid_date with a past validity window is a disable, not
  an enable — judged by its window at the lease guard.
* V4-L6: resolve_bridge_command_member's enroll fallback is canonical-aware
  (stored "042" matches a canonical "42" command).
* V4-L7: bulk_remove_expired covers paused members and mapping-only members.
* V4-L8: an acked block (and the dedup acked-return) belongs to the member
  it was queued for — a recycled ID must not inherit the previous holder's
  ack, in the queue dedup or in the scheduler reconcile.

B-H1 (owner-override carve-out, adms/routes.py:774-792) is untouched; no
test here exercises the owner branch's serve decision for a live member.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.services.bridge_service import (
    STALE_COMMAND_SUPERSEDED_MARKER,
    STALE_DISABLE_MARKER,
    STALE_ENABLE_MARKER,
    adms_command_text,
    bridge_command_must_be_cancelled,
    bridge_enable_must_be_cancelled,
    invalidate_adms_enroll_index,
    lease_pending_commands,
    queue_adms_membership_command,
    queue_manual_adms_member_command,
    queue_membership_command,
    resolve_adms_member_for_disable,
    resolve_bridge_command_member,
)
from app.services.reminder_scheduler import _scheduled_reminder_job
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
    invalidate_adms_enroll_index(gym_id)
    return member


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V4 ADMS",
        device_serial=serial,
        device_name="V4 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _bridge(seed_gym):
    installation, _api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V4 bridge", "V4-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation


def _delete_member(member):
    """Mirror deactivate_member: soft-delete, free mappings, keep enroll."""
    member.deleted_at = utcnow()
    member.status = "deleted"
    delete_identity_mappings(member.gym_id, member.id)
    db.session.commit()


def _unenroll_member(member):
    member.device_enroll_number = None
    delete_identity_mappings(member.gym_id, member.id)
    db.session.commit()
    invalidate_adms_enroll_index(member.gym_id)


def _getrequest_body(client, token, serial):
    res = client.get(f"/iclock/{token}/getrequest?SN={serial}")
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    return res.get_data(as_text=True)


# ─── V4-H2: deleted members' blocks must serve (ADMS) ─────────────────────

def test_deleted_member_block_serves_at_adms_getrequest(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="H2-X2008", token="h2-token")
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Deleted Ex",
        phone="+919100100001", enroll="103", status="active",
        end=date.today() + timedelta(days=20),
    )
    _delete_member(member)
    assert member.deleted_at is not None

    cmd = queue_adms_membership_command(member)
    assert cmd is not None and cmd.action == "block"
    db.session.commit()

    body = _getrequest_body(client, "h2-token", "H2-X2008")
    assert "C:" in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "delivered"


def test_active_member_block_still_cancelled_at_adms_serve(client, seed_gym):
    # Invariant: an active member must NEVER be blocked.
    integration = _adms_integration(seed_gym, serial="H2B-X2008", token="h2b-token")
    _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active Keeper",
        phone="+919100100002", enroll="104", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="block", test_enroll_number="104",
        command_text=adms_command_text("block", "104", member_name="Active Keeper"),
        status="queued",
    )
    db.session.add(cmd)
    db.session.commit()

    body = _getrequest_body(client, "h2b-token", "H2B-X2008")
    assert "C:" not in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "failed"
    assert saved.result_code == STALE_DISABLE_MARKER


def test_restored_member_stale_block_self_corrects_at_adms_serve(client, seed_gym):
    # A delete-time block queued while deleted, then the member is restored
    # active: serve-time resolution sees them active again and cancels.
    integration = _adms_integration(seed_gym, serial="H2C-X2008", token="h2c-token")
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Restored Ex",
        phone="+919100100003", enroll="105", status="active",
        end=date.today() + timedelta(days=20),
    )
    _delete_member(member)
    cmd = queue_adms_membership_command(member)
    assert cmd is not None and cmd.action == "block"
    db.session.commit()

    member.deleted_at = None
    member.status = "active"
    member.membership_end = date.today() + timedelta(days=20)
    db.session.commit()

    body = _getrequest_body(client, "h2c-token", "H2C-X2008")
    assert "C:" not in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "failed"
    assert saved.result_code == STALE_DISABLE_MARKER


def test_delete_time_block_aliasing_manual_block_serves(client, seed_gym):
    # Owner manually blocked A, then A is deleted: the delete-time queue
    # aliases the queued manual row. It must be demoted to the automatic
    # branch (not cancelled by the owner branch, where deleted members
    # never resolve) and serve.
    integration = _adms_integration(seed_gym, serial="H2D-X2008", token="h2d-token")
    owner = seed_gym["owner"]
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Manual Then Deleted",
        phone="+919100100004", enroll="106", status="active",
        end=date.today() + timedelta(days=20),
    )
    manual = queue_manual_adms_member_command(member, "block", owner.id)
    assert manual is not None and manual.requested_by_id == owner.id
    db.session.commit()

    _delete_member(member)
    aliased = queue_adms_membership_command(member)
    assert aliased is not None and aliased.id == manual.id
    assert aliased.requested_by_id is None, "manual flag must be demoted for a deleted member"
    db.session.commit()

    body = _getrequest_body(client, "h2d-token", "H2D-X2008")
    assert "C:" in body, body
    saved = db.session.get(RRRAdmsCommand, manual.id)
    assert saved.status == "delivered"


def test_resolve_adms_member_for_disable_prefers_live_holder(seed_gym):
    # Live holder wins over a deleted holder of the same enroll: the block
    # must be judged on the live member (active -> cancelled), never served
    # against them on the deleted member's account. The dual-holder shape
    # is mapping-only for the live member — the unique constraint keeps
    # the deleted holder's device_enroll_number, so the live member holds
    # the ID via a confirmed mapping.
    gym_id = seed_gym["gym"].id
    deleted = _member(
        gym_id, seed_gym["plan"].id, name="Deleted Holder",
        phone="+919100100005", enroll="107", status="active",
        end=date.today() + timedelta(days=20),
    )
    _delete_member(deleted)
    live = _member(
        gym_id, seed_gym["plan"].id, name="Live Holder",
        phone="+919100100006", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="107", member_id=live.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    assert resolve_adms_member_for_disable(gym_id, "107").id == live.id


# ─── V4-H2: deleted members' disables must lease (bridge) ────────────────

def test_deleted_member_disable_leases_on_bridge(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Deleted Bridge",
        phone="+919100100007", enroll="108", status="active",
        end=date.today() + timedelta(days=20),
    )
    _delete_member(member)
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="disable_user", enroll_number="108",
        member_name=member.full_name,
    )
    db.session.add(cmd)
    db.session.commit()

    leased = lease_pending_commands(installation)
    assert [c.id for c in leased] == [cmd.id]
    assert db.session.get(BridgeCommand, cmd.id).status == "leased"


def test_active_member_disable_still_cancelled_at_bridge_lease(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active Bridge",
        phone="+919100100008", enroll="109", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="disable_user", enroll_number="109",
        member_name=member.full_name,
    )
    db.session.add(cmd)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert STALE_DISABLE_MARKER in (saved.last_error or "")


def test_restored_member_stale_bridge_disable_self_corrects(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Restored Bridge",
        phone="+919100100009", enroll="110", status="active",
        end=date.today() + timedelta(days=20),
    )
    _delete_member(member)
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="disable_user", enroll_number="110",
        member_name=member.full_name,
    )
    db.session.add(cmd)
    db.session.commit()

    member.deleted_at = None
    member.status = "active"
    member.membership_end = date.today() + timedelta(days=20)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert STALE_DISABLE_MARKER in (saved.last_error or "")


# ─── V4-M3: stale block must not survive a terminal-ID recycle ────────────

def test_remap_displaces_stale_adms_manual_block(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M3-X2008", token="m3-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Holder A",
        phone="+919100100010", enroll="111", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    assert stale is not None
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Holder B",
        phone="+919100100011", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    remap_unresolved(gym_id, "111", holder_b, owner.id)
    db.session.commit()

    saved = db.session.get(RRRAdmsCommand, stale.id)
    assert saved.status == "failed"
    assert saved.result_code == STALE_COMMAND_SUPERSEDED_MARKER
    # Active B must not be blocked: nothing servable for the enroll.
    body = _getrequest_body(client, "m3-token", "M3-X2008")
    assert "C:" not in body, body


def test_remap_displaces_stale_bridge_disable(seed_gym):
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Bridge A",
        phone="+919100100012", enroll="112", status="expired",
        end=date.today() - timedelta(days=3),
    )
    stale = queue_membership_command(holder_a)
    assert stale is not None and stale.command_type == "disable_user"
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Bridge B",
        phone="+919100100013", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    remap_unresolved(gym_id, "112", holder_b, seed_gym["owner"].id)
    db.session.commit()

    saved = db.session.get(BridgeCommand, stale.id)
    assert saved.status == "failed"
    assert STALE_COMMAND_SUPERSEDED_MARKER in (saved.last_error or "")


def test_lease_cancels_stale_bridge_disable_after_recycle(seed_gym):
    # Backstop: a stale disable that reaches the lease (queued in another
    # process, after the remap) must not execute against the new holder.
    installation = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Lease A",
        phone="+919100100014", enroll="113", status="expired",
        end=date.today() - timedelta(days=3),
    )
    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Lease B",
        phone="+919100100015", enroll="113", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=holder_a.id,
        command_type="disable_user", enroll_number="113",
        member_name=holder_a.full_name,
    )
    db.session.add(stale)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, stale.id)
    assert saved.status == "failed"
    assert STALE_COMMAND_SUPERSEDED_MARKER in (saved.last_error or "")


def test_expired_new_holder_gets_own_block_after_remap(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M3B-X2008", token="m3b-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Expired A",
        phone="+919100100016", enroll="114", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    assert stale is not None
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Expired B",
        phone="+919100100017", enroll=None, status="expired",
        end=date.today() - timedelta(days=3),
    )
    remap_unresolved(gym_id, "114", holder_b, owner.id)
    db.session.commit()

    assert db.session.get(RRRAdmsCommand, stale.id).status == "failed"
    fresh = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="114", status="queued"
    ).one()
    assert fresh.action == "block"
    assert fresh.requested_by_id is None
    body = _getrequest_body(client, "m3b-token", "M3B-X2008")
    assert "C:" in body, body
    assert db.session.get(RRRAdmsCommand, fresh.id).status == "delivered"


# ─── V4-M4: set_valid_date judged by its window ───────────────────────────

def test_set_valid_date_past_window_leases_for_expired_member(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Past Window",
        phone="+919100100018", enroll="115", status="expired",
        end=date.today() - timedelta(days=3),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="set_valid_date", enroll_number="115",
        member_name=member.full_name,
        valid_from=(date.today() - timedelta(days=30)).isoformat(),
        valid_to=(date.today() - timedelta(days=1)).isoformat(),
    )
    db.session.add(cmd)
    db.session.commit()

    leased = lease_pending_commands(installation)
    assert [c.id for c in leased] == [cmd.id]


def test_set_valid_date_past_window_cancelled_for_active_member(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active Window",
        phone="+919100100019", enroll="116", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="set_valid_date", enroll_number="116",
        member_name=member.full_name,
        valid_from=(date.today() - timedelta(days=30)).isoformat(),
        valid_to=(date.today() - timedelta(days=1)).isoformat(),
    )
    db.session.add(cmd)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert STALE_DISABLE_MARKER in (saved.last_error or "")


def test_set_valid_date_future_window_cancelled_for_expired_member(seed_gym):
    installation = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Future Window",
        phone="+919100100020", enroll="117", status="expired",
        end=date.today() - timedelta(days=3),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id, member_id=member.id,
        command_type="set_valid_date", enroll_number="117",
        member_name=member.full_name,
        valid_from=date.today().isoformat(),
        valid_to=(date.today() + timedelta(days=30)).isoformat(),
    )
    db.session.add(cmd)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert STALE_ENABLE_MARKER in (saved.last_error or "")


# ─── V4-L6: bridge enroll fallback is canonical-aware ─────────────────────

def test_resolve_bridge_command_member_canonical_fallback(seed_gym):
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Zero Padded",
        phone="+919100100021", enroll="042", status="expired",
        end=date.today() - timedelta(days=3),
    )
    cmd = BridgeCommand(
        bridge_id=1, gym_id=seed_gym["gym"].id, member_id=None,
        command_type="disable_user", enroll_number="42",
        member_name="Zero Padded",
    )
    assert resolve_bridge_command_member(cmd) is not None
    assert resolve_bridge_command_member(cmd).id == member.id
    # ...so the guard judges the real member instead of failing safe.
    assert bridge_command_must_be_cancelled(cmd) is False


# ─── V4-L7: bulk_remove_expired covers paused + mapping-only ──────────────

def test_bulk_remove_expired_covers_paused_and_mapping_only(client, seed_gym):
    _adms_integration(seed_gym, serial="L7-X2008", token="l7-token")
    gym_id = seed_gym["gym"].id
    paused = _member(
        gym_id, seed_gym["plan"].id, name="Paused Member",
        phone="+919100100022", enroll="118", status="paused",
        end=date.today() + timedelta(days=20),
    )
    mapping_only = _member(
        gym_id, seed_gym["plan"].id, name="Mapping Only",
        phone="+919100100023", enroll=None, status="expired",
        end=date.today() - timedelta(days=3),
    )
    mapping = RRRIdentityMapping(
        gym_id=gym_id, external_id="119", member_id=mapping_only.id,
        source="adms_direct", status="confirmed",
    )
    db.session.add(mapping)
    expired = _member(
        gym_id, seed_gym["plan"].id, name="Expired Member",
        phone="+919100100024", enroll="120", status="expired",
        end=date.today() - timedelta(days=3),
    )
    # Active with a past end is NOT blockable: counted as a target but
    # reported as skipped (pinned M8 behaviour), never queued.
    active_overdue = _member(
        gym_id, seed_gym["plan"].id, name="Active Overdue",
        phone="+919100100025", enroll="121", status="active",
        end=date.today() - timedelta(days=2),
    )
    db.session.commit()

    res = client.post(
        "/api/mobile/v1/rrr/bulk-remove-expired",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["total"] == 4, data
    assert data["queued"] == 3, data
    assert data["skipped_not_blockable"] == 1, data
    for enroll in ("118", "119", "120"):
        assert RRRAdmsCommand.query.filter_by(
            gym_id=gym_id, action="block", test_enroll_number=enroll,
            status="queued",
        ).count() == 1, enroll
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="121"
    ).count() == 0


# ─── V4-L8: acked blocks belong to the member they were queued for ───────

def test_adms_dedup_does_not_return_previous_holders_acked_block(seed_gym):
    _adms_integration(seed_gym, serial="L8-X2008", token="l8-token")
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Acked A",
        phone="+919100100026", enroll="122", status="expired",
        end=date.today() - timedelta(days=3),
    )
    first = queue_membership_command(holder_a)
    assert first is not None and first.action == "block"
    first.status = "acked"
    first.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Acked B",
        phone="+919100100027", enroll="122", status="expired",
        end=date.today() - timedelta(days=3),
    )
    second = queue_membership_command(holder_b)
    db.session.commit()

    assert second is not None
    assert second.id != first.id, "recycled ID inherited the previous holder's acked block"
    assert second.status == "queued"
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, action="block", test_enroll_number="122"
    ).count() == 2


def test_adms_queued_block_rewritten_for_new_holder(seed_gym):
    # Same hole, queued (not yet acked) shape: the row must be rewritten
    # for the new holder, not returned as theirs with the old name.
    _adms_integration(seed_gym, serial="L8B-X2008", token="l8b-token")
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Queued A",
        phone="+919100100028", enroll="123", status="expired",
        end=date.today() - timedelta(days=3),
    )
    first = queue_membership_command(holder_a)
    assert first is not None
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Queued B",
        phone="+919100100029", enroll="123", status="expired",
        end=date.today() - timedelta(days=3),
    )
    second = queue_membership_command(holder_b)
    db.session.commit()

    assert second is not None and second.id == first.id
    assert "Queued B" in (second.command_text or "")
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, action="block", test_enroll_number="123"
    ).count() == 1


def test_scheduler_requeues_block_after_recycle(app, seed_gym):
    _adms_integration(seed_gym, serial="L8C-X2008", token="l8c-token")
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Sched A",
        phone="+919100100030", enroll="124", status="expired",
        end=date.today() - timedelta(days=3),
    )
    first = queue_membership_command(holder_a)
    assert first is not None
    first.status = "acked"
    first.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Sched B",
        phone="+919100100031", enroll="124", status="expired",
        end=date.today() - timedelta(days=3),
    )

    _scheduled_reminder_job(app)

    blocks = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, action="block", test_enroll_number="124"
    ).all()
    assert len(blocks) == 2, [ (b.id, b.status) for b in blocks ]
    assert any(b.status in {"queued", "delivered"} for b in blocks)
