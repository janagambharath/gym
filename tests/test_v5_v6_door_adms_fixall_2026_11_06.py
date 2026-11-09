"""Regression tests for the deep-review v5+v6 door-safety / ADMS findings
(2026-11-06, fix-all v5+v6, worker A2).

* V5-M4: recycled enroll whose last ACKED state is a block for the previous
  holder — the new active holder gets a corrective unblock at link time,
  even on the active-skip (OPERLOG auto-link) path.
* V5-M5: a delete-time block that fails once is re-driven — bridge retry
  uses the including-deleted guard, and the scheduler block-reconcile
  (ADMS + bridge) now scans soft-deleted members.
* V5-M6: mapping-only deleted member's delete-time block queues — the
  block is queued BEFORE the identity mappings are deleted.
* V5-L7: bridge enroll-confirm calls displace_stale_enroll_commands; an
  already-leased bridge command is (by lease design) not displaced.
* V5-L8: schedule_retry_after_failed_command retries create_user and
  set_valid_date, judged on their own intent.
* V6-M5: queue_manual_adms_member_command dedupes/replaces like the
  automatic path — repeated taps never stack duplicate commands.
* V6-M6: getrequest owner branch cancels a manual block whose intended
  member differs from the resolved member (B-H1 carve-out itself
  untouched — an owner block for its own member still serves).
* V6-M7: owner-triggered Re-sync skips an active member whose latest
  acked state is a manual block newer than their last membership change.
* V6-M8: a failed manual command surfaces as a distinct failed state via
  door_blocked_state / the member endpoint instead of reverting to the
  stale previous state.
* V6-M9: a queued-but-never-delivered command goes stale after the
  terminal poll interval + margin and stops reporting blocked=True.
* V6-L8: devicecmd ignores acks for guard-cancelled commands.
* V6-L9: _queue_template_restore_commands was DELETED (dead code) — see
  also tests/test_adms_template_crypto.py.

B-H1 (owner-override carve-out, adms/routes.py owner branch) is untouched;
test_owner_block_for_its_own_member_still_serves pins that.
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
    door_blocked_state,
    queue_gym_reconciliation,
    queue_manual_adms_member_command,
    queue_manual_bridge_member_command,
    queue_membership_command,
    schedule_retry_after_failed_command,
)
from app.services.enroll_match_service import confirm_match
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
    from app.services.bridge_service import invalidate_adms_enroll_index

    invalidate_adms_enroll_index(gym_id)
    return member


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V5V6 ADMS",
        device_serial=serial,
        device_name="V5V6 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _bridge(seed_gym, serial="V5V6-BRIDGE-01"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V5V6 bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key, serial="V5V6-BRIDGE-01"):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


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
    from app.services.bridge_service import invalidate_adms_enroll_index

    invalidate_adms_enroll_index(member.gym_id)


def _getrequest_body(client, token, serial):
    res = client.get(f"/iclock/{token}/getrequest?SN={serial}")
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    return res.get_data(as_text=True)


# ─── V5-M4: acked block for the previous holder must not pin the new holder ──

def test_remap_queues_corrective_unblock_for_recycled_acked_block(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M4-X2008", token="m4-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Acked A",
        phone="+919100200001", enroll="103", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    assert stale is not None
    stale.status = "acked"
    stale.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Active B",
        phone="+919100200002", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    remap_unresolved(gym_id, "103", holder_b, owner.id)
    db.session.commit()

    fresh = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="103", action="unblock", status="queued"
    ).one()
    assert fresh.id != stale.id
    body = _getrequest_body(client, "m4-token", "M4-X2008")
    assert "C:" in body and "Grp=1" in body, body
    assert db.session.get(RRRAdmsCommand, fresh.id).status == "delivered"


def test_confirm_match_active_skip_still_queues_corrective_unblock(seed_gym):
    _adms_integration(seed_gym, serial="M4B-X2008", token="m4b-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Skip A",
        phone="+919100200003", enroll="104", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    stale.status = "acked"
    stale.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Skip B",
        phone="+919100200004", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    # OPERLOG auto-link path: skip_command_for_active=True queues nothing
    # for an active member — the corrective unblock must still fire.
    confirm_match(
        gym_id, holder_b.id, "104", owner.id, skip_command_for_active=True
    )
    db.session.commit()

    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="104", action="unblock", status="queued"
    ).count() == 1


def test_remap_queues_corrective_enable_on_bridge_for_recycled_acked_disable(seed_gym):
    _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Bridge Acked A",
        phone="+919100200005", enroll="105", status="expired",
        end=date.today() - timedelta(days=3),
    )
    stale = queue_membership_command(holder_a)
    assert stale is not None and stale.command_type == "disable_user"
    stale.status = "acked"
    stale.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Bridge Active B",
        phone="+919100200006", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    remap_unresolved(gym_id, "105", holder_b, seed_gym["owner"].id)
    db.session.commit()

    fresh = BridgeCommand.query.filter_by(
        member_id=holder_b.id, command_type="enable_user", status="pending"
    ).one()
    assert fresh.enroll_number == "105"


def test_no_corrective_unblock_when_new_holder_is_expired(seed_gym):
    # The new holder needs a block, not an unblock: displace must not queue
    # a corrective enable for them (the remap's own queue handles it).
    _adms_integration(seed_gym, serial="M4C-X2008", token="m4c-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Exp A",
        phone="+919100200007", enroll="106", status="active",
        end=date.today() + timedelta(days=20),
    )
    stale = queue_manual_adms_member_command(holder_a, "block", owner.id)
    stale.status = "acked"
    stale.acknowledged_at = utcnow()
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Exp B",
        phone="+919100200008", enroll=None, status="expired",
        end=date.today() - timedelta(days=3),
    )
    remap_unresolved(gym_id, "106", holder_b, owner.id)
    db.session.commit()

    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="106", action="unblock"
    ).count() == 0
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="106", action="block", status="queued"
    ).count() == 1


# ─── V5-M5: a delete-time block that fails once is re-driven ───────────────

def test_scheduler_requeues_deleted_members_failed_adms_block(app, seed_gym):
    _adms_integration(seed_gym, serial="M5-X2008", token="m5-token")
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Deleted Fail",
        phone="+919100200009", enroll="107", status="expired",
        end=date.today() - timedelta(days=3),
    )
    _delete_member(member)
    cmd = queue_membership_command(member)
    assert cmd is not None and cmd.action == "block"
    cmd.status = "failed"
    cmd.result_message = "Timeout: no ack within 10 min"
    db.session.commit()

    _scheduled_reminder_job(app)

    blocks = RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="107", action="block"
    ).all()
    assert len(blocks) == 2, [(b.id, b.status) for b in blocks]
    assert any(b.status == "queued" for b in blocks)


def test_scheduler_requeues_deleted_members_failed_bridge_block(app, seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Deleted Bridge Fail",
        phone="+919100200010", enroll="108", status="expired",
        end=date.today() - timedelta(days=3),
    )
    _delete_member(member)
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        command_type="disable_user", enroll_number="108",
        member_name=member.full_name, status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd)
    db.session.commit()

    _scheduled_reminder_job(app)

    blocks = BridgeCommand.query.filter_by(
        gym_id=gym_id, member_id=member.id, command_type="disable_user"
    ).all()
    assert len(blocks) == 2, [(b.id, b.status) for b in blocks]
    assert any(b.status == "pending" for b in blocks)


def test_failed_disable_retries_for_deleted_member(seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Deleted Retry",
        phone="+919100200011", enroll="109", status="expired",
        end=date.today() - timedelta(days=3),
    )
    _delete_member(member)
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        command_type="disable_user", enroll_number="109",
        member_name=member.full_name, status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd)
    db.session.commit()

    retry = schedule_retry_after_failed_command(cmd)
    assert retry is not None
    assert retry.command_type == "disable_user"
    assert retry.retry_attempt == 1
    assert retry.id != cmd.id


def test_failed_disable_still_never_retries_for_active_member(seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Active No Retry",
        phone="+919100200012", enroll="110", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        command_type="disable_user", enroll_number="110",
        member_name=member.full_name, status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd)
    db.session.commit()

    assert schedule_retry_after_failed_command(cmd) is None


# ─── V5-M6: mapping-only deleted member's block queues ─────────────────────

def test_deactivate_mapping_only_member_queues_block(client, seed_gym):
    _adms_integration(seed_gym, serial="M6-X2008", token="m6-token")
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Mapping Only",
        phone="+919100200013", enroll=None, status="expired",
        end=date.today() - timedelta(days=3),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="111", member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="111", action="block", status="queued"
    ).count() == 1


# ─── V5-L7: bridge enroll-confirm displaces stale commands ────────────────

def test_bridge_enroll_confirm_displaces_pending_stale_disable(client, seed_gym):
    installation, api_key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Confirm A",
        phone="+919100200014", enroll="112", status="expired",
        end=date.today() - timedelta(days=3),
    )
    stale = queue_membership_command(holder_a)
    assert stale is not None and stale.command_type == "disable_user"
    db.session.commit()

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Confirm B",
        phone="+919100200015", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    res = client.post(
        "/api/bridge/v1/enrollment/confirm",
        json={
            "gymId": installation.public_id,
            "memberId": holder_b.id,
            "deviceEnrollNumber": "112",
        },
        headers=_bridge_headers(api_key),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]

    saved = db.session.get(BridgeCommand, stale.id)
    assert saved.status == "failed"
    assert STALE_COMMAND_SUPERSEDED_MARKER in (saved.last_error or "")


def test_bridge_enroll_confirm_leaves_leased_command_to_lease_guard(client, seed_gym):
    # Documented lease-design limit (V5-L7): an already-leased command is
    # not displaced by enroll-confirm; the lease-time holder-mismatch
    # check is what cancels it. The new holder's enable is still queued.
    from app.services.bridge_service import lease_pending_commands

    installation, api_key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Leased A",
        phone="+919100200016", enroll="113", status="expired",
        end=date.today() - timedelta(days=3),
    )
    stale = queue_membership_command(holder_a)
    assert stale is not None
    assert [c.id for c in lease_pending_commands(installation)] == [stale.id]
    assert db.session.get(BridgeCommand, stale.id).status == "leased"

    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Leased B",
        phone="+919100200017", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    res = client.post(
        "/api/bridge/v1/enrollment/confirm",
        json={
            "gymId": installation.public_id,
            "memberId": holder_b.id,
            "deviceEnrollNumber": "113",
        },
        headers=_bridge_headers(api_key),
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]

    assert db.session.get(BridgeCommand, stale.id).status == "leased"
    # The lease-time backstop only runs when the row is (re-)leased, and
    # its 120 s lease has not expired yet — so the stale row is NOT in
    # this lease batch, while the new holder's enable is.
    leased = lease_pending_commands(installation)
    assert stale.id not in [c.id for c in leased]
    assert any(
        c.member_id == holder_b.id and c.command_type == "enable_user"
        for c in leased
    )
    assert db.session.get(BridgeCommand, stale.id).status == "leased"


# ─── V5-L8: retries for create_user / set_valid_date ───────────────────────

def test_failed_create_user_retries_for_active_member(seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Create Retry",
        phone="+919100200018", enroll="114", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        command_type="create_user", enroll_number="114",
        member_name=member.full_name, status="failed",
        last_error="terminal temporarily offline",
    )
    db.session.add(cmd)
    db.session.commit()

    retry = schedule_retry_after_failed_command(cmd)
    assert retry is not None
    assert retry.command_type == "create_user"
    assert retry.retry_attempt == 1


def test_failed_set_valid_date_retries_on_its_own_intent(seed_gym):
    installation, _key = _bridge(seed_gym)
    gym_id = seed_gym["gym"].id
    active = _member(
        gym_id, seed_gym["plan"].id, name="Future Window",
        phone="+919100200019", enroll="115", status="active",
        end=date.today() + timedelta(days=20),
    )
    future = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=active.id,
        command_type="set_valid_date", enroll_number="115",
        member_name=active.full_name, status="failed",
        valid_from=date.today().isoformat(),
        valid_to=(date.today() + timedelta(days=30)).isoformat(),
        last_error="terminal temporarily offline",
    )
    expired = _member(
        gym_id, seed_gym["plan"].id, name="Past Window",
        phone="+919100200020", enroll="116", status="expired",
        end=date.today() - timedelta(days=3),
    )
    past = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=expired.id,
        command_type="set_valid_date", enroll_number="116",
        member_name=expired.full_name, status="failed",
        valid_from=(date.today() - timedelta(days=30)).isoformat(),
        valid_to=(date.today() - timedelta(days=1)).isoformat(),
        last_error="terminal temporarily offline",
    )
    db.session.add_all([future, past])
    db.session.commit()

    retry_future = schedule_retry_after_failed_command(future)
    assert retry_future is not None
    assert retry_future.command_type == "set_valid_date"
    retry_past = schedule_retry_after_failed_command(past)
    assert retry_past is not None
    assert retry_past.command_type == "set_valid_date"

    # A future-window set_valid_date for an expired member is an enable
    # for a non-enableable member: still no retry.
    expired_future = BridgeCommand(
        bridge_id=installation.id, gym_id=gym_id, member_id=expired.id,
        command_type="set_valid_date", enroll_number="116",
        member_name=expired.full_name, status="failed",
        valid_from=date.today().isoformat(),
        valid_to=(date.today() + timedelta(days=30)).isoformat(),
        last_error="terminal temporarily offline",
    )
    db.session.add(expired_future)
    db.session.commit()
    assert schedule_retry_after_failed_command(expired_future) is None


# ─── V6-M5: manual ADMS commands dedupe / replace ─────────────────────────

def test_manual_adms_double_block_queues_once(seed_gym):
    _adms_integration(seed_gym, serial="M5A-X2008", token="m5a-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Double Tap",
        phone="+919100200021", enroll="117", status="active",
        end=date.today() + timedelta(days=20),
    )
    first = queue_manual_adms_member_command(member, "block", owner.id)
    second = queue_manual_adms_member_command(member, "block", owner.id)
    db.session.commit()

    assert first is not None and second is not None
    assert first.id == second.id
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="117", action="block"
    ).count() == 1


def test_manual_adms_block_then_unblock_replaces_queued_row(seed_gym):
    _adms_integration(seed_gym, serial="M5B-X2008", token="m5b-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Flip Flop",
        phone="+919100200022", enroll="118", status="active",
        end=date.today() + timedelta(days=20),
    )
    first = queue_manual_adms_member_command(member, "block", owner.id)
    replaced = queue_manual_adms_member_command(member, "unblock", owner.id)
    db.session.commit()

    assert replaced.id == first.id
    assert replaced.action == "unblock"
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="118"
    ).count() == 1


def test_manual_adms_acked_state_returns_then_new_opposite_queues(seed_gym):
    _adms_integration(seed_gym, serial="M5C-X2008", token="m5c-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Acked Flip",
        phone="+919100200023", enroll="119", status="active",
        end=date.today() + timedelta(days=20),
    )
    first = queue_manual_adms_member_command(member, "unblock", owner.id)
    first.status = "acked"
    first.acknowledged_at = utcnow()
    db.session.commit()

    again = queue_manual_adms_member_command(member, "unblock", owner.id)
    assert again.id == first.id
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="119"
    ).count() == 1

    opposite = queue_manual_adms_member_command(member, "block", owner.id)
    db.session.commit()
    assert opposite.id != first.id
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="119"
    ).count() == 2


# ─── V6-M6: owner branch serves only against its intended member ───────────

def test_owner_block_cancelled_when_enroll_reassigned_to_another_member(client, seed_gym):
    _adms_integration(seed_gym, serial="M6A-X2008", token="m6a-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    holder_a = _member(
        gym_id, seed_gym["plan"].id, name="Owner A",
        phone="+919100200024", enroll="120", status="active",
        end=date.today() + timedelta(days=20),
    )
    manual = queue_manual_adms_member_command(holder_a, "block", owner.id)
    assert manual is not None and manual.requested_by_id == owner.id
    db.session.commit()

    # Reassign the enroll WITHOUT going through remap/displace (the path
    # V6-M6 guards): the serve-time check is the last line of defence.
    _unenroll_member(holder_a)
    holder_b = _member(
        gym_id, seed_gym["plan"].id, name="Owner B",
        phone="+919100200025", enroll="120", status="active",
        end=date.today() + timedelta(days=20),
    )

    body = _getrequest_body(client, "m6a-token", "M6A-X2008")
    assert "C:" not in body, body
    saved = db.session.get(RRRAdmsCommand, manual.id)
    assert saved.status == "cancelled"
    assert saved.result_code == STALE_COMMAND_SUPERSEDED_MARKER


def test_owner_block_for_its_own_member_still_serves(client, seed_gym):
    # B-H1 pin: the owner-override carve-out itself is untouched.
    _adms_integration(seed_gym, serial="M6B-X2008", token="m6b-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Own Block",
        phone="+919100200026", enroll="121", status="active",
        end=date.today() + timedelta(days=20),
    )
    manual = queue_manual_adms_member_command(member, "block", owner.id)
    assert manual is not None
    db.session.commit()

    body = _getrequest_body(client, "m6b-token", "M6B-X2008")
    assert "C:" in body and "Grp=100" in body, body
    assert db.session.get(RRRAdmsCommand, manual.id).status == "delivered"


# ─── V6-M7: Re-sync must not undo a manual misconduct block ───────────────

def test_reconcile_skips_newer_manual_block_then_proceeds_after_membership_change(seed_gym):
    _adms_integration(seed_gym, serial="M7-X2008", token="m7-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Misconduct",
        phone="+919100200027", enroll="122", status="active",
        end=date.today() + timedelta(days=20),
    )
    manual = queue_manual_adms_member_command(member, "block", owner.id)
    manual.status = "acked"
    manual.acknowledged_at = utcnow()
    db.session.commit()

    assert queue_gym_reconciliation(gym_id)["queued"] == 0
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="122", action="unblock"
    ).count() == 0

    # A later membership change (renewal/edit) retires the override: the
    # block is no longer newer than the last membership change.
    member.membership_end = date.today() + timedelta(days=25)
    db.session.commit()

    assert queue_gym_reconciliation(gym_id)["queued"] == 1
    assert RRRAdmsCommand.query.filter_by(
        gym_id=gym_id, test_enroll_number="122", action="unblock", status="queued"
    ).count() == 1


def test_reconcile_skips_newer_manual_bridge_block(seed_gym):
    _bridge(seed_gym)
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Bridge Misconduct",
        phone="+919100200028", enroll="123", status="active",
        end=date.today() + timedelta(days=20),
    )
    manual = queue_manual_bridge_member_command(member, "block", owner.id)
    assert manual is not None and manual.command_type == "disable_user"
    manual.status = "acked"
    manual.acknowledged_at = utcnow()
    db.session.commit()

    assert queue_gym_reconciliation(gym_id)["queued"] == 0
    assert BridgeCommand.query.filter_by(
        member_id=member.id, command_type="enable_user"
    ).count() == 0

    member.membership_end = date.today() + timedelta(days=25)
    db.session.commit()

    assert queue_gym_reconciliation(gym_id)["queued"] == 1
    assert BridgeCommand.query.filter_by(
        member_id=member.id, command_type="enable_user", status="pending"
    ).count() == 1


# ─── V6-M8: failed manual command is a distinct state ──────────────────────

def test_failed_manual_block_surfaces_as_failed_state(client, seed_gym):
    _adms_integration(seed_gym, serial="M8-X2008", token="m8-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Failed Block",
        phone="+919100200029", enroll="124", status="active",
        end=date.today() + timedelta(days=20),
    )
    unblock = queue_manual_adms_member_command(member, "unblock", owner.id)
    unblock.status = "acked"
    unblock.acknowledged_at = utcnow()
    db.session.commit()

    block = queue_manual_adms_member_command(member, "block", owner.id)
    assert block is not None and block.id != unblock.id
    block.status = "failed"
    block.result_code = "1"
    block.result_message = "Timeout: no ack within 10 min"
    db.session.commit()

    state = door_blocked_state(member)
    assert state["failed"] is True
    assert state["failed_action"] == "block"
    assert state["failed_at"] is not None
    # The page must NOT claim the previous acked unblock is the current
    # truth without the failure attached — blocked stays False (previous
    # acked state) but the failure is explicit.
    assert state["blocked"] is False
    assert state["detail"] == "Timeout: no ack within 10 min"

    res = client.get(
        f"/api/mobile/v1/members/{member.id}", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    data = res.get_json()["data"]
    assert data["door_access_failed"] is True
    assert data["door_access_failed_action"] == "block"
    assert data["door_access_failed_at"] is not None


def test_re_tapping_after_failure_queues_fresh_command(seed_gym):
    # The "tap to retry" half of V6-M8: a failed row never dedupes, so the
    # owner can re-issue the same action.
    _adms_integration(seed_gym, serial="M8B-X2008", token="m8b-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Retry Tap",
        phone="+919100200030", enroll="125", status="active",
        end=date.today() + timedelta(days=20),
    )
    first = queue_manual_adms_member_command(member, "block", owner.id)
    first.status = "failed"
    first.result_code = "1"
    first.result_message = "Timeout: no ack within 10 min"
    db.session.commit()

    second = queue_manual_adms_member_command(member, "block", owner.id)
    db.session.commit()
    assert second is not None and second.id != first.id
    assert second.status == "queued"


# ─── V6-M9: queued-but-never-delivered goes stale ──────────────────────────

def test_stale_queued_block_stops_reporting_blocked(seed_gym):
    integration = _adms_integration(seed_gym, serial="M9-X2008", token="m9-token")
    owner = seed_gym["owner"]
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Stale Queued",
        phone="+919100200031", enroll="126", status="active",
        end=date.today() + timedelta(days=20),
    )
    cmd = queue_manual_adms_member_command(member, "block", owner.id)
    assert cmd is not None
    # Fresh: the queued block is still the requested state.
    fresh_state = door_blocked_state(member)
    assert fresh_state["blocked"] is True
    assert fresh_state["pending"] is True
    assert fresh_state["pending_action"] == "block"
    assert fresh_state["stale_queued"] is False

    # 30 min with no delivery (terminal polls every 30 s): stale.
    cmd.created_at = utcnow() - timedelta(minutes=30)
    db.session.commit()

    state = door_blocked_state(member)
    assert state["blocked"] is False
    assert state["pending"] is True
    assert state["pending_action"] == "block"
    assert state["stale_queued"] is True
    assert state["queued_since"] is not None
    assert state["terminal_last_seen_at"] is not None
    assert integration.last_success_at is not None


# ─── V6-L8: acks for guard-cancelled commands are ignored ──────────────────

def test_devicecmd_ignores_ack_for_guard_cancelled_block(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="L8-X2008", token="l8-token")
    gym_id = seed_gym["gym"].id
    member = _member(
        gym_id, seed_gym["plan"].id, name="Cancelled Ack",
        phone="+919100200032", enroll="127", status="active",
        end=date.today() + timedelta(days=20),
    )
    from app.services.bridge_service import adms_command_text

    cmd = RRRAdmsCommand(
        gym_id=gym_id, integration_id=integration.id,
        action="block", test_enroll_number="127",
        command_text=adms_command_text("block", "127", member_name="Cancelled Ack"),
        status="queued",
    )
    db.session.add(cmd)
    db.session.commit()

    # Serve-time guard cancels the automatic block for an active member.
    body = _getrequest_body(client, "l8-token", "L8-X2008")
    assert "C:" not in body, body
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "cancelled"
    assert saved.result_code == STALE_DISABLE_MARKER

    # A late Return=0 ack from the terminal must not flip it back.
    res = client.post(
        f"/iclock/l8-token/devicecmd?SN=L8-X2008",
        data={"ID": str(cmd.id), "Return": "0", "Content": "OK"},
    )
    assert res.status_code == 200
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "cancelled"
    assert saved.result_code == STALE_DISABLE_MARKER


# ─── V6-L9: template restore helper is gone (dead code deleted) ────────────

def test_template_restore_helper_is_deleted():
    import app.services.bridge_service as bridge_service

    assert not hasattr(bridge_service, "_queue_template_restore_commands")
