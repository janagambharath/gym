"""Access event processing pipeline.

Transforms bridge and normalized RRR attendance records into semantic
``AccessEvent`` entries and maintains ``MemberAccessState`` for "currently
inside" queries. Every projection is idempotent: re-processing the same
attendance record produces no duplicate access events.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance, BridgeInstallation
from app.models.member import Member
from app.models.member_access_state import MemberAccessState
from app.models.mixins import utcnow
from app.services.storage_service import member_profile_photo_url
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day

logger = logging.getLogger(__name__)


# ── ZKTeco AttState constants ─────────────────────────────────────────

ATT_STATE_CHECK_IN = 0
ATT_STATE_CHECK_OUT = 1
ATT_STATE_BREAK_OUT = 2
ATT_STATE_BREAK_IN = 3
ATT_STATE_OT_IN = 4
ATT_STATE_OT_OUT = 5


def _classify_event(
    att_state: int | None,
    is_invalid: bool,
) -> tuple[str, str]:
    """Return ``(event_type, direction)`` from raw device fields.

    When ``is_invalid`` is True the device denied verification —
    the member was not granted access regardless of att_state.

    When ``att_state`` is None (old bridge build) we cannot determine
    direction, so we honestly report ATTENDANCE / UNKNOWN.
    """
    if is_invalid:
        return "ACCESS_DENIED", "UNKNOWN"

    if att_state is None:
        # Old bridge version that doesn't send AttState.
        # We cannot determine direction — be honest.
        return "ATTENDANCE", "UNKNOWN"

    if att_state == ATT_STATE_CHECK_IN:
        return "ENTRY", "IN"
    if att_state == ATT_STATE_CHECK_OUT:
        return "EXIT", "OUT"
    if att_state in (ATT_STATE_BREAK_IN, ATT_STATE_OT_IN):
        return "ENTRY", "IN"
    if att_state in (ATT_STATE_BREAK_OUT, ATT_STATE_OT_OUT):
        return "EXIT", "OUT"

    # Unexpected att_state value — record it but don't guess.
    return "ATTENDANCE", "UNKNOWN"


def _resolve_member(gym_id: int, device_enroll_number: str) -> Member | None:
    """Find the Renewal Desk member by device enroll number.

    V3-M14: a soft-deleted member never resolves — its terminal ID
    reads as unknown, not as a named ex-member in Live Access.
    V4-M5: route through find_member_by_enroll_number — an exact query
    misses a member stored pre-fix as "042" when the punch carries
    canonical "42" (bridge leg).
    """
    from app.services.bridge_service import find_member_by_enroll_number

    member = find_member_by_enroll_number(gym_id, device_enroll_number)
    if member is not None and member.deleted_at is not None:
        return None
    return member


def _live_member(member: Member | None) -> Member | None:
    """Return *member* only when it is a live (non-deleted) member (V3-M14).

    A soft-deleted member keeps ``device_enroll_number`` by design, so
    stale ``BridgeAttendance.member_id`` / ``RRRAttendanceEvent.member_id``
    rows can still hand one back. Treat it as unknown: no name/status
    snapshot in the feed, no ``MemberAccessState`` flip to INSIDE.
    """
    if member is not None and member.deleted_at is not None:
        return None
    return member


def _punch_key(enroll_number, event_timestamp, event_type, direction) -> str:
    """Stable punch identity (V7-L19): enroll + full-precision
    timestamp + type + direction.

    A punch's row id changes when it projects (``"adms-<id>"`` -> int
    AccessEvent id), so id-based dedupe cannot collapse the same punch
    across legs/pages. The timestamp is deliberately FULL precision:
    truncating to the second would collapse two genuinely distinct
    punches by the same member in the same second (V4-L12's feed
    search test builds exactly that pair from two ``_now()`` calls).
    A real twin carries the same instant on both legs — the ADMS
    projection copies ``punch_time`` verbatim into the AccessEvent —
    so full-precision equality still collapses it. Member id is
    deliberately NOT in the key — it changes from None to the member
    when the punch is linked, and the punch is still the same punch.
    """
    ts = event_timestamp
    if isinstance(ts, datetime):
        ts = ts.isoformat()
    elif ts is not None:
        ts = str(ts)
    return f"{enroll_number or ''}|{ts or ''}|{event_type or ''}|{direction or ''}"


def _normalize_twin_class(event_type, direction):
    """Normalize a punch classification for twin comparison (V9-L23).

    A direction-missing punch classifies ATTENDANCE/UNKNOWN while the
    same physical punch seen with an att-state classifies ENTRY/IN
    (ATTLOG line with no status column; old bridge build with no
    att_state). Those are the same punch, so twin keys must treat
    them as one class. ATTENDANCE is entry-like only — it never
    normalises to EXIT, so a genuine same-second ENTRY+EXIT pair (and
    an ATTENDANCE row against an EXIT) stay distinct.
    """
    if event_type == "ATTENDANCE":
        return "ENTRY", "IN"
    if direction in (None, "", "UNKNOWN"):
        if event_type == "ENTRY":
            return "ENTRY", "IN"
        if event_type == "EXIT":
            return "EXIT", "OUT"
    return event_type, direction


def _find_punch_twin(
    *,
    gym_id: int,
    device_enroll_number: str,
    event_timestamp: datetime,
    event_type: str,
    direction: str,
) -> AccessEvent | None:
    """Existing AccessEvent for the same physical punch, projected via
    the OTHER ingest path (V7-M9).

    Bridge and ADMS projections use disjoint ``source_event_id``
    namespaces, so neither saw the other's row and one physical punch
    yielded two AccessEvents (doubled ``entries_today``, duplicate feed
    rows). A twin is the same gym + enroll + event type + direction in
    the same wall-clock second — the second window absorbs the bridge
    path's microseconds vs the ADMS path's whole-second timestamps.
    Same-second entry+exit stay distinct (type/direction differ).
    """
    ts = _as_utc(event_timestamp)
    if ts is None:
        return None
    from datetime import timedelta

    floor = ts.replace(microsecond=0)
    # V9-L23: classification-tolerant twin match — a direction-missing
    # punch (ATTENDANCE/UNKNOWN) is the same physical punch as the
    # ENTRY/IN the other path recorded for it. Match any stored class
    # whose NORMALISED class equals the incoming punch's normalised
    # class, in either direction (incoming ATTENDANCE vs stored ENTRY,
    # or incoming ENTRY vs stored ATTENDANCE). ATTENDANCE normalises
    # to entry-like only, so same-second entry+exit pairs stay
    # distinct.
    target = _normalize_twin_class(event_type, direction)
    candidates = {(event_type, direction)} | {
        cls
        for cls in (
            ("ENTRY", "IN"),
            ("EXIT", "OUT"),
            ("ATTENDANCE", "UNKNOWN"),
            ("ACCESS_DENIED", "UNKNOWN"),
        )
        if _normalize_twin_class(*cls) == target
    }
    return (
        AccessEvent.query.filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.device_enroll_number == device_enroll_number,
            or_(
                *[
                    and_(
                        AccessEvent.event_type == twin_type,
                        AccessEvent.direction == twin_direction,
                    )
                    for twin_type, twin_direction in sorted(candidates)
                ]
            ),
            AccessEvent.event_timestamp >= floor,
            AccessEvent.event_timestamp < floor + timedelta(seconds=1),
        )
        .order_by(AccessEvent.id.asc())
        .first()
    )


def _unprojected_rrr_exists(gym_id: int):
    """Correlated EXISTS: an AccessEvent projects this RRR row.

    Shared by the summary count (V3-M13) and the feed legs (V3-M11)
    so both agree on which ADMS punches are already in the feed.
    """
    from sqlalchemy import String, cast, exists as _exists

    from app.models.rrr import RRRAttendanceEvent

    return (
        db.session.query(AccessEvent.id)
        .filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.source_event_id
            == "rrr-attendance-" + cast(RRRAttendanceEvent.id, String),
        )
        .exists()
    )


def adms_device_status(gym_id: int) -> dict | None:
    """Direct-ADMS terminal online state for a gym (V3-M12).

    Shared helper so ``/access/summary`` and the dashboard payload
    (via :func:`get_access_summary`) report the same device state:
    a direct-ADMS terminal with no bridge row used to read "Offline"
    on the dashboard while Live Access correctly showed online.
    Returns None when the gym has no direct-ADMS integration.
    """
    from app.models.rrr import RRRIntegration
    from app.services.rrr_service import (
        direct_adms_terminal_is_online,
        direct_adms_terminal_last_seen_at,
    )

    adms = RRRIntegration.query.filter_by(
        gym_id=gym_id, connector_type="adms_direct"
    ).first()
    if not adms:
        return None
    last_seen = direct_adms_terminal_last_seen_at(adms)
    online = direct_adms_terminal_is_online(adms, last_seen_at=last_seen)
    return {
        "adms_online": online,
        "adms_last_seen_at": last_seen.isoformat() if last_seen else None,
        "adms_device_name": adms.device_name or adms.device_serial,
        "device_online": online,
        "device_name": adms.device_name or adms.device_serial,
        "device_serial": adms.device_serial,
        # V4-L11: whether the ADMS integration may override a live
        # bridge's online state — only when token-connected or
        # serial-fallback is enabled. A disconnected integration must
        # fall through to the bridge heartbeat instead.
        "adms_connection_usable": bool(
            adms.status == "connected" or adms.allow_serial_fallback
        ),
    }


def _rrr_entry_rows_query(gym_id: int):
    """RRR rows that belong in the Live Access RRR leg (V4-M22).

    Only direct-ADMS punches: bridge/eBioServer punches already project
    into AccessEvent via the BridgeAttendance path, so counting/showing
    their RRR rows as well double-counts entries and duplicates feed
    rows. Only entry direction: att-states 0/3/4 (or unknown/None,
    which the feed treats as an entry) — exits must not inflate the
    entry count or appear as entries in the feed.
    """
    from sqlalchemy import or_ as _or

    from app.models.rrr import RRRAttendanceEvent

    return RRRAttendanceEvent.query.filter(
        RRRAttendanceEvent.gym_id == gym_id,
        RRRAttendanceEvent.source == "adms_direct",
        _or(
            RRRAttendanceEvent.direction.is_(None),
            RRRAttendanceEvent.direction.in_(["0", "3", "4"]),
        ),
    )


def _rrr_exit_rows_query(gym_id: int):
    """RRR rows that belong in the Live Access unprojected-exit backfill
    (V5-L12): direct-ADMS punches in an exit direction (att-states
    1/2/5). Mirrors :func:`_rrr_entry_rows_query` — entries got an
    unprojected backfill leg, exits had none, so a projection failure
    left an ADMS exit invisible in the feed and in ``exits_today``.
    """
    from app.models.rrr import RRRAttendanceEvent

    return RRRAttendanceEvent.query.filter(
        RRRAttendanceEvent.gym_id == gym_id,
        RRRAttendanceEvent.source == "adms_direct",
        RRRAttendanceEvent.direction.in_(["1", "2", "5"]),
    )


def _serialize_rrr_event(evt) -> dict:
    """Serialize one unprojected RRR row for the feed (V5-L28).

    Sends the REAL event type + direction (classified from the stored
    att-state) instead of hardcoding ``"ENTRY"`` with no direction:
    the old shape rendered every unprojected punch as an ENTRY twin of
    its projected AccessEvent row, and the client dedupe key
    (device:member:timestamp:event_type:direction) split the twins
    instead of collapsing them.
    """
    try:
        att_state = int(evt.direction) if evt.direction is not None else None
    except (TypeError, ValueError):
        att_state = None
    event_type, direction = _classify_event(att_state, is_invalid=False)
    member = _live_member(evt.member)
    return {
        "id": f"adms-{evt.id}",
        "event_type": event_type,
        "direction": direction,
        "event_timestamp": evt.punch_time.isoformat() if evt.punch_time else None,
        "member_id": member.id if member else None,
        "member_name": member.full_name if member else None,
        "biometric_user_id": evt.biometric_user_id,
        "device_name": evt.device_serial,
        "verify_method": evt.verify_method,
        "source": "adms_direct",
        # V7-L19: stable punch identity — lets clients dedupe this row
        # against its projected AccessEvent twin across page fetches.
        "punch_key": _punch_key(evt.biometric_user_id, evt.punch_time, event_type, direction),
    }


def process_attendance_to_access_event(
    attendance: BridgeAttendance,
) -> AccessEvent | None:
    """Process one BridgeAttendance into an AccessEvent.

    Returns the created ``AccessEvent``, or ``None`` if this attendance
    was already processed (idempotent).

    The caller is responsible for committing the session.
    """
    # 1. Deduplicate by source_event_id within the gym
    existing = AccessEvent.query.filter_by(
        gym_id=attendance.gym_id,
        source_event_id=attendance.event_id,
    ).first()
    if existing is not None:
        return None  # Already processed

    # 2. Classify event type
    event_type, direction = _classify_event(
        attendance.att_state,
        attendance.is_invalid,
    )

    # 3. Resolve member
    member = attendance.member
    if member is None and attendance.member_id is not None:
        member = db.session.get(Member, attendance.member_id)
    if member is None:
        member = _resolve_member(attendance.gym_id, attendance.device_enroll_number)
    # V3-M14: a soft-deleted member resolves as unknown — no name/status
    # snapshot, no MemberAccessState update (see _live_member).
    member = _live_member(member)

    # V7-M9: the same physical punch may already be projected via the
    # ADMS path (disjoint source_event_id namespaces). Projecting again
    # would double entries_today and duplicate the feed row — skip and,
    # if the twin was projected before the member was known, fill its
    # identity + INSIDE state like the ADMS existing-branch does.
    twin = _find_punch_twin(
        gym_id=attendance.gym_id,
        device_enroll_number=attendance.device_enroll_number,
        event_timestamp=attendance.event_time,
        event_type=event_type,
        direction=direction,
    )
    if twin is not None:
        if member is not None and twin.member_id is None:
            twin.member_id = member.id
            twin.member_name = member.full_name
            twin.membership_status = member.status
            db.session.flush()
            if twin.event_type in ("ENTRY", "EXIT", "ATTENDANCE"):
                _update_member_access_state(
                    gym_id=attendance.gym_id,
                    member_id=member.id,
                    access_event=twin,
                    event_type="ENTRY" if twin.event_type == "ATTENDANCE" else twin.event_type,
                )
        return None

    # 4. Get bridge info for display
    bridge = None
    if attendance.bridge_id:
        bridge = db.session.get(BridgeInstallation, attendance.bridge_id)

    # 5. Snapshot member info for display
    member_name = None
    membership_status = None
    if member is not None:
        member_name = member.full_name
        membership_status = member.status
    device_name = bridge.display_name if bridge else None

    # 6. Create AccessEvent
    access_event = AccessEvent(
        gym_id=attendance.gym_id,
        member_id=member.id if member else None,
        bridge_id=attendance.bridge_id,
        event_type=event_type,
        direction=direction,
        event_timestamp=attendance.event_time,
        received_timestamp=attendance.received_at or utcnow(),
        device_enroll_number=attendance.device_enroll_number,
        source_event_id=attendance.event_id,
        att_state=attendance.att_state,
        verify_method=attendance.verify_method,
        is_invalid=attendance.is_invalid,
        member_name=member_name,
        membership_status=membership_status,
        device_name=device_name,
    )
    db.session.add(access_event)

    # Flush to get the access_event.id before updating state
    db.session.flush()

    # 7. Update MemberAccessState (only for known members with direction)
    if member is not None and event_type in ("ENTRY", "EXIT"):
        _update_member_access_state(
            gym_id=attendance.gym_id,
            member_id=member.id,
            access_event=access_event,
            event_type=event_type,
        )
    elif member is not None and event_type == "ATTENDANCE":
        # Generic attendance without direction info — treat as entry
        # since most gym scans happen on entry. Marked as INSIDE but
        # the event itself stays as ATTENDANCE (honest classification).
        _update_member_access_state(
            gym_id=attendance.gym_id,
            member_id=member.id,
            access_event=access_event,
            event_type="ENTRY",
        )

    logger.info(
        "AccessEvent created: gym=%s member=%s type=%s direction=%s enroll=%s",
        attendance.gym_id,
        member.id if member else "unknown",
        event_type,
        direction,
        attendance.device_enroll_number,
    )
    return access_event


def process_rrr_attendance_to_access_event(attendance) -> AccessEvent | None:
    """Project a normalized direct-device punch into the member access feed.

    The RRR attendance row remains the source of truth for device ingestion;
    this projection gives the owner and member apps the same attendance feed
    used by the bridge connector. Reprocessing and later identity linking are
    safe and idempotent.
    """
    source_event_id = f"rrr-attendance-{attendance.id}"
    existing = AccessEvent.query.filter_by(
        gym_id=attendance.gym_id,
        source_event_id=source_event_id,
    ).first()

    member = attendance.member
    if member is None and attendance.member_id is not None:
        member = db.session.get(Member, attendance.member_id)
    # V3-M14: a soft-deleted member resolves as unknown.
    member = _live_member(member)

    if existing is not None:
        # An identity may have been linked after the punch first arrived.
        if member is not None:
            if existing.member_id is None:
                existing.member_id = member.id
            # V9-L22: only (re)write the displayed name/status when the
            # row belongs to this member (or had no member yet). The
            # twin may have been remapped to a different member since
            # this row projected; overwriting its name/status with the
            # new member's would show one member's name on another
            # member's row. Mirrors the bridge twin branch guard.
            if existing.member_id == member.id:
                existing.member_name = member.full_name
                existing.membership_status = member.status
            if existing.member_id == member.id and existing.event_type in ("ENTRY", "EXIT", "ATTENDANCE"):
                _update_member_access_state(
                    gym_id=attendance.gym_id,
                    member_id=member.id,
                    access_event=existing,
                    event_type="ENTRY" if existing.event_type == "ATTENDANCE" else existing.event_type,
                )
        return None

    try:
        att_state = int(attendance.direction) if attendance.direction is not None else None
    except (TypeError, ValueError):
        att_state = None
    try:
        verify_method = int(attendance.verify_method) if attendance.verify_method is not None else None
    except (TypeError, ValueError):
        verify_method = None

    event_type, direction = _classify_event(att_state, is_invalid=False)
    # V7-M9: cross-source twin — this punch may already be projected
    # via the bridge path (same gym + enroll + second + type). Skip
    # creating a second AccessEvent; fill the twin's identity + INSIDE
    # state when the member is now known. No feed/summary twin survives
    # in either arrival order: bridge-first RRR rows carry a non-ADMS
    # source so the RRR leg never surfaces them, and ADMS-first rows
    # are already projected (their own AccessEvent exists).
    twin = _find_punch_twin(
        gym_id=attendance.gym_id,
        device_enroll_number=(attendance.biometric_user_id or "unknown")[:32],
        event_timestamp=attendance.punch_time,
        event_type=event_type,
        direction=direction,
    )
    if twin is not None:
        if member is not None:
            if twin.member_id is None:
                twin.member_id = member.id
            # V9-L22: only (re)write the displayed name/status when the
            # twin belongs to this member (or had no member yet) — see
            # the existing-branch guard above.
            if twin.member_id == member.id:
                twin.member_name = member.full_name
                twin.membership_status = member.status
            if twin.member_id == member.id and twin.event_type in ("ENTRY", "EXIT", "ATTENDANCE"):
                _update_member_access_state(
                    gym_id=attendance.gym_id,
                    member_id=member.id,
                    access_event=twin,
                    event_type="ENTRY" if twin.event_type == "ATTENDANCE" else twin.event_type,
                )
        return None
    access_event = AccessEvent(
        gym_id=attendance.gym_id,
        member_id=member.id if member else None,
        bridge_id=None,
        event_type=event_type,
        direction=direction,
        event_timestamp=attendance.punch_time,
        received_timestamp=attendance.received_at or utcnow(),
        device_enroll_number=(attendance.biometric_user_id or "unknown")[:32],
        source_event_id=source_event_id,
        att_state=att_state,
        verify_method=verify_method,
        is_invalid=False,
        member_name=member.full_name if member else None,
        membership_status=member.status if member else None,
        device_name=(attendance.device_serial or "Direct ADMS terminal")[:120],
    )
    try:
        with db.session.begin_nested():
            db.session.add(access_event)
            db.session.flush()
    except IntegrityError:
        # Another ingestion worker projected the same RRR row first.
        return None

    if member is not None and event_type in ("ENTRY", "EXIT", "ATTENDANCE"):
        _update_member_access_state(
            gym_id=attendance.gym_id,
            member_id=member.id,
            access_event=access_event,
            event_type="ENTRY" if event_type == "ATTENDANCE" else event_type,
        )
    return access_event


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _update_member_access_state(
    *,
    gym_id: int,
    member_id: int,
    access_event: AccessEvent,
    event_type: str,
) -> None:
    """Update or create the MemberAccessState for one member.

    Out-of-order protection: only update if the new event's timestamp is
    newer than the currently recorded last_event_timestamp.
    """
    state = MemberAccessState.query.filter_by(
        gym_id=gym_id,
        member_id=member_id,
    ).first()

    if state is None:
        state = MemberAccessState(
            gym_id=gym_id,
            member_id=member_id,
            current_state="UNKNOWN",
        )
        db.session.add(state)

    # Out-of-order protection
    prev_time = _as_utc(state.last_event_timestamp)
    curr_time = _as_utc(access_event.event_timestamp)
    if prev_time is not None and curr_time is not None and prev_time > curr_time:
        # This event is older than the current state — don't update state
        return

    # V6-L14: same-second entry+exit is order-dependent — whichever
    # event is processed last wins the state. Let EXIT win: an ENTRY
    # at the same timestamp as the recorded event must not flip a
    # member back INSIDE after an EXIT at that second, and an ENTRY
    # re-delivered at the same second changes nothing anyway.
    if prev_time is not None and curr_time is not None and prev_time == curr_time:
        if event_type != "EXIT":
            return

    # Update state
    if event_type == "ENTRY":
        state.current_state = "INSIDE"
        state.last_entry_at = access_event.event_timestamp
    elif event_type == "EXIT":
        state.current_state = "OUTSIDE"
        state.last_exit_at = access_event.event_timestamp

    state.last_event_id = access_event.id
    state.last_event_timestamp = access_event.event_timestamp


# ── V8-L16 whole-second twin keys ─────────────────────────────────────

def _parse_timestamp_value(value):
    """Parse a serialized (ISO string) or raw timestamp to datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _twin_second_key(enroll_number, event_timestamp, event_type, direction):
    """Whole-second twin key (V8-L16): enroll + type + direction + the
    timestamp truncated to the second (UTC).

    This is the V7-M9 twin identity — ``_find_punch_twin`` already
    matches on the same wall-clock second — applied to the merged
    feed/summary, where the full-precision ``_punch_key`` cannot see
    the twin: the bridge leg preserves fractional seconds while the
    ADMS leg is whole-second, so the same physical punch carries two
    different full-precision keys and renders/counted twice.
    """
    ts = _parse_timestamp_value(event_timestamp)
    if ts is None:
        return None
    ts = _as_utc(ts).replace(microsecond=0)
    # V9-L23: normalise the classification before keying — a
    # direction-missing ATTENDANCE/UNKNOWN punch and the ENTRY/IN the
    # other path recorded for the same physical punch must share one
    # key, or the twin survives and double-counts/renders twice.
    event_type, direction = _normalize_twin_class(event_type, direction)
    return f"{enroll_number or ''}|{ts.isoformat()}|{event_type or ''}|{direction or ''}"


