"""Regression tests for the deep-review v9 ADMS / door-safety findings
(2026-11-07, fix-all v9, worker ADMS/door).

* V9-M7: bridge twin of V8-L11 — a pending raw/advanced bridge command
  (create_user / delete_user / set_valid_date) was silently overwritten
  in place by the bridge membership/manual dedupe (no command-type
  filter, no audit on the membership path). A raw-queued enrollment
  could vanish and leave a paying member with no terminal user. Both
  bridge queue functions now preserve any pending non-membership
  command, audit the preservation, and queue the membership/manual
  command as a fresh row behind it. The normal replace path (pending
  enable -> disable) still replaces in place.
* V9-L13: the V8-L10 manual re-stamp refreshed intended_member_id but
  not the stale command_text name, so a legacy row could serve a block
  that renames the terminal user to the previous holder's name. The
  re-stamp now refreshes command_text from the current member + audits.
* V9-L14: a queued unlock_door never expired and served unguarded
  whenever the terminal next polled, wedging the ADMS pipe behind the
  COMMAND_PENDING guards, with no owner cancel path. Queued unlocks
  now expire after 10 min at serve/lease time (ADMS getrequest +
  bridge lease), and owners can cancel a queued ADMS row via
  POST /api/mobile/v1/access/adms-commands/<id>/cancel.
* V9-L15: a bridge "accepted"-but-never-confirmed command escalated to
  failed after 10 leases with no bounded retry (only incoming "failed"
  scheduled one), so a dead enable stranded a renewed member. The ack
  endpoint now schedules the bounded retry whenever the durable status
  after the ack is failed. The retry stays bounded by
  BRIDGE_COMMAND_MAX_EXECUTION_ATTEMPTS and fail-closed (never
  re-drives a disable/enable the member no longer qualifies for).

Fail-closed invariant pinned throughout: no change here lets a block
reach a live active member (the lease/serve guards are untouched and
the L15 retry guard is exercised for an active member's disable).
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
    adms_command_text,
    expire_stale_queued_adms_unlock_commands,
    lease_pending_commands,
    queue_adms_membership_command,
    queue_manual_adms_member_command,
    queue_manual_bridge_member_command,
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


def _bridge(seed_gym, serial="V9-BRIDGE-01"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V9 bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key, serial="V9-BRIDGE-01"):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V9 ADMS",
        device_serial=serial,
        device_name="V9 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _expired_member(seed_gym, *, enroll, phone, name="V9 Expired"):
    return _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name=name,
        phone=phone, enroll=enroll, status="expired",
        end=date.today() - timedelta(days=3),
    )


def _pending_raw_bridge_command(installation, member, *, command_type, enroll):
    cmd = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type=command_type,
        enroll_number=enroll,
        member_name=member.full_name,
        status="pending",
    )
    db.session.add(cmd)
    db.session.commit()
    return cmd


# ─── V9-M7: bridge membership/manual dedupe preserves raw commands ───────

def test_v9m7_bridge_membership_queue_preserves_queued_create_user(seed_gym):
    installation, _key = _bridge(seed_gym)
    member = _expired_member(seed_gym, enroll="181", phone="+919100500001")
    create = _pending_raw_bridge_command(
        installation, member, command_type="create_user", enroll="181"
    )

    block = queue_membership_command(member)
    assert block is not None
    assert block.id != create.id
    assert block.command_type == "disable_user"
    # The bridge membership queue does not flush (callers commit with
    # the membership change); flush so the column default lands.
    db.session.flush()
    assert block.status == "pending"
    saved_create = db.session.get(BridgeCommand, create.id)
    assert saved_create.status == "pending"
    assert saved_create.command_type == "create_user"
    rows = AuditLog.query.filter_by(
        resource_type="bridge_command", action="bridge_membership_command_queued"
    ).all()
    assert any(
        (r.metadata_json or {}).get("raw_command_preserved") is True
        and (r.metadata_json or {}).get("preserved_command_type") == "create_user"
        for r in rows
    ), "expected a raw_command_preserved audit row"


def test_v9m7_bridge_membership_queue_preserves_delete_and_set_valid_date(seed_gym):
    installation, _key = _bridge(seed_gym)
    for command_type, enroll, phone in [
        ("delete_user", "182", "+919100500002"),
        ("set_valid_date", "183", "+919100500003"),
    ]:
        member = _expired_member(seed_gym, enroll=enroll, phone=phone)
        raw = _pending_raw_bridge_command(
            installation, member, command_type=command_type, enroll=enroll
        )
        queued = queue_membership_command(member)
        assert queued is not None and queued.id != raw.id
        assert queued.command_type == "disable_user"
        saved_raw = db.session.get(BridgeCommand, raw.id)
        assert saved_raw.status == "pending"
        assert saved_raw.command_type == command_type


def test_v9m7_bridge_manual_queue_preserves_queued_create_user(seed_gym):
    installation, _key = _bridge(seed_gym)
    owner = seed_gym["owner"]
    member = _expired_member(seed_gym, enroll="184", phone="+919100500004")
    create = _pending_raw_bridge_command(
        installation, member, command_type="create_user", enroll="184"
    )

    block = queue_manual_bridge_member_command(member, "block", owner.id)
    assert block is not None
    assert block.id != create.id
    assert block.command_type == "disable_user"
    saved_create = db.session.get(BridgeCommand, create.id)
    assert saved_create.status == "pending"
    assert saved_create.command_type == "create_user"
    rows = AuditLog.query.filter_by(
        resource_type="bridge_command", action="bridge_manual_block_queued"
    ).all()
    assert any(
        (r.metadata_json or {}).get("raw_command_preserved") is True for r in rows
    ), "expected a raw_command_preserved audit row"


def test_v9m7_bridge_membership_normal_replace_still_replaces(seed_gym):
    """Regression pin for the kept behaviour: a pending enable_user IS
    replaced in place by the newest membership state (expired -> block)."""
    installation, _key = _bridge(seed_gym)
    member = _expired_member(seed_gym, enroll="185", phone="+919100500005")
    enable = _pending_raw_bridge_command(
        installation, member, command_type="enable_user", enroll="185"
    )

    block = queue_membership_command(member)
    assert block is not None
    assert block.id == enable.id
    assert block.command_type == "disable_user"
    assert BridgeCommand.query.filter_by(
        gym_id=member.gym_id, member_id=member.id, status="pending"
    ).count() == 1


# ─── V9-L13: manual re-stamp refreshes the stale command_text name ────────

def test_v9l13_manual_restamp_refreshes_command_text_name(seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L13-X2008", token="v9l13-token")
    gym_id = seed_gym["gym"].id
    owner = seed_gym["owner"]
    member = _member(
        gym_id, seed_gym["plan"].id, name="Legacy Block",
        phone="+919100500006", enroll="191", status="active",
        end=date.today() + timedelta(days=20),
    )
    legacy = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="block",
        test_enroll_number="191",
        command_text=adms_command_text("block", "191", member_name="Old Name"),
        requested_by_id=owner.id,
        intended_member_id=None,
        status="queued",
    )
    db.session.add(legacy)
    db.session.commit()

    returned = queue_manual_adms_member_command(member, "block", owner.id)
    assert returned is not None
    assert returned.id == legacy.id
    saved = db.session.get(RRRAdmsCommand, legacy.id)
    assert saved.intended_member_id == member.id
    assert "Legacy Block" in (saved.command_text or "")
    assert "Old Name" not in (saved.command_text or "")
    rows = AuditLog.query.filter_by(
        resource_type="rrr_adms_command", resource_id=str(legacy.id),
        action="adms_manual_block_queued",
    ).all()
    assert any(
        (r.metadata_json or {}).get("restamped_intent") is True
        and (r.metadata_json or {}).get("command_text_refreshed") is True
        for r in rows
    ), "expected a restamped_intent + command_text_refreshed audit row"


# ─── V9-L14: queued unlock_door expires; owner can cancel queued rows ────

def _adms_unlock(seed_gym, integration, *, stale_minutes=None):
    cmd = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        action="unlock_door",
        test_enroll_number=None,
        command_text=adms_command_text("unlock_door", None, delay_seconds=5),
        requested_by_id=seed_gym["owner"].id,
        status="queued",
    )
    db.session.add(cmd)
    db.session.commit()
    if stale_minutes is not None:
        cmd.created_at = utcnow() - timedelta(minutes=stale_minutes)
        db.session.commit()
    return cmd


def test_v9l14_stale_queued_adms_unlock_expires_on_getrequest(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L14-X2008", token="v9l14-token")
    stale = _adms_unlock(seed_gym, integration, stale_minutes=11)

    res = client.get("/iclock/v9l14-token/getrequest?SN=V9L14-X2008")
    assert res.status_code == 200
    assert res.get_data(as_text=True) == "OK"
    saved = db.session.get(RRRAdmsCommand, stale.id)
    assert saved.status == "failed"
    assert saved.result_code == "CANCELLED_STALE_UNLOCK"


def test_v9l14_fresh_queued_adms_unlock_still_serves(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L14B-X2008", token="v9l14b-token")
    fresh = _adms_unlock(seed_gym, integration)

    res = client.get("/iclock/v9l14b-token/getrequest?SN=V9L14B-X2008")
    assert res.status_code == 200
    assert "CONTROL DEVICE 1" in res.get_data(as_text=True)
    saved = db.session.get(RRRAdmsCommand, fresh.id)
    assert saved.status == "delivered"


def test_v9l14_expire_helper_leaves_fresh_unlock_alone(seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L14C-X2008", token="v9l14c-token")
    fresh = _adms_unlock(seed_gym, integration)
    assert expire_stale_queued_adms_unlock_commands(integration.id) == 0
    assert db.session.get(RRRAdmsCommand, fresh.id).status == "queued"


def test_v9l14_stale_bridge_unlock_expires_at_lease_and_fresh_leases(seed_gym):
    installation, _key = _bridge(seed_gym)
    stale = BridgeCommand(
        bridge_id=installation.id,
        gym_id=seed_gym["gym"].id,
        member_id=None,
        command_type="unlock_door",
        enroll_number="SYSTEM",
        status="pending",
    )
    db.session.add(stale)
    db.session.commit()
    stale.created_at = utcnow() - timedelta(minutes=11)
    db.session.commit()

    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, stale.id)
    assert saved.status == "failed"
    assert "CANCELLED_STALE_UNLOCK" in (saved.last_error or "")

    fresh = BridgeCommand(
        bridge_id=installation.id,
        gym_id=seed_gym["gym"].id,
        member_id=None,
        command_type="unlock_door",
        enroll_number="SYSTEM",
        status="pending",
    )
    db.session.add(fresh)
    db.session.commit()
    leased = lease_pending_commands(installation)
    assert [c.id for c in leased] == [fresh.id]


def test_v9l14_owner_can_cancel_queued_adms_row_and_pipe_unwedges(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L14D-X2008", token="v9l14d-token")
    unlock = _adms_unlock(seed_gym, integration)

    res = client.post(
        f"/api/mobile/v1/access/adms-commands/{unlock.id}/cancel",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    saved = db.session.get(RRRAdmsCommand, unlock.id)
    assert saved.status == "failed"
    assert saved.result_code == "CANCELLED_BY_OWNER"

    # Cancelling again is a 409 — terminal rows are history, not re-cancellable.
    res = client.post(
        f"/api/mobile/v1/access/adms-commands/{unlock.id}/cancel",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 409

    # The pipe is unwedged: a fresh unlock can now be queued (the
    # COMMAND_PENDING guard no longer sees the cancelled row).
    res = client.post(
        "/api/mobile/v1/access/remote-unlock",
        json={"confirm": True, "delay_seconds": 5},
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    assert res.get_json()["data"]["status"] == "queued"


def test_v9l14_owner_cancel_rejects_delivered_row_and_unknown_id(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="V9L14E-X2008", token="v9l14e-token")
    delivered = _adms_unlock(seed_gym, integration)
    delivered.status = "delivered"
    delivered.delivered_at = utcnow()
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/access/adms-commands/{delivered.id}/cancel",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 409
    assert db.session.get(RRRAdmsCommand, delivered.id).status == "delivered"

    res = client.post(
        "/api/mobile/v1/access/adms-commands/999999/cancel",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 404


# ─── V9-L15: accepted-but-never-confirmed escalates with bounded retry ────

def test_v9l15_accepted_escalation_schedules_bounded_retry(client, seed_gym, seed_member):
    installation, api_key = _bridge(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    command = queue_membership_command(member)
    assert command.command_type == "enable_user"
    command.delivery_attempts = 9
    db.session.commit()

    delivery = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}",
        headers=_bridge_headers(api_key),
    )
    assert delivery.status_code == 200
    assert len(delivery.json) == 1
    token = delivery.json[0]["leaseToken"]

    ack = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={"status": "accepted", "leaseToken": token,
              "errorMessage": "Accepted by server; device delivery unconfirmed."},
        headers=_bridge_headers(api_key),
    )
    assert ack.status_code == 200, ack.get_data(as_text=True)[:300]
    assert ack.json["retryScheduled"] is True
    assert db.session.get(BridgeCommand, command.id).status == "failed"
    retries = BridgeCommand.query.filter_by(member_id=member.id).order_by(
        BridgeCommand.created_at
    ).all()
    assert len(retries) == 2
    assert retries[1].status == "pending"
    assert retries[1].command_type == "enable_user"
    assert retries[1].retry_attempt == 1
    assert retries[1].not_before is not None


def test_v9l15_accepted_below_threshold_does_not_schedule_retry(client, seed_gym, seed_member):
    installation, api_key = _bridge(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    command = queue_membership_command(member)
    db.session.commit()

    delivery = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}",
        headers=_bridge_headers(api_key),
    )
    ack = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={"status": "accepted", "leaseToken": delivery.json[0]["leaseToken"]},
        headers=_bridge_headers(api_key),
    )
    assert ack.status_code == 200
    assert ack.json["retryScheduled"] is False
    assert db.session.get(BridgeCommand, command.id).status == "pending"
    assert BridgeCommand.query.filter_by(member_id=member.id).count() == 1


def test_v9l15_retry_is_bounded_at_max_attempts(client, seed_gym, seed_member):
    """A command already at the retry cap escalates to failed with no
    further retry — the retry loop terminates."""
    installation, api_key = _bridge(seed_gym)
    member = db.session.get(Member, seed_member.id)
    member.device_enroll_number = "42"
    command = queue_membership_command(member)
    command.delivery_attempts = 9
    command.retry_attempt = 4  # BRIDGE_COMMAND_MAX_EXECUTION_ATTEMPTS is 5
    db.session.commit()

    delivery = client.get(
        f"/api/bridge/v1/commands/pending?gymId={installation.public_id}",
        headers=_bridge_headers(api_key),
    )
    ack = client.post(
        f"/api/bridge/v1/commands/{command.id}/ack",
        json={"status": "accepted", "leaseToken": delivery.json[0]["leaseToken"]},
        headers=_bridge_headers(api_key),
    )
    assert ack.status_code == 200
    assert ack.json["retryScheduled"] is False
    assert db.session.get(BridgeCommand, command.id).status == "failed"
    assert BridgeCommand.query.filter_by(member_id=member.id).count() == 1


def test_v9l15_accepted_escalation_never_retries_active_member_disable(client, seed_gym):
    """Fail-closed pin: an accepted-escalated disable for a LIVE active
    member must fail without a retry — the retry guard, not the ack
    path, is the decider."""
    installation, _key = _bridge(seed_gym)
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active No Retry",
        phone="+919100500007", enroll="195", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type="disable_user",
        enroll_number="195",
        member_name=member.full_name,
        status="leased",
        lease_token="v9l15-token",
        lease_expires_at=utcnow() + timedelta(minutes=2),
        delivery_attempts=10,
    )
    db.session.add(cmd)
    db.session.commit()

    from app.services.bridge_service import acknowledge_command, schedule_retry_after_failed_command

    accepted, _err = acknowledge_command(
        cmd, status="accepted", lease_token="v9l15-token",
        error_message="Accepted by server; device delivery unconfirmed.",
    )
    assert accepted is True
    assert cmd.status == "failed"
    assert schedule_retry_after_failed_command(cmd) is None
    assert BridgeCommand.query.filter_by(member_id=member.id).count() == 1
