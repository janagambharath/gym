"""Regression tests for deep-review v8 punch / Live Access fix-all (worker A4).

Covers V8-H1, V8-M8, V8-L16, V8-L17, V8-L18. Nothing here touches
production data or the live terminal: every serial, enroll number and
member is synthetic.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.models import BridgeInstallation, Member
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance
from app.models.member_access_state import MemberAccessState
from app.models.rrr import RRRAttendanceEvent
from app.mobile_api.token_service import create_access_token
from app.services.access_event_service import (
    backfill_missing_rrr_projections,
    get_access_events,
    get_access_summary,
    process_attendance_to_access_event,
    process_rrr_attendance_to_access_event,
    record_manual_access_event,
)
from app.services.rrr_service import normalize_attendance
from app.services.timezone_service import utc_start_of_gym_day

UTC = timezone.utc


def _now():
    return datetime.now(UTC)


def _today_base():
    """Midday gym-local today — safely inside the 'today' feed window."""
    return utc_start_of_gym_day("Asia/Kolkata") + timedelta(hours=12)


def _member(seed_gym, *, name, phone="+910000000501", enroll=None, status="active",
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


def _installation(seed_gym, *, serial="V8-TEST-X2008"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V8 Test Bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _auth_headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _count_access_events(seed_gym):
    return AccessEvent.query.filter_by(gym_id=seed_gym["gym"].id).count()


# ── V8-H1: manual check-in must not write a string into Integer ───────


def test_v8_h1_manual_checkin_verify_method_is_int_or_none(seed_gym, seed_member):
    """record_manual_access_event must store int-or-None in the Integer
    verify_method column (V8-H1). On SQLite the pre-fix string
    "MANUAL_CHECKIN" is stored silently, so only a TYPE assertion
    catches it — a 200-only test passes before and after the fix.
    Production Postgres rejects the string with 22P02 on flush, so
    every manual check-in 500d live."""
    # The column itself must be Integer (the other half of the finding).
    assert AccessEvent.__table__.c.verify_method.type.__class__.__name__ == "Integer"
    event = record_manual_access_event(
        gym_id=seed_gym["gym"].id, member_id=seed_member.id
    )
    stored = db.session.get(AccessEvent, event.id)
    assert stored is not None
    assert stored.verify_method is None or isinstance(stored.verify_method, int)
    assert not isinstance(stored.verify_method, str)


def test_v8_h1_manual_checkin_endpoint_stores_int_or_none(client, seed_gym, seed_member):
    """Same type assertion through POST /api/mobile/v1/access/checkin
    (V8-H1): 200 is not enough — the stored value must be int-or-None."""
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    res = client.post(
        "/api/mobile/v1/access/checkin",
        headers=_auth_headers(owner, gym),
        json={"member_id": seed_member.id, "type": "ENTRY"},
    )
    assert res.status_code == 200
    stored = AccessEvent.query.filter_by(
        gym_id=gym.id, member_id=seed_member.id
    ).first()
    assert stored is not None
    assert stored.verify_method is None or isinstance(stored.verify_method, int)
    assert not isinstance(stored.verify_method, str)


# ── V8-L17: manual check-in must not fabricate a terminal enroll ──────


def test_v8_l17_manual_checkin_without_enroll_fabricates_no_id(seed_gym):
    """A member with no biometric enrolment gets no terminal enroll
    number on the manual row (V8-L17) — it used to masquerade as
    terminal ID = member id."""
    member = _member(seed_gym, name="No Enroll Member", phone="+910000000502")
    assert member.device_enroll_number is None
    event = record_manual_access_event(
        gym_id=seed_gym["gym"].id, member_id=member.id
    )
    assert event.device_enroll_number != str(member.id)
    assert not (event.device_enroll_number or "").isdigit()
    # Feed search by the member id must not surface the manual row as
    # if it were a terminal punch from that enroll number.
    feed = get_access_events(
        seed_gym["gym"].id, "Asia/Kolkata", search=str(member.id)
    )
    assert feed["pagination"]["total"] == 0


def test_v8_l17_real_punch_from_enroll_equal_to_member_id_not_twin(seed_gym):
    """The L17 corruption path: a real terminal punch from enroll N in
    the same second as a manual row for member-id N used to twin-match
    the manual row — projection skipped, manual row's name overwritten.
    With no fabricated enroll the real punch projects normally (V8-L17)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    manual_member = _member(
        seed_gym, name="Manual Member", phone="+910000000503"
    )
    manual = record_manual_access_event(gym_id=gym_id, member_id=manual_member.id)
    assert manual.event_type == "ENTRY"
    # A different member owns terminal enroll == manual member's id.
    puncher = _member(
        seed_gym, name="Terminal Puncher", phone="+910000000504",
        enroll=str(manual_member.id),
    )
    db.session.add(BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=puncher.id,
        device_enroll_number=str(manual_member.id),
        event_time=manual.event_timestamp, event_id="v8-l17-real-punch",
        verify_method=1, att_state=0, is_invalid=False,
    ))
    db.session.flush()
    attendance = BridgeAttendance.query.filter_by(
        event_id="v8-l17-real-punch"
    ).first()
    projected = process_attendance_to_access_event(attendance)
    db.session.commit()
    assert projected is not None
    assert projected.member_id == puncher.id
    # The manual row still belongs to the manual member, un-overwritten.
    manual_after = db.session.get(AccessEvent, manual.id)
    assert manual_after.member_id == manual_member.id
    assert manual_after.member_name == "Manual Member"
    assert _count_access_events(seed_gym) == 2


