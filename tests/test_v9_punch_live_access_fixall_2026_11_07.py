"""Regression tests for deep-review v9 punch / Live Access fix-all.

Covers V9-H1, V9-L22, V9-L23, V9-L24, V9-L26, V9-L27, V9-L28.
Nothing here touches production data or the live terminal: every
serial, enroll number and member is synthetic.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.models import Member
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance, BridgeInstallation
from app.models.member_access_state import MemberAccessState
from app.models.rrr import RRRAdmsCommand, RRRIntegration
from app.mobile_api.token_service import create_access_token
from app.services.access_event_service import (
    _serialize_rrr_event,
    backfill_missing_rrr_projections,
    get_access_events,
    get_access_summary,
    process_attendance_to_access_event,
    process_rrr_attendance_to_access_event,
)
from app.services.rrr_service import normalize_attendance
from app.services.timezone_service import utc_start_of_gym_day

UTC = timezone.utc

FAKE_SERIAL = "V9-TEST-X2008"
FAKE_TOKEN = "V9-TEST-TOKEN"


def _now():
    return datetime.now(UTC)


def _today_base():
    """Midday gym-local today — safely inside the 'today' feed window."""
    return utc_start_of_gym_day("Asia/Kolkata") + timedelta(hours=12)


def _member(seed_gym, *, name, phone="+910000000601", enroll=None, status="active",
            end=None):
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name=name,
        phone=phone,
        membership_start=(end or date.today()) - timedelta(days=30),
        membership_end=end or (date.today() + timedelta(days=30)),
        status=status,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _owner_headers(seed_gym):
    token = create_access_token(
        seed_gym["owner"].id, seed_gym["gym"].id, seed_gym["owner"].role
    )
    return {"Authorization": f"Bearer {token}"}


def _member_headers(member):
    token = create_access_token(member.id, member.gym_id, "member")
    return {"Authorization": f"Bearer {token}"}


def _installation(seed_gym, *, serial="V9-TEST-BRIDGE"):
    installation, _key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V9 Test Bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation


def _bridge_punch(seed_gym, installation, *, member, enroll, event_time,
                  att_state, event_id):
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=seed_gym["gym"].id,
        member_id=member.id if member else None,
        device_enroll_number=enroll, event_time=event_time,
        event_id=event_id, verify_method=1, att_state=att_state,
        is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    return attendance


def _count_access_events(seed_gym):
    return AccessEvent.query.filter_by(gym_id=seed_gym["gym"].id).count()


def _integration(seed_gym, *, serial=FAKE_SERIAL, token=FAKE_TOKEN):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V9 Fake device ADMS",
        device_serial=serial,
        device_name="V9 Fake Test X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token=token,
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


# ── V9-H1: GET /api/member/v1/access 500s for any member with a ────────
# MemberAccessState row (access_state.is_inside does not exist) ────────


def test_v9_h1_member_access_with_inside_state_row(client, seed_member):
    """A member who has punched (INSIDE state row) gets 200 with
    is_inside True — pre-fix this 500d on the nonexistent
    ``access_state.is_inside`` attribute (V9-H1). The old tests never
    created a state row before calling the endpoint, which is how this
    slipped through."""
    member = seed_member
    db.session.add(MemberAccessState(
        gym_id=member.gym_id, member_id=member.id, current_state="INSIDE",
        last_entry_at=_now(), last_event_timestamp=_now(),
    ))
    db.session.commit()
    res = client.get("/api/member/v1/access", headers=_member_headers(member))
    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.json["data"]["summary"]["is_inside"] is True


def test_v9_h1_member_access_with_outside_state_row(client, seed_member):
    """Same endpoint with an OUTSIDE state row: 200, is_inside False."""
    member = seed_member
    db.session.add(MemberAccessState(
        gym_id=member.gym_id, member_id=member.id, current_state="OUTSIDE",
        last_exit_at=_now(), last_event_timestamp=_now(),
    ))
    db.session.commit()
    res = client.get("/api/member/v1/access", headers=_member_headers(member))
    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.json["data"]["summary"]["is_inside"] is False


def test_v9_h1_member_access_without_state_row(client, seed_member):
    """A member who never punched (no state row) still gets 200 with
    is_inside False — the only case the old suite exercised."""
    res = client.get(
        "/api/member/v1/access", headers=_member_headers(seed_member)
    )
    assert res.status_code == 200
    assert res.json["data"]["summary"]["is_inside"] is False


# ── V9-L22: twin/existing branches must not overwrite a row that ──────
# already belongs to a different member ────────────────────────────────


def test_v9_l22_rrr_existing_branch_keeps_other_members_name(seed_gym):
    """RRR existing branch: the projected row belongs to member A; the
    RRR row is later linked to member B (remap). The row's member_id,
    member_name and membership_status must stay A's (V9-L22)."""
    gym_id = seed_gym["gym"].id
    member_a = _member(seed_gym, name="Member A", phone="+910000000602", enroll="42")
    member_b = _member(seed_gym, name="Member B", phone="+910000000603", enroll="43")
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=_today_base(), device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is not None
    db.session.commit()
    projected = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id=f"rrr-attendance-{event.id}"
    ).one()
    assert projected.member_id == member_a.id
    assert projected.member_name == "Member A"
    # Remap: the RRR row now points at member B, then re-process.
    event.member_id = member_b.id
    db.session.commit()
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    after = db.session.get(AccessEvent, projected.id)
    assert after.member_id == member_a.id
    assert after.member_name == "Member A"
    assert after.membership_status == "active"


