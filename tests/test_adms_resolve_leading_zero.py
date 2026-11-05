"""Regression: a renewal unblock must not be silently dropped at serve time
when the member's stored enroll number carries leading zeros.

Production incident 2026-11-05 (Arun, member abhi goud): the renewal POST
returned 201 and the member went active in the app, but the terminal never
received the unblock — every getrequest poll after the renewal returned
empty. The serve-time enable guard resolves the command's enroll number
back to a member row; an exact-match miss (stored "042" vs canonical "42")
resolved to None, and the guard cancelled the unblock without logging
anything, so the logs looked like a dead terminal.

Fix: resolve_adms_member falls back to comparing canonical forms, and a
cancelled enable is logged with the reason.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.extensions import db
from app.models import Member
from app.services.bridge_service import (
    enable_must_be_cancelled,
    member_is_proven_enableable,
    resolve_adms_member,
)


def _member(seed_gym, *, enroll: str) -> Member:
    gym = seed_gym["gym"]
    plan = seed_gym["plan"]
    member = Member(
        gym_id=gym.id,
        plan_id=plan.id,
        full_name="Abhi Goud",
        phone="+919998887777",
        membership_start=date.today() - timedelta(days=30),
        membership_end=date.today() + timedelta(days=90),
        status="active",
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def test_resolve_leading_zero_enroll_number(seed_gym):
    member = _member(seed_gym, enroll="042")
    resolved = resolve_adms_member(seed_gym["gym"].id, "42")
    assert resolved is not None
    assert resolved.id == member.id


def test_resolve_canonical_enroll_number_still_exact(seed_gym):
    member = _member(seed_gym, enroll="42")
    resolved = resolve_adms_member(seed_gym["gym"].id, "42")
    assert resolved is not None
    assert resolved.id == member.id


def test_resolve_unknown_enroll_number_returns_none(seed_gym):
    _member(seed_gym, enroll="42")
    assert resolve_adms_member(seed_gym["gym"].id, "999") is None
    assert resolve_adms_member(seed_gym["gym"].id, None) is None


def test_enable_guard_passes_for_leading_zero_member(seed_gym):
    # The whole point: the resolved member must be proven enableable, so a
    # renewal unblock for a "042" member is served, not cancelled.
    member = _member(seed_gym, enroll="042")
    resolved = resolve_adms_member(seed_gym["gym"].id, "42")
    assert resolved is not None
    assert member_is_proven_enableable(resolved) is True
    assert enable_must_be_cancelled(resolved) is False
