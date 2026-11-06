"""Regression tests for the Tier 1 (backend half), Tier 3, Tier 5 and
B-M2 fixes from deep review v2 (2026-11-05).

* B-H11: missing /assets/* is a real 404 (never the SPA fallback);
  index.html is served no-cache.
* H7: ADMS ingest canonicalizes enroll IDs ("042" -> "42"); remap
  replays rows stored pre-fix under a zero-padded ID.
* M13: Live Access feed — same date filter on the ADMS leg, true
  pagination, dedup against projected rows, correct totals.
* H9/M11: unenroll + soft-delete free the identity mapping; the
  mapped-member lookup never returns a soft-deleted member.
* H11: auto-link fuzzy scan is throttled off the ingest hot path.
* B-H9: unresolved mappings are paginated, grouped by terminal ID.
* H3/H4-legacy: legacy bulk renew uses gym-local today, the plan grid
  and records previous_start before mutation; the member form enforces
  the grid.
* M4/M5: Date Repair uses start + duration - 1, handles restarts in
  the ledger checks and scans paused members.
* M3/B-M3: paused members stay paused through verify / renew /
  refund / revert.
* B-M2: gym timezone is validated on save (400 on invalid).
* M9/B-L1: duplicate verified UPI references are rejected; method /
  channel are enum-validated on payment and renewal records.
* M1: batch create + CSV import validate enforce the plan grid.
* M12 residual: the scheduler ADMS reconcile covers mapping-only
  members (no device_enroll_number).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from app.extensions import db
from app.mobile_api.token_service import create_access_token
from app.models import Member, PaymentVerification, RenewalHistory
from app.models.access_event import AccessEvent
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAdmsCommand,
    RRRAttendanceEvent,
    RRRIdentityMapping,
    RRRIntegration,
)
from app.services.timezone_service import today_for_gym


def _owner_headers(seed_gym):
    owner = seed_gym["owner"]
    return {"Authorization": f"Bearer {create_access_token(owner.id, seed_gym['gym'].id, 'gym_owner')}"}


def _member(gym_id, plan_id, *, name, phone, enroll=None, status="active",
            start=None, end=None, price=1000):
    today = date.today()
    member = Member(
        gym_id=gym_id,
        plan_id=plan_id,
        full_name=name,
        phone=phone,
        membership_start=start or (today - timedelta(days=30)),
        membership_end=end if end is not None else today + timedelta(days=30),
        status=status,
        price=price,
        device_enroll_number=enroll,
    )
    db.session.add(member)
    db.session.commit()
    return member


def _login_owner(client, seed_gym):
    client.post(
        "/auth/login",
        data={"email": "owner@testgym.com", "password": "SecurePass123!"},
        follow_redirects=True,
    )


def _adms_integration(seed_gym, *, serial="T15-TEST-01"):
    row = RRRIntegration(
        gym_id=seed_gym["gym"].id,
        connector_type="adms_direct",
        display_name="Tier135 ADMS",
        device_serial=serial,
        device_name="Tier135 X2008",
        status="connected",
        commands_enabled=True,
        commissioning_status="physical_test_passed",
        adms_path_token="tier135-token",
        last_success_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()
    return row


# ─── B-H11: stale-bundle trap ────────────────────────────────────────────

def test_pwa_missing_asset_is_404_and_index_is_no_cache(client, seed_gym):
    index_res = client.get("/")
    assert index_res.status_code == 200
    assert index_res.headers.get("Cache-Control") == "no-cache"

    res = client.get("/assets/chunk-that-does-not-exist-1234.js")
    assert res.status_code == 404
    # The missing chunk must NOT be served the SPA fallback: its bytes
    # must differ from index.html (a 200-with-index.html is the bug).
    assert res.data != index_res.data


# ─── H7: canonicalize at ingest ──────────────────────────────────────────

def test_ingest_canonicalizes_enroll_ids(seed_gym):
    from app.adms.routes import _parse_operlog_enrollment, _parse_userinfo_line
    from app.services.rrr_service import normalize_attendance

    gym_id = seed_gym["gym"].id
    assert _parse_userinfo_line("USER PIN=042\tName=Ramesh\tPri=0")["enroll_number"] == "42"
    assert _parse_operlog_enrollment("USER PIN=042\tName=Ramesh\tPri=0")["enroll_number"] == "42"

    event, created = normalize_attendance(
        gym_id=gym_id,
        source="adms_direct",
        biometric_user_id="042",
        punch_time=datetime.now(timezone.utc),
    )
    assert created is True
    assert event.biometric_user_id == "42"


def test_remap_replays_legacy_zero_padded_rows(seed_gym):
    from app.services.rrr_service import remap_unresolved

    gym = seed_gym["gym"]
    member = _member(gym.id, seed_gym["plan"].id, name="Legacy Pad",
                     phone="+919100020101")
    # A row stored before the H7 fix, under the raw "042" form.
    legacy = RRRAttendanceEvent(
        gym_id=gym.id,
        source="adms_direct",
        biometric_user_id="042",
        punch_time=datetime.now(timezone.utc),
        processing_status="unmapped",
        dedupe_key="legacy-zero-pad-042",
    )
    db.session.add(legacy)
    db.session.commit()

    replayed = remap_unresolved(gym.id, "42", member, seed_gym["owner"].id)
    assert replayed == 1
    db.session.refresh(legacy)
    assert legacy.processing_status == "processed"
    assert legacy.member_id == member.id


# ─── M13: Live Access feed ───────────────────────────────────────────────

def test_live_access_dedupes_filters_and_paginates(seed_gym, seed_member):
    from app.services.access_event_service import get_access_events

    gym = seed_gym["gym"]
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=30)

    # One ADMS punch already projected into AccessEvent (duplicate
    # candidate), one unprojected ADMS punch today, one unprojected
    # punch 30 days ago (must not appear under "today").
    projected = RRRAttendanceEvent(
        gym_id=gym.id, source="adms_direct",
        member_id=seed_member.id, biometric_user_id="77",
        punch_time=now - timedelta(minutes=5), processing_status="processed",
        dedupe_key="m13-projected",
    )
    fresh = RRRAttendanceEvent(
        gym_id=gym.id, source="adms_direct",
        member_id=seed_member.id, biometric_user_id="77",
        punch_time=now - timedelta(minutes=2), processing_status="processed",
        dedupe_key="m13-fresh",
    )
    stale = RRRAttendanceEvent(
        gym_id=gym.id, source="adms_direct",
        member_id=seed_member.id, biometric_user_id="77",
        punch_time=old, processing_status="processed",
        dedupe_key="m13-stale",
    )
    db.session.add_all([projected, fresh, stale])
    db.session.flush()
    db.session.add(AccessEvent(
        gym_id=gym.id, member_id=seed_member.id,
        event_type="ENTRY", direction="IN",
        event_timestamp=projected.punch_time,
        received_timestamp=now,
        device_enroll_number="77",
        source_event_id=f"rrr-attendance-{projected.id}",
        member_name=seed_member.full_name,
    ))
    db.session.commit()

    page1 = get_access_events(gym.id, "Asia/Kolkata", page=1, per_page=1, date_filter="today")
    assert page1["pagination"]["total"] == 2  # projected AccessEvent + fresh ADMS
    assert page1["pagination"]["total_pages"] == 2
    assert len(page1["events"]) == 1

    page2 = get_access_events(gym.id, "Asia/Kolkata", page=2, per_page=1, date_filter="today")
    assert len(page2["events"]) == 1
    assert page1["events"][0]["id"] != page2["events"][0]["id"]
    # The stale punch never appears under "today".
    ids = {e["id"] for e in page1["events"] + page2["events"]}
    assert f"adms-{stale.id}" not in ids
    # No duplicate: the projected punch appears exactly once, as the
    # AccessEvent row, never also as adms-<id>.
    assert f"adms-{projected.id}" not in ids


# ─── H9 / M11: mappings freed, deleted members never resolve ────────────

def test_unenroll_deletes_identity_mapping(client, seed_gym):
    gym = seed_gym["gym"]
    member = _member(gym.id, seed_gym["plan"].id, name="Enrolled",
                     phone="+919100020102", enroll="55")
    db.session.add(RRRIdentityMapping(
        gym_id=gym.id, external_id="55", member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/unenroll",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym.id, member_id=member.id).count() == 0
    # The ID is reusable now: a different member can take it.
    other = _member(gym.id, seed_gym["plan"].id, name="Next",
                    phone="+919100020103")
    res = client.post(
        f"/api/mobile/v1/members/{other.id}/enroll",
        headers=_owner_headers(seed_gym),
        json={"enroll_number": "55"},
    )
    assert res.status_code == 200


def test_soft_delete_frees_mapping_and_mapped_member_ignores_deleted(client, seed_gym):
    from app.services.rrr_service import _mapped_member

    gym = seed_gym["gym"]
    member = _member(gym.id, seed_gym["plan"].id, name="Doomed",
                     phone="+919100020104", enroll="66")
    db.session.add(RRRIdentityMapping(
        gym_id=gym.id, external_id="66", member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()
    assert _mapped_member(gym.id, "66") is not None

    res = client.post(
        f"/api/mobile/v1/members/{member.id}/deactivate",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    assert RRRIdentityMapping.query.filter_by(
        gym_id=gym.id, member_id=member.id).count() == 0
    # Neither the (deleted) mapping branch nor the enroll fallback may
    # resolve a soft-deleted member.
    assert _mapped_member(gym.id, "66") is None


# ─── H11: auto-link throttled off the hot path ───────────────────────────

def test_auto_link_runs_once_per_interval_and_only_for_snapshot_ids(seed_gym):
    from app.services import enroll_match_service
    from app.services.rrr_service import normalize_attendance

    gym = seed_gym["gym"]
    _adms_integration(seed_gym)
    member = _member(gym.id, seed_gym["plan"].id, name="John Doe",
                     phone="+919100020105")
    # Terminal snapshot contains enroll 77 / John Doe only.
    db.session.add(RRRAdmsCommand(
        gym_id=gym.id,
        integration_id=RRRIntegration.query.filter_by(gym_id=gym.id).first().id,
        action="sync_users",
        status="acked",
        command_text="DATA QUERY USERINFO",
        result_data=json.dumps({"users": [{"enroll_number": "77", "name": "John Doe"}]}),
    ))
    db.session.commit()

    # V3-M15: the throttle moved from rrr_service to enroll_match_service
    # (shared by ATTLOG ingest and the OPERLOG path).
    enroll_match_service._AUTO_LINK_LAST_RUN.clear()
    event, _ = normalize_attendance(
        gym_id=gym.id, source="adms_direct", biometric_user_id="77",
        punch_time=datetime.now(timezone.utc),
    )
    assert enroll_match_service._AUTO_LINK_LAST_RUN.get(gym.id) is not None
    db.session.refresh(member)
    assert member.device_enroll_number == "77"

    first_run = enroll_match_service._AUTO_LINK_LAST_RUN[gym.id]
    # A second unmapped punch inside the interval must NOT re-run the
    # fuzzy scan, even for an ID that is not in the snapshot.
    normalize_attendance(
        gym_id=gym.id, source="adms_direct", biometric_user_id="99",
        punch_time=datetime.now(timezone.utc),
    )
    assert enroll_match_service._AUTO_LINK_LAST_RUN[gym.id] == first_run


# ─── B-H9: unresolved mappings pagination ────────────────────────────────

def _unmapped(gym_id, bio_id, minutes_ago):
    row = RRRAttendanceEvent(
        gym_id=gym_id, source="adms_direct", biometric_user_id=bio_id,
        punch_time=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        processing_status="unmapped",
        dedupe_key=f"bh9-{bio_id}-{minutes_ago}",
    )
    db.session.add(row)
    return row


def test_unresolved_mappings_paginated_and_grouped(client, seed_gym):
    gym = seed_gym["gym"]
    _unmapped(gym.id, "71", 1)
    _unmapped(gym.id, "71", 2)
    _unmapped(gym.id, "72", 3)
    db.session.commit()

    res = client.get(
        "/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=1",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["pagination"] == {"page": 1, "per_page": 1, "total": 2, "total_pages": 2}
    assert len(data["groups"]) == 1
    group = data["groups"][0]
    assert group["biometric_user_id"] == "71"
    assert group["punch_count"] == 2
    assert group["latest_event_id"] is not None

    res = client.get(
        "/api/mobile/v1/rrr/mappings/unresolved?page=2&per_page=1",
        headers=_owner_headers(seed_gym),
    )
    data = res.get_json()["data"]
    assert data["groups"][0]["biometric_user_id"] == "72"
    assert data["groups"][0]["punch_count"] == 1


def test_unresolved_mappings_legacy_shape_capped(client, seed_gym):
    gym = seed_gym["gym"]
    _unmapped(gym.id, "73", 1)
    db.session.commit()
    res = client.get(
        "/api/mobile/v1/rrr/mappings/unresolved",
        headers=_owner_headers(seed_gym),
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert "events" in data and "groups" not in data
    assert data["total"] == 1
    assert data["events"][0]["biometric_user_id"] == "73"


# ─── H3 / H4-legacy: legacy bulk renew ───────────────────────────────────

def test_bulk_renew_uses_gym_local_today_and_previous_start(client, seed_gym):
    gym = seed_gym["gym"]
    gym.timezone = "America/New_York"
    db.session.commit()
    member = _member(
        gym.id, seed_gym["plan"].id, name="Bulk",
        phone="+919100020106", status="expired",
        start=date.today() - timedelta(days=60),
        end=date.today() - timedelta(days=5),
    )
    old_start = member.membership_start
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30",
              "amount": "1000", "notes": "legacy"},
    )
    assert res.status_code == 302
    db.session.refresh(member)
    # V3-L15: expired members default to previous_end + 1 (continuity),
    # not forced to today — a renewal paid days ago keeps its paid days.
    # V3-H4: membership_start is the current period's start.
    assert member.membership_start == date.today() - timedelta(days=4)
    assert member.membership_end == member.membership_start + timedelta(days=29)
    history = RenewalHistory.query.filter_by(member_id=member.id).one()
    assert history.previous_start == old_start
    assert history.previous_end == date.today() - timedelta(days=5)


def test_bulk_renew_rejects_off_plan_days(client, seed_gym):
    gym = seed_gym["gym"]
    member = _member(
        gym.id, seed_gym["plan"].id, name="Bulk Off Grid",
        phone="+919100020107", status="expired",
        start=date.today() - timedelta(days=60),
        end=date.today() - timedelta(days=5),
    )
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "45",
              "amount": "1000"},
        follow_redirects=True,
    )
    assert res.status_code == 200
    db.session.refresh(member)
    assert member.membership_end == date.today() - timedelta(days=5)
    assert RenewalHistory.query.filter_by(member_id=member.id).count() == 0


def test_bulk_renew_keeps_paused_member_paused(client, seed_gym):
    gym = seed_gym["gym"]
    member = _member(
        gym.id, seed_gym["plan"].id, name="Bulk Paused",
        phone="+919100020108", status="paused",
        start=date.today() - timedelta(days=60),
        end=date.today() - timedelta(days=5),
    )
    _login_owner(client, seed_gym)
    res = client.post(
        "/members/bulk-renew",
        data={"member_ids": [str(member.id)], "renewal_days": "30",
              "amount": "1000"},
    )
    assert res.status_code == 302
    db.session.refresh(member)
    assert member.status == "paused"


def test_member_form_rejects_off_grid_end(client, seed_gym):
    gym = seed_gym["gym"]
    start = date.today() - timedelta(days=10)
    member = _member(
        gym.id, seed_gym["plan"].id, name="Form Grid",
        phone="+919100020109", start=start,
        end=start + timedelta(days=29),
    )
    _login_owner(client, seed_gym)
    res = client.post(
        f"/members/{member.id}/edit",
        data={
            "full_name": "Form Grid",
            "phone": "+919100020109",
            "email": "",
            "gender": "",
            "plan_id": str(seed_gym["plan"].id),
            "membership_start": start.isoformat(),
            "membership_end": (start + timedelta(days=45)).isoformat(),
            "status": "active",
            "notes": "",
        },
    )
    # Re-rendered with the grid error, nothing saved.
    assert res.status_code == 200
    db.session.refresh(member)
    assert member.membership_end == start + timedelta(days=29)


# ─── M4 / M5: Date Repair ────────────────────────────────────────────────

def _history_row(gym_id, member_id, plan_id, *, prev_end, new_start, new_end):
    row = RenewalHistory(
        gym_id=gym_id, member_id=member_id, plan_id=plan_id,
        previous_end=prev_end, new_start=new_start, new_end=new_end,
        amount=1000,
    )
    db.session.add(row)
    return row


def test_date_repair_span_proposal_is_duration_minus_one(seed_gym):
    from app.mobile_api.date_repair import classify_member

    gym = seed_gym["gym"]
    start = date.today() - timedelta(days=15)
    member = _member(gym.id, seed_gym["plan"].id, name="Span",
                     phone="+919100020110", start=start,
                     end=start + timedelta(days=91))
    finding = classify_member(member, [], today=date.today())
    assert finding["classification"] == "span_mismatch"
    assert finding["proposed_end"] == (start + timedelta(days=29)).isoformat()


def test_date_repair_ledger_checks_handle_restarts(seed_gym):
    from app.mobile_api.date_repair import classify_member

    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    start = date.today() - timedelta(days=100)
    first_end = start + timedelta(days=29)
    # Creation row, then a restart row (gap after expiry), then a
    # hand-edited stored end past the ledger's latest end. The stored
    # start is the restart row's start (the current chain start), so
    # the S3 start check passes and the ledger check is reached.
    restart_start = date.today() - timedelta(days=10)
    restart_end = restart_start + timedelta(days=29)
    member = _member(gym.id, plan_id, name="Restart Ledger",
                     phone="+919100020111", start=restart_start,
                     end=first_end + timedelta(days=100))
    rows = [
        _history_row(gym.id, member.id, plan_id, prev_end=start,
                     new_start=start, new_end=first_end),
        _history_row(gym.id, member.id, plan_id, prev_end=first_end,
                     new_start=restart_start, new_end=restart_end),
    ]
    db.session.commit()
    finding = classify_member(member, rows, today=date.today())
    assert finding is not None
    assert finding["classification"] == "ledger_mismatch"
    assert finding["proposed_end"] == restart_end.isoformat()


def test_date_repair_oversized_renewal_flagged_despite_restart(seed_gym):
    from app.mobile_api.date_repair import classify_member

    gym = seed_gym["gym"]
    plan_id = seed_gym["plan"].id
    start = date.today() - timedelta(days=100)
    first_end = start + timedelta(days=29)
    # Genuine restart: the new period starts 2+ days after the previous
    # period ended (not the normal +1 chaining day). The stored start is
    # the restart row's start (the current chain start), so the S3
    # start check passes and the oversized check is reached.
    restart_start = date.today() - timedelta(days=69)
    # Restart row applies 61 days on a 30-day plan.
    bad_end = restart_start + timedelta(days=60)
    member = _member(gym.id, plan_id, name="Restart Oversized",
                     phone="+919100020112", start=restart_start, end=bad_end)
    rows = [
        _history_row(gym.id, member.id, plan_id, prev_end=start,
                     new_start=start, new_end=first_end),
        _history_row(gym.id, member.id, plan_id, prev_end=first_end,
                     new_start=restart_start, new_end=bad_end),
    ]
    db.session.commit()
    finding = classify_member(member, rows, today=date.today())
    assert finding is not None
    assert finding["classification"] == "oversized_renewal"
    assert finding["proposed_end"] == (bad_end - timedelta(days=31)).isoformat()


def test_date_repair_scan_includes_paused_members(client, seed_gym):
    gym = seed_gym["gym"]
    start = date.today() - timedelta(days=15)
    _member(gym.id, seed_gym["plan"].id, name="Paused Span",
            phone="+919100020113", status="paused", start=start,
            end=start + timedelta(days=91))
    res = client.get(
        "/api/mobile/v1/date-repair/scan", headers=_owner_headers(seed_gym)
    )
    flagged = res.get_json()["data"]["flagged"]
    assert len(flagged) == 1
    assert flagged[0]["classification"] == "span_mismatch"


# ─── M3 / B-M3: paused stays paused ──────────────────────────────────────

def _paused_member(seed_gym, **kwargs):
    return _member(
        seed_gym["gym"].id, seed_gym["plan"].id, status="paused",
        start=date.today() - timedelta(days=60),
        end=date.today() + timedelta(days=30), **kwargs,
    )


def test_verify_payment_keeps_paused_member_paused(seed_gym):
    from app.services.payment_service import verify_payment

    member = _paused_member(seed_gym, name="Paused Verify",
                            phone="+919100020114")
    payment = PaymentVerification(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        amount=1000, status="pending", renewal_days=30,
    )
    db.session.add(payment)
    db.session.commit()
    verify_payment(payment, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()
    db.session.refresh(member)
    assert member.status == "paused"
    # The renewal chains from the current end (today+30), so its start
    # (today+31) is in the future: verify_payment schedules it instead
    # of moving the current dates. Paused is what must survive.
    assert member.membership_end == date.today() + timedelta(days=30)
    scheduled = RenewalHistory.query.filter_by(
        payment_verification_id=payment.id).one()
    assert scheduled.new_start == date.today() + timedelta(days=31)


def test_direct_renewal_keeps_paused_member_paused(client, seed_gym):
    member = _paused_member(seed_gym, name="Paused Renew",
                            phone="+919100020115")
    res = client.post(
        f"/api/mobile/v1/renewals/{member.id}",
        headers=_owner_headers(seed_gym),
        json={"renewal_days": 30, "amount": "1000.00"},
    )
    assert res.status_code == 201
    db.session.refresh(member)
    assert member.status == "paused"


def test_refund_keeps_paused_member_paused(seed_gym):
    from app.services.payment_service import refund_payment, verify_payment

    member = _paused_member(seed_gym, name="Paused Refund",
                            phone="+919100020116")
    payment = PaymentVerification(
        gym_id=seed_gym["gym"].id, member_id=member.id,
        amount=1000, status="pending", renewal_days=30,
    )
    db.session.add(payment)
    db.session.commit()
    verify_payment(payment, verified_by_id=seed_gym["owner"].id, renewal_days=30)
    db.session.commit()
    refund_payment(payment, refunded_by_id=seed_gym["owner"].id)
    db.session.commit()
    db.session.refresh(member)
    assert member.status == "paused"


# ─── B-M2: timezone validated on save ────────────────────────────────────

def test_settings_rejects_invalid_timezone(client, seed_gym):
    res = client.patch(
        "/api/mobile/v1/settings",
        headers=_owner_headers(seed_gym),
        json={"timezone": "Not/AZone"},
    )
    assert res.status_code == 400
    db.session.refresh(seed_gym["gym"])
    assert seed_gym["gym"].timezone != "Not/AZone"

    res = client.patch(
        "/api/mobile/v1/settings",
        headers=_owner_headers(seed_gym),
        json={"timezone": "Asia/Kolkata"},
    )
    assert res.status_code == 200


# ─── M9 / B-L1: duplicate reference + enums ──────────────────────────────

def _verified_payment_with_ref(seed_gym, member_id, reference):
    row = PaymentVerification(
        gym_id=seed_gym["gym"].id, member_id=member_id,
        amount=1000, status="verified", reference=reference,
        renewal_days=30,
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_create_payment_rejects_duplicate_verified_reference(client, seed_gym, seed_member):
    _verified_payment_with_ref(seed_gym, seed_member.id, "UTR-DUP-1")
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "amount": "1000",
              "method": "upi", "channel": "offline",
              "reference": "UTR-DUP-1", "renewal_days": 30},
    )
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "DUPLICATE_REFERENCE"


def test_create_payment_validates_method_and_channel(client, seed_gym, seed_member):
    res = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "amount": "1000",
              "method": "cashh", "renewal_days": 30},
    )
    assert res.status_code == 400

    res = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "amount": "1000",
              "method": "upi", "channel": "whatsapp", "renewal_days": 30},
    )
    assert res.status_code == 400

    res = client.post(
        "/api/mobile/v1/payments",
        headers=_owner_headers(seed_gym),
        json={"member_id": seed_member.id, "amount": "1000",
              "method": "upi", "channel": "offline",
              "reference": "UTR-OK-1", "renewal_days": 30},
    )
    assert res.status_code == 201


def test_direct_renewal_validates_channel(client, seed_gym, seed_member):
    res = client.post(
        f"/api/mobile/v1/renewals/{seed_member.id}",
        headers=_owner_headers(seed_gym),
        json={"renewal_days": 30, "amount": "1000.00", "channel": "smoke-signal"},
    )
    assert res.status_code == 400


# ─── M1: grid check on import paths ──────────────────────────────────────

def test_batch_create_rejects_off_grid_end(client, seed_gym):
    res = client.post(
        "/api/mobile/v1/members/batch-create",
        headers=_owner_headers(seed_gym),
        json={"members": [{
            "name": "Off Grid", "phone": "+919100020117",
            "plan_id": seed_gym["plan"].id,
            "membership_start": (date.today() - timedelta(days=10)).isoformat(),
            "membership_end": (date.today() + timedelta(days=35)).isoformat(),
        }]},
    )
    assert res.status_code == 422


def test_csv_import_preview_flags_off_grid_end(client, seed_gym):
    from app.services.mobile_member_import_service import validate_csv

    preview = validate_csv(
        seed_gym["gym"].id, "Asia/Kolkata",
        "full_name,phone,membership_start,membership_end,plan,status\n"
        f"Off Grid,+919100020118,"
        f"{(date.today() - timedelta(days=10)).isoformat()},"
        f"{(date.today() + timedelta(days=35)).isoformat()},"
        "Monthly Standard,active\n",
    )
    assert preview["rows"][0]["errors"]
    assert any("grid" in err for err in preview["rows"][0]["errors"])


# ─── M12 residual: scheduler covers mapping-only members ─────────────────

def test_scheduler_reconcile_requeues_mapping_only_member(app, seed_gym):
    from app.services.reminder_scheduler import _scheduled_reminder_job

    gym = seed_gym["gym"]
    integration = _adms_integration(seed_gym)
    member = _member(
        gym.id, seed_gym["plan"].id, name="Mapping Only",
        phone="+919100020119", status="expired",
        start=date.today() - timedelta(days=60),
        end=date.today() - timedelta(days=5),
    )
    # No device_enroll_number — only a confirmed mapping to ID 88.
    db.session.add(RRRIdentityMapping(
        gym_id=gym.id, external_id="88", member_id=member.id,
        source="adms_direct", status="confirmed",
    ))
    db.session.commit()

    _scheduled_reminder_job(app)

    queued = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, action="block",
        test_enroll_number="88",
    ).first()
    assert queued is not None