def _rrr_second_twin_count(gym_id: int, day_start_utc, *, entry: bool) -> int:
    """Unprojected RRR rows for today that are V7-M9 twins of an
    AccessEvent (V8-L16).

    Only a WHOLE-second RRR punch can be such a twin: ADMS device
    times are whole-second by construction (``_parse_device_time``
    parses ``%H:%M:%S``), so a whole-second RRR punch in the same
    second as a fractional-second bridge AccessEvent is the same
    physical punch seen twice. A fractional-second RRR punch in the
    same second is a genuinely distinct punch — V4-L12's pair (two
    ``_now()`` calls, both fractional) must stay distinct, so it is
    never counted here. Returns how many of today's unprojected RRR
    rows to subtract from the summary count.
    """
    from app.models.rrr import RRRAttendanceEvent

    if entry:
        rrr_rows = (
            _rrr_entry_rows_query(gym_id)
            .filter(RRRAttendanceEvent.punch_time >= day_start_utc)
            .filter(~_unprojected_rrr_exists(gym_id))
            .all()
        )
        ae_types = ("ENTRY", "ATTENDANCE")
    else:
        rrr_rows = (
            _rrr_exit_rows_query(gym_id)
            .filter(RRRAttendanceEvent.punch_time >= day_start_utc)
            .filter(~_unprojected_rrr_exists(gym_id))
            .all()
        )
        ae_types = ("EXIT",)
    if not rrr_rows:
        return 0
    ae_keys = {
        _twin_second_key(
            evt.device_enroll_number,
            evt.event_timestamp,
            evt.event_type,
            evt.direction,
        )
        for evt in AccessEvent.query.filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.event_type.in_(ae_types),
            AccessEvent.event_timestamp >= day_start_utc,
        ).all()
    }
    count = 0
    for row in rrr_rows:
        if row.punch_time is None:
            continue
        ts = _as_utc(row.punch_time)
        if ts.microsecond != 0:
            continue  # fractional-second RRR punch: distinct, not a twin
        try:
            att_state = int(row.direction) if row.direction is not None else None
        except (TypeError, ValueError):
            att_state = None
        event_type, direction = _classify_event(att_state, is_invalid=False)
        if (
            _twin_second_key(row.biometric_user_id, ts, event_type, direction)
            in ae_keys
        ):
            count += 1
    return count