def test_v9_l22_rrr_twin_branch_keeps_other_members_name(seed_gym):
    """RRR twin branch: the bridge-projected twin belongs to member A;
    the ADMS re-delivery is linked to member B. The twin keeps A's
    identity (V9-L22)."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    member_a = _member(seed_gym, name="Twin A", phone="+910000000604", enroll="42")
    member_b = _member(seed_gym, name="Twin B", phone="+910000000605", enroll="43")
    t = _today_base()
    attendance = _bridge_punch(
        seed_gym, installation, member=member_a, enroll="42",
        event_time=t, att_state=0, event_id="v9-l22-bridge-first",
    )
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    twin = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id="v9-l22-bridge-first"
    ).one()
    assert twin.member_id == member_a.id
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    event.member_id = member_b.id
    db.session.commit()
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    after = db.session.get(AccessEvent, twin.id)
    assert after.member_id == member_a.id
    assert after.member_name == "Twin A"
    assert _count_access_events(seed_gym) == 1


def test_v9_l22_twin_branch_still_fills_unlinked_twin(seed_gym):
    """Positive control: a twin with NO member yet still gets the newly
    linked member's identity (the guard must not block the fill). The
    member is created only after the bridge punch projects (otherwise
    enroll resolution would link the bridge row immediately and the
    twin would never be unlinked)."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    t = _today_base()
    attendance = _bridge_punch(
        seed_gym, installation, member=None, enroll="42",
        event_time=t, att_state=0, event_id="v9-l22-unlinked",
    )
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    twin = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id="v9-l22-unlinked"
    ).one()
    assert twin.member_id is None
    member = _member(seed_gym, name="Fill Twin", phone="+910000000606", enroll="42")
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    after = db.session.get(AccessEvent, twin.id)
    assert after.member_id == member.id
    assert after.member_name == "Fill Twin"


# ── V9-L23: twin keys must tolerate a missing direction / ──────────────
# ATTENDANCE-vs-ENTRY classification split ─────────────────────────────


def test_v9_l23_direction_missing_attlog_twin_collapses(seed_gym):
    """Bridge ENTRY first; the ADMS re-delivery has no status column
    (direction None -> ATTENDANCE/UNKNOWN). Same physical punch: the
    projection must twin-skip it, not create a second AccessEvent."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    member = _member(seed_gym, name="No Direction", phone="+910000000607", enroll="42")
    t = _today_base()
    attendance = _bridge_punch(
        seed_gym, installation, member=member, enroll="42",
        event_time=t, att_state=0, event_id="v9-l23-bridge-entry",
    )
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction=None,
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1


def test_v9_l23_old_bridge_attendance_vs_adms_entry_twin_collapses(seed_gym):
    """Old bridge build sends no att_state (ATTENDANCE/UNKNOWN
    AccessEvent); the ADMS leg carries att-state 0 (ENTRY/IN). Same
    punch, same second: twin-skip, one AccessEvent."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    member = _member(seed_gym, name="Old Bridge", phone="+910000000608", enroll="42")
    t = _today_base()
    attendance = _bridge_punch(
        seed_gym, installation, member=member, enroll="42",
        event_time=t, att_state=None, event_id="v9-l23-old-bridge",
    )
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1