# ── V8-M8: failed ADMS (RRR) projections are backfilled ───────────────


def _unprojected_rrr_row(seed_gym, *, member, punch_time, direction="0"):
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id=member.device_enroll_number,
        punch_time=punch_time, device_serial="V8-TEST-X2008",
        direction=direction,
    )
    assert created is True
    db.session.commit()
    # Simulate the ingest-time projection failure: row stored, no event.
    assert _count_access_events(seed_gym) == 0
    return event


def test_v8_m8_backfill_reprojects_failed_rrr_punch(seed_gym):
    """An ADMS punch stored with no AccessEvent (projection threw at
    ingest, ack preserved) is re-projected by the sweep — feed row,
    count and INSIDE flip included — and a second sweep is a no-op
    (V8-M8)."""
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Backfill RRR", phone="+910000000505", enroll="42")
    event = _unprojected_rrr_row(seed_gym, member=member, punch_time=_today_base())
    assert backfill_missing_rrr_projections(gym_id) == 1
    db.session.commit()
    projected = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id=f"rrr-attendance-{event.id}"
    ).first()
    assert projected is not None
    assert projected.member_id == member.id
    state = MemberAccessState.query.filter_by(
        gym_id=gym_id, member_id=member.id
    ).first()
    assert state is not None and state.current_state == "INSIDE"
    assert backfill_missing_rrr_projections(gym_id) == 0
    assert _count_access_events(seed_gym) == 1


def test_v8_m8_scheduler_job_backfills_rrr_punch(app, seed_gym):
    """The daily scheduler job — the job that actually runs in prod —
    backfills the unprojected RRR punch (V8-M8)."""
    from app.services.reminder_scheduler import _scheduled_reminder_job

    gym = seed_gym["gym"]
    gym.whatsapp_enabled = False
    db.session.commit()
    member = _member(seed_gym, name="Scheduler RRR", phone="+910000000506", enroll="42")
    _unprojected_rrr_row(seed_gym, member=member, punch_time=_today_base())
    _scheduled_reminder_job(app)
    assert _count_access_events(seed_gym) == 1