# ── Query helpers for the mobile API ──────────────────────────────────


def get_access_summary(gym_id: int, gym_timezone: str) -> dict:
    """Return summary counts for the Live Access dashboard card."""
    day_start_utc = utc_start_of_gym_day(gym_timezone)

    # V4-M10: inside_now must not count soft-deleted members — a member
    # deleted while INSIDE keeps a MemberAccessState row until it is
    # expired on soft-delete / aged out, and must not show as inside.
    inside_now = (
        MemberAccessState.query.filter_by(
            gym_id=gym_id,
            current_state="INSIDE",
        )
        .join(Member, MemberAccessState.member_id == Member.id)
        .filter(Member.deleted_at.is_(None))
        .count()
    )

    entries_today = AccessEvent.query.filter(
        AccessEvent.gym_id == gym_id,
        AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]),
        AccessEvent.event_timestamp >= day_start_utc,
    ).count()

    exits_today = AccessEvent.query.filter(
        AccessEvent.gym_id == gym_id,
        AccessEvent.event_type == "EXIT",
        AccessEvent.event_timestamp >= day_start_utc,
    ).count()

    denied_today = AccessEvent.query.filter(
        AccessEvent.gym_id == gym_id,
        AccessEvent.event_type == "ACCESS_DENIED",
        AccessEvent.event_timestamp >= day_start_utc,
    ).count()

    # Last event time
    last_event = (
        AccessEvent.query.filter_by(gym_id=gym_id)
        .order_by(AccessEvent.event_timestamp.desc())
        .first()
    )
    last_event_at = last_event.event_timestamp.isoformat() if last_event else None

    # Device status from BridgeInstallation
    bridge = BridgeInstallation.query.filter_by(gym_id=gym_id).first()
    device_online = False
    last_heartbeat = None
    device_name = None
    if bridge:
        device_name = bridge.display_name
        if bridge.last_heartbeat_at:
            hb = bridge.last_heartbeat_at
            if hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            heartbeat_age = max(0, (utcnow() - hb).total_seconds())
            device_online = heartbeat_age <= 120 and bridge.is_active
            last_heartbeat = hb.isoformat()

    # Also count ADMS attendance events (RRRAttendanceEvent) — these are the
    # punches from direct-cloud terminals that don't go through AccessEvent.
    # V3-M13: count ONLY unprojected rows. Every ADMS punch that projected
    # into AccessEvent (the normal case) was already counted above, so
    # adding all RRR rows double-counted entries today (~2x).
    # V4-M22: the RRR leg is ADMS-direct entry rows only — bridge /
    # eBioServer punches already have an AccessEvent via the
    # BridgeAttendance path, so their RRR rows must not be counted here.
    from app.models.rrr import RRRAttendanceEvent
    adms_entries_today = _rrr_entry_rows_query(gym_id).filter(
        RRRAttendanceEvent.punch_time >= day_start_utc,
    ).filter(~_unprojected_rrr_exists(gym_id)).count()
    # V8-L16: a twin-skipped RRR row (bridge projected first, ADMS leg
    # whole-second vs bridge fractional) is unprojected forever, so it
    # is counted here AND its bridge AccessEvent is counted above —
    # entries_today double-counts it. Subtract the whole-second twins.
    adms_entries_today -= _rrr_second_twin_count(gym_id, day_start_utc, entry=True)
    entries_today = entries_today + adms_entries_today

    # V5-L12: same unprojected backfill for exits — an ADMS exit whose
    # projection failed must still count, or the member reads as
    # INSIDE with zero exits until the nightly auto-reset.
    adms_exits_today = _rrr_exit_rows_query(gym_id).filter(
        RRRAttendanceEvent.punch_time >= day_start_utc,
    ).filter(~_unprojected_rrr_exists(gym_id)).count()
    adms_exits_today -= _rrr_second_twin_count(gym_id, day_start_utc, entry=False)
    exits_today = exits_today + adms_exits_today

    # Last event time — check both tables
    last_adms_event = (
        RRRAttendanceEvent.query.filter_by(gym_id=gym_id)
        .order_by(RRRAttendanceEvent.punch_time.desc())
        .first()
    )
    if last_adms_event and last_adms_event.punch_time:
        adms_time = last_adms_event.punch_time.isoformat()
        if not last_event_at or adms_time > last_event_at:
            last_event_at = adms_time

    # V3-M12: Direct ADMS is authoritative for device state when
    # configured (same rule as /access/summary). Without this override
    # the dashboard embedded device_online=False for ADMS-only gyms
    # (no BridgeInstallation row) while Live Access showed online.
    # V4-L11: apply the override only when the ADMS terminal is actually
    # online (which already requires a connected integration or
    # serial-fallback). A disconnected ADMS integration must not
    # override a live bridge's online state with False.
    adms_status = adms_device_status(gym_id)
    if adms_status is not None and adms_status.get("adms_connection_usable"):
        # The ADMS device name is the configured terminal's name even
        # when it is briefly offline; the ONLINE state, however, only
        # overrides when the terminal is actually seen — a stale ADMS
        # integration must never flip a live bridge to offline.
        device_name = adms_status["device_name"]
        if adms_status["device_online"]:
            device_online = adms_status["device_online"]

    return {
        "inside_now": inside_now,
        "entries_today": entries_today,
        "exits_today": exits_today,
        "denied_today": denied_today,
        "last_event_at": last_event_at,
        "device_online": device_online,
        "device_name": device_name,
        "last_heartbeat": last_heartbeat,
    }


