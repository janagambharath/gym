"""Regression tests for deep-review v3 mapping / punch / Live Access findings.

Covers V3-H3, V3-M10..M15, V3-L8..L14 (service + endpoint level).
Nothing here touches production data or the live terminal: every serial,
enroll number and member is synthetic.
"""
from __future__ import annotations

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
    RRRBiometricTemplate,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.mobile_api.token_service import create_access_token
from app.services import enroll_match_service
from app.services.access_event_service import (
    _resolve_member,
    get_access_events,
    get_access_summary,
    process_attendance_to_access_event,
)
from app.services.bridge_service import (
    desired_command_type,
    member_is_proven_blockable,
    resolve_adms_member,
)
from app.services.enroll_match_service import confirm_match
from app.services.rrr_service import (
    _dedupe_key,
    normalize_attendance,
    remap_unresolved,
)

UTC = timezone.utc


def _now():
    return datetime.now(UTC)


def _member(seed_gym, *, name, phone, enroll=None, status="active",
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
    db.session.add(member)
    db.session.commit()
    return member


def _auth_headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _integration(seed_gym, *, serial="V3-TEST-X2008"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V3 Test ADMS",
        device_serial=serial,
        device_name="V3 Test X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        last_success_at=_now(),
    )
    db.session.add(row)
    db.session.commit()
    return row


def _installation(seed_gym):
    installation, api_key = BridgeInstallation.create_for_gym(
        seed_gym["gym"].id, "V3 Test Bridge", "V3-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


# ── V3-H3: canonical enroll comparison ──────────────────────────────────


def test_h3_confirm_match_accepts_canonical_of_padded_stored_id(seed_gym):
    """Stored "042" confirming "42" is the SAME id, not a conflict."""
    member = _member(seed_gym, name="Padded Holder", phone="+910000000101",
                     enroll="042")
    result = confirm_match(
        seed_gym["gym"].id, member.id, "42", seed_gym["owner"].id
    )
    db.session.commit()
    assert result.device_enroll_number == "42"
    assert db.session.get(Member, member.id).device_enroll_number == "42"


def test_h3_guard2_blocks_second_member_on_padded_holder(seed_gym):
    """Guard 2 must see a stored "042" holder when linking "42" elsewhere."""
    _member(seed_gym, name="Padded Holder", phone="+910000000102", enroll="042")
    other = _member(seed_gym, name="Other Member", phone="+910000000103")
    with pytest.raises(ValueError, match="already linked to Padded Holder"):
        remap_unresolved(seed_gym["gym"].id, "42", other, seed_gym["owner"].id)


def test_h3_enroll_endpoint_rejects_padded_holder(client, seed_gym):
    """POST /members/<id>/enroll 409s when "42" is held as stored "042"."""
    _member(seed_gym, name="Padded Holder", phone="+910000000104", enroll="042")
    other = _member(seed_gym, name="Other Member", phone="+910000000105")
    resp = client.post(
        f"/api/mobile/v1/members/{other.id}/enroll",
        json={"enroll_number": "42"},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 409
    assert resp.json["error"]["code"] == "DUPLICATE_ENROLL"


def test_h3_mapped_member_resolves_padded_stored_id(seed_gym):
    """A punch for "42" attributes to the member stored as "042"."""
    member = _member(seed_gym, name="Padded Holder", phone="+910000000106",
                     enroll="042")
    event, created = normalize_attendance(
        gym_id=seed_gym["gym"].id,
        source="adms_direct",
        biometric_user_id="42",
        punch_time=_now(),
        device_serial="V3-TEST-X2008",
    )
    assert created is True
    assert event.member_id == member.id
    assert event.processing_status == "processed"


def test_h3_bridge_confirm_rejects_padded_holder(client, seed_gym):
    """Bridge confirm_enrollment 409s when "42" is held as stored "042"."""
    installation, api_key = _installation(seed_gym)
    _member(seed_gym, name="Padded Holder", phone="+910000000107", enroll="042")
    other = _member(seed_gym, name="Other Member", phone="+910000000108")
    resp = client.post(
        "/api/bridge/v1/enrollment/confirm",
        json={
            "gymId": installation.public_id,
            "memberId": other.id,
            "deviceEnrollNumber": "42",
        },
        headers={
            "X-Api-Key": api_key,
            "X-RenewalDesk-Bridge-Protocol": "2",
            "X-Device-Serial": "V3-SERIAL-01",
        },
    )
    assert resp.status_code == 409
    assert resp.json["error"]["code"] == "enroll_number_in_use"


# ── V3-M10: no linking to soft-deleted members ─────────────────────────


def test_m10_bulk_resolve_rejects_deleted_member(client, seed_gym):
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000109",
                      deleted=True)
    resp = client.post(
        "/api/mobile/v1/rrr/mappings/bulk-resolve",
        json={"mappings": [{"external_id": "103", "member_id": deleted.id}]},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200
    item = resp.json["data"]["results"][0]
    assert item["ok"] is False
    assert item["error"] == "Member not found"
    assert RRRIdentityMapping.query.filter_by(
        gym_id=seed_gym["gym"].id, external_id="103"
    ).first() is None


def test_m10_single_resolve_deleted_member_404(client, seed_gym):
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000110",
                      deleted=True)
    resp = client.post(
        "/api/mobile/v1/rrr/mappings/103",
        json={"member_id": deleted.id},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 404


def test_m10_remap_raises_for_deleted_member(seed_gym):
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000111",
                      deleted=True)
    with pytest.raises(ValueError, match="deleted"):
        remap_unresolved(seed_gym["gym"].id, "103", deleted, seed_gym["owner"].id)


def test_m10_guard3_ignores_mapping_to_deleted_member(seed_gym):
    """A confirmed mapping pointing at a deleted member frees the ID."""
    gym_id = seed_gym["gym"].id
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000112",
                      deleted=True)
    stale = RRRIdentityMapping(
        gym_id=gym_id, external_id="103", member_id=deleted.id,
        source="adms_direct", status="confirmed",
    )
    db.session.add(stale)
    db.session.commit()
    live = _member(seed_gym, name="Live Member", phone="+910000000113")
    resolved = remap_unresolved(gym_id, "103", live, seed_gym["owner"].id)
    db.session.commit()
    assert resolved == 0
    mapping = RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="103", status="confirmed"
    ).first()
    assert mapping is not None
    assert mapping.member_id == live.id
    assert db.session.get(Member, live.id).device_enroll_number == "103"


