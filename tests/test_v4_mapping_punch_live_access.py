"""Regression tests for deep-review v4 mapping / punch / Live Access findings.

Covers V4-M5..M10, V4-M16 (backend note), V4-M21, V4-M22, V4-L9..L13.
Nothing here touches production data or the live terminal: every serial,
enroll number and member is synthetic.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models import BridgeInstallation, Member
from app.models.access_event import AccessEvent
from app.models.bridge import BridgeAttendance, BridgeCommand
from app.models.member_access_state import MemberAccessState
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRAttendanceEvent,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.mobile_api.token_service import create_access_token
from app.services import enroll_match_service
from app.services.access_event_service import (
    _resolve_member,
    get_access_events,
    get_access_summary,
    get_members_inside,
    process_attendance_to_access_event,
    record_manual_access_event,
)
from app.services.bridge_service import find_member_by_enroll_number
from app.services.rrr_service import (
    _dedupe_key,
    normalize_attendance,
    remap_unresolved,
)

UTC = timezone.utc


def _now():
    return datetime.now(UTC)


def _member(seed_gym, *, name, phone="+910000000201", enroll=None, status="active",
            end=None, deleted=False):
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
    if deleted:
        member.deleted_at = utcnow()
        member.status = "deleted"
    db.session.add(member)
    db.session.commit()
    return member


def _auth_headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _integration(seed_gym, *, serial="V4-TEST-X2008", status="connected"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V4 Test ADMS",
        device_serial=serial,
        device_name="V4 Test X2008",
        status=status,
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        last_success_at=_now(),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _installation(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V4 Test Bridge", "V4-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "V4-SERIAL-01",
    }


# ── V4-M5: bridge leg canonicalization ──────────────────────────────────


def test_m5_bridge_punch_attributes_padded_member(seed_gym):
    """A member stored as "042" punching "42" on a bridge resolves."""
    member = _member(seed_gym, name="Padded Holder", phone="+910000000202", enroll="042")
    installation, _key = _installation(seed_gym)
    attendance = BridgeAttendance(
        bridge_id=installation.id,
        gym_id=seed_gym["gym"].id,
        member_id=None,
        event_id="v4-m5-evt-1",
        device_enroll_number="42",
        event_time=_now(),
        verify_method=1,
        att_state=0,
        is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    event = process_attendance_to_access_event(attendance)
    db.session.commit()
    assert event is not None
    assert event.member_id == member.id
    assert event.member_name == "Padded Holder"


def test_m5_bridge_attendance_endpoint_knows_padded_member(client, seed_gym):
    installation, api_key = _installation(seed_gym)
    _member(seed_gym, name="Padded Holder", phone="+910000000203", enroll="042")
    payload = {
        "gymId": installation.public_id,
        "eventId": "v4-m5-evt-2",
        "deviceEnrollNumber": "42",
        "eventTime": _now().isoformat(),
        "verifyMethod": 1,
        "isInvalid": False,
    }
    resp = client.post(
        "/api/bridge/v1/attendance", json=payload, headers=_bridge_headers(api_key)
    )
    assert resp.status_code == 201
    assert resp.json["knownMember"] is True


def test_m5_bridge_command_endpoint_resolves_padded_member(client, seed_gym):
    """POST /settings/bridge/commands with enroll "42" finds stored "042"."""
    _installation(seed_gym)
    _member(seed_gym, name="Padded Holder", phone="+910000000204", enroll="042")
    resp = client.post(
        "/api/mobile/v1/settings/bridge/commands",
        json={"command_type": "enable_user", "enroll_number": "42"},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code in (200, 201), resp.get_data(as_text=True)


# ── V4-M6: canonical mapping lookups + conflict report ──────────────────


def test_m6_mapped_member_resolves_padded_mapping(seed_gym):
    """A confirmed mapping stored as "042" resolves a punch for "42"."""
    member = _member(seed_gym, name="Mapped Member", phone="+910000000205")
    db.session.add(RRRIdentityMapping(
        gym_id=seed_gym["gym"].id, external_id="042", member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=_now(),
        device_serial="V4-TEST-X2008",
    )
    assert created is True
    assert event.member_id == member.id


def test_m6_guard3_canonical_mapping_blocks_live_holder(seed_gym):
    """A confirmed mapping "042" to a LIVE member blocks remap of "42"."""
    holder = _member(seed_gym, name="Holder", phone="+910000000206")
    db.session.add(RRRIdentityMapping(
        gym_id=seed_gym["gym"].id, external_id="042", member_id=holder.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    other = _member(seed_gym, name="Other", phone="+910000000207")
    with pytest.raises(ValueError, match="already linked"):
        remap_unresolved(seed_gym["gym"].id, "42", other, seed_gym["owner"].id)


def test_m6_conflict_report_lists_padded_pair(seed_gym):
    """The new migration's reporter finds members holding "042" + "42"."""
    import importlib.util
    from pathlib import Path

    _member(seed_gym, name="First", phone="+910000000208", enroll="042")
    _member(seed_gym, name="Second", phone="+910000000209", enroll="42")
    path = Path(__file__).parent.parent / (
        "migrations/versions/v4a3a3_conflicting_canonical_pairs.py"
    )
    assert path.exists()
    spec = importlib.util.spec_from_file_location("v4a3a3_conflicts", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "v4a3a3conflicts"
    assert module.down_revision == "m3rg3v3fixall"
    conn = db.session.connection()
    conflicts = module._conflicts(conn, "members", "id", "device_enroll_number")
    assert (seed_gym["gym"].id, "42") in conflicts
    holders = conflicts[(seed_gym["gym"].id, "42")]
    assert {raw for _, raw in holders} == {"042", "42"}


# ── V4-M7: auto-link throttle / cache / targeted ingest scan ────────────


def _snapshot(seed_gym, users):
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


def test_m7_suggest_matches_cached_within_60s(seed_gym):
    _snapshot(seed_gym, [{"user_id": "42", "name": "Ramesh Kumar"}])
    _member(seed_gym, name="Ramesh Kumar", phone="+910000000210")
    enroll_match_service._SUGGEST_CACHE.clear()
    first = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert first.get("cached") is not True
    assert len(first["suggestions"]) == 1
    second = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert second.get("cached") is True
    assert second["suggestions"] == first["suggestions"]


def test_m7_auto_link_endpoint_gated_on_throttle(client, seed_gym):
    enroll_match_service._AUTO_LINK_LAST_RUN.clear()
    headers = _auth_headers(seed_gym["owner"], seed_gym["gym"])
    first = client.post(
        "/api/mobile/v1/rrr/enroll-matches/auto-link", json={},
        headers=headers,
    )
    assert first.status_code == 200
    second = client.post(
        "/api/mobile/v1/rrr/enroll-matches/auto-link", json={},
        headers=headers,
    )
    assert second.status_code == 200
    assert second.json["data"].get("throttled") is True
    assert second.json["data"]["linked"] == []


def test_m7_snapshot_status_endpoint_is_cheap(client, seed_gym):
    headers = _auth_headers(seed_gym["owner"], seed_gym["gym"])
    resp = client.get(
        "/api/mobile/v1/rrr/enroll-snapshot-status", headers=headers
    )
    assert resp.status_code == 200
    assert resp.json["data"]["has_snapshot"] is False
    _snapshot(seed_gym, [{"user_id": "42", "name": "Ramesh Kumar"}])
    resp = client.get(
        "/api/mobile/v1/rrr/enroll-snapshot-status", headers=headers
    )
    assert resp.status_code == 200
    assert resp.json["data"]["has_snapshot"] is True
    assert resp.json["data"]["terminal_user_count"] == 1


def test_m7_ingest_autolink_scoped_to_punch_id(seed_gym):
    """A punch for 42 links ONLY via the targeted matcher (no full scan)."""
    _snapshot(seed_gym, [{"user_id": "42", "name": "Ramesh Kumar"}])
    member = _member(seed_gym, name="Ramesh Kumar", phone="+910000000211")
    enroll_match_service._AUTO_LINK_LAST_RUN.clear()
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=_now(),
        device_serial="V4-TEST-X2008",
    )
    assert created is True
    assert event.member_id == member.id
    assert db.session.get(Member, member.id).device_enroll_number == "42"


