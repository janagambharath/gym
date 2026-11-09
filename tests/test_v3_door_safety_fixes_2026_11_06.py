"""Regression tests for the deep-review v3 door-safety / ADMS findings
(2026-11-06).

* V3-M6: create_user must not open the door for an expired/paused member
  (409 at queue time; 409 chosen over create-then-block / Grp=100 wire
  text because a refusal has no access window).
* V3-M7: direct enroll endpoint enforces Guard 3 (identity mappings) and
  deletes stale mappings when a member's terminal ID changes.
* V3-M8: scheduler reconciliation re-drives failed blocks for paused
  members, ADMS and bridge paths.
* V3-M9: group-block test 409s at queue time for a real member's ID.
* V3-L6: resolve_adms_member's legacy fallback uses a cached per-gym
  canonical index instead of a full-table scan; results unchanged.
* V3-L7: desired_command_type treats NULL membership_end as "cannot
  prove expired" (disable_user, cancelled CANCELLED_STALE_STATE) instead
  of raising TypeError.

B-H1 (owner-override carve-out, adms/routes.py) is untouched; the serve
guards below are backstops, not the code under test.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models.mixins import utcnow
from app.models.rrr import RRRAdmsCommand, RRRIdentityMapping, RRRIntegration
from app.services.bridge_service import (
    STALE_DISABLE_MARKER,
    _adms_enroll_index_cache,
    adms_command_text,
    bridge_command_must_be_cancelled,
    desired_command_type,
    invalidate_adms_enroll_index,
    lease_pending_commands,
    member_is_proven_blockable,
    member_is_proven_enableable,
    resolve_adms_member,
)
from app.services.reminder_scheduler import _scheduled_reminder_job


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _member(gym_id, plan_id, *, name, phone, enroll=None, status="active",
            start=None, end="__default__", price=1000):
    # end="__default__" -> +30d; end=None -> NULL end (L7) stays NULL.
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
    return member


def _member_with_end(gym_id, plan_id, *, name, phone, enroll=None,
                     status="active", end, start=None):
    return _member(gym_id, plan_id, name=name, phone=phone, enroll=enroll,
                   status=status, start=start, end=end)


def _adms_integration(seed_gym, *, serial, token):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V3 ADMS",
        device_serial=serial,
        device_name="V3 X2008",
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
        seed_gym["gym"].id, "V3 bridge", "V3-BRIDGE-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation


def _device_command_url(integration_id):
    return f"/api/mobile/v1/rrr/integrations/{integration_id}/adms/device-command"


def _group_test_url(integration_id):
    return f"/api/mobile/v1/rrr/integrations/{integration_id}/adms/commands"


# ─── V3-M6: create_user must not open the door ────────────────────────────

def test_create_user_for_expired_member_409s(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M6-X2008", token="m6-token")
    _member_with_end(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Expired Member",
        phone="+919100060001", enroll="42", status="expired",
        end=date.today() - timedelta(days=5),
    )
    res = client.post(
        _device_command_url(integration.id), headers=_owner_headers(seed_gym),
        json={"action": "create_user", "enroll_number": "42", "member_name": "Expired Member"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "MEMBER_NOT_ENABLEABLE"
    assert RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


def test_create_user_for_paused_member_409s(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M6P-X2008", token="m6p-token")
    _member_with_end(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Paused Member",
        phone="+919100060002", enroll="43", status="paused",
        end=date.today() + timedelta(days=20),
    )
    res = client.post(
        _device_command_url(integration.id), headers=_owner_headers(seed_gym),
        json={"action": "create_user", "enroll_number": "43", "member_name": "Paused Member"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


def test_create_user_for_active_member_still_201s(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M6A-X2008", token="m6a-token")
    _member_with_end(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Active Member",
        phone="+919100060003", enroll="44", status="active",
        end=date.today() + timedelta(days=20),
    )
    res = client.post(
        _device_command_url(integration.id), headers=_owner_headers(seed_gym),
        json={"action": "create_user", "enroll_number": "44", "member_name": "Active Member"},
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]
    assert RRRAdmsCommand.query.filter_by(
        gym_id=seed_gym["gym"].id, action="create_user"
    ).count() == 1


def test_create_user_for_active_member_with_null_end_409s(client, seed_gym):
    # Fail-closed: an active member with no end date cannot be proven
    # enableable, so no terminal user is created for them.
    integration = _adms_integration(seed_gym, serial="M6N-X2008", token="m6n-token")
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Null End Member",
        phone="+919100060004", enroll="45", status="active",
        start=date.today() - timedelta(days=30), end=None,
    )
    assert member.membership_end is None
    res = client.post(
        _device_command_url(integration.id), headers=_owner_headers(seed_gym),
        json={"action": "create_user", "enroll_number": "45", "member_name": "Null End Member"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


# ─── V3-M9: group-block test refuses real members at queue time ───────────

def test_group_block_test_for_real_member_409s_at_queue(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M9-X2008", token="m9-token")
    _member_with_end(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Confirmed Member",
        phone="+919100090001", enroll="930", status="active",
        end=date.today() + timedelta(days=20),
    )
    res = client.post(
        _group_test_url(integration.id), headers=_owner_headers(seed_gym),
        json={
            "action": "essl_group_block_test",
            "test_enroll_number": "930",
            "test_user_name": "Confirmed Member",
            "test_member_confirmed": True,
        },
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "TEST_MEMBER_IS_REAL"
    assert RRRAdmsCommand.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


def test_group_block_test_for_fake_id_still_201s(client, seed_gym):
    integration = _adms_integration(seed_gym, serial="M9F-X2008", token="m9f-token")
    res = client.post(
        _group_test_url(integration.id), headers=_owner_headers(seed_gym),
        json={
            "action": "essl_group_block_test",
            "test_enroll_number": "999",
            "test_user_name": "Test Fake",
            "test_member_confirmed": True,
        },
    )
    assert res.status_code == 201, res.get_data(as_text=True)[:300]


# ─── V3-M7: enroll enforces Guard 3 + frees stale mappings ───────────────

def test_enroll_rejected_when_id_mapped_to_another_member(client, seed_gym):
    gym_id = seed_gym["gym"].id
    member_a = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Mapped A",
        phone="+919100070001", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="103", member_id=member_a.id,
        source="adms_direct", status="confirmed",
    ))
    member_b = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Enrolling B",
        phone="+919100070002", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/members/{member_b.id}/enroll",
        headers=_owner_headers(seed_gym), json={"enroll_number": "103"},
    )
    assert res.status_code == 409, res.get_data(as_text=True)[:300]
    assert res.get_json()["error"]["code"] == "DUPLICATE_ENROLL"
    db.session.refresh(member_b)
    assert member_b.device_enroll_number is None
    # The original mapping is untouched.
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="103", status="confirmed"
    ).one().member_id == member_a.id


def test_enroll_move_frees_old_mapping_for_reuse(client, seed_gym):
    gym_id = seed_gym["gym"].id
    member_a = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Moving A",
        phone="+919100070003", enroll="103", status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="103", member_id=member_a.id,
        source="adms_direct", status="confirmed",
    ))
    member_b = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Taking B",
        phone="+919100070004", enroll=None, status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/members/{member_a.id}/enroll",
        headers=_owner_headers(seed_gym), json={"enroll_number": "104"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    # Old mapping 103 -> A is gone, so 103 no longer resolves to A.
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="103", member_id=member_a.id
    ).count() == 0
    assert resolve_adms_member(gym_id, "103") is None

    res = client.post(
        f"/api/mobile/v1/members/{member_b.id}/enroll",
        headers=_owner_headers(seed_gym), json={"enroll_number": "103"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert resolve_adms_member(gym_id, "103").id == member_b.id


def test_enroll_same_id_keeps_own_mapping(client, seed_gym):
    gym_id = seed_gym["gym"].id
    member_a = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Steady A",
        phone="+919100070005", enroll="103", status="active",
        end=date.today() + timedelta(days=20),
    )
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="103", member_id=member_a.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/members/{member_a.id}/enroll",
        headers=_owner_headers(seed_gym), json={"enroll_number": "103"},
    )
    assert res.status_code == 200, res.get_data(as_text=True)[:300]
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="103", member_id=member_a.id,
        status="confirmed",
    ).count() == 1


# ─── V3-M8: scheduler re-drives failed blocks for paused members ─────────

def test_scheduler_requeues_failed_block_for_paused_member_adms(app, seed_gym):
    gym = seed_gym["gym"]
    _adms_integration(seed_gym, serial="M8-X2008", token="m8-token")
    paused = _member_with_end(
        gym.id, seed_gym["plan"].id, name="Frozen Paused",
        phone="+919100080001", enroll="55", status="paused",
        end=date.today() + timedelta(days=20),
    )
    expired = _member_with_end(
        gym.id, seed_gym["plan"].id, name="Expired Still",
        phone="+919100080002", enroll="56", status="expired",
        end=date.today() - timedelta(days=3),
    )
    assert member_is_proven_blockable(paused) is True
    assert member_is_proven_blockable(expired) is True

    _scheduled_reminder_job(app)

    paused_block = RRRAdmsCommand.query.filter_by(
        gym_id=gym.id, action="block", test_enroll_number="55"
    ).first()
    assert paused_block is not None, "paused member's failed block was never re-queued"
    assert paused_block.status in {"queued", "delivered"}
    expired_block = RRRAdmsCommand.query.filter_by(
        gym_id=gym.id, action="block", test_enroll_number="56"
    ).first()
    assert expired_block is not None, "expired regression: block no longer re-queued"


def test_scheduler_requeues_failed_block_for_paused_member_bridge(app, seed_gym):
    gym = seed_gym["gym"]
    installation = _bridge(seed_gym)
    paused = _member_with_end(
        gym.id, seed_gym["plan"].id, name="Frozen Bridge",
        phone="+919100080003", enroll="57", status="paused",
        end=date.today() + timedelta(days=20),
    )
    active = _member_with_end(
        gym.id, seed_gym["plan"].id, name="Active Bridge",
        phone="+919100080004", enroll="58", status="active",
        end=date.today() + timedelta(days=20),
    )

    _scheduled_reminder_job(app)

    paused_cmd = BridgeCommand.query.filter_by(
        bridge_id=installation.id, member_id=paused.id,
        command_type="disable_user",
    ).first()
    assert paused_cmd is not None, "paused member's failed bridge block was never re-queued"
    assert BridgeCommand.query.filter_by(
        bridge_id=installation.id, member_id=active.id,
        command_type="disable_user",
    ).count() == 0, "active member must never get a disable re-queued"


# ─── V3-L6: cached canonical index resolves exactly like the scan ────────

def test_resolve_adms_member_index_matches_scan_results(seed_gym):
    gym_id = seed_gym["gym"].id
    zero_padded = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Zero Padded",
        phone="+919100060011", enroll="042", status="active",
        end=date.today() + timedelta(days=20),
    )
    plain = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Plain",
        phone="+919100060012", enroll="43", status="active",
        end=date.today() + timedelta(days=20),
    )
    invalidate_adms_enroll_index(gym_id)

    # First call builds the index, second call serves from it: results
    # must be identical either way.
    for _ in range(2):
        assert resolve_adms_member(gym_id, "42").id == zero_padded.id
        assert resolve_adms_member(gym_id, "042").id == zero_padded.id
        assert resolve_adms_member(gym_id, "43").id == plain.id
        assert resolve_adms_member(gym_id, "99") is None
    assert gym_id in _adms_enroll_index_cache


def test_resolve_adms_member_index_self_heals_after_reenroll(seed_gym):
    gym_id = seed_gym["gym"].id
    invalidate_adms_enroll_index(gym_id)  # hermetic: prior tests share gym id 1
    member = _member_with_end(
        gym_id, seed_gym["plan"].id, name="Reenrolled",
        phone="+919100060013", enroll="042", status="active",
        end=date.today() + timedelta(days=20),
    )
    assert resolve_adms_member(gym_id, "42").id == member.id

    # Re-enroll without invalidating (simulates any path that forgets):
    # the cached entry must fail verification and rebuild, never return
    # a member who no longer holds the ID.
    member.device_enroll_number = "77"
    db.session.commit()
    assert resolve_adms_member(gym_id, "42") is None
    assert resolve_adms_member(gym_id, "77").id == member.id


# ─── V3-L7: NULL membership_end is "cannot prove expired" ────────────────

def test_desired_command_type_null_end_is_disable_not_crash(seed_gym):
    member = _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Null End",
        phone="+919100060021", enroll="66", status="active",
        start=date.today() - timedelta(days=30), end=None,
    )
    assert member.membership_end is None
    # No TypeError, and the answer is the fail-closed one: not an enable.
    assert desired_command_type(member) == "disable_user"
    assert member_is_proven_blockable(member) is False
    assert member_is_proven_enableable(member) is False


def test_null_end_active_member_disable_cancelled_at_bridge_lease(seed_gym):
    # Invariant: an active member must NEVER be blocked. A disable queued
    # for an active member with a NULL end (desired type says disable,
    # guards say not blockable) is cancelled at the lease, never served.
    gym = seed_gym["gym"]
    installation = _bridge(seed_gym)
    member = _member(
        gym.id, seed_gym["plan"].id, name="Null End Lease",
        phone="+919100060022", enroll="67", status="active",
        start=date.today() - timedelta(days=30), end=None,
    )
    cmd = BridgeCommand(
        bridge_id=installation.id, gym_id=gym.id, member_id=member.id,
        command_type="disable_user", enroll_number="67",
        member_name=member.full_name,
    )
    db.session.add(cmd)
    db.session.commit()

    assert bridge_command_must_be_cancelled(cmd) is True
    assert lease_pending_commands(installation) == []
    saved = db.session.get(BridgeCommand, cmd.id)
    assert saved.status == "failed"
    assert STALE_DISABLE_MARKER in (saved.last_error or "")


def test_null_end_active_member_block_cancelled_at_adms_serve(client, seed_gym):
    # Same invariant on the ADMS path: an automatic block for an active
    # member with a NULL end is cancelled at serve with
    # CANCELLED_STALE_STATE and never reaches the terminal.
    integration = _adms_integration(seed_gym, serial="L7-X2008", token="l7-token")
    _member(
        seed_gym["gym"].id, seed_gym["plan"].id, name="Null End Serve",
        phone="+919100060023", enroll="68", status="active",
        start=date.today() - timedelta(days=30), end=None,
    )
    cmd = RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="block", test_enroll_number="68",
        command_text=adms_command_text("block", "68", member_name="Null End Serve"),
        status="queued",
    )
    db.session.add(cmd)
    db.session.commit()

    res = client.get("/iclock/l7-token/getrequest?SN=L7-X2008")
    assert res.status_code == 200
    assert "C:" not in res.get_data(as_text=True)
    saved = db.session.get(RRRAdmsCommand, cmd.id)
    assert saved.status == "cancelled"
    assert saved.result_code == STALE_DISABLE_MARKER