# ── V3-M11: ADMS leg fetch window ───────────────────────────────────────


def test_m11_deep_page_returns_unprojected_row(seed_gym):
    """An unprojected punch older than the newest 500 raw rows is pageable.

    505 projected punches + 1 older unprojected punch: page 6 at
    per_page=100 must contain the unprojected row (old code sliced an
    empty list past 500/per_page).
    """
    gym_id = seed_gym["gym"].id
    base = _now()
    rrr_rows = []
    for i in range(506):
        row = RRRAttendanceEvent(
            gym_id=gym_id,
            source="adms_direct",
            device_serial="V3-TEST-X2008",
            biometric_user_id="7",
            punch_time=base - timedelta(minutes=i),
            dedupe_key=f"v3-m11-{i}",
            processing_status="unmapped",
        )
        rrr_rows.append(row)
    db.session.add_all(rrr_rows)
    db.session.flush()
    # Project every row except the oldest (i == 505).
    access_rows = [
        AccessEvent(
            gym_id=gym_id,
            event_type="ENTRY",
            direction="IN",
            event_timestamp=row.punch_time,
            received_timestamp=row.punch_time,
            device_enroll_number="7",
            source_event_id=f"rrr-attendance-{row.id}",
        )
        for row in rrr_rows[:505]
    ]
    db.session.add_all(access_rows)
    db.session.commit()

    result = get_access_events(
        gym_id, "Asia/Kolkata", page=6, per_page=100, date_filter="all"
    )
    assert result["pagination"]["total"] == 506
    assert result["pagination"]["total_pages"] == 6
    page6_ids = {e["id"] for e in result["events"]}
    assert f"adms-{rrr_rows[505].id}" in page6_ids