def get_access_events(
    gym_id: int,
    gym_timezone: str,
    *,
    page: int = 1,
    per_page: int = 25,
    event_type: str | None = None,
    search: str | None = None,
    date_filter: str | None = None,
) -> dict:
    """Return paginated access events for the feed.

    Raises ValueError on an unknown ``date_filter`` (V3-L12) — the
    caller maps it to a 400 instead of silently returning all-time rows.
    """
    # V3-L12: an unexpected date_filter used to disable the date filter
    # on both legs (all-time rows). Fail loudly instead.
    if date_filter not in ("today", "all", None):
        raise ValueError(f"Unknown date_filter: {date_filter!r}. Expected 'today' or 'all'.")
    page = max(page, 1)
    per_page = max(per_page, 1)
    query = AccessEvent.query.filter_by(gym_id=gym_id)

    # Filter by event type
    if event_type == "entry":
        query = query.filter(AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]))
    elif event_type == "exit":
        query = query.filter_by(event_type="EXIT")
    elif event_type == "denied":
        query = query.filter_by(event_type="ACCESS_DENIED")

    # Filter by date (default: last 7 days, not just today)
    if date_filter == "today":
        day_start_utc = utc_start_of_gym_day(gym_timezone)
        query = query.filter(AccessEvent.event_timestamp >= day_start_utc)
    elif date_filter == "all" or date_filter is None:
        # Show last 7 days by default so historical punches are visible
        from datetime import timedelta
        from app.models.mixins import utcnow
        week_ago = utcnow() - timedelta(days=7)
        query = query.filter(AccessEvent.event_timestamp >= week_ago)

    # Search by member name or enroll number (V4-L12): the two feed legs
    # must use the SAME predicates — the ADMS leg already searched name
    # OR biometric ID while this leg searched name only, so an ID search
    # silently dropped every AccessEvent row.
    if search and search.strip():
        from sqlalchemy import or_

        search_term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AccessEvent.member_name.ilike(search_term),
                AccessEvent.device_enroll_number.ilike(search_term),
            )
        )

    # Merged-feed pagination: a row's overall rank can sit ahead of its
    # own leg's page-N window (the other leg may contribute many newer
    # rows), so BOTH legs are fetched from the top through this page and
    # the merged, re-sorted list is sliced. per_page is capped at 100 by
    # the endpoint; the per-leg fetch is capped at 2000 rows (V3-M11) —
    # pages past 2000/per_page are not reachable, by design, to bound
    # the memory of a deep-page request.
    fetch_limit = min(max(page, 1) * max(per_page, 1), 2000)
    access_total = query.count()
    access_rows = (
        query.order_by(AccessEvent.event_timestamp.desc())
        .limit(fetch_limit)
        .all()
    )
    events = [_serialize_access_event(evt) for evt in access_rows]

    # Also include ADMS attendance events (from direct-cloud terminals).
    # These live in RRRAttendanceEvent, not AccessEvent — but most of them
    # are ALREADY projected into AccessEvent (source_event_id
    # "rrr-attendance-<id>"), so this leg only backfills the unprojected
    # remainder. M13: the ADMS leg gets the SAME date filter as the
    # AccessEvent leg, true offset/limit pagination, and dedup against
    # projected rows — "Today" no longer shows all-time punches, page 2+
    # no longer repeats page 1, and total/total_pages count real rows.
    from datetime import timedelta

    from sqlalchemy import or_

    from app.models.mixins import utcnow as _utcnow
    from app.models.rrr import RRRAttendanceEvent

    if date_filter == "today":
        adms_since = utc_start_of_gym_day(gym_timezone)
    else:  # "all" or None — validated above
        adms_since = _utcnow() - timedelta(days=7)

    adms_events: list[dict] = []
    adms_total = 0
    # V5-L12 / V5-L28: the RRR leg backfills unprojected rows for BOTH
    # directions — entry rows when the caller wants entries (or all),
    # exit rows when it wants exits (or all). Denied has no RRR leg.
    # Each leg serializes via _serialize_rrr_event (real type +
    # direction), so an unprojected row can no longer render as an
    # ENTRY twin of its projected AccessEvent row.
    if event_type != "denied":
        _projected = _unprojected_rrr_exists(gym_id)
        for _leg_query, _leg_wanted in (
            (_rrr_entry_rows_query(gym_id), event_type in (None, "entry")),
            (_rrr_exit_rows_query(gym_id), event_type in (None, "exit")),
        ):
            if not _leg_wanted:
                continue
            adms_query = _leg_query
            if adms_since is not None:
                adms_query = adms_query.filter(
                    RRRAttendanceEvent.punch_time >= adms_since
                )
            if search and search.strip():
                term = f"%{search.strip()}%"
                adms_query = adms_query.outerjoin(
                    Member, RRRAttendanceEvent.member_id == Member.id
                ).filter(
                    or_(
                        Member.full_name.ilike(term),
                        RRRAttendanceEvent.biometric_user_id.ilike(term),
                    )
                )
            # Total = ADMS rows in the window that have NO AccessEvent
            # projection. A correlated EXISTS on source_event_id keeps
            # the count exact under every filter (date/search/type) —
            # counting projected rows separately would drift whenever
            # the two legs' search predicates differ (name vs
            # name-or-biometric-ID).
            # V3-M11: the same NOT EXISTS filter applies to the ROWS
            # query, not just the count. The old code fetched the most
            # recent 500 RAW rows and filtered projected ones out in
            # Python, so an unprojected punch older than the newest 500
            # raw rows was counted in the total but could never appear
            # on any page.
            adms_total += adms_query.filter(~_projected).count()

            # fetch_limit (both legs, from the top) is defined above.
            adms_rows = (
                adms_query.filter(~_projected)
                .order_by(RRRAttendanceEvent.punch_time.desc())
                .limit(fetch_limit)
                .all()
            )
            for evt in adms_rows:
                adms_events.append(_serialize_rrr_event(evt))

    # Re-sort merged events by timestamp (most recent first) and take
    # this page's slice. Both legs were fetched from the top through
    # this page, so the slice is exact (up to the 2000-row fetch cap).
    merged = sorted(
        events + adms_events,
        key=lambda e: e.get("event_timestamp") or "",
        reverse=True,
    )
    # V7-L19: collapse historical cross-source twins in the merged feed
    # (same punch projected via both bridge and ADMS before the V7-M9
    # twin check existed). The first row wins — the AccessEvent leg
    # sorts ahead of the RRR leg at equal timestamps. The total drops
    # by the duplicates removed within the fetched window.
    seen_punch_keys: set[str] = set()
    deduped_merged: list[dict] = []
    duplicates_removed = 0
    # V8-L16: whole-second twin keys for the AccessEvent leg. A
    # twin-skipped RRR row (bridge projected first) stays unprojected
    # forever, so the merged feed relies on punch_key equality — but the
    # bridge timestamp carries fractional seconds while the ADMS punch
    # is whole-second, so the keys differ and the twin renders twice.
    # Drop an RRR-leg row only when its punch is whole-second AND an
    # AccessEvent shares its enroll+type+direction+whole-second: a
    # fractional-second RRR punch in the same second is a genuinely
    # distinct punch (V4-L12's pair) and must stay.
    ae_second_keys = {
        _twin_second_key(
            row.get("device_enroll_number") or row.get("biometric_user_id"),
            row.get("event_timestamp"),
            row.get("event_type"),
            row.get("direction"),
        )
        for row in events
    }
    ae_second_keys.discard(None)
    for row in merged:
        key = row.get("punch_key") or _punch_key(
            row.get("biometric_user_id") or row.get("device_enroll_number"),
            row.get("event_timestamp"),
            row.get("event_type"),
            row.get("direction"),
        )
        if key in seen_punch_keys:
            duplicates_removed += 1
            continue
        if row.get("source") == "adms_direct":
            ts = _parse_timestamp_value(row.get("event_timestamp"))
            if ts is not None and _as_utc(ts).microsecond == 0:
                second_key = _twin_second_key(
                    row.get("biometric_user_id") or row.get("device_enroll_number"),
                    row.get("event_timestamp"),
                    row.get("event_type"),
                    row.get("direction"),
                )
                if second_key in ae_second_keys:
                    duplicates_removed += 1
                    continue
        seen_punch_keys.add(key)
        deduped_merged.append(row)
    merged = deduped_merged
    start = (page - 1) * per_page
    page_events = merged[start:start + per_page]

    # V8-L16 (documented, not fixed): duplicates_removed only counts
    # twins found inside the 2000-row fetch window, so on deep pages a
    # twin-skipped RRR row beyond the cap still inflates total /
    # total_pages. A precise fix needs a cross-dialect SQL twin count
    # (whole-second EXISTS over the full filtered window, Postgres
    # date_trunc vs SQLite strftime) — not attempted here because the
    # common case (twins within the fetched window, i.e. every recent
    # page) is now subtracted, and the residual only affects pages
    # near the 2000-row cap.
    total = access_total + adms_total - duplicates_removed
    return {
        "events": page_events,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": (total + per_page - 1) // per_page if per_page else 0,
        },
    }