def test_v8_m8_backfill_ignores_non_adms_direct_rows(seed_gym):
    """Only adms_direct RRR rows are swept — bridge/eBioServer RRR rows
    already project via the BridgeAttendance path (V8-M8 scope)."""
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Bridge RRR", phone="+910000000507", enroll="42")
    event, created = normalize_attendance(
        gym_id=gym_id, source="direct_bridge",
        biometric_user_id="42", punch_time=_today_base(),
        device_serial="V8-TEST-X2008", direction="0",
    )
    assert created is True
    db.session.commit()
    assert backfill_missing_rrr_projections(gym_id) == 0
    assert _count_access_events(seed_gym) == 0
    assert RRRAttendanceEvent.query.filter_by(gym_id=gym_id).count() == 1


# ── V8-L16: fractional-second twin must collapse once, distinct ───────
# same-second punches must stay distinct ───────────────────────────────


def test_v8_l16_fractional_bridge_twin_collapses_in_feed_and_summary(seed_gym):
    """Bridge punch (fractional seconds) projects first; the ADMS
    re-delivery (whole-second) twin-skips at projection, and the merged
    feed + summary must still show ONE entry, not two (V8-L16)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Skew Twin", phone="+910000000508", enroll="42")
    t = _today_base()  # whole second
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v8-l16-bridge-first", device_enroll_number="42",
        event_time=t + timedelta(microseconds=987654),
        verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V8-TEST-X2008", direction="0",
    )
    # The RRR row itself is new (the bridge punch never went through
    # normalize_attendance) — the twin-skip happens at projection below.
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    assert get_access_events(gym_id, "Asia/Kolkata", date_filter="today")["pagination"]["total"] == 1
    assert get_access_summary(gym_id, "Asia/Kolkata")["entries_today"] == 1


def test_v8_l16_fractional_bridge_exit_twin_collapses(seed_gym):
    """Same skew, exit direction: one exit in feed + summary (V8-L16)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Skew Exit", phone="+910000000509", enroll="42")
    t = _today_base()
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v8-l16-exit-bridge", device_enroll_number="42",
        event_time=t + timedelta(microseconds=123456),
        verify_method=1, att_state=1, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V8-TEST-X2008", direction="1",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    feed = get_access_events(
        gym_id, "Asia/Kolkata", date_filter="today", event_type="exit"
    )
    assert feed["pagination"]["total"] == 1
    assert get_access_summary(gym_id, "Asia/Kolkata")["exits_today"] == 1


def test_v8_l16_distinct_same_second_punches_stay_distinct(seed_gym):
    """V4-L12's pair — an AccessEvent and an unprojected ADMS row in
    the same second, BOTH with fractional timestamps — are two distinct
    punches and must still render as two (V8-L16 must not collapse
    them by truncating punch_key to the second)."""
    gym_id = seed_gym["gym"].id
    db.session.add(AccessEvent(
        gym_id=gym_id, event_type="ENTRY", direction="IN",
        event_timestamp=_now(), received_timestamp=_now(),
        device_enroll_number="42", source_event_id="v8-l16-distinct-1",
        member_name="Someone Else",
    ))
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=_now(), device_serial="V8-TEST-X2008", direction="0",
    )
    db.session.commit()
    result = get_access_events(gym_id, "Asia/Kolkata", search="42")
    assert result["pagination"]["total"] == 2


# ── V8-L18: run-reminders CLI also repairs projections ─────────────────


def test_v8_l18_run_reminders_cli_backfills_projections(app, seed_gym):
    """The flask run-reminders CLI (manual fallback if the scheduler is
    ever off) backfills both bridge and RRR projections (V8-L18)."""
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = False
    db.session.commit()
    member = _member(seed_gym, name="CLI RRR", phone="+910000000510", enroll="42")
    _unprojected_rrr_row(seed_gym, member=member, punch_time=_today_base())
    runner = app.test_cli_runner()
    result = runner.invoke(args=["run-reminders"])
    assert result.exit_code == 0, result.output
    assert _count_access_events(seed_gym) == 1
    state = MemberAccessState.query.filter_by(
        gym_id=gym.id, member_id=member.id
    ).first()
    assert state is not None and state.current_state == "INSIDE"