# ── V3-M12 / V3-M13: ADMS-aware summary without double-count ────────────


def _summary_rows(seed_gym):
    """2 projected punches (in AccessEvent) + 1 unprojected RRR punch."""
    gym_id = seed_gym["gym"].id
    now = _now()
    rrr_rows = []
    for i in range(3):
        row = RRRAttendanceEvent(
            gym_id=gym_id,
            source="adms_direct",
            device_serial="V3-TEST-X2008",
            biometric_user_id="7",
            punch_time=now - timedelta(minutes=i),
            dedupe_key=f"v3-m13-{i}",
            processing_status="processed",
        )
        rrr_rows.append(row)
    db.session.add_all(rrr_rows)
    db.session.flush()
    access_rows = [
        AccessEvent(
            gym_id=gym_id,
            event_type="ENTRY",
            direction="IN",
            event_timestamp=row.punch_time,
            received_timestamp=row.punch_time,
            device_enroll_number="7",
            source_event_id=f"rrr-attendance-{row.id}",
        )
        for row in rrr_rows[:2]
    ]
    db.session.add_all(access_rows)
    db.session.commit()
    return rrr_rows


def test_m13_summary_counts_entries_once(seed_gym):
    _summary_rows(seed_gym)
    summary = get_access_summary(seed_gym["gym"].id, "Asia/Kolkata")
    # 2 projected AccessEvent entries + 1 unprojected RRR punch = 3.
    # The old code added ALL 3 RRR rows on top: 5.
    assert summary["entries_today"] == 3


def test_m12_summary_adms_terminal_online(seed_gym):
    _summary_rows(seed_gym)
    _integration(seed_gym)
    summary = get_access_summary(seed_gym["gym"].id, "Asia/Kolkata")
    assert summary["device_online"] is True
    assert summary["device_name"] == "V3 Test X2008"
    assert summary["entries_today"] == 3


def test_m12_summary_no_integration_stays_offline(seed_gym):
    summary = get_access_summary(seed_gym["gym"].id, "Asia/Kolkata")
    assert summary["device_online"] is False


# ── V3-M14: deleted members never resolve in Live Access ───────────────


def test_m14_resolve_member_skips_deleted(seed_gym):
    live = _member(seed_gym, name="Live One", phone="+910000000114", enroll="42")
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000115",
                      enroll="43", deleted=True)
    assert _resolve_member(seed_gym["gym"].id, "42") is not None
    assert _resolve_member(seed_gym["gym"].id, "42").id == live.id
    assert _resolve_member(seed_gym["gym"].id, "43") is None
    assert resolve_adms_member(seed_gym["gym"].id, "43") is None