def get_members_inside(
    gym_id: int,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str | None = None,
) -> dict:
    """Return paginated list of members currently inside the gym."""
    from sqlalchemy.orm import joinedload

    query = (
        MemberAccessState.query.filter_by(
            gym_id=gym_id,
            current_state="INSIDE",
        )
        .join(Member, MemberAccessState.member_id == Member.id)
        # V4-M10: a soft-deleted member must not appear named in the
        # Inside Now list, even if its state row was never expired.
        .filter(Member.deleted_at.is_(None))
        .options(joinedload(MemberAccessState.member))
    )

    # Search by member name — V5-M7: the base query above already
    # joins Member, so filter on the already-joined table. A second
    # unaliased join(Member) emitted two JOIN members and made
    # members.full_name ambiguous (500 on any Inside search).
    # V7-L17: also match the terminal enroll number, mirroring the
    # feed legs (V4-L12) — typing "42" must find inside member 42.
    if search and search.strip():
        from sqlalchemy import or_

        search_term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Member.full_name.ilike(search_term),
                Member.device_enroll_number.ilike(search_term),
            )
        )

    pagination = (
        query.order_by(MemberAccessState.last_entry_at.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )

    members = []
    for state in pagination.items:
        member = state.member
        if member is None:
            continue
        members.append({
            "id": member.id,
            "full_name": member.full_name,
            "phone": member.phone,
            "status": member.status,
            "entered_at": state.last_entry_at.isoformat() if state.last_entry_at else None,
            "has_biometric": bool(member.device_enroll_number),
        })

    return {
        "members": members,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": pagination.total,
            "total_pages": pagination.pages,
        },
    }


