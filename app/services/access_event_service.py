"""Access event processing pipeline.

Transforms raw ``BridgeAttendance`` records into semantic ``AccessEvent``
entries and maintains the ``MemberAccessState`` for "currently inside"
queries.  Every operation is idempotent: re-processing the same attendance
record produces no duplicate access events.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func

from app.extensions import db
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance, BridgeInstallation
from app.models.member import Member
from app.models.member_access_state import MemberAccessState
from app.models.mixins import utcnow
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
    """Find the Renewal Desk member by device enroll number."""
    return Member.query.filter_by(
        gym_id=gym_id,
        device_enroll_number=device_enroll_number,
    ).first()


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

    # Update state
    if event_type == "ENTRY":
        state.current_state = "INSIDE"
        state.last_entry_at = access_event.event_timestamp
    elif event_type == "EXIT":
        state.current_state = "OUTSIDE"
        state.last_exit_at = access_event.event_timestamp

    state.last_event_id = access_event.id
    state.last_event_timestamp = access_event.event_timestamp


# ── Query helpers for the mobile API ──────────────────────────────────


def get_access_summary(gym_id: int, gym_timezone: str) -> dict:
    """Return summary counts for the Live Access dashboard card."""
    day_start_utc = utc_start_of_gym_day(gym_timezone)

    inside_now = MemberAccessState.query.filter_by(
        gym_id=gym_id,
        current_state="INSIDE",
    ).count()

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
    """Return paginated access events for the feed."""
    query = AccessEvent.query.filter_by(gym_id=gym_id)

    # Filter by event type
    if event_type == "entry":
        query = query.filter(AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]))
    elif event_type == "exit":
        query = query.filter_by(event_type="EXIT")
    elif event_type == "denied":
        query = query.filter_by(event_type="ACCESS_DENIED")

    # Filter by date (default: today)
    if date_filter == "today" or date_filter is None:
        day_start_utc = utc_start_of_gym_day(gym_timezone)
        query = query.filter(AccessEvent.event_timestamp >= day_start_utc)
    elif date_filter == "all":
        pass  # No date filter

    # Search by member name
    if search and search.strip():
        search_term = f"%{search.strip()}%"
        query = query.filter(AccessEvent.member_name.ilike(search_term))

    # Order by most recent first
    pagination = (
        query.order_by(AccessEvent.event_timestamp.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )

    events = []
    for evt in pagination.items:
        events.append(_serialize_access_event(evt))

    return {
        "events": events,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": pagination.total,
            "total_pages": pagination.pages,
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
        .options(joinedload(MemberAccessState.member))
    )

    # Search by member name
    if search and search.strip():
        search_term = f"%{search.strip()}%"
        query = query.join(Member).filter(Member.full_name.ilike(search_term))

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
    """Serialize an AccessEvent for JSON response."""
    return {
        "id": evt.id,
        "event_type": evt.event_type,
        "direction": evt.direction,
        "event_timestamp": evt.event_timestamp.isoformat() if evt.event_timestamp else None,
        "member_id": evt.member_id,
        "member_name": evt.member_name,
        "membership_status": evt.membership_status,
        "device_name": evt.device_name,
        "device_enroll_number": evt.device_enroll_number,
        "is_invalid": evt.is_invalid,
        "verify_method": evt.verify_method,
    }