# ── V4-M8 / V4-L13: legacy dedupe probes ────────────────────────────────


def _old_format_key(serial, enroll, punch_time):
    stable = "|".join((serial, enroll, punch_time.isoformat()))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def test_m8_resend_of_yodha_migrated_row_dedupes(seed_gym):
    """A row stored under the old (pre-L8) key dedupes on re-send."""
    t = _now()
    row = RRRAttendanceEvent(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        device_serial="V4-TEST-X2008", biometric_user_id="42",
        punch_time=t, dedupe_key=_old_format_key("V4-TEST-X2008", "42", t),
        processing_status="unmapped",
    )
    db.session.add(row)
    db.session.commit()
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t,
        device_serial="V4-TEST-X2008", direction="0",
    )
    assert created is False
    assert event.id == row.id


def test_l13_same_punch_direction_present_vs_absent_dedupes(seed_gym):
    """A punch first seen with NO direction dedupes when re-sent WITH one."""
    t = _now()
    first, created_first = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t,
        device_serial="V4-TEST-X2008", direction=None,
    )
    assert created_first is True
    second, created_second = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t,
        device_serial="V4-TEST-X2008", direction="0",
    )
    assert created_second is False
    assert second.id == first.id


def test_l13_entry_and_exit_same_second_stay_distinct(seed_gym):
    """The direction-less probe must NOT collapse a real entry+exit pair."""
    t = _now()
    entry, created_entry = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t,
        device_serial="V4-TEST-X2008", direction="0",
    )
    exit_evt, created_exit = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t,
        device_serial="V4-TEST-X2008", direction="1",
    )
    assert created_entry is True
    assert created_exit is True
    assert entry.id != exit_evt.id