def _serialize_access_event(evt: AccessEvent) -> dict:
    """Serialize an AccessEvent for JSON response.

    V4-M10: a soft-deleted member's snapshot name must not leak into the
    feed — old AccessEvent rows keep member_name/member_id after the
    member is deleted, so hide both here (the row still shows as an
    unknown-ID event).
    """
    member = _live_member(evt.member) if evt.member_id is not None else None
    return {
        "id": evt.id,
        "event_type": evt.event_type,
        "direction": evt.direction,
        "event_timestamp": evt.event_timestamp.isoformat() if evt.event_timestamp else None,
        "member_id": member.id if member else None,
        "member_name": evt.member_name if member else None,
        # V11-L27 (event-rows half): the member's profile photo URL so
        # Android event rows can render the photo like the member
        # payload does (same resolver as the owner member serializer).
        # None when the member is unknown/deleted or has no photo.
        "profile_photo_url": member_profile_photo_url(member) if member else None,
        "membership_status": evt.membership_status if member else None,
        "device_name": evt.device_name,
        "device_enroll_number": evt.device_enroll_number,
        # Alias so both feed legs expose the terminal ID under one key —
        # the ADMS leg already sends biometric_user_id; without this the
        # PWA/Android could not show the ID for unmapped AccessEvent rows.
        "biometric_user_id": evt.device_enroll_number,
        "is_invalid": evt.is_invalid,
        "verify_method": evt.verify_method,
        # V7-L19: stable punch identity (see _punch_key).
        "punch_key": _punch_key(evt.device_enroll_number, evt.event_timestamp, evt.event_type, evt.direction),
    }


