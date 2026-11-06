"""Regression: linking a biometric ID must never 500 when the ID is held by
a soft-deleted member, and a member picked from search must be selectable.

Production incident 2026-11-06 (Arun, morning): staff tried to link
terminal IDs 101/102/103/59 to members and hit "An unexpected error
occurred." Two backend causes and one PWA cause:

1. POST /members/<id>/enroll checked for a duplicate enroll number with
   ``deleted_at IS NULL`` — but the unique constraint covers soft-deleted
   rows too. Enrolling an ID held by a deleted member passed the check,
   then the commit threw UniqueViolation -> 500.
2. remap_unresolved Guard 1 compared the stored enroll number RAW against
   the canonical ID, so a member stored as "0103" was falsely rejected
   when linking "103".
3. (PWA, rrr-mappings.js) search results were never merged into
   allMembers, so tapping a searched member did nothing; and a failed
   link silently reverted the button with no error shown.

Fix: the enroll duplicate check now includes soft-deleted holders and
returns a clear 409; Guard 1 compares canonical forms; the single
resolve endpoint returns the ValueError as a 409 instead of 500ing.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member
from app.services.rrr_service import remap_unresolved


def _headers(seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, gym.id, owner.role)}"}


def _member(seed_gym, *, name, enroll=None, deleted=False):
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name=name,
        phone="+919998887777",
        membership_start=date.today() - timedelta(days=30),
        membership_end=date.today() + timedelta(days=90),
        status="active",
        device_enroll_number=enroll,
    )
    if deleted:
        member.deleted_at = datetime.now(timezone.utc)
    db.session.add(member)
    db.session.commit()
    return member


def test_enroll_id_held_by_deleted_member_returns_409_not_500(client, seed_gym):
    """ID 101 held by a soft-deleted member: enrolling another member with
    it must return a clear 409, never a 500."""
    _member(seed_gym, name="Old Deleted", enroll="101", deleted=True)
    target = _member(seed_gym, name="Manideep")
    res = client.post(
        f"/api/mobile/v1/members/{target.id}/enroll",
        json={"enroll_number": "101"},
        headers=_headers(seed_gym),
    )
    assert res.status_code == 409, res.get_data(as_text=True)
    assert "deleted" in res.get_json()["error"]["message"].lower()


def test_enroll_id_held_by_live_member_returns_409(client, seed_gym):
    _member(seed_gym, name="First Holder", enroll="102")
    target = _member(seed_gym, name="Second Member")
    res = client.post(
        f"/api/mobile/v1/members/{target.id}/enroll",
        json={"enroll_number": "102"},
        headers=_headers(seed_gym),
    )
    assert res.status_code == 409
    assert "already assigned" in res.get_json()["error"]["message"]


def test_enroll_free_id_succeeds(client, seed_gym):
    target = _member(seed_gym, name="Free Member")
    res = client.post(
        f"/api/mobile/v1/members/{target.id}/enroll",
        json={"enroll_number": "103"},
        headers=_headers(seed_gym),
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    assert db.session.get(Member, target.id).device_enroll_number == "103"


def test_remap_guard1_canonical_match_does_not_reject(seed_gym):
    """A member stored as "0103" already holds canonical ID "103" —
    linking "103" must succeed, not raise 'already has enroll number'."""
    member = _member(seed_gym, name="Anish", enroll="0103")
    resolved = remap_unresolved(seed_gym["gym"].id, "103", member, seed_gym["owner"].id)
    assert resolved == 0
    assert db.session.get(Member, member.id).device_enroll_number == "103"


def test_remap_guard1_different_id_still_rejects(seed_gym):
    member = _member(seed_gym, name="Anish", enroll="42")
    with pytest.raises(ValueError, match="already has enroll number"):
        remap_unresolved(seed_gym["gym"].id, "103", member, seed_gym["owner"].id)


def test_remap_guard2_deleted_holder_raises_clear_error(seed_gym):
    _member(seed_gym, name="Old Deleted", enroll="102", deleted=True)
    target = _member(seed_gym, name="New Member")
    with pytest.raises(ValueError, match="deleted member"):
        remap_unresolved(seed_gym["gym"].id, "102", target, seed_gym["owner"].id)
