"""Regression: ATTLOG ingest must survive an auto-link enroll-number conflict.

Production incident 2026-11-05 (Arun, gym 12): a soft-deleted member held
device_enroll_number '101' while auto-link tried to assign '101' to an
active member. The duplicate guard filtered deleted_at out, so it missed the
holder; the flush then threw UniqueViolation, poisoning the session, and the
next begin_nested() raised PendingRollbackError (NOT an IntegrityError, so
nothing caught it). Every ATTLOG POST 500'd and the terminal retried the same
batch forever — sync stall with polls still green.

Fix: (1) savepoint around the auto-link block in normalize_attendance so a
failed link rolls back cleanly and the punch still saves as unmapped;
(2) duplicate guards in confirm_match / remap_unresolved see soft-deleted
holders too, so the conflict raises a clean ValueError instead of a flush
violation.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models import Member
from app.models.rrr import RRRAdmsCommand, RRRAttendanceEvent, RRRIntegration
from app.services.enroll_match_service import confirm_match

from tests.test_adms_fake_device import (
    FAKE_SERIAL,
    FAKE_TOKEN,
    _cdata,
    _integration,
)


def _member(seed_gym, *, name, phone, enroll, status="active", deleted=False):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        membership_start=date.today() - timedelta(days=30),
        membership_end=date.today() + timedelta(days=30),
        status=status,
        device_enroll_number=enroll,
    )
    if deleted:
        member.deleted_at = datetime.now(timezone.utc)
    db.session.add(member)
    db.session.commit()
    return member


def _snapshot(integration, gym_id, users):
    cmd = RRRAdmsCommand(
        gym_id=gym_id,
        integration_id=integration.id,
        action="sync_users",
        test_enroll_number=None,
        command_text="DATA QUERY USERINFO PIN=ALL",
        status="acked",
        result_data=json.dumps({"users": users}),
    )
    db.session.add(cmd)
    db.session.commit()


def test_confirm_match_refuses_id_held_by_deleted_member(client, seed_gym):
    _member(seed_gym, name="Old User", phone="+919999999901",
            enroll="101", deleted=True)
    active = _member(seed_gym, name="Test User", phone="+919999999902",
                     enroll=None)
    with pytest.raises(ValueError, match="deleted member"):
        confirm_match(seed_gym["gym"].id, active.id, "101", actor_id=None)
    # Nothing was dirtied: the active member still has no enroll number.
    assert db.session.get(Member, active.id).device_enroll_number is None


def test_attlog_survives_autolink_conflict_with_soft_deleted_holder(
    client, seed_gym
):
    integration = _integration(seed_gym)
    # Soft-deleted member still holds enroll '101' in the DB (the unique
    # constraint covers deleted rows, even though guards used to ignore them).
    _member(seed_gym, name="Old User", phone="+919999999901",
            enroll="101", deleted=True)
    # Active member whose terminal name matches exactly -> auto-link attempts
    # to give him '101' when ANY unmapped punch triggers the auto-link run.
    active = _member(seed_gym, name="Test User", phone="+919999999902",
                     enroll=None)
    _snapshot(integration, seed_gym["gym"].id, [
        {"enroll_number": "101", "name": "Test User"},
        {"enroll_number": "999", "name": "Other Guy"},
    ])

    # A punch for the OTHER unmapped ID triggers auto-link, which conflicts
    # on '101'. In production this 500'd the whole batch, every retry.
    line = "999\t2026-11-05 08:00:00\t0\t1"
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "ATTLOG"),
        data=line, content_type="text/plain",
    )
    assert response.status_code == 200

    # Punch saved (as unmapped — the conflicting link is correctly refused),
    # and the active member was NOT given the conflicting enroll number.
    events = RRRAttendanceEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, biometric_user_id="999").all()
    assert len(events) == 1
    assert events[0].processing_status == "unmapped"
    assert db.session.get(Member, active.id).device_enroll_number is None

    # A second punch (the terminal retry) must also succeed, not 500.
    response = client.post(
        _cdata(FAKE_TOKEN, FAKE_SERIAL, "ATTLOG"),
        data=line, content_type="text/plain",
    )
    assert response.status_code == 200
