"""Comprehensive test suite for the Live Access / Entry & Exit feature.

Covers:
1. Entry event processing and member access state transitions
2. Exit event processing and state update
3. Access denied handling (is_invalid=True)
4. Unknown member event handling (graceful handling, no crash)
5. Event deduplication via source_event_id idempotency
6. Multiple entry/exit cycles (INSIDE -> OUTSIDE -> INSIDE)
7. Out-of-order event handling (older events don't overwrite newer state)
8. Legacy bridge attendance without attState (ATTENDANCE classification)
9. Tenant isolation (two gyms cannot see each other's events or counts)
10. Bridge API ingestion with attState end-to-end
11. Mobile API /access/summary endpoint
12. Mobile API /access/events endpoint with filters (entry, exit, denied)
13. Mobile API /access/inside endpoint
14. Mobile API /dashboard includes access_summary
15. Mobile API unauthorized access rejection
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import uuid

import pytest

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Gym, User, Member, MembershipPlan, BridgeInstallation, BridgeAttendance
from app.models.access_event import AccessEvent
from app.models.member_access_state import MemberAccessState
from app.services.access_event_service import (
    process_attendance_to_access_event,
    get_access_summary,
    get_access_events,
    get_members_inside,
)


@pytest.fixture
def seed_bridge(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "Main Entrance", "SERIAL-ENTRANCE-01"
    )
    db.session.add(installation)
    db.session.commit()
    return {"installation": installation, "api_key": api_key}


def _bridge_headers(api_key: str, serial: str = "SERIAL-ENTRANCE-01") -> dict[str, str]:
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": serial,
    }


def _auth_headers(user, gym) -> dict[str, str]:
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


# ─── 1. Entry Event Processing ─────────────────────────────────────────

def test_entry_event_processing(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "101"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    attendance = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        member_id=member.id,
        device_enroll_number="101",
        event_time=now,
        event_id=str(uuid.uuid4()),
        verify_method=1,
        att_state=0,  # CheckIn
        is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()

    event = process_attendance_to_access_event(attendance)
    db.session.commit()

    assert event is not None
    assert event.event_type == "ENTRY"
    assert event.direction == "IN"
    assert event.member_id == member.id
    assert event.member_name == member.full_name

    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    assert state is not None
    assert state.current_state == "INSIDE"
    assert state.last_entry_at is not None


# ─── 2. Exit Event Processing ──────────────────────────────────────────

def test_exit_event_processing(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "102"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id

    # First enter
    t1 = datetime.now(timezone.utc) - timedelta(hours=1)
    att1 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        member_id=member.id,
        device_enroll_number="102",
        event_time=t1,
        event_id=str(uuid.uuid4()),
        verify_method=1,
        att_state=0,
        is_invalid=False,
    )
    db.session.add(att1)
    db.session.flush()
    process_attendance_to_access_event(att1)

    # Then exit
    t2 = datetime.now(timezone.utc)
    att2 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        member_id=member.id,
        device_enroll_number="102",
        event_time=t2,
        event_id=str(uuid.uuid4()),
        verify_method=1,
        att_state=1,  # CheckOut
        is_invalid=False,
    )
    db.session.add(att2)
    db.session.flush()
    event2 = process_attendance_to_access_event(att2)
    db.session.commit()

    assert event2 is not None
    assert event2.event_type == "EXIT"
    assert event2.direction == "OUT"

    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    assert state is not None
    assert state.current_state == "OUTSIDE"
    assert state.last_exit_at is not None


# ─── 3. Access Denied Handling ─────────────────────────────────────────

def test_access_denied_handling(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "103"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    attendance = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        member_id=member.id,
        device_enroll_number="103",
        event_time=now,
        event_id=str(uuid.uuid4()),
        verify_method=1,
        att_state=0,
        is_invalid=True,  # Access denied at hardware
    )
    db.session.add(attendance)
    db.session.flush()

    event = process_attendance_to_access_event(attendance)
    db.session.commit()

    assert event is not None
    assert event.event_type == "ACCESS_DENIED"
    assert event.direction == "UNKNOWN"
    assert event.is_invalid is True

    # State must NOT become INSIDE
    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    assert state is None


# ─── 4. Unknown Member Handling ────────────────────────────────────────

def test_unknown_member_handling(seed_gym, seed_bridge):
    gym = seed_gym["gym"]
    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    attendance = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        device_enroll_number="99999",  # Unregistered card/finger
        event_time=now,
        event_id=str(uuid.uuid4()),
        verify_method=1,
        att_state=0,
        is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()

    event = process_attendance_to_access_event(attendance)
    db.session.commit()

    assert event is not None
    assert event.member_id is None
    assert event.device_enroll_number == "99999"
    assert event.event_type == "ENTRY"


# ─── 5. Deduplication Idempotency ──────────────────────────────────────

def test_event_deduplication(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "104"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    evt_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    att = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id,
        member_id=member.id,
        device_enroll_number="104",
        event_time=now,
        event_id=evt_id,
        verify_method=1,
        att_state=0,
        is_invalid=False,
    )
    db.session.add(att)
    db.session.flush()

    first = process_attendance_to_access_event(att)
    second = process_attendance_to_access_event(att)
    db.session.commit()

    assert first is not None
    assert second is None  # Deduplicated

    count = AccessEvent.query.filter_by(gym_id=gym.id, source_event_id=evt_id).count()
    assert count == 1


# ─── 6. Multiple Entry/Exit Cycles ─────────────────────────────────────

def test_multiple_entry_exit_cycles(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "105"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    base = datetime.now(timezone.utc) - timedelta(hours=5)

    # 1. Enter morning
    att1 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="105",
        event_time=base, event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att1)
    db.session.flush()
    process_attendance_to_access_event(att1)

    # 2. Exit morning
    att2 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="105",
        event_time=base + timedelta(hours=1), event_id=str(uuid.uuid4()), verify_method=1, att_state=1, is_invalid=False,
    )
    db.session.add(att2)
    db.session.flush()
    process_attendance_to_access_event(att2)

    # 3. Enter evening
    att3 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="105",
        event_time=base + timedelta(hours=4), event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att3)
    db.session.flush()
    process_attendance_to_access_event(att3)
    db.session.commit()

    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    assert state.current_state == "INSIDE"


# ─── 7. Out-of-Order Event Protection ──────────────────────────────────

def test_out_of_order_event_protection(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "106"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    old_time = now - timedelta(hours=2)

    # Newer EXIT event arrives first
    att_newer = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="106",
        event_time=now, event_id=str(uuid.uuid4()), verify_method=1, att_state=1, is_invalid=False,
    )
    db.session.add(att_newer)
    db.session.flush()
    process_attendance_to_access_event(att_newer)

    # Older ENTRY arrives later (delayed sync / offline buffer)
    att_older = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="106",
        event_time=old_time, event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att_older)
    db.session.flush()
    process_attendance_to_access_event(att_older)
    db.session.commit()

    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    # Must remain OUTSIDE because the EXIT was newer than ENTRY
    assert state.current_state == "OUTSIDE"


# ─── 8. Legacy Bridge Attendance Without att_state ─────────────────────

def test_legacy_bridge_attendance_without_att_state(seed_gym, seed_member, seed_bridge):
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "107"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    att = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="107",
        event_time=now, event_id=str(uuid.uuid4()), verify_method=1, att_state=None, is_invalid=False,
    )
    db.session.add(att)
    db.session.flush()
    event = process_attendance_to_access_event(att)
    db.session.commit()

    assert event.event_type == "ATTENDANCE"
    assert event.direction == "UNKNOWN"

    state = MemberAccessState.query.filter_by(gym_id=gym.id, member_id=member.id).first()
    assert state.current_state == "INSIDE"


# ─── 9. Tenant Isolation ───────────────────────────────────────────────

def test_tenant_isolation_access_events(seed_gym, seed_member, seed_bridge):
    gym1 = seed_gym["gym"]
    bridge1_id = seed_bridge["installation"].id
    member1 = seed_member
    member1.device_enroll_number = "108"

    # Create Gym 2
    gym2 = Gym(
        name="Gym 2", slug="gym-2", email="gym2@test.com", phone="+919000000002",
        status="active", subscription_status="trial",
        trial_ends_at=datetime.now(timezone.utc).date() + timedelta(days=14),
    )
    db.session.add(gym2)
    db.session.flush()

    bridge2, _ = BridgeInstallation.create_for_gym(
        gym2.id, "Gym 2 Entrance", "SERIAL-GYM2-01"
    )
    db.session.add(bridge2)
    db.session.commit()

    now = datetime.now(timezone.utc)
    att = BridgeAttendance(
        bridge_id=bridge1_id,
        gym_id=gym1.id, member_id=member1.id, device_enroll_number="108",
        event_time=now, event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att)
    db.session.flush()
    process_attendance_to_access_event(att)
    db.session.commit()

    # Gym 1 summary should have 1 entry
    summary1 = get_access_summary(gym1.id, "Asia/Kolkata")
    assert summary1["entries_today"] == 1
    assert summary1["inside_now"] == 1

    # Gym 2 summary must be 0
    summary2 = get_access_summary(gym2.id, "Asia/Kolkata")
    assert summary2["entries_today"] == 0
    assert summary2["inside_now"] == 0

    events2 = get_access_events(gym2.id, "Asia/Kolkata")
    assert len(events2["events"]) == 0


# ─── 10. Bridge API Ingestion with attState End-to-End ─────────────────

def test_bridge_api_ingests_att_state(client, seed_gym, seed_member, seed_bridge):
    installation = seed_bridge["installation"]
    api_key = seed_bridge["api_key"]
    member = seed_member
    member.device_enroll_number = "109"
    db.session.commit()

    event_id = str(uuid.uuid4())
    event_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    res = client.post(
        "/api/bridge/v1/attendance",
        headers=_bridge_headers(api_key),
        json={
            "gymId": installation.public_id,
            "eventId": event_id,
            "deviceEnrollNumber": "109",
            "eventTime": event_time,
            "verifyMethod": 1,
            "attState": 0,
            "isInvalid": False,
        },
    )

    assert res.status_code == 201
    assert res.get_json()["ok"] is True

    # Check that AccessEvent was created automatically
    access_event = AccessEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, source_event_id=event_id
    ).first()
    assert access_event is not None
    assert access_event.event_type == "ENTRY"
    assert access_event.direction == "IN"
    assert access_event.att_state == 0


# ─── 11. Mobile API /access/summary ────────────────────────────────────

def test_mobile_api_access_summary(client, seed_gym, seed_member, seed_bridge):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "110"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    att = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="110",
        event_time=now, event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att)
    db.session.flush()
    process_attendance_to_access_event(att)
    db.session.commit()

    res = client.get("/api/mobile/v1/access/summary", headers=_auth_headers(owner, gym))
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["inside_now"] == 1
    assert data["entries_today"] == 1
    assert data["exits_today"] == 0
    assert data["denied_today"] == 0


# ─── 12. Mobile API /access/events with Filters ────────────────────────

def test_mobile_api_access_events_and_filters(client, seed_gym, seed_member, seed_bridge):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "111"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)

    # 1 Entry
    att1 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="111",
        event_time=now - timedelta(minutes=30), event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    # 1 Denied
    att2 = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="111",
        event_time=now - timedelta(minutes=15), event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=True,
    )
    db.session.add_all([att1, att2])
    db.session.flush()
    process_attendance_to_access_event(att1)
    process_attendance_to_access_event(att2)
    db.session.commit()

    # All events
    res_all = client.get("/api/mobile/v1/access/events", headers=_auth_headers(owner, gym))
    assert res_all.status_code == 200
    assert len(res_all.get_json()["data"]["events"]) == 2

    # Filter entry
    res_entry = client.get("/api/mobile/v1/access/events?type=entry", headers=_auth_headers(owner, gym))
    assert res_entry.status_code == 200
    events_entry = res_entry.get_json()["data"]["events"]
    assert len(events_entry) == 1
    assert events_entry[0]["event_type"] == "ENTRY"

    # Filter denied
    res_denied = client.get("/api/mobile/v1/access/events?type=denied", headers=_auth_headers(owner, gym))
    assert res_denied.status_code == 200
    events_denied = res_denied.get_json()["data"]["events"]
    assert len(events_denied) == 1
    assert events_denied[0]["event_type"] == "ACCESS_DENIED"


# ─── 13. Mobile API /access/inside ────────────────────────────────────

def test_mobile_api_access_inside(client, seed_gym, seed_member, seed_bridge):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]
    member = seed_member
    member.device_enroll_number = "112"
    db.session.commit()

    bridge_id = seed_bridge["installation"].id
    now = datetime.now(timezone.utc)
    att = BridgeAttendance(
        bridge_id=bridge_id,
        gym_id=gym.id, member_id=member.id, device_enroll_number="112",
        event_time=now, event_id=str(uuid.uuid4()), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(att)
    db.session.flush()
    process_attendance_to_access_event(att)
    db.session.commit()

    res = client.get("/api/mobile/v1/access/inside", headers=_auth_headers(owner, gym))
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert len(data["members"]) == 1
    assert data["members"][0]["full_name"] == member.full_name


# ─── 14. Mobile Dashboard Includes access_summary ──────────────────────

def test_mobile_dashboard_includes_access_summary(client, seed_gym):
    owner = seed_gym["owner"]
    gym = seed_gym["gym"]

    res = client.get("/api/mobile/v1/dashboard", headers=_auth_headers(owner, gym))
    assert res.status_code == 200
    data = res.get_json()
    assert "access_summary" in data["data"]
    assert "inside_now" in data["data"]["access_summary"]
    assert "entries_today" in data["data"]["access_summary"]
    assert "exits_today" in data["data"]["access_summary"]
    assert "denied_today" in data["data"]["access_summary"]


# ─── 15. Unauthorized Access Rejection ─────────────────────────────────

def test_mobile_access_endpoints_require_auth(client):
    res_summary = client.get("/api/mobile/v1/access/summary")
    res_events = client.get("/api/mobile/v1/access/events")
    res_inside = client.get("/api/mobile/v1/access/inside")

    assert res_summary.status_code == 401
    assert res_events.status_code == 401
    assert res_inside.status_code == 401
