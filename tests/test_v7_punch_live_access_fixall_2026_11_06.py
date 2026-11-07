"""Regression tests for deep-review v7 punch / Live Access fix-all (worker A4).

Covers V7-M7, V7-M8, V7-M9, V7-L16..L19, the bridge-enrollment gym_id
carry-over, and the V5-L9 direction-less re-send dedupe residual.
Nothing here touches production data or the live terminal: every serial,
enroll number and member is synthetic.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.models import BridgeInstallation, Gym, Member
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance, BridgeCommand
from app.models.member_access_state import MemberAccessState
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRAttendanceEvent,
    RRRIntegration,
)
from app.mobile_api.token_service import create_access_token
from app.services import enroll_match_service
from app.services.access_event_service import (
    backfill_missing_bridge_projections,
    get_access_events,
    get_access_summary,
    get_members_inside,
    process_attendance_to_access_event,
    process_rrr_attendance_to_access_event,
)
from app.services.rrr_service import (
    _dedupe_key,
    normalize_attendance,
)

UTC = timezone.utc


def _now():
    return datetime.now(UTC)


def _member(seed_gym, *, name, phone="+910000000401", enroll=None, status="active",
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


def _integration(seed_gym, *, serial="V7-TEST-X2008", status="connected"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V7 Test ADMS",
        device_serial=serial,
        device_name="V7 Test X2008",
        status=status,
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        last_success_at=_now(),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _installation(seed_gym, *, serial="V7-TEST-X2008"):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V7 Test Bridge", serial
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key, serial="V7-TEST-X2008"):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


def _bridge_snapshot(seed_gym, users):
    installation, _key = _installation(seed_gym)
    db.session.add(BridgeCommand(
        bridge_id=installation.id,
        gym_id=seed_gym["gym"].id,
        command_type="sync_users",
        enroll_number="SYSTEM",
        status="acked",
        acknowledged_at=_now(),
        result_data=json.dumps({"users": users}),
    ))
    db.session.commit()


def _adms_operlog_snapshot(seed_gym, integration, users):
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id,
        integration_id=integration.id,
        action="operlog_snapshot",
        command_text="OPERLOG enrollment capture",
        status="acked",
        result_data=json.dumps({"users": users, "source": "operlog"}),
    ))
    db.session.commit()


def _old_format_key(serial, enroll, punch_time):
    stable = "|".join((serial, enroll, punch_time.isoformat()))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


# ── V7-M7: the daily scheduler resets stale INSIDE members ─────────────


def test_v7_m7_scheduled_job_resets_stale_inside(app, seed_gym):
    """_scheduled_reminder_job — the job that actually runs in prod —
    flips a member who entered 2 days ago to OUTSIDE (V7-M7). The flask
    run-reminders CLI was previously the only caller and nothing
    schedules it."""
    from app.services.reminder_scheduler import _scheduled_reminder_job

    gym = seed_gym["gym"]
    gym.whatsapp_enabled = False
    db.session.commit()
    member = _member(seed_gym, name="Stale Inside", phone="+910000000402", enroll="42")
    db.session.add(MemberAccessState(
        gym_id=gym.id, member_id=member.id,
        current_state="INSIDE", last_entry_at=_now() - timedelta(days=2),
    ))
    db.session.commit()
    _scheduled_reminder_job(app)
    state = MemberAccessState.query.filter_by(
        gym_id=gym.id, member_id=member.id
    ).first()
    assert state.current_state == "OUTSIDE"


# ── V7-M8: ADMS snapshot wins per PIN over a stale bridge snapshot ─────


def test_v7_m8_adms_snapshot_wins_over_stale_bridge(seed_gym):
    """A migrated gym's frozen bridge names must not shadow the live
    ADMS list: PIN 42 suggests the ADMS name, bridge-only PINs are
    still suggested, and the stale bridge name links nobody (V7-M8)."""
    gym_id = seed_gym["gym"].id
    _bridge_snapshot(seed_gym, [
        {"user_id": "42", "name": "Old Name"},
        {"user_id": "44", "name": "Bridge Only"},
    ])
    _member(seed_gym, name="Old Name", phone="+910000000403")
    _member(seed_gym, name="New Name", phone="+910000000404")
    _member(seed_gym, name="Adms Only", phone="+910000000405")
    _member(seed_gym, name="Bridge Only", phone="+910000000406")
    # Bridge-only gym: the bridge name is all there is — still used.
    first = enroll_match_service.suggest_matches(gym_id)
    assert {s["enroll_number"]: s["terminal_name"] for s in first["suggestions"]} == {
        "42": "Old Name", "44": "Bridge Only",
    }
    # Migration: the ADMS snapshot arrives with a recycled PIN 42.
    integration = _integration(seed_gym)
    _adms_operlog_snapshot(seed_gym, integration, [
        {"enroll_number": "42", "name": "New Name"},
        {"enroll_number": "43", "name": "Adms Only"},
    ])
    second = enroll_match_service.suggest_matches(gym_id)
    by_enroll = {s["enroll_number"]: s for s in second["suggestions"]}
    assert set(by_enroll) == {"42", "43", "44"}
    assert by_enroll["42"]["terminal_name"] == "New Name"
    assert by_enroll["42"]["member_name"] == "New Name"
    assert by_enroll["43"]["member_name"] == "Adms Only"
    assert by_enroll["44"]["member_name"] == "Bridge Only"
    assert all(s["member_name"] != "Old Name" for s in second["suggestions"])
    linked = enroll_match_service.auto_link_high_confidence(
        gym_id, enroll_number="42"
    )
    assert [l["member_name"] for l in linked["linked"]] == ["New Name"]


# ── V7-M9: one punch via bridge AND ADMS = one AccessEvent ─────────────


def _count_access_events(seed_gym):
    return AccessEvent.query.filter_by(gym_id=seed_gym["gym"].id).count()


def test_v7_m9_bridge_first_then_adms_is_one_event(seed_gym):
    """Bridge punch projects first; the ADMS re-delivery of the same
    punch must not create a twin (V7-M9)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Dual Feed", phone="+910000000407", enroll="42")
    t = _now().replace(microsecond=0)
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v7-m9-bridge-first", device_enroll_number="42",
        event_time=t, verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    assert process_attendance_to_access_event(attendance) is not None
    normalize_attendance(
        gym_id=gym_id, source="direct_bridge", biometric_user_id="42",
        punch_time=t, external_event_id="v7-m9-bridge-first",
        device_serial="V7-TEST-X2008", direction="0", verify_method="1",
    )
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    # ADMS delivers the same physical punch.
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V7-TEST-X2008", direction="0",
    )
    assert created is False
    assert process_rrr_attendance_to_access_event(event) is None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    assert get_access_summary(gym_id, "Asia/Kolkata")["entries_today"] == 1
    assert get_access_events(gym_id, "Asia/Kolkata", date_filter="today")["pagination"]["total"] == 1