# ── Auto-reset stale "Inside" members ────────────────────────────────


def auto_reset_stale_inside_members(
    gym_id: int,
    gym_timezone: str,
    auto_exit_hour: int = 23,
) -> int:
    """Mark members as OUTSIDE if they entered before today's closing time.

    Many gyms have a single biometric terminal used only for entry scans.
    Without exit scans, ``MemberAccessState.current_state`` stays ``INSIDE``
    indefinitely.  This function resets stale entries by transitioning members
    whose ``last_entry_at`` is before the most recent gym closing time
    (default: 11 PM) to ``OUTSIDE``.

    Returns the number of members reset.

    The caller is responsible for committing the session.
    """
    from datetime import timedelta
    from zoneinfo import ZoneInfo

    try:
        tz = ZoneInfo(gym_timezone)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")

    now_local = datetime.now(tz)

    # Determine the most recent closing time in local tz
    closing_today = now_local.replace(
        hour=auto_exit_hour, minute=0, second=0, microsecond=0,
    )
    if now_local < closing_today:
        # Before today's closing → use yesterday's closing as the cutoff
        closing_cutoff = closing_today - timedelta(days=1)
    else:
        closing_cutoff = closing_today

    # Convert to UTC for the database comparison
    closing_cutoff_utc = closing_cutoff.astimezone(timezone.utc)

    # V7-L7: also catch rows whose last_entry_at is in the future
    # (beyond the same 15-minute skew the ADMS/bridge ingest bound
    # allows, V6-M11). Pre-fix clock-ahead terminals stored
    # future-dated punches that can never satisfy
    # ``last_entry_at < closing_cutoff``, so those members stayed
    # INSIDE forever with no repair path. A future entry is reset
    # with last_exit_at = now (not the past closing cutoff).
    now_utc = datetime.now(timezone.utc)
    from datetime import timedelta as _td

    _future_bound_utc = now_utc + _td(minutes=15)

    stale_members = MemberAccessState.query.filter(
        MemberAccessState.gym_id == gym_id,
        MemberAccessState.current_state == "INSIDE",
        or_(
            MemberAccessState.last_entry_at < closing_cutoff_utc,
            MemberAccessState.last_entry_at > _future_bound_utc,
        ),
    ).all()

    count = 0
    for state in stale_members:
        state.current_state = "OUTSIDE"
        # SQLite strips tzinfo on read: treat a naive stored value
        # as UTC before comparing with the aware bound.
        _entry_at = state.last_entry_at
        if _entry_at is not None and _entry_at.tzinfo is None:
            _entry_at = _entry_at.replace(tzinfo=timezone.utc)
        if _entry_at is not None and _entry_at > _future_bound_utc:
            state.last_exit_at = now_utc
        else:
            state.last_exit_at = closing_cutoff_utc
        count += 1

    if count:
        logger.info(
            "Auto-reset %d stale INSIDE member(s) for gym %s (cutoff: %s)",
            count, gym_id, closing_cutoff_utc.isoformat(),
        )

    return count