# ── V4-M9: ATTLOG truncation ────────────────────────────────────────────


def test_m9_attlog_lines_not_truncated_at_256k(app, seed_gym):
    """A >256 KB ATTLOG body is fully parsed, not silently cut off."""
    from app.adms.routes import _attlog_lines

    line = "42\t2026-11-05 10:00:00\t0\t1"
    body = "\n".join([line] * 11000)
    assert len(body) > 262144
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=body, content_type="text/plain"
    ):
        lines = _attlog_lines()
    assert len(lines) == 11000


def test_m9_ingest_counts_skipped_lines(app, seed_gym, caplog):
    """Malformed ATTLOG lines are logged, not silently dropped."""
    import logging

    from app.adms.routes import _ingest_attlog

    integration = _integration(seed_gym)
    body = (
        "42\t2026-11-05 10:00:00\t0\t1\n"
        "garbage-no-tabs\n"
        "43\t2026-11-05 10:01:00\t0\t1\n"
    )
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=body, content_type="text/plain"
    ):
        with caplog.at_level(logging.WARNING):
            created = _ingest_attlog(integration)
    assert created == 2
    assert "skipped 1 malformed" in caplog.text


# ── V4-M10: deleted members hidden in Live Access reads ─────────────────


def _inside_deleted_setup(seed_gym):
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Deleted Inside", phone="+910000000212",
                     enroll="45")
    db.session.add(AccessEvent(
        gym_id=gym_id, member_id=member.id, event_type="ENTRY", direction="IN",
        event_timestamp=_now(), received_timestamp=_now(),
        device_enroll_number="45", source_event_id="v4-m10-evt-1",
        member_name="Deleted Inside", membership_status="active",
    ))
    db.session.add(MemberAccessState(
        gym_id=gym_id, member_id=member.id, current_state="INSIDE",
        last_entry_at=_now(),
    ))
    db.session.commit()
    member.deleted_at = utcnow()
    member.status = "deleted"
    db.session.commit()
    return member


def test_m10_deleted_member_hidden_in_feed_inside_and_count(seed_gym):
    _inside_deleted_setup(seed_gym)
    gym_id = seed_gym["gym"].id
    feed = get_access_events(gym_id, "Asia/Kolkata", date_filter="all")
    assert feed["pagination"]["total"] == 1
    row = feed["events"][0]
    assert row["member_id"] is None
    assert row["member_name"] is None
    inside = get_members_inside(gym_id)
    assert inside["members"] == []
    summary = get_access_summary(gym_id, "Asia/Kolkata")
    assert summary["inside_now"] == 0


