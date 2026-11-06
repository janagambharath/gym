"""Regression: two v3 findings the fix-all fan-out missed.

V3-M4 — restore_deleted_members un-pauses frozen members: soft-delete
overwrote status with "deleted", destroying the paused state, and restore
mapped every non-expired deleted member to "active" + queued an unblock.
Fix: the soft-delete audit entry records the pre-delete status, and
restore brings a paused member back as paused with no unblock queued.

V3-L3 — timezone validation bypassed for non-string values: a non-string
timezone skipped the ZoneInfo check entirely and was stored. Fix: 400
on any non-string timezone value.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.models.bridge import BridgeCommand
from test_tier0_tier2_fixes_2026_11_05 import _bridge, _member, _owner_headers


def test_restore_paused_member_stays_paused_no_unblock(client, seed_gym):
    _bridge(seed_gym)
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    paused = _member(
        gym.id, plan_id, name="Frozen Member", phone="+919100020031",
        enroll="301", status="paused", end=date.today() + timedelta(days=30),
    )
    # Soft-delete through the API so the audit entry records the status.
    res = client.post(
        f"/api/mobile/v1/members/{paused.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    db.session.refresh(paused)
    assert paused.status == "deleted"

    res = client.post(
        "/api/mobile/v1/rrr/restore-deleted-members",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["restored"] == 1
    assert res.get_json()["data"]["unblocks_queued"] == 0

    db.session.refresh(paused)
    assert paused.status == "paused"
    assert paused.deleted_at is None
    # The soft-delete itself legitimately queued a block (paused is
    # blockable); the restore must not have queued an UNBLOCK.
    assert BridgeCommand.query.filter_by(
        gym_id=gym.id, member_id=paused.id, command_type="enable_user"
    ).count() == 0


def test_restore_active_member_still_unblocks(client, seed_gym):
    _bridge(seed_gym)
    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    active = _member(
        gym.id, plan_id, name="Active Member", phone="+919100020032",
        enroll="302", status="active", end=date.today() + timedelta(days=30),
    )
    res = client.post(
        f"/api/mobile/v1/members/{active.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200

    res = client.post(
        "/api/mobile/v1/rrr/restore-deleted-members",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    assert res.get_json()["data"]["unblocks_queued"] == 1
    db.session.refresh(active)
    assert active.status == "active"


def test_settings_rejects_non_string_timezone(client, seed_gym):
    res = client.patch(
        "/api/mobile/v1/settings",
        headers=_owner_headers(seed_gym),
        json={"timezone": 123},
    )
    assert res.status_code == 400
    res = client.patch(
        "/api/mobile/v1/settings",
        headers=_owner_headers(seed_gym),
        json={"timezone": True},
    )
    assert res.status_code == 400
    res = client.patch(
        "/api/mobile/v1/settings",
        headers=_owner_headers(seed_gym),
        json={"timezone": "Asia/Kolkata"},
    )
    assert res.status_code == 200
