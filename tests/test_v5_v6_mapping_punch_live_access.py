"""Regression tests for deep-review v5+v6 mapping / punch / Live Access findings.

Covers V5-M7, V5-L9..L13, V5-L28, V6-M10..M13, V6-L10, V6-L11, V6-L14.
Nothing here touches production data or the live terminal: every serial,
enroll number and member is synthetic.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

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
    _update_member_access_state,
    get_access_events,
    get_access_summary,
    get_members_inside,
    process_attendance_to_access_event,
)
from app.services.rrr_service import (
    _dedupe_key,
    normalize_attendance,
    remap_unresolved,
)

UTC = timezone.utc


def _now():
    return datetime.now(UTC)


def _member(seed_gym, *, name, phone="+910000000301", enroll=None, status="active",
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


def _auth_headers(user, gym):
    token = create_access_token(user.id, gym.id, user.role)
    return {"Authorization": f"Bearer {token}"}


def _integration(seed_gym, *, serial="V5-TEST-X2008", status="connected"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="V5 Test ADMS",
        device_serial=serial,
        device_name="V5 Test X2008",
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
        seed_gym["gym"].id, "V5 Test Bridge", "V5-SERIAL-01"
    )
    db.session.add(installation)
    db.session.commit()
    return installation, api_key


def _bridge_headers(api_key):
    return {
        "X-Api-Key": api_key,
        "X-RenewalDesk-Bridge-Protocol": "2",
        "X-Device-Serial": "V5-SERIAL-01",
    }


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


def _old_format_key(serial, enroll, punch_time):
    stable = "|".join((serial, enroll, punch_time.isoformat()))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _inside_member(seed_gym, *, name, phone, enroll):
    member = _member(seed_gym, name=name, phone=phone, enroll=enroll)
    db.session.add(MemberAccessState(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        current_state="INSIDE", last_entry_at=_now(),
    ))
    db.session.commit()
    return member


# ── V5-M7: Inside search no longer 500s ──────────────────────────────────


def test_v5_m7_inside_search_with_term(seed_gym):
    """Searching the Inside list by name works (was: ambiguous column 500)."""
    _inside_member(seed_gym, name="Ramesh Kumar", phone="+910000000302", enroll="42")
    _inside_member(seed_gym, name="Suresh Patel", phone="+910000000303", enroll="43")
    result = get_members_inside(seed_gym["gym"].id, search="Ramesh")
    assert [m["full_name"] for m in result["members"]] == ["Ramesh Kumar"]
    assert result["pagination"]["total"] == 1
    assert get_members_inside(seed_gym["gym"].id, search="zzz")["members"] == []
    assert get_members_inside(seed_gym["gym"].id)["pagination"]["total"] == 2


# ── V5-L9: Yodha dedupe-key recompute migration ─────────────────────────


def _load_l9_migration():
    path = Path(__file__).parent.parent / (
        "migrations/versions/v5l9a1b2c3d4e_recompute_yodha_dedupe_keys.py"
    )
    assert path.exists()
    spec = importlib.util.spec_from_file_location("v5l9_recompute", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "v5l9a1b2c3d4e"
    assert module.down_revision == "m3rg3v4fixall"
    return module


def test_v5_l9_migration_recomputes_zero_padded_key_and_resend_dedupes(seed_gym):
    """A migrated row stored under old-format key "042" (raw serial,
    zero-padded pin) gets the new-format key, so a re-send dedupes
    instead of inserting a duplicate (the V5-L9 hole)."""
    module = _load_l9_migration()
    yodha = Gym(
        id=3, name="Yodha Fitness", slug="yodha-fitness",
        email="yodha@test.com", phone="+919876543211", status="active",
        subscription_status="trial",
        trial_ends_at=date.today() + timedelta(days=30), max_members=50,
    )
    db.session.add(yodha)
    db.session.commit()
    t = datetime(2026, 11, 1, 10, 0, 0, tzinfo=UTC)
    row = RRRAttendanceEvent(
        gym_id=3, source="adms_direct", device_serial="v5-serial",
        biometric_user_id="042", punch_time=t,
        received_at=t + timedelta(minutes=5),
        direction="0", dedupe_key=_old_format_key("v5-serial", "042", t),
        processing_status="unmapped",
    )
    db.session.add(row)
    db.session.commit()
    counts = module._recompute(db.session.connection())
    db.session.commit()
    assert counts["examined"] == 1
    assert counts["updated"] == 1
    assert counts["skipped_collision"] == 0
    db.session.refresh(row)
    assert row.dedupe_key == _dedupe_key(
        "adms_direct", "v5-serial", None, "42", t, direction="0"
    )
    # Re-send of the same punch now dedupes (before the fix it missed:
    # the legacy probe only tries canonical "42" against a "042" key).
    event, created = normalize_attendance(
        gym_id=3, source="adms_direct", biometric_user_id="042",
        punch_time=t, device_serial="v5-serial", direction="0",
    )
    assert created is False
    assert event.id == row.id
    # Idempotent: a second run changes nothing.
    counts2 = module._recompute(db.session.connection())
    db.session.commit()
    assert counts2["updated"] == 0
    assert counts2["already_correct"] == 1


def test_v5_l9_migration_noop_without_yodha_gym(seed_gym):
    """On a DB with no Yodha Fitness gym the migration touches nothing."""
    module = _load_l9_migration()
    counts = module._recompute(db.session.connection())
    assert counts == {
        "examined": 0, "updated": 0, "already_correct": 0, "skipped_collision": 0,
    }


# ── V5-L10: one bad ATTLOG line can't fail the batch ─────────────────────


def test_v5_l10_bad_line_skipped_rest_of_batch_ingests(app, seed_gym, monkeypatch, caplog):
    """A normalize failure on one line skips just that line (V5-L10)."""
    import logging

    from app.adms.routes import _ingest_attlog
    from app.services.rrr_service import normalize_attendance as _real_normalize

    integration = _integration(seed_gym)

    def _flaky(**kwargs):
        if kwargs.get("biometric_user_id") == "43":
            raise RuntimeError("simulated normalize failure")
        return _real_normalize(**kwargs)

    monkeypatch.setattr("app.adms.routes.normalize_attendance", _flaky)
    body = (
        "42\t2026-11-05 10:00:00\t0\t1\n"
        "43\t2026-11-05 10:01:00\t0\t1\n"
        "44\t2026-11-05 10:02:00\t0\t1\n"
    )
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=body, content_type="text/plain"
    ):
        with caplog.at_level(logging.WARNING):
            created = _ingest_attlog(integration)
    assert created == 2
    assert RRRAttendanceEvent.query.filter_by(
        gym_id=seed_gym["gym"].id, biometric_user_id="43"
    ).first() is None
    assert "skipping line" in caplog.text


# ── V5-L11: suggest cache must not cache the no_snapshot error ─────────


def test_v5_l11_no_snapshot_error_not_cached(seed_gym):
    """A no_snapshot error is served fresh: once the snapshot lands,
    the next call sees it instead of the cached error (V5-L11)."""
    enroll_match_service._SUGGEST_CACHE.clear()
    first = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert first.get("error") == "no_snapshot"
    _snapshot(seed_gym, [{"user_id": "42", "name": "Ramesh Kumar"}])
    _member(seed_gym, name="Ramesh Kumar", phone="+910000000304")
    second = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert second.get("error") is None
    assert second.get("cached") is not True
    assert len(second["suggestions"]) == 1


def test_v5_l11_snapshot_arrival_invalidates_cache(seed_gym):
    """Storing a snapshot drops the cached suggestions (V5-L11)."""
    _integration(seed_gym)
    enroll_match_service._SUGGEST_CACHE.clear()
    enroll_match_service.upsert_terminal_snapshot(
        seed_gym["gym"].id, "42", "Ramesh Kumar", source="operlog"
    )
    db.session.commit()
    _member(seed_gym, name="Ramesh Kumar", phone="+910000000305")
    first = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert len(first["suggestions"]) == 1
    second = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert second.get("cached") is True
    enroll_match_service.upsert_terminal_snapshot(
        seed_gym["gym"].id, "43", "Suresh Kumar", source="operlog"
    )
    db.session.commit()
    _member(seed_gym, name="Suresh Kumar", phone="+910000000306")
    third = enroll_match_service.suggest_matches_cached(seed_gym["gym"].id)
    assert third.get("cached") is not True
    assert len(third["suggestions"]) == 2


# ── V5-L12 + V5-L28: unprojected exits in feed/summary, real type+direction


def test_v5_l12_unprojected_exit_in_feed_and_summary(seed_gym):
    """An ADMS exit whose projection failed still counts and shows
    (V5-L12), with its real EXIT/OUT type — not a hardcoded ENTRY
    twin (V5-L28)."""
    gym_id = seed_gym["gym"].id
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="7",
        punch_time=_now(), device_serial="V5-TEST-X2008", direction="0",
    )
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="8",
        punch_time=_now(), device_serial="V5-TEST-X2008", direction="1",
    )
    db.session.commit()
    summary = get_access_summary(gym_id, "Asia/Kolkata")
    assert summary["entries_today"] == 1
    assert summary["exits_today"] == 1
    feed = get_access_events(gym_id, "Asia/Kolkata", date_filter="today")
    assert feed["pagination"]["total"] == 2
    by_type = {e["event_type"]: e for e in feed["events"]}
    assert by_type["ENTRY"]["direction"] == "IN"
    assert by_type["EXIT"]["direction"] == "OUT"
    exits = get_access_events(
        gym_id, "Asia/Kolkata", date_filter="today", event_type="exit"
    )
    assert exits["pagination"]["total"] == 1
    assert exits["events"][0]["event_type"] == "EXIT"


# ── V5-L13: IntegrityError fallback probes legacy keys ──────────────────


def test_v5_l13_integrity_fallback_probes_legacy_keys(seed_gym, monkeypatch):
    """A concurrent-insert loser whose exact key finds nothing must
    still find the winner under a legacy key spelling instead of
    re-raising and 500ing the batch (V5-L13).

    Simulated deterministically: the pre-check queries are stubbed
    to miss, and the insert flush raises IntegrityError once — the
    fallback must return the legacy-keyed row.
    """
    gym_id = seed_gym["gym"].id
    t = _now()
    legacy_key = _old_format_key("V5-TEST-X2008", "42", t)
    legacy_row = RRRAttendanceEvent(
        gym_id=gym_id, source="adms_direct", device_serial="V5-TEST-X2008",
        biometric_user_id="42", punch_time=t, direction="0",
        dedupe_key=legacy_key, processing_status="unmapped",
    )
    db.session.add(legacy_row)
    db.session.commit()
    _member(seed_gym, name="Linked Member", phone="+910000000307", enroll="42")

    results = iter([None, None, None, legacy_row])

    class _FakeQuery:
        def filter_by(self, **kwargs):
            class _F:
                def first(self):
                    return next(results)
            return _F()

    monkeypatch.setattr(RRRAttendanceEvent, "query", _FakeQuery())
    monkeypatch.setattr(
        "app.services.rrr_service._legacy_dedupe_keys",
        lambda *a, **k: [legacy_key],
    )
    real_flush = db.session.flush
    state = {"raised": False}

    def _flaky_flush(*args, **kwargs):
        if not state["raised"] and any(
            isinstance(o, RRRAttendanceEvent) for o in db.session.new
        ):
            state["raised"] = True
            raise IntegrityError(
                "INSERT", None, Exception("UNIQUE constraint failed")
            )
        return real_flush(*args, **kwargs)

    monkeypatch.setattr(db.session, "flush", _flaky_flush)
    event, created = normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=t, device_serial="V5-TEST-X2008", direction="0",
    )
    assert state["raised"] is True
    assert created is False
    assert event.id == legacy_row.id


# ── V6-M10: linked namesake makes the suggestion ambiguous ─────────────


def test_v6_m10_linked_namesake_ties_unlinked_match(seed_gym):
    """Terminal 102 "Rahul Sharma" with a linked Rahul (101) AND an
    unlinked Rahul must be ambiguous — never auto-linkable (V6-M10)."""
    _snapshot(seed_gym, [{"user_id": "102", "name": "Rahul Sharma"}])
    _member(seed_gym, name="Rahul Sharma", phone="+910000000308", enroll="101")
    _member(seed_gym, name="Rahul Sharma", phone="+910000000309")
    result = enroll_match_service.suggest_matches(seed_gym["gym"].id)
    assert len(result["suggestions"]) == 1
    sugg = result["suggestions"][0]
    assert sugg["enroll_number"] == "102"
    assert sugg["ambiguous"] is True
    assert sugg["member_id"] is None
    assert sugg["auto_linkable"] is False
    assert any(c.get("already_linked") for c in sugg["candidate_members"])
    targeted = enroll_match_service._suggest_for_enroll(seed_gym["gym"].id, "102")
    assert targeted is not None
    assert targeted["ambiguous"] is True
    assert targeted["auto_linkable"] is False
    linked = enroll_match_service.auto_link_high_confidence(
        seed_gym["gym"].id, enroll_number="102"
    )
    assert linked["linked"] == []


def test_v6_m10_no_linked_namesake_still_links(seed_gym):
    """Without a linked namesake the exact match still auto-links."""
    _snapshot(seed_gym, [{"user_id": "102", "name": "Rahul Sharma"}])
    _member(seed_gym, name="Rahul Sharma", phone="+910000000310")
    linked = enroll_match_service.auto_link_high_confidence(
        seed_gym["gym"].id, enroll_number="102"
    )
    assert len(linked["linked"]) == 1
    assert linked["linked"][0]["enroll_number"] == "102"


# ── V6-M11: future punches rejected on both ingest paths ───────────────


def test_v6_m11_future_device_time_rejected():
    from app.adms.routes import _parse_device_time

    future = (_now() + timedelta(hours=2)).astimezone(timezone.utc)
    # Device sends wall-clock in gym tz; a clock 2h ahead parses to a
    # future UTC instant and must be rejected.
    from zoneinfo import ZoneInfo

    wall = future.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d %H:%M:%S")
    assert _parse_device_time(wall, "Asia/Kolkata") is None
    # 10 minutes ahead (inside the 15-min skew allowance) still parses.
    near = (_now() + timedelta(minutes=10)).astimezone(ZoneInfo("Asia/Kolkata"))
    assert _parse_device_time(
        near.strftime("%Y-%m-%d %H:%M:%S"), "Asia/Kolkata"
    ) is not None


def test_v6_m11_future_bridge_timestamp_rejected():
    from app.bridge.routes import _parse_timestamp

    with pytest.raises(ValueError, match="future"):
        _parse_timestamp((_now() + timedelta(hours=2)).isoformat(), "Asia/Kolkata")
    assert _parse_timestamp(
        (_now() + timedelta(minutes=10)).isoformat(), "Asia/Kolkata"
    ) is not None


def test_v6_m11_future_attlog_line_skipped(app, seed_gym):
    """A future-dated ATTLOG line is skipped like a malformed line."""
    from app.adms.routes import _ingest_attlog

    integration = _integration(seed_gym)
    from zoneinfo import ZoneInfo

    # Device sends IST wall-clock: +2h ahead in IST is +2h ahead in UTC.
    future = (_now() + timedelta(hours=2)).astimezone(
        ZoneInfo("Asia/Kolkata")
    ).strftime("%Y-%m-%d %H:%M:%S")
    body = f"42\t{future}\t0\t1\n"
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=body, content_type="text/plain"
    ):
        assert _ingest_attlog(integration) == 0
    assert RRRAttendanceEvent.query.filter_by(gym_id=seed_gym["gym"].id).count() == 0


def test_v6_m11_future_bridge_attendance_422(client, seed_gym):
    installation, api_key = _installation(seed_gym)
    payload = {
        "gymId": installation.public_id,
        "eventId": "v6-m11-evt-1",
        "deviceEnrollNumber": "42",
        "eventTime": (_now() + timedelta(hours=2)).isoformat(),
        "verifyMethod": 1,
        "isInvalid": False,
    }
    resp = client.post(
        "/api/bridge/v1/attendance", json=payload, headers=_bridge_headers(api_key)
    )
    assert resp.status_code == 422


# ── V6-M12/M13: link paths backfill pre-link punches ────────────────────


def _bridge_punch_setup(seed_gym, *, enroll="42", event_id="v6-m12-evt-1"):
    """An unmapped bridge punch: BridgeAttendance + AccessEvent with
    no member, plus its unmapped RRR row."""
    gym_id = seed_gym["gym"].id
    installation, _key = _installation(seed_gym)
    attendance = BridgeAttendance(
        bridge_id=installation.id, gym_id=gym_id, member_id=None,
        event_id=event_id, device_enroll_number=enroll,
        event_time=_now(), verify_method=1, att_state=0, is_invalid=False,
    )
    db.session.add(attendance)
    db.session.flush()
    process_attendance_to_access_event(attendance)
    normalize_attendance(
        gym_id=gym_id, source="direct_bridge", biometric_user_id=enroll,
        punch_time=attendance.event_time, external_event_id=event_id,
        device_serial="V5-SERIAL-01", direction="0", verify_method="1",
    )
    db.session.commit()
    return attendance


def test_v6_m13_remap_backfills_bridge_punch_and_inside(seed_gym):
    """Remap attributes the bridge punch's BridgeAttendance + AccessEvent
    and flips the member INSIDE (V6-M13)."""
    gym_id = seed_gym["gym"].id
    attendance = _bridge_punch_setup(seed_gym)
    member = _member(seed_gym, name="Bridge Member", phone="+910000000311")
    assert remap_unresolved(gym_id, "42", member, seed_gym["owner"].id) == 1
    db.session.commit()
    db.session.refresh(attendance)
    assert attendance.member_id == member.id
    evt = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id="v6-m12-evt-1"
    ).first()
    assert evt is not None
    assert evt.member_id == member.id
    assert evt.member_name == "Bridge Member"
    state = MemberAccessState.query.filter_by(
        gym_id=gym_id, member_id=member.id
    ).first()
    assert state is not None
    assert state.current_state == "INSIDE"


def test_v6_m12_mobile_enroll_endpoint_backfills(client, seed_gym):
    """POST /members/{id}/enroll backfills pre-link punches (V6-M12)."""
    gym_id = seed_gym["gym"].id
    _bridge_punch_setup(seed_gym)
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="42",
        punch_time=_now(), device_serial="V5-TEST-X2008", direction="0",
    )
    db.session.commit()
    member = _member(seed_gym, name="Enroll Member", phone="+910000000312")
    resp = client.post(
        f"/api/mobile/v1/members/{member.id}/enroll",
        json={"enroll_number": "42"},
        headers=_auth_headers(seed_gym["owner"], seed_gym["gym"]),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert RRRAttendanceEvent.query.filter_by(
        gym_id=gym_id, processing_status="unmapped"
    ).count() == 0
    assert BridgeAttendance.query.filter_by(
        gym_id=gym_id, event_id="v6-m12-evt-1"
    ).first().member_id == member.id
    evt = AccessEvent.query.filter_by(
        gym_id=gym_id, source_event_id="v6-m12-evt-1"
    ).first()
    assert evt.member_id == member.id


def test_v6_m12_bridge_confirm_backfills(client, seed_gym):
    """POST /bridge/v1/enrollment/confirm backfills pre-link punches."""
    gym_id = seed_gym["gym"].id
    installation, api_key = _installation(seed_gym)
    normalize_attendance(
        gym_id=gym_id, source="adms_direct", biometric_user_id="43",
        punch_time=_now(), device_serial="V5-TEST-X2008", direction="0",
    )
    db.session.commit()
    member = _member(seed_gym, name="Confirm Member", phone="+910000000313")
    resp = client.post(
        "/api/bridge/v1/enrollment/confirm",
        json={
            "gymId": installation.public_id,
            "memberId": member.id,
            "deviceEnrollNumber": "43",
        },
        headers=_bridge_headers(api_key),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    assert RRRAttendanceEvent.query.filter_by(
        gym_id=gym_id, processing_status="unmapped"
    ).count() == 0


# ── V6-L10: legacy bridge event_id includes att_state + serial ─────────


def test_v6_l10_legacy_event_id_keeps_entry_and_exit_distinct(client, seed_gym):
    """Two legacy (no eventId) punches in the same second, entry + exit,
    must be two rows — the old key collapsed them (V6-L10)."""
    installation, api_key = _installation(seed_gym)
    t = _now().isoformat()
    for att_state in (0, 1):
        resp = client.post(
            "/api/bridge/v1/attendance",
            json={
                "gymId": installation.public_id,
                "deviceEnrollNumber": "77",
                "eventTime": t,
                "verifyMethod": 1,
                "isInvalid": False,
                "attState": att_state,
            },
            headers=_bridge_headers(api_key),
        )
        assert resp.status_code == 201, resp.get_data(as_text=True)
    rows = BridgeAttendance.query.filter_by(
        gym_id=seed_gym["gym"].id, device_enroll_number="77"
    ).all()
    assert len(rows) == 2
    assert len({r.event_id for r in rows}) == 2


# ── V6-L11: USERINFO upload prunes terminal-deleted OPERLOG entries ─────


def test_v6_l11_userinfo_prunes_operlog_snapshot(app, seed_gym):
    """A USERINFO upload listing only PIN 42 drops PIN 43 from the
    OPERLOG snapshot (V6-L11)."""
    from app.adms.routes import _ingest_userinfo

    integration = _integration(seed_gym)
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="operlog_snapshot", command_text="OPERLOG enrollment capture",
        status="acked",
        result_data=json.dumps({
            "users": [
                {"enroll_number": "42", "name": "Alice Smith"},
                {"enroll_number": "43", "name": "Bob Jones"},
            ],
            "source": "operlog", "count": 2,
        }),
    ))
    db.session.add(RRRAdmsCommand(
        gym_id=seed_gym["gym"].id, integration_id=integration.id,
        action="sync_users", command_text="DATA QUERY USERINFO",
        status="queued",
    ))
    db.session.commit()
    body = "USER PIN=42\tName=Alice Smith\tPri=0\tPasswd=\tCard=0\n"
    with app.test_request_context(
        "/iclock/cdata", method="POST", data=body, content_type="text/plain"
    ):
        assert _ingest_userinfo(integration) == 1
    db.session.commit()
    snap = enroll_match_service.get_adms_snapshot(seed_gym["gym"].id)
    assert snap is not None
    assert [u["enroll_number"] for u in snap["users"]] == ["42"]


# ── V6-M16: campaign create honours Idempotency-Key ───────────────────


def _campaign_body(*, name="Recovery Blast"):
    return {
        "name": name,
        "campaign_type": "recovery",
        "segment_type": "all_expired",
    }


def test_v6_m16_campaign_create_replays_same_key(client, seed_gym):
    """A retry with the same Idempotency-Key returns the first campaign
    instead of creating a duplicate (V6-M16)."""
    from app.models.campaign import Campaign

    headers = {
        **_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        "Idempotency-Key": "camp-launch-1",
    }
    first = client.post(
        "/api/mobile/v1/campaigns", json=_campaign_body(), headers=headers
    )
    assert first.status_code == 201, first.get_data(as_text=True)
    campaign_id = first.json["data"]["id"]
    second = client.post(
        "/api/mobile/v1/campaigns", json=_campaign_body(), headers=headers
    )
    assert second.status_code == 201
    assert second.json["data"]["id"] == campaign_id
    assert second.json == first.json
    assert Campaign.query.filter_by(gym_id=seed_gym["gym"].id).count() == 1


def test_v6_m16_campaign_create_key_reused_for_different_body(client, seed_gym):
    """The same key with a different campaign body is a 409 (V6-M16)."""
    headers = {
        **_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        "Idempotency-Key": "camp-launch-2",
    }
    first = client.post(
        "/api/mobile/v1/campaigns", json=_campaign_body(), headers=headers
    )
    assert first.status_code == 201
    second = client.post(
        "/api/mobile/v1/campaigns",
        json=_campaign_body(name="Different Name"),
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_v6_m16_campaign_create_without_key_still_creates_two(client, seed_gym):
    """No key = no replay: two identical posts create two campaigns."""
    from app.models.campaign import Campaign

    headers = _auth_headers(seed_gym["owner"], seed_gym["gym"])
    for _ in range(2):
        resp = client.post(
            "/api/mobile/v1/campaigns", json=_campaign_body(), headers=headers
        )
        assert resp.status_code == 201
    assert Campaign.query.filter_by(gym_id=seed_gym["gym"].id).count() == 2


# ── V5-L34: deactivate honours Idempotency-Key ─────────────────────────


def test_v5_l34_deactivate_replays_same_key(client, seed_gym):
    """A retry with the same Idempotency-Key returns the stored 200
    instead of 404ing on the already-deleted member (V5-L34)."""
    from app.models import MobileIdempotencyKey

    member = _member(seed_gym, name="Deactivate Me", phone="+910000000315")
    headers = {
        **_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        "Idempotency-Key": "bulk-deactivate-1-42",
    }
    first = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        json={}, headers=headers,
    )
    assert first.status_code == 200, first.get_data(as_text=True)
    second = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        json={}, headers=headers,
    )
    assert second.status_code == 200
    assert second.json == first.json
    assert db.session.get(Member, member.id).deleted_at is not None
    assert MobileIdempotencyKey.query.filter_by(
        gym_id=seed_gym["gym"].id, scope="deactivate_member",
        key="bulk-deactivate-1-42",
    ).count() == 1


def test_v5_l34_deactivate_key_reused_for_other_member(client, seed_gym):
    """The same key for a different member is a 409 — the fingerprint
    binds the key to the member (V5-L34)."""
    first_member = _member(seed_gym, name="First", phone="+910000000316")
    second_member = _member(seed_gym, name="Second", phone="+910000000317")
    headers = {
        **_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        "Idempotency-Key": "bulk-deactivate-2-42",
    }
    resp = client.post(
        f"/api/mobile/v1/members/{first_member.id}/deactivate",
        json={}, headers=headers,
    )
    assert resp.status_code == 200
    resp = client.post(
        f"/api/mobile/v1/members/{second_member.id}/deactivate",
        json={}, headers=headers,
    )
    assert resp.status_code == 409
    assert resp.json["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert db.session.get(Member, second_member.id).deleted_at is None


def test_v5_l34_deactivate_without_key_second_is_404(client, seed_gym):
    """No key = existing behaviour: a second deactivate 404s."""
    member = _member(seed_gym, name="No Key", phone="+910000000318")
    headers = _auth_headers(seed_gym["owner"], seed_gym["gym"])
    assert client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate", headers=headers
    ).status_code == 200
    assert client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate", headers=headers
    ).status_code == 404


def test_v5_l34_deactivate_key_too_long_is_400(client, seed_gym):
    member = _member(seed_gym, name="Long Key", phone="+910000000319")
    headers = {
        **_auth_headers(seed_gym["owner"], seed_gym["gym"]),
        "Idempotency-Key": "x" * 129,
    }
    resp = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        json={}, headers=headers,
    )
    assert resp.status_code == 400
    assert db.session.get(Member, member.id).deleted_at is None


# ── V6-L14: same-second entry+exit — EXIT wins ──────────────────────────


def test_v6_l14_same_second_exit_wins_over_entry(seed_gym):
    """At equal timestamps an EXIT must win; a later ENTRY at the same
    second must not flip the member back INSIDE (V6-L14)."""
    gym_id = seed_gym["gym"].id
    member = _member(seed_gym, name="Same Second", phone="+910000000314", enroll="42")
    t = _now()
    state = MemberAccessState(
        gym_id=gym_id, member_id=member.id, current_state="INSIDE",
        last_entry_at=t, last_event_timestamp=t,
    )
    db.session.add(state)
    db.session.commit()

    counter = {"n": 0}

    def _evt(event_type):
        counter["n"] += 1
        evt = AccessEvent(
            gym_id=gym_id, member_id=member.id, event_type=event_type,
            direction="IN" if event_type == "ENTRY" else "OUT",
            event_timestamp=t, received_timestamp=t,
            device_enroll_number="42",
            source_event_id=f"v6-l14-{event_type}-{counter['n']}",
        )
        db.session.add(evt)
        db.session.flush()
        return evt

    _update_member_access_state(
        gym_id=gym_id, member_id=member.id,
        access_event=_evt("ENTRY"), event_type="ENTRY",
    )
    assert state.current_state == "INSIDE"
    _update_member_access_state(
        gym_id=gym_id, member_id=member.id,
        access_event=_evt("EXIT"), event_type="EXIT",
    )
    assert state.current_state == "OUTSIDE"
    _update_member_access_state(
        gym_id=gym_id, member_id=member.id,
        access_event=_evt("ENTRY"), event_type="ENTRY",
    )
    assert state.current_state == "OUTSIDE"