def test_m10_deactivate_expires_inside_state(client, seed_gym):
    member = _member(seed_gym, name="To Delete", phone="+910000000213", enroll="46")
    db.session.add(MemberAccessState(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        current_state="INSIDE", last_entry_at=_now(),
    ))
    db.session.commit()
    resp = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200
    state = MemberAccessState.query.filter_by(
        gym_id=seed_gym["gym"].id, member_id=member.id
    ).first()
    assert state is not None
    assert state.current_state == "OUTSIDE"


# ── V4-M21 (REGRESSION): linked-then-deleted holder frees the ID ───────


def test_m21_remap_frees_deleted_holder_with_enroll_and_mapping(seed_gym):
    """REAL case: deleted member WITH device_enroll_number set AND a
    confirmed mapping still pointing at them (the v3 test's deleted
    member had no enroll number, which is why it passed while the bug
    lived). Remapping the ID to a live member must succeed."""
    gym_id = seed_gym["gym"].id
    deleted = _member(seed_gym, name="Old Deleted", phone="+910000000214",
                      enroll="101", deleted=True)
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="101", member_id=deleted.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    live = _member(seed_gym, name="Live Member", phone="+910000000215")
    resolved = remap_unresolved(gym_id, "101", live, seed_gym["owner"].id)
    db.session.commit()
    assert resolved == 0
    assert db.session.get(Member, live.id).device_enroll_number == "101"
    assert db.session.get(Member, deleted.id).device_enroll_number is None
    mapping = RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="101", status="confirmed"
    ).first()
    assert mapping is not None
    assert mapping.member_id == live.id


def test_m21_remap_frees_deleted_holder_with_enroll_no_mapping(seed_gym):
    """Pure ID-101 case: deleted holder keeps enroll "101", no mapping row."""
    gym_id = seed_gym["gym"].id
    deleted = _member(seed_gym, name="Old Deleted", phone="+910000000216",
                      enroll="101", deleted=True)
    live = _member(seed_gym, name="Live Member", phone="+910000000217")
    resolved = remap_unresolved(gym_id, "101", live, seed_gym["owner"].id)
    db.session.commit()
    assert resolved == 0
    assert db.session.get(Member, live.id).device_enroll_number == "101"
    assert db.session.get(Member, deleted.id).device_enroll_number is None


def test_m21_enroll_endpoint_frees_deleted_holder_with_mapping(client, seed_gym):
    gym_id = seed_gym["gym"].id
    deleted = _member(seed_gym, name="Old Deleted", phone="+910000000218",
                      enroll="101", deleted=True)
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="101", member_id=deleted.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    live = _member(seed_gym, name="Live Member", phone="+910000000219")
    resp = client.post(
        f"/api/mobile/v1/members/{live.id}/enroll",
        json={"enroll_number": "101"},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert db.session.get(Member, live.id).device_enroll_number == "101"
    assert db.session.get(Member, deleted.id).device_enroll_number is None


def test_m21_live_holder_still_blocks(seed_gym):
    """The freeing rule is deleted-holders only — a live holder still 409s."""
    _member(seed_gym, name="Live Holder", phone="+910000000220", enroll="101")
    other = _member(seed_gym, name="Other", phone="+910000000221")
    with pytest.raises(ValueError, match="already linked to Live Holder"):
        remap_unresolved(seed_gym["gym"].id, "101", other, seed_gym["owner"].id)


# ── V4-M22 (REGRESSION): bridge punches counted/shown exactly once ─────


def test_m22_bridge_punch_counted_once_in_summary_and_feed(seed_gym):
    """A bridge punch must appear exactly once in entries_today and feed."""
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Bridge Member", phone="+910000000222",
                     enroll="42")
    installation, _key = _installation(seed_gym)
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=member.id,
        event_id="v4-m22-evt-1", device_enroll_number="42",
        event_time=_now(), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    process_attendance_to_access_event(attendance)
    normalize_attendance(
        gym_id=gym_id, source="direct_bridge", biometric_user_id="42",
        punch_time=attendance.event_time, external_event_id="v4-m22-evt-1",
        device_serial="V4-SERIAL-01", direction="0", verify_method="1",
    )
    db.session.commit()
    summary = get_access_summary(gym_id, "Asia/Kolkata")
    assert summary["entries_today"] == 1
    feed = get_access_events(gym_id, "Asia/Kolkata", date_filter="today")
    assert feed["pagination"]["total"] == 1