def test_m14_resolve_adms_mapping_branch_skips_deleted(seed_gym):
    gym_id = seed_gym["gym"].id
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000116",
                      enroll="44", deleted=True)
    db.session.add(RRRIdentityMapping(
        gym_id=gym_id, external_id="44", member_id=deleted.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    assert resolve_adms_member(gym_id, "44") is None


def test_m14_deleted_member_not_inside_in_live_access(seed_gym):
    gym_id = seed_gym["gym"].id
    installation, _api_key = _installation(seed_gym)
    deleted = _member(seed_gym, name="Deleted One", phone="+910000000117",
                      enroll="45", deleted=True)
    attendance = BridgeAttendance(
        bridge_id=installation.id,
        gym_id=gym_id,
        member_id=deleted.id,
        event_id="v3-m14-evt-1",
        device_enroll_number="45",
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
    assert event.member_id is None
    assert event.member_name is None
    state = MemberAccessState.query.filter_by(
        gym_id=gym_id, member_id=deleted.id
    ).first()
    assert state is None or state.current_state != "INSIDE"


# ── V3-M15: shared auto-link throttle ───────────────────────────────────


def test_m15_auto_link_scan_throttle_is_shared(seed_gym):
    gym_id = seed_gym["gym"].id
    enroll_match_service._AUTO_LINK_LAST_RUN.clear()
    assert enroll_match_service.auto_link_scan_due(gym_id) is True
    assert enroll_match_service.auto_link_scan_due(gym_id) is False


def test_m15_ingest_stamps_throttle_even_when_punch_not_in_snapshot(seed_gym):
    """The snapshot fetch itself is bounded: one check per gym per 5 min,
    even when the punch's ID is absent from the snapshot."""
    gym_id = seed_gym["gym"].id
    enroll_match_service._AUTO_LINK_LAST_RUN.clear()
    event, created = normalize_attendance(
        gym_id=gym_id,
        source="adms_direct",
        biometric_user_id="999",
        punch_time=_now(),
        device_serial="V3-TEST-X2008",
    )
    assert created is True
    assert event.processing_status == "unmapped"
    assert enroll_match_service.auto_link_scan_due(gym_id) is False


# ── Fail-safe invariant (guard-adjacent changes) ────────────────────────


def test_fail_safe_active_member_never_blockable(seed_member):
    """H3/M10/M14 lookup changes must not change block outcomes."""
    assert member_is_proven_blockable(seed_member) is False
    assert desired_command_type(seed_member) == "enable_user"


def test_fail_safe_paused_member_still_blockable(seed_gym, seed_member):
    seed_member.status = "paused"
    db.session.commit()
    assert member_is_proven_blockable(seed_member) is True
    assert desired_command_type(seed_member) == "disable_user"


# ── V3-L8: dedupe key ───────────────────────────────────────────────────


def test_l8_dedupe_key_canonical_serial_and_direction():
    t = _now()
    base = _dedupe_key("adms_direct", "abc-1", None, "42", t)
    assert base == _dedupe_key("adms_direct", " ABC-1 ", None, "42", t)
    assert base != _dedupe_key("adms_direct", "ABC-1", None, "42", t, direction="0")
    assert _dedupe_key("adms_direct", "ABC-1", None, "42", t, direction="0") != (
        _dedupe_key("adms_direct", "ABC-1", None, "42", t, direction="1")
    )


def test_l8_entry_and_exit_same_second_are_distinct_rows(seed_gym):
    t = _now()
    entry, created_entry = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t, device_serial="V3-TEST-X2008",
        direction="0",
    )
    exit_evt, created_exit = normalize_attendance(
        gym_id=seed_gym["gym"].id, source="adms_direct",
        biometric_user_id="42", punch_time=t, device_serial="V3-TEST-X2008",
        direction="1",
    )
    assert created_entry is True
    assert created_exit is True
    assert entry.id != exit_evt.id


# ── V3-L9: device time parsing ──────────────────────────────────────────


def test_l9_parse_device_time_dd_mm_yyyy():
    from app.adms.routes import _parse_device_time

    parsed = _parse_device_time("05/11/2026 10:30:00", "Asia/Kolkata")
    assert parsed == datetime(2026, 11, 5, 5, 0, 0, tzinfo=UTC)
    assert _parse_device_time("2026-11-05 10:30:00", "Asia/Kolkata") == parsed
    assert _parse_device_time("not a date", "Asia/Kolkata") is None


# ── V3-L10: fingerprint template PIN canonicalization ───────────────────


def test_l10_template_upload_stores_canonical_pin(app, seed_gym):
    """A USERINFO template upload for PIN 042 stores under "42"."""
    from app.adms.routes import _ingest_userinfo

    integration = _integration(seed_gym)
    _member(seed_gym, name="Template User", phone="+910000000118", enroll="42")
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="sync_users", command_text="DATA QUERY USERINFO",
        status="queued",
    ))
    db.session.commit()
    line = "USER PIN=042\tName=Template User\tPri=0\tFID=1\tTMP=QUJDREVGRw=="
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=line, content_type="text/plain"
    ):
        _ingest_userinfo(integration)
    db.session.commit()
    tmpl = RRRBiometricTemplate.query.filter_by(
        gym_id=seed_gym["gym"].id
    ).first()
    assert tmpl is not None
    assert tmpl.enroll_number == "42"