def test_v7_m9_adms_first_then_bridge_is_one_event(seed_gym):
    """ADMS punch projects first; the bridge re-delivery of the same
    punch must not create a twin (V7-M9)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Dual Feed Two", phone="+910000000408", enroll="42")
    t = _now().replace(microsecond=0)
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V7-TEST-X2008", direction="0",
    )
    assert created is True
    assert process_rrr_attendance_to_access_event(event) is not None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v7-m9-adms-first", device_enroll_number="42",
        event_time=t, verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    assert process_attendance_to_access_event(attendance) is None
    normalize_attendance(
        gym_id=gym_id, source="direct_bridge", biometric_user_id="42",
        punch_time=t, external_event_id="v7-m9-adms-first",
        device_serial="V7-TEST-X2008", direction="0", verify_method="1",
    )
    db.session.commit()
    assert _count_access_events(seed_gym) == 1
    assert get_access_summary(gym_id, "Asia/Kolkata")["entries_today"] == 1
    assert get_access_events(gym_id, "Asia/Kolkata", date_filter="today")["pagination"]["total"] == 1


def test_v7_m9_microsecond_skew_still_a_twin(seed_gym):
    """The bridge path may carry microseconds while ADMS stores whole
    seconds — the same-second window still collapses them (V7-M9)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Skewed Twin", phone="+910000000409", enroll="42")
    t = _now().replace(microsecond=0)
    event, _ = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V7-TEST-X2008", direction="0",
    )
    assert process_rrr_attendance_to_access_event(event) is not None
    db.session.commit()
    skewed = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v7-m9-skewed", device_enroll_number="42",
        event_time=t + timedelta(microseconds=987654),
        verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(skewed)
    db.session.flush()
    assert process_attendance_to_access_event(skewed) is None
    db.session.commit()
    assert _count_access_events(seed_gym) == 1