def test_m22_adms_exit_row_not_counted_as_entry(seed_gym):
    """An unprojected ADMS exit-direction punch is not an entry."""
    gym_id = seed_gym["gym"].id
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="7",
        punch_time=_now(), device_serial="V4-TEST-X2008", direction="1",
    )
    db.session.commit()
    summary = get_access_summary(gym_id, "Asia/Kolkata")
    assert summary["entries_today"] == 0
    feed = get_access_events(gym_id, "Asia/Kolkata", date_filter="today")
    assert feed["pagination"]["total"] == 0


# ── V4-L9: second holder of the same canonical ID ───────────────────────


def test_l9_second_holder_found_when_first_excluded(seed_gym):
    """Both holders padded ("042", "0042"), first excluded → second found."""
    first = _member(seed_gym, name="First Holder", phone="+910000000223",
                    enroll="042")
    second = _member(seed_gym, name="Second Holder", phone="+910000000224",
                     enroll="0042")
    found = find_member_by_enroll_number(
        seed_gym["gym"].id, "42", exclude_id=first.id
    )
    assert found is not None
    assert found.id == second.id


# ── V4-L10: Guard 1 with a non-numeric stored enroll ────────────────────


def test_l10_guard1_non_numeric_stored_enroll(seed_gym):
    """A member stored with non-numeric enroll "ABC" gets the honest
    'already has enroll number' error, not a digits ValueError."""
    member = _member(seed_gym, name="Alpha", phone="+910000000225", enroll="ABC")
    with pytest.raises(ValueError, match="already has enroll number ABC"):
        remap_unresolved(seed_gym["gym"].id, "103", member, seed_gym["owner"].id)


# ── V4-L11: disconnected ADMS must not override a live bridge ──────────


def test_l11_disconnected_adms_keeps_live_bridge_online(seed_gym):
    installation, _key = _installation(seed_gym)
    installation.last_heartbeat_at = _now()
    installation.is_active = True
    _integration(seed_gym, status="disconnected")
    db.session.commit()
    summary = get_access_summary(seed_gym["gym"].id, "Asia/Kolkata")
    assert summary["device_online"] is True


def test_l11_disconnected_adms_endpoint_keeps_live_bridge_online(client, seed_gym):
    installation, _key = _installation(seed_gym)
    installation.last_heartbeat_at = _now()
    installation.is_active = True
    _integration(seed_gym, status="disconnected")
    db.session.commit()
    resp = client.get(
        "/api/mobile/v1/access/summary",
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200
    assert resp.json["data"]["device_online"] is True


# ── V4-L12: search is symmetric across feed legs ────────────────────────


def test_l12_search_by_enroll_matches_both_legs(seed_gym):
    """Searching "42" finds the AccessEvent row (by enroll) AND the
    unprojected ADMS row (by biometric ID)."""
    gym_id = seed_gym["gym"].id
    db.session.add(AccessEvent(
        gym_id=gym_id, event_type="ENTRY", direction="IN",
        event_timestamp=_now(), received_timestamp=_now(),
        device_enroll_number="42", source_event_id="v4-l12-evt-1",
        member_name="Someone Else",
    ))
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=_now(), device_serial="V4-TEST-X2008", direction="0",
    )
    db.session.commit()
    result = get_access_events(gym_id, "Asia/Kolkata", search="42")
    assert result["pagination"]["total"] == 2


# ── V4-M16 (backend note): paused members are denied manual check-in ───


def test_m16_manual_checkin_denies_paused_member(seed_gym):
    member = _member(seed_gym, name="Paused One", phone="+910000000226",
                     status="paused")
    event = record_manual_access_event(
        gym_id=seed_gym["gym"].id, member_id=member.id
    )
    assert event.event_type == "ACCESS_DENIED"
    state = MemberAccessState.query.filter_by(
        gym_id=seed_gym["gym"].id, member_id=member.id
    ).first()
    assert state is None or state.current_state != "INSIDE"