# ── V3-L12: unknown date filter ─────────────────────────────────────────


def test_l12_unknown_date_filter_raises(seed_gym):
    with pytest.raises(ValueError, match="Unknown date_filter"):
        get_access_events(seed_gym["gym"].id, "Asia/Kolkata", date_filter="week")


def test_l12_unknown_date_filter_endpoint_400(client, seed_gym):
    resp = client.get(
        "/api/mobile/v1/access/events?date=week",
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 400
    assert resp.json["error"]["code"] == "VALIDATION_ERROR"


# ── V3-L13: snapshot enroll canonicalization ────────────────────────────


def test_l13_terminal_snapshot_canonical_enroll(seed_gym):
    installation, _api_key = _installation(seed_gym)
    db.session.add(BridgeCommand(
        bridge_id=installation.id,
        gym_id=seed_gym["gym"].id,
        command_type="sync_users",
        enroll_number="42",
        status="acked",
        acknowledged_at=_now(),
        result_data=json.dumps({"users": [{"user_id": "042", "name": "X"}]}),
    ))
    db.session.commit()
    snapshot = enroll_match_service.get_terminal_snapshot(seed_gym["gym"].id)
    assert snapshot is not None
    assert snapshot["users"][0]["enroll_number"] == "42"


def test_l13_adms_snapshot_canonical_enroll(seed_gym):
    integration = _integration(seed_gym)
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="sync_users", command_text="DATA QUERY USERINFO",
        status="acked", acknowledged_at=_now(),
        result_data=json.dumps({"users": [{"enroll_number": "042", "name": "X"}]}),
    ))
    db.session.commit()
    snapshot = enroll_match_service.get_adms_snapshot(seed_gym["gym"].id)
    assert snapshot is not None
    assert snapshot["users"][0]["enroll_number"] == "42"


# ── V3-L14: confirm_match flushes, callers commit ──────────────────────


def test_l14_confirm_match_inside_savepoint_rolls_back_cleanly(seed_gym, seed_member):
    """A savepoint rollback after confirm_match leaves nothing persisted."""
    gym_id = seed_gym["gym"].id
    owner_id = seed_gym["owner"].id
    try:
        with db.session.begin_nested():
            confirm_match(gym_id, seed_member.id, "42", owner_id)
            raise RuntimeError("force savepoint rollback")
    except RuntimeError:
        pass
    db.session.expire_all()
    assert db.session.get(Member, seed_member.id).device_enroll_number is None
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id="42"
    ).first() is None
    # And a normal confirm + commit still persists.
    confirm_match(gym_id, seed_member.id, "42", owner_id)
    db.session.commit()
    assert db.session.get(Member, seed_member.id).device_enroll_number == "42"


def test_l14_mobile_confirm_endpoint_persists(client, seed_gym, seed_member):
    resp = client.post(
        "/api/mobile/v1/rrr/enroll-matches/confirm",
        json={"member_id": seed_member.id, "enroll_number": "42"},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200
    assert db.session.get(Member, seed_member.id).device_enroll_number == "42"


# ── Migration chain (V3-H3 backfill) ────────────────────────────────────


def test_migration_backfill_revision_chain():
    import re
    from pathlib import Path

    path = Path(__file__).parent.parent / (
        "migrations/versions/c4a9012b3d4e_canonicalize_stored_enroll_numbers.py"
    )
    text = path.read_text()
    assert 'down_revision = "71e470eb6cb6"' in text
    assert 'revision = "c4a9012b3d4e"' in text
    assert "ltrim(m.device_enroll_number, '0')" in text
    assert "rrr_biometric_templates" in text
    assert "rrr_identity_mappings" in text
    # Only all-digit values with a leading zero and a non-zero digit.
    assert "^0+[1-9][0-9]*$" in text