def test_v7_m9_same_second_entry_and_exit_stay_distinct(seed_gym):
    """The twin matcher must not collapse a real entry+exit pair in
    the same second (type/direction differ)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="In Out", phone="+910000000410", enroll="42")
    t = _now().replace(microsecond=0)
    for n, att_state in enumerate((0, 1)):
        attendance = BridgeAttendance(
            bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
            event_id=f"v7-m9-inout-{n}", device_enroll_number="42",
            event_time=t, verify_method=1, att_state=att_state, is_invalid=False,
        )
        db.session.add(attendance)
        db.session.flush()
        assert process_attendance_to_access_event(attendance) is not None
    db.session.commit()
    assert _count_access_events(seed_gym) == 2


# ── V7-L16: failed bridge projections are backfilled ───────────────────


def test_v7_l16_backfill_reprojects_failed_bridge_punch(seed_gym):
    """A bridge punch stored with no AccessEvent (projection threw at
    ingest) is re-projected by the sweep — feed row, count and INSIDE
    flip included — and a second sweep is a no-op (V7-L16)."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    member = _member(seed_gym, name="Backfill Me", phone="+910000000411", enroll="42")
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v7-l16-evt-1", device_enroll_number="42",
        event_time=_now(), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.commit()
    # Simulate the ingest-time projection failure: row stored, no event.
    assert _count_access_events(seed_gym) == 0
    assert backfill_missing_bridge_projections(gym_id) == 1
    db.session.commit()
    evt = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id="v7-l16-evt-1"
    ).first()
    assert evt is not None
    assert evt.member_id == member.id
    state = MemberAccessState.query.filter_by(
        gym_id=gym_id, member_id=member.id
    ).first()
    assert state is not None and state.current_state == "INSIDE"
    assert backfill_missing_bridge_projections(gym_id) == 0
    assert _count_access_events(seed_gym) == 1


# ── V7-L17: Inside search matches the enroll number ────────────────────


def test_v7_l17_inside_search_finds_enroll_number(seed_gym):
    """Typing a terminal enroll number in the Inside search finds the
    member inside — previously name-only, like the feed legs (V7-L17)."""
    member = _member(seed_gym, name="Inside Forty Two", phone="+910000000412", enroll="42")
    other = _member(seed_gym, name="Someone Else", phone="+910000000413", enroll="43")
    for m in (member, other):
        db.session.add(MemberAccessState(
            gym_id=seed_gym["gym"].id, member_id=m.id,
            current_state="INSIDE", last_entry_at=_now(),
        ))
    db.session.commit()
    assert [m["full_name"] for m in get_members_inside(
        seed_gym["gym"].id, search="42")["members"]] == ["Inside Forty Two"]
    assert [m["full_name"] for m in get_members_inside(
        seed_gym["gym"].id, search="Inside")["members"]] == ["Inside Forty Two"]
    assert get_members_inside(seed_gym["gym"].id, search="zzz")["members"] == []


# ── V7-L18: member app counts ATTENDANCE punches ───────────────────────