def test_v9_l23_classification_tolerant_twin_collapses_in_feed_and_summary(seed_gym):
    """Feed + summary leg: bridge ENTRY (fractional) projects first;
    the unprojected ADMS row is direction-missing (ATTENDANCE,
    whole-second). It must collapse to ONE entry in the merged feed
    and in entries_today — not render/count twice."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    member = _member(seed_gym, name="Feed Twin", phone="+910000000609", enroll="42")
    t = _today_base()
    attendance = _bridge_punch(
        seed_gym, installation, member=member, enroll="42",
        event_time=t + timedelta(microseconds=555555), att_state=0,
        event_id="v9-l23-feed-bridge",
    )
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction=None,
    )
    assert created is True
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    assert get_access_events(
        gym_id, "Asia/Kolkata", date_filter="today"
    )["pagination"]["total"] == 1
    assert get_access_summary(gym_id, "Asia/Kolkata")["entries_today"] == 1


def test_v9_l23_entry_and_exit_same_second_stay_distinct(seed_gym):
    """Guard against over-merging: a genuine ENTRY and a genuine EXIT
    in the same second are two punches, and an ATTENDANCE row must not
    collapse against an EXIT either (ATTENDANCE normalises to
    entry-like only)."""
    gym_id = seed_gym["gym"].id
    installation = _installation(seed_gym)
    member = _member(seed_gym, name="Distinct", phone="+910000000610", enroll="42")
    t = _today_base()
    entry = _bridge_punch(
        seed_gym, installation, member=member, enroll="42",
        event_time=t, att_state=0, event_id="v9-l23-entry",
    )
    assert process_attendance_to_access_event(entry) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V9-TEST-X2008", direction="1",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is not None
    db.session.commit()
    assert _count_access_events(seed_gym) == 2
    # ATTENDANCE (direction-missing) vs a bridge EXIT in the same
    # second: also distinct — the exit is not an entry twin.
    event2, created2 = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t + timedelta(seconds=10),
        device_serial="V9-TEST-X2008", direction=None,
    )
    assert created2 is True
    exit_punch = _bridge_punch(
        seed_gym, installation, member=member, enroll="42",
        event_time=t + timedelta(seconds=10), att_state=1,
        event_id="v9-l23-exit",
    )
    assert process_attendance_to_access_event(exit_punch) is not None
    db.session.commit()
    assert process_rrr_attendance_to_access_event(event2) is not None
    db.session.commit()
    assert _count_access_events(seed_gym) == 4


# ── V9-L24: /access/summary must count real failed ADMS commands ──────


def test_v9_l24_summary_counts_failed_adms_commands(client, seed_gym):
    """A failed Direct Cloud command shows up in failed_commands
    (pre-fix it was hardcoded to 0, so the owner banner never fired)."""
    integration = _integration(seed_gym)
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="block", command_text="DATA UPDATE USERINFO PIN=42\tGrp=100",
        status="failed",
    ))
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="unblock", command_text="DATA UPDATE USERINFO PIN=42\tGrp=1",
        status="queued",
    ))
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    data = res.json["data"]
    assert data["failed_commands"] == 1
    assert data["pending_commands"] == 1


def test_v9_l24_summary_zero_failed_when_none_failed(client, seed_gym):
    """No failed ADMS commands -> failed_commands is 0 (not a stale
    count from another gym/integration)."""
    _integration(seed_gym)
    res = client.get(
        "/api/mobile/v1/access/summary", headers=_owner_headers(seed_gym)
    )
    assert res.status_code == 200
    assert res.json["data"]["failed_commands"] == 0


# ── V9-L26: manual check-in must 400, not 500, on bad input types ─────


def test_v9_l26_checkin_rejects_non_integer_member_id(client, seed_gym, seed_member):
    """A non-integer member_id (string) must 400 — pre-fix Postgres
    raised invalid-input-syntax on filter_by(id=...) -> 500."""
    res = client.post(
        "/api/mobile/v1/access/checkin",
        headers=_owner_headers(seed_gym),
        json={"member_id": "not-an-int", "type": "ENTRY"},
    )
    assert res.status_code == 400


def test_v9_l26_checkin_rejects_non_string_type(client, seed_gym, seed_member):
    """A non-string type must 400 — pre-fix .upper() on an int raised
    AttributeError -> 500."""
    res = client.post(
        "/api/mobile/v1/access/checkin",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "type": 123},
    )
    assert res.status_code == 400


def test_v9_l26_checkin_rejects_bool_member_id(client, seed_gym, seed_member):
    """A JSON boolean is an int subclass in Python but is not a member
    id — it must 400, not reach the query."""
    res = client.post(
        "/api/mobile/v1/access/checkin",
        headers=_owner_headers(seed_gym),
        json={"member_id": True, "type": "ENTRY"},
    )
    assert res.status_code == 400


def test_v9_l26_checkin_still_accepts_valid_input(client, seed_gym, seed_member):
    """Valid input still records the check-in (the validation must not
    break the happy path)."""
    res = client.post(
        "/api/mobile/v1/access/checkin",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "type": "ENTRY"},
    )
    assert res.status_code == 200


# ── V9-L27: RRR feed leg must send null member_name for unmapped rows ──


def test_v9_l27_rrr_feed_leg_sends_null_name_for_unmapped_row(seed_gym):
    """An unmapped RRR row serialises member_name None, like the
    AccessEvent leg — pre-fix it fabricated "User {id}"."""
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="999", punch_time=_today_base(),
        device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    db.session.commit()
    assert event.member_id is None
    assert _serialize_rrr_event(event)["member_name"] is None


# ── V9-L28: a failed projection is repaired by the next ATTLOG batch ──


def test_v9_l28_attlog_batch_repairs_failed_projection(client, seed_gym):
    """An ADMS punch whose projection failed at ingest is repaired when
    the NEXT ATTLOG batch arrives — no waiting for the daily scheduler
    (V9-L28). The failed row must project (feed + INSIDE) as soon as
    the batch's cdata POST returns OK."""
    integration = _integration(seed_gym)
    member = _member(seed_gym, name="Repair Me", phone="+910000000611", enroll="42")
    failed, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=_today_base(),
        device_serial="V9-TEST-X2008", direction="0",
    )
    assert created is True
    db.session.commit()
    assert _count_access_events(seed_gym) == 0
    # A fresh punch arrives in a new ATTLOG batch (different time, so
    # it is a genuinely new punch, not a replay of the failed one).
    line = "42\t" + (_today_base() + timedelta(minutes=5)).strftime(
        "%Y-%m-%d %H:%M:%S"
    ) + "\t0\t1"
    res = client.post(
        f"/iclock/{FAKE_TOKEN}/cdata?SN={FAKE_SERIAL}&table=ATTLOG",
        data=line, content_type="text/plain",
    )
    assert res.status_code == 200
    assert res.get_data(as_text=True) == "OK"
    # Both punches projected: the new one at ingest, the failed one by
    # the post-batch backfill — without any scheduler/CLI run.
    assert _count_access_events(seed_gym) == 2
    projected = AccessEvent.query.filter_by(
        gym_id=seed_gym["gym"].id,
        source_event_id=f"rrr-attendance-{failed.id}",
    ).first()
    assert projected is not None
    assert projected.member_id == member.id
    state = MemberAccessState.query.filter_by(
        gym_id=seed_gym["gym"].id, member_id=member.id
    ).first()
    assert state is not None and state.current_state == "INSIDE"
    # Idempotent: the backfill helper itself is still a no-op afterwards.
    assert backfill_missing_rrr_projections(seed_gym["gym"].id) == 0