def backfill_missing_bridge_projections(
    gym_id: int,
    *,
    limit: int = 100,
    since_days: int = 7,
) -> int:
    """Re-project bridge punches that have no AccessEvent (V7-L16).

    A bridge punch whose projection threw at ingest used to be lost
    from the feed, the counts and the INSIDE flip forever — no later
    path re-projected it (``_backfill_bridge_punch`` only runs for
    unmapped rows). This sweep is called from the daily scheduler job;
    it is scoped to the last 7 days (the feed window) so ancient rows
    are never resurrected, per-row savepoint-contained, and idempotent
    (``process_attendance_to_access_event`` dedupes on
    ``source_event_id``). The caller is responsible for committing.
    Returns the number of projections created.
    """
    from datetime import timedelta

    cutoff = utcnow() - timedelta(days=since_days)
    projected = (
        db.session.query(AccessEvent.id)
        .filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.source_event_id == BridgeAttendance.event_id,
        )
        .exists()
    )
    rows = (
        BridgeAttendance.query.filter(
            BridgeAttendance.gym_id == gym_id,
            BridgeAttendance.event_time >= cutoff,
            ~projected,
        )
        .order_by(BridgeAttendance.event_time.asc())
        .limit(limit)
        .all()
    )
    created = 0
    for row in rows:
        try:
            with db.session.begin_nested():
                if process_attendance_to_access_event(row) is not None:
                    created += 1
        except Exception:
            logger.exception(
                "Bridge projection backfill failed for attendance %s",
                row.event_id,
            )
    if created:
        logger.info(
            "Backfilled %d missing bridge punch projection(s) for gym %s",
            created,
            gym_id,
        )
    return created


def backfill_missing_rrr_projections(
    gym_id: int,
    *,
    limit: int = 100,
    since_days: int = 7,
) -> int:
    """Re-project direct-ADMS punches that have no AccessEvent (V8-M8).

    Mirror of :func:`backfill_missing_bridge_projections` for the RRR
    leg. ``_ingest_attlog`` swallows projection exceptions (log-only,
    ack preserved), and ``process_rrr_attendance_to_access_event``'s
    existing-branch repair only runs on a terminal re-send — an acked
    ATTLOG batch is never re-sent, so a failed ADMS projection used to
    stay failed forever: the unprojected RRR feed leg still showed the
    punch and the summary still counted it, but ``MemberAccessState``
    never flipped INSIDE, member-app ``last_visit``/``today_entries``
    missed it (they query AccessEvent only), and Retain nudges keyed
    off Inside/attendance missed it. Same shape as the bridge sweep:
    scoped to the last 7 days (the feed window), per-row savepoint-
    contained, idempotent (``process_rrr_attendance_to_access_event``
    dedupes on ``source_event_id``). Twin-skipped rows are re-examined
    on every sweep — the twin branch returns None (not counted as
    created) but re-fills the twin's identity + INSIDE state when the
    member has since been linked. The caller is responsible for
    committing. Returns the number of projections created.
    """
    from datetime import timedelta

    from app.models.rrr import RRRAttendanceEvent

    cutoff = utcnow() - timedelta(days=since_days)
    rows = (
        RRRAttendanceEvent.query.filter(
            RRRAttendanceEvent.gym_id == gym_id,
            RRRAttendanceEvent.source == "adms_direct",
            RRRAttendanceEvent.punch_time >= cutoff,
            ~_unprojected_rrr_exists(gym_id),
        )
        .order_by(RRRAttendanceEvent.punch_time.asc())
        .limit(limit)
        .all()
    )
    created = 0
    for row in rows:
        try:
            with db.session.begin_nested():
                if process_rrr_attendance_to_access_event(row) is not None:
                    created += 1
        except Exception:
            logger.exception(
                "RRR projection backfill failed for rrr attendance %s",
                row.id,
            )
    if created:
        logger.info(
            "Backfilled %d missing RRR punch projection(s) for gym %s",
            created,
            gym_id,
        )
    return created


def has_legacy_attendance_events(gym_id: int) -> bool:
    """Return True if the gym has ATTENDANCE events (att_state=null).

    This indicates old bridge builds that don't report entry/exit direction.
    The mobile app uses this to show an info banner.
    """
    return db.session.query(
        AccessEvent.query.filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.event_type == "ATTENDANCE",
        ).exists()
    ).scalar() or False


def record_manual_access_event(
    *,
    gym_id: int,
    member_id: int,
    event_type: str = "ENTRY",
    actor_name: str = "Front Desk App",
) -> AccessEvent:
    """Record a front desk manual check-in or check-out directly from the app."""
    import uuid

    member = Member.query.filter_by(id=member_id, gym_id=gym_id).first()
    if not member:
        raise ValueError(f"Member {member_id} not found in gym {gym_id}")

    # Check expiration / validity
    # V4-M16: a paused (frozen) member is denied too — the old code only
    # checked expired, so staff could tap a frozen member and get a
    # successful ENTRY that marked them INSIDE, bypassing the freeze.
    if member.status in ("expired", "paused") or (member.days_until_expiry is not None and member.days_until_expiry < 0):
        actual_event_type = "ACCESS_DENIED"
        direction = "NONE"
    else:
        actual_event_type = "EXIT" if event_type.upper() == "EXIT" else "ENTRY"
        direction = "OUT" if actual_event_type == "EXIT" else "IN"

    now = utcnow()
    access_event = AccessEvent(
        gym_id=gym_id,
        member_id=member.id,
        bridge_id=None,
        event_type=actual_event_type,
        direction=direction,
        event_timestamp=now,
        received_timestamp=now,
        # V8-H1: verify_method is db.Integer (models/access_event.py:61)
        # — the old "MANUAL_CHECKIN" string stored fine on SQLite (type
        # affinity) but 500s on production Postgres (22P02) on flush, so
        # EVERY manual check-in failed live. None = no device verification.
        # V8-L17: never fabricate a terminal enroll number from the member
        # id. device_enroll_number is NOT NULL, so None would need a
        # migration; "" is the no-enrollment marker instead — it cannot
        # collide with any real enroll number (canonical enrolls are
        # non-empty digit strings), so a manual row can no longer
        # masquerade as terminal ID = member id in feed search or in
        # _find_punch_twin (a same-second real punch from enroll N used to
        # twin-match — and overwrite — the manual row for member-id N).
        device_enroll_number=member.device_enroll_number or "",
        source_event_id=f"manual-{uuid.uuid4().hex[:16]}",
        att_state=ATT_STATE_CHECK_OUT if direction == "OUT" else ATT_STATE_CHECK_IN,
        verify_method=None,
        is_invalid=(actual_event_type == "ACCESS_DENIED"),
        member_name=member.full_name,
        membership_status=member.status,
        device_name=actor_name,
    )
    db.session.add(access_event)
    db.session.flush()

    if actual_event_type in ("ENTRY", "EXIT"):
        _update_member_access_state(
            gym_id=gym_id,
            member_id=member.id,
            access_event=access_event,
            event_type=actual_event_type,
        )

    db.session.commit()
    logger.info(
        "Manual AccessEvent created: gym=%s member=%s type=%s direction=%s actor=%s",
        gym_id, member.id, actual_event_type, direction, actor_name,
    )
    return access_event