def test_v7_l18_member_app_counts_attendance_events(client, seed_member):
    """A legacy-bridge ATTENDANCE punch today counts as an entry and
    sets last_visit in the member app (V7-L18)."""
    member = seed_member
    db.session.add(AccessEvent(
        gym_id=member.gym_id, member_id=member.id,
        event_type="ATTENDANCE", direction="UNKNOWN",
        event_timestamp=_now(), received_timestamp=_now(),
        device_enroll_number="1", source_event_id="v7-l18-attendance",
    ))
    db.session.commit()
    token = create_access_token(user_id=member.id, gym_id=member.gym_id, role="member")
    res = client.get("/api/member/v1/access", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    summary = res.json["data"]["summary"]
    assert summary["today_entries"] == 1
    assert summary["last_visit"] is not None


# ── V7-L19: merged feed dedupes historical twins by punch identity ───


def test_v7_l19_feed_collapses_historical_twin_by_punch_key(seed_gym):
    """Two AccessEvents for the same punch (pre-V7-M9 twins, different
    ids/device names) render once in the feed, with a shared stable
    punch_key (V7-L19)."""
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Twin Feed", phone="+910000000414", enroll="42")
    t = _now().replace(microsecond=0)
    for n, (source_id, device) in enumerate((
        ("v7-l19-bridge", "Bridge PC"),
        ("rrr-attendance-999", "Direct ADMS terminal"),
    )):
        db.session.add(AccessEvent(
            gym_id=gym_id, member_id=member.id,
            event_type="ENTRY", direction="IN",
            event_timestamp=t, received_timestamp=t,
            device_enroll_number="42", source_event_id=source_id,
            device_name=device, member_name="Twin Feed",
        ))
    db.session.commit()
    feed = get_access_events(gym_id, "Asia/Kolkata", date_filter="today")
    assert feed["pagination"]["total"] == 1
    assert len(feed["events"]) == 1
    # SQLite returns datetimes naive, so the stored timestamp's
    # isoformat carries no offset — compare against the naive form.
    assert feed["events"][0]["punch_key"] == "42|" + t.replace(tzinfo=None).isoformat() + "|ENTRY|IN"


# ── Carry-over: bridge enrollment passes the gym id, not the integration id


def test_v7_carryover_bridge_enrollment_passes_gym_id(client, seed_gym, monkeypatch):
    """POST /bridge/v1/enrollment must call upsert_terminal_snapshot
    with installation.gym_id — the old code passed integration.id,
    which could land the name in another gym's OPERLOG snapshot."""
    installation, api_key = _installation(seed_gym)
    db.session.add(RRRIntegration(
        gym_id=seed_gym["gym"].id, connector_type="direct_bridge",
        display_name="V7 Test Bridge",
        device_serial="V7-TEST-X2008", status="connected",
    ))
    db.session.commit()
    calls = []

    def _spy(gym_id, enroll_number, name, source="operlog"):
        calls.append((gym_id, enroll_number, name, source))

    monkeypatch.setattr(
        "app.services.enroll_match_service.upsert_terminal_snapshot", _spy
    )
    resp = client.post(
        "/api/bridge/v1/enrollment",
        json={
            "gymId": installation.public_id,
            "deviceEnrollNumber": "42",
            "userName": "Enrolled Person",
        },
        headers=_bridge_headers(api_key),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert calls == [(seed_gym["gym"].id, "42", "Enrolled Person", "bridge")]


# ── V5-L9: legacy probe catches zero-padded pins without the migration ─


def test_v7_v5_l9_resend_dedupes_zero_padded_key_without_migration(seed_gym):
    """A pre-fix RRR row stored under an old-format key built from raw
    pin "042" dedupes on re-send even though the migration never ran —
    the legacy probe now tries the raw pin as well as canonical "42"
    (V5-L9 residual)."""
    gym_id = seed_gym["gym"].id
    t = datetime(2026, 11, 1, 10, 0, 0, tzinfo=UTC)
    row = RRRAttendanceEvent(
        gym_id=gym_id, source="adms_direct", device_serial="v7-serial",
        biometric_user_id="042", punch_time=t,
        received_at=t + timedelta(minutes=5),
        direction="0", dedupe_key=_old_format_key("v7-serial", "042", t),
        processing_status="unmapped",
    )
    db.session.add(row)
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="042",
        punch_time=t, device_serial="v7-serial", direction="0",
    )
    assert created is False
    assert event.id == row.id
    assert RRRAttendanceEvent.query.filter_by(gym_id=gym_id).count() == 1


def test_v7_v5_l9_resend_dedupes_raw_pin_directionless_key(seed_gym):
    """Same hole, new-format spelling: a pre-H7 row whose
    direction-less key was computed from raw pin "042" dedupes when the
    punch re-arrives with a direction (V5-L9 residual)."""
    gym_id = seed_gym["gym"].id
    t = datetime(2026, 11, 1, 11, 0, 0, tzinfo=UTC)
    raw_directionless = hashlib.sha256(
        "|".join(("V7-SERIAL", "042", t.isoformat(), "")).encode("utf-8")
    ).hexdigest()
    row = RRRAttendanceEvent(
        gym_id=gym_id, source="adms_direct", device_serial="v7-serial",
        biometric_user_id="042", punch_time=t,
        received_at=t + timedelta(minutes=5),
        direction=None, dedupe_key=raw_directionless,
        processing_status="unmapped",
    )
    db.session.add(row)
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="042",
        punch_time=t, device_serial="v7-serial", direction="0",
    )
    assert created is False
    assert event.id == row.id
    assert RRRAttendanceEvent.query.filter_by(gym_id=gym_id).count() == 1
