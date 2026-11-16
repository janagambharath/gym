"""Option B — server-side Live Access direction derivation (2026-11-16).

Bharath's explicit yes (2026-11-16 ~10:44 IST) to derive direction from
MemberAccessState instead of trusting the terminal's status byte: the
X2008 auto-alternates in/out per member with no midnight reset, so a
member whose last punch was an ENTRY gets today's first punch recorded
as EXIT. Derivation happens at ADMS ingest (normalize_attendance),
stored in RRRAttendanceEvent.derived_direction; the raw `direction`
is never rewritten.

Covered here:
- first punch of day derives ENTRY even when the byte says EXIT
- second punch same day derives EXIT even when the byte says ENTRY
- next-day first punch derives ENTRY after an overnight INSIDE
- re-entry after an exit the same day derives ENTRY
- manual check-out interplay (next punch derives ENTRY)
- unknown-ID punches never touch state and keep raw classification
- raw byte + AccessEvent.att_state stay raw; derived lives separately
- unprojected RRR leg shows the derived type (feed + summary agree)
- post-midnight punch in the same session derives EXIT (23:00 boundary)
- out-of-order punch falls back to raw
- twin-skip withdraws derivation (RRR leg must not re-label the twin)
- bridge path untouched (raw classification, no derivation)
- derive_adms_att_state unit cases (state machine + session boundary)
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.extensions import db
from app.models import BridgeAttendance, BridgeInstallation, Member
from app.models.access_event import AccessEvent
from app.models.member_access_state import MemberAccessState
from app.models.rrr import RRRAttendanceEvent
from app.services.access_event_service import (
    derive_adms_att_state,
    get_access_events,
    get_access_summary,
    process_attendance_to_access_event,
    process_rrr_attendance_to_access_event,
    record_manual_access_event,
)
from app.services.rrr_service import normalize_attendance

IST = ZoneInfo("Asia/Kolkata")
TZ = "Asia/Kolkata"


def _ist_day(offset: int = 0):
    return (datetime.now(IST) + timedelta(days=offset)).date()


def _punch(day_offset: int, hour: int, minute: int = 0) -> datetime:
    """Gym-local wall time as an aware UTC datetime."""
    local = datetime.combine(_ist_day(day_offset), time(hour, minute), tzinfo=IST)
    return local.astimezone(timezone.utc)


def _member_with_enroll(seed_gym, enroll: str = "42") -> Member:
    member = Member(
        gym_id=seed_gym["gym"].id,
        plan_id=seed_gym["plan"].id,
        full_name="Derive Test",
        phone=f"+91999999{enroll}",
        membership_start=_ist_day(-1),
        membership_end=_ist_day(30),
        status="active",
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _adms_punch(seed_gym, enroll: str, punch_time: datetime, direction, *, project: bool = True):
    """Ingest one ADMS punch (optionally project it) and return (rrr, access)."""
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id,
        source="adms_direct",
        biometric_user_id=enroll,
        punch_time=punch_time,
        device_serial="OPTB-TEST-X2008",
        direction=direction,
        gym_timezone=TZ,
    )
    assert created is True
    access = None
    if project:
        access = process_rrr_attendance_to_access_event(event)
    db.session.commit()
    return event, access


def _state(seed_gym, member):
    return MemberAccessState.query.filter_by(
        gym_id=seed_gym["gym"].id, member_id=member.id
    ).first()


# ── Core derivation: the morning-EXIT bug ───────────────────────────────


def test_first_punch_of_day_derives_entry_despite_exit_byte(seed_gym):
    """The reported bug: terminal sends check-out (1) for a morning
    arrival; the server must show ENTRY."""
    member = _member_with_enroll(seed_gym)
    event, access = _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")

    assert event.direction == "1"  # raw byte preserved
    assert event.derived_direction == "0"
    assert access is not None
    assert access.event_type == "ENTRY"
    assert access.direction == "IN"
    assert access.att_state == 1  # raw byte preserved on the AccessEvent too

    state = _state(seed_gym, member)
    assert state is not None and state.current_state == "INSIDE"

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 1
    assert summary["exits_today"] == 0


def test_second_punch_same_day_derives_exit_despite_entry_byte(seed_gym):
    """The terminal alternates the other way too: after an ENTRY the
    next punch's byte says check-in (0) even though the member is
    leaving."""
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")  # ENTRY (derived)
    event, access = _adms_punch(seed_gym, "42", _punch(0, 18, 0), "0")

    assert event.direction == "0"
    assert event.derived_direction == "1"
    assert access is not None
    assert access.event_type == "EXIT"
    assert access.direction == "OUT"

    state = _state(seed_gym, member)
    assert state is not None and state.current_state == "OUTSIDE"

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 1
    assert summary["exits_today"] == 1


def test_next_day_first_punch_derives_entry_after_overnight_inside(seed_gym):
    """A member who entered yesterday and never exited must show ENTRY
    on today's first punch — the nightly 23:00 reset is NOT load-bearing
    for this; derivation applies the session boundary itself."""
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(-1, 8, 20), "1")  # yesterday ENTRY
    assert _state(seed_gym, member).current_state == "INSIDE"

    event, access = _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")
    assert event.derived_direction == "0"
    assert access is not None and access.event_type == "ENTRY"
    assert _state(seed_gym, member).current_state == "INSIDE"

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 1
    assert summary["exits_today"] == 0


def test_reentry_after_exit_same_day_derives_entry(seed_gym):
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")   # ENTRY
    _adms_punch(seed_gym, "42", _punch(0, 12, 0), "0")   # EXIT
    event, access = _adms_punch(seed_gym, "42", _punch(0, 17, 0), "1")  # ENTRY

    assert event.derived_direction == "0"
    assert access is not None and access.event_type == "ENTRY"
    assert _state(seed_gym, member).current_state == "INSIDE"

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 2
    assert summary["exits_today"] == 1


# ── Manual check-out interplay ──────────────────────────────────────────


def test_manual_checkout_then_next_punch_derives_entry(seed_gym):
    """A staff check-out is explicit, not derived — and it flips state
    so the next terminal punch derives ENTRY."""
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")  # ENTRY, INSIDE
    assert _state(seed_gym, member).current_state == "INSIDE"

    manual = record_manual_access_event(
        gym_id=seed_gym["gym"].id, member_id=member.id, event_type="EXIT"
    )
    assert manual.event_type == "EXIT"
    assert _state(seed_gym, member).current_state == "OUTSIDE"

    event, access = _adms_punch(seed_gym, "42", _punch(0, 12, 0), "0")
    assert event.derived_direction == "0"
    assert access is not None and access.event_type == "ENTRY"
    assert _state(seed_gym, member).current_state == "INSIDE"

    # A manual check-in also sets INSIDE (and is itself never derived).
    manual_in = record_manual_access_event(
        gym_id=seed_gym["gym"].id, member_id=member.id, event_type="ENTRY"
    )
    assert manual_in.event_type == "ENTRY"
    assert _state(seed_gym, member).current_state == "INSIDE"


# ── Unknown IDs, raw preservation, unprojected leg ──────────────────────


def test_unknown_id_punch_keeps_raw_and_touches_no_state(seed_gym):
    """No member → no derivation, raw governs, no state row is created."""
    event, access = _adms_punch(seed_gym, "999", _punch(0, 8, 20), "1")

    assert event.derived_direction is None
    assert event.direction == "1"
    assert event.processing_status == "unmapped"
    assert access is not None
    assert access.event_type == "EXIT"  # raw governs for unknown IDs
    assert MemberAccessState.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 0
    assert summary["exits_today"] == 1


def test_unprojected_rrr_leg_shows_derived_type(seed_gym):
    """A punch whose projection never ran must still show/count as the
    derived type in the RRR feed leg and the summary backfill."""
    member = _member_with_enroll(seed_gym)
    event, _ = _adms_punch(
        seed_gym, "42", _punch(0, 8, 20), "1", project=False
    )
    assert event.derived_direction == "0"
    assert AccessEvent.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0

    feed = get_access_events(seed_gym["gym"].id, TZ, date_filter="today")
    assert feed["pagination"]["total"] == 1
    assert feed["events"][0]["event_type"] == "ENTRY"
    assert feed["events"][0]["direction"] == "IN"

    summary = get_access_summary(seed_gym["gym"].id, TZ)
    assert summary["entries_today"] == 1
    assert summary["exits_today"] == 0


# ── Session boundary (23:00, not midnight) + out-of-order ─────────────


def test_post_midnight_punch_in_same_session_derives_exit(seed_gym):
    """Entered 23:30, punched again 00:30 — same session, so EXIT.
    A midnight boundary would wrongly call this an ENTRY."""
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(-1, 23, 30), "1")  # yesterday ENTRY
    assert _state(seed_gym, member).current_state == "INSIDE"

    event, access = _adms_punch(seed_gym, "42", _punch(0, 0, 30), "0")
    assert event.derived_direction == "1"
    assert access is not None and access.event_type == "EXIT"
    assert _state(seed_gym, member).current_state == "OUTSIDE"


def test_out_of_order_punch_falls_back_to_raw(seed_gym):
    """A punch older than the entry that put the member inside cannot
    be derived from current state — raw governs, and it must not flip
    the (newer) state."""
    member = _member_with_enroll(seed_gym)
    _adms_punch(seed_gym, "42", _punch(0, 8, 20), "1")  # ENTRY, INSIDE
    anchor = _state(seed_gym, member).last_entry_at

    event, access = _adms_punch(seed_gym, "42", _punch(0, 7, 0), "0")
    assert event.derived_direction is None
    assert access is not None and access.event_type == "ENTRY"  # raw "0"
    state = _state(seed_gym, member)
    assert state.current_state == "INSIDE"
    assert state.last_entry_at == anchor  # older punch did not move state


# ── Twin-skip withdraws derivation ──────────────────────────────────────


def test_twin_skip_withdraws_derivation(seed_gym):
    """Bridge EXIT projected first, ADMS EXIT same second: the ADMS row
    twin-skips. Its derived ENTRY must be withdrawn, or the RRR leg
    would surface the twin as a phantom ENTRY."""
    gym_id = seed_gym["gym"].id
    installation, _key = BridgeInstallation.create_for_gym(
        gym_id, "Main Entrance", "OPTB-SERIAL-01"
    )
    db.session.add(installation)
    member = _member_with_enroll(seed_gym)
    t = _punch(0, 8, 20)
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="optb-twin-exit-bridge", device_enroll_number="42",
        event_time=t + timedelta(microseconds=123456),
        verify_method=1, att_state=1, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    assert _state(seed_gym, member).current_state == "OUTSIDE"

    event, _ = _adms_punch(seed_gym, "42", t, "1", project=True)
    # Derivation ran at ingest (state was OUTSIDE → ENTRY)...
    # ...but the twin-skip withdrew it, so the RRR leg reads raw EXIT.
    db.session.refresh(event)
    assert event.derived_direction is None
    assert process_rrr_attendance_to_access_event(event) is None

    feed = get_access_events(gym_id, TZ, date_filter="today", event_type="entry")
    assert feed["pagination"]["total"] == 0
    feed = get_access_events(gym_id, TZ, date_filter="today", event_type="exit")
    assert feed["pagination"]["total"] == 1
    summary = get_access_summary(gym_id, TZ)
    assert summary["entries_today"] == 0
    assert summary["exits_today"] == 1


# ── Bridge path untouched ───────────────────────────────────────────────


def test_bridge_punch_keeps_raw_classification(seed_gym):
    """Derivation is ADMS-direct only: a bridge punch for a member with
    no state keeps its raw EXIT, and no derived value is stored."""
    gym_id = seed_gym["gym"].id
    installation, _key = BridgeInstallation.create_for_gym(
        gym_id, "Main Entrance", "OPTB-SERIAL-02"
    )
    db.session.add(installation)
    member = _member_with_enroll(seed_gym)
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="optb-bridge-raw-exit", device_enroll_number="42",
        event_time=_punch(0, 8, 20), verify_method=1, att_state=1,
        is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    access = process_attendance_to_access_event(attendance)
    db.session.commit()

    assert access is not None and access.event_type == "EXIT"

    event, _ = normalize_attendance(
        gym_id=gym_id, source="direct_bridge", biometric_user_id="42",
        punch_time=_punch(0, 8, 20), external_event_id="optb-bridge-raw-exit",
        device_serial="OPTB-SERIAL-02", direction="1", verify_method="1",
    )
    assert event.derived_direction is None


# ── derive_adms_att_state unit cases ────────────────────────────────────


def _set_state(seed_gym, member, current_state, last_entry_at=None, last_event_at=None):
    state = MemberAccessState(
        gym_id=seed_gym["gym"].id,
        member_id=member.id,
        current_state=current_state,
        last_entry_at=last_entry_at,
        last_exit_at=None,
        last_event_timestamp=last_event_at or last_entry_at,
    )
    db.session.add(state)
    db.session.commit()
    return state


def test_derive_unit_no_state_or_outside_is_entry(seed_gym):
    member = _member_with_enroll(seed_gym)
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 8, 20), gym_timezone=TZ,
    ) == 0  # no state row at all

    _set_state(seed_gym, member, "OUTSIDE",
               last_entry_at=_punch(-1, 8, 20), last_event_at=_punch(-1, 18, 0))
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 8, 20), gym_timezone=TZ,
    ) == 0


def test_derive_unit_inside_same_session_is_exit(seed_gym):
    member = _member_with_enroll(seed_gym)
    _set_state(seed_gym, member, "INSIDE", last_entry_at=_punch(0, 8, 20))
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 18, 0), gym_timezone=TZ,
    ) == 1


def test_derive_unit_inside_new_session_is_entry(seed_gym):
    member = _member_with_enroll(seed_gym)
    _set_state(seed_gym, member, "INSIDE", last_entry_at=_punch(-1, 18, 0))
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 8, 20), gym_timezone=TZ,
    ) == 0


def test_derive_unit_inside_late_night_session_is_exit(seed_gym):
    member = _member_with_enroll(seed_gym)
    _set_state(seed_gym, member, "INSIDE", last_entry_at=_punch(-1, 23, 30))
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 0, 30), gym_timezone=TZ,
    ) == 1


def test_derive_unit_out_of_order_and_no_anchor_is_none(seed_gym):
    member = _member_with_enroll(seed_gym)
    _set_state(seed_gym, member, "INSIDE", last_entry_at=_punch(0, 8, 20))
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        punch_time=_punch(0, 7, 0), gym_timezone=TZ,
    ) is None  # punch predates the anchoring entry

    member2 = _member_with_enroll(seed_gym, enroll="43")
    db.session.add(MemberAccessState(
        gym_id=seed_gym["gym"].id, member_id=member2.id,
        current_state="INSIDE",
        last_entry_at=None, last_event_timestamp=None,
    ))
    db.session.commit()
    assert derive_adms_att_state(
        gym_id=seed_gym["gym"].id, member_id=member2.id,
        punch_time=_punch(0, 8, 20), gym_timezone=TZ,
    ) is None  # INSIDE with no anchor: cannot derive
