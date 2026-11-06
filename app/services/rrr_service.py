"""Real-data Revenue / Retain / Recover calculations and attendance normalization."""
from __future__ import annotations

import hashlib
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import AccessEvent, Gym, Member, MembershipPlan, PaymentVerification, QRSettings
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAttendanceEvent,
    RRRDevice,
    RRRIdentityMapping,
    RRRIntegration,
    RRROpportunity,
    RRRRule,
)
from app.services.timezone_service import today_for_gym


DEFAULT_RULES = {
    "expiry_days": 30,
    "no_visit_days": 14,
    "attendance_drop_percent": 50,
    "recent_expiry_days": 30,
}


def _canonical_or_raw(value: object) -> str:
    """Canonical enroll number ("042" -> "42"); raw value when the ID is
    non-numeric (M16 — such IDs can never link, but must keep their
    stored form so punches are not dropped).

    Standing rule (V4-L31): never GROUP BY biometric_user_id raw —
    historical punch/bridge rows keep their raw enroll numbers (the
    c4a9012b3d4e backfill canonicalizes stored member/template/mapping
    rows only, never event facts), so canonicalize with this helper
    first or "042" and "42" split into two groups for one terminal ID.
    """
    try:
        from app.services.bridge_service import canonical_enroll_number

        return canonical_enroll_number(value)
    except ValueError:
        return str(value or "").strip()


# V3-M15: the auto-link scan throttle lives in enroll_match_service
# (auto_link_scan_due) so every trigger — ATTLOG ingest here, the
# OPERLOG post-upload path, manual scans — shares one per-gym gate.
# PER-PROCESS LIMIT (documented, not fixed): see auto_link_scan_due —
# each gunicorn worker holds its own copy of the last-run dict.


def delete_identity_mappings(gym_id: int, member_id: int) -> int:
    """Delete every RRR identity mapping pointing at *member_id* (H9).

    Called on unenroll + soft-delete so the terminal ID is freed for
    reuse: the mapping branch of ``_mapped_member`` and Guard 3 of
    ``remap_unresolved`` both only see ``status="confirmed"`` rows, so
    removing the rows unblocks the ID. Returns the rows deleted.
    """
    rows = RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, member_id=member_id
    ).all()
    for row in rows:
        db.session.delete(row)
    return len(rows)


def rules_for_gym(gym_id: int) -> dict[str, int]:
    values = dict(DEFAULT_RULES)
    for rule in RRRRule.query.filter_by(gym_id=gym_id, is_enabled=True).all():
        values[rule.rule_key] = rule.value
    return values


def attendance_visit_counts(
    gym_id: int,
    member_ids: list[int],
    gym_timezone: str,
    today=None,
) -> dict[int, tuple[int, int]]:
    """Count distinct local attendance days for recent and baseline 14-day windows.

    A terminal may emit both entry and exit punches, or duplicate scans on one
    day. Counting raw rows would inflate visit frequency and create false
    attendance-drop signals, so one member can contribute at most one visit per
    local calendar day.
    """
    if not member_ids:
        return {}

    today = today or today_for_gym(gym_timezone)
    recent_start_day = today - timedelta(days=13)
    baseline_start_day = today - timedelta(days=27)
    try:
        zone = ZoneInfo(gym_timezone or "Asia/Kolkata")
    except Exception:
        zone = ZoneInfo("Asia/Kolkata")
    baseline_start = datetime.combine(baseline_start_day, datetime.min.time(), tzinfo=zone)
    rows = (
        db.session.query(RRRAttendanceEvent.member_id, RRRAttendanceEvent.punch_time)
        .filter(
            RRRAttendanceEvent.gym_id == gym_id,
            RRRAttendanceEvent.member_id.in_(member_ids),
            RRRAttendanceEvent.punch_time >= baseline_start.astimezone(timezone.utc),
        )
        .all()
    )
    # Manual check-ins and normalized device events are stored in the shared
    # access feed. Merge them with RRR rows and deduplicate by local calendar
    # day so either ingestion path produces the same attendance signal.
    rows.extend(
        db.session.query(AccessEvent.member_id, AccessEvent.event_timestamp)
        .filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.member_id.in_(member_ids),
            AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]),
            AccessEvent.event_timestamp >= baseline_start.astimezone(timezone.utc),
        )
        .all()
    )
    recent_days: dict[int, set] = defaultdict(set)
    baseline_days: dict[int, set] = defaultdict(set)
    for member_id, punch_time in rows:
        if punch_time.tzinfo is None:
            punch_time = punch_time.replace(tzinfo=timezone.utc)
        local_day = punch_time.astimezone(zone).date()
        if local_day >= recent_start_day:
            recent_days[member_id].add(local_day)
        elif local_day >= baseline_start_day:
            baseline_days[member_id].add(local_day)
    return {
        member_id: (len(recent_days[member_id]), len(baseline_days[member_id]))
        for member_id in member_ids
    }


ADMS_RECENT_POLL_WINDOW = timedelta(minutes=5)


def direct_adms_terminal_last_seen_at(integration: RRRIntegration):
    """Return the latest authenticated sighting for this integration's serial."""
    if not integration.device_serial:
        return None
    device = RRRDevice.query.filter_by(
        integration_id=integration.id,
        serial_number=integration.device_serial,
    ).first()
    seen_at = device.last_seen_at if device else integration.last_success_at
    if seen_at is not None and seen_at.tzinfo is None:
        seen_at = seen_at.replace(tzinfo=timezone.utc)
    return seen_at


def direct_adms_terminal_is_online(
    integration: RRRIntegration, *, last_seen_at=None
) -> bool:
    """Treat a recent authenticated poll as online for commissioning.

    X2008 devices that cannot send the ADMS path token use the owner's
    serial-fallback setting. Those authenticated requests refresh
    ``RRRDevice.last_seen_at`` but intentionally do not clear auth errors or
    set the integration's stronger token-authenticated ``connected`` state.
    The commissioning UI and test endpoint accept a recent sighting only
    when the integration is token-connected or serial fallback is enabled.
    """
    if last_seen_at is None:
        last_seen_at = direct_adms_terminal_last_seen_at(integration)
    if last_seen_at is None:
        return False
    if integration.status != "connected" and not integration.allow_serial_fallback:
        return False
    return last_seen_at >= utcnow() - ADMS_RECENT_POLL_WINDOW


def ensure_default_rules(gym_id: int) -> list[RRRRule]:
    existing = {rule.rule_key for rule in RRRRule.query.filter_by(gym_id=gym_id).all()}
    created = []
    for key, value in DEFAULT_RULES.items():
        if key not in existing:
            item = RRRRule(gym_id=gym_id, rule_key=key, value=value)
            db.session.add(item)
            created.append(item)
    return created


def _dedupe_key(source: str, device_serial: str | None, external_event_id: str | None,
                biometric_user_id: str, punch_time, raw_payload: str = "",
                direction: str | None = None) -> str:
    # The same physical punch may arrive through eBioServer and a direct SDK
    # connector. Source IDs differ, so deduplicate by physical device/user/time.
    # V3-L8: canonicalize the serial (upper-case, strip) so a terminal
    # whose serial is spelled differently per upload does not double-count
    # the same punch; include direction so an entry+exit at the same second
    # no longer collapse into one row.
    stable = "|".join((
        (device_serial or "").strip().upper(), biometric_user_id,
        punch_time.isoformat(), str(direction or ""),
    ))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _legacy_dedupe_keys(device_serial: str | None, biometric_user_id: str,
                       punch_time, direction: str | None = None) -> list[str]:
    """Pre-L8 dedupe keys to probe on a miss (V4-M8, V4-L13).

    * V4-M8: the Yodha punch-time migration recomputed ``dedupe_key`` in
      the old format — raw serial, no direction suffix. A re-send of a
      migrated row computes a new-format key that never matches, so the
      punch would insert as a duplicate. Probing the old 3-part key
      keeps the migration's re-send guarantee.
    * V4-L13: the same punch arriving once with direction present and
      once without (old bridge vs new) computes two different new-format
      keys. Probing the direction-less new-format key catches that pair.
    Probing is read-only and cheap (indexed equality lookups); nothing
    is rewritten.
    """
    keys: list[str] = []
    iso = punch_time.isoformat()
    # Direction-less new-format key (canonical serial + empty direction).
    directionless = hashlib.sha256(
        "|".join(((device_serial or "").strip().upper(), biometric_user_id, iso, "")).encode("utf-8")
    ).hexdigest()
    if directionless:
        keys.append(directionless)
    # Old-format keys (migration 71e470eb6cb6): raw serial, 3 parts, no
    # direction. Try the serial as passed and its canonical spelling —
    # the migration used the stored serial verbatim.
    for serial_variant in {(device_serial or ""), (device_serial or "").strip().upper()}:
        old = hashlib.sha256(
            "|".join((serial_variant, biometric_user_id, iso)).encode("utf-8")
        ).hexdigest()
        if old not in keys:
            keys.append(old)
    return keys


def _mapped_member(gym_id: int, biometric_user_id: str) -> Member | None:
    # M2: the mapping row is gym-scoped, but the member it points at must
    # be verified too — a cross-gym member reference must never be returned
    # for this gym.  On mismatch, fall through to the gym-scoped enroll
    # query (which can only return a member of this gym) or None.
    # M11: a soft-deleted member must never resolve — neither via the
    # mapping branch nor via the enroll fallback.
    # V4-M6: canonicalize the mapping-branch lookup the same way the
    # enroll fallback is canonicalized — a stored pre-fix mapping
    # "042" is invisible to an exact "42" lookup, so a second mapping
    # row "42" could be created alongside it for the same canonical ID.
    from app.services.bridge_service import find_confirmed_mapping

    mapping = find_confirmed_mapping(gym_id, biometric_user_id)
    if mapping and mapping.member_id:
        member = mapping.member
        if (
            member is not None
            and member.gym_id == gym_id
            and member.deleted_at is None
        ):
            return member
    # V3-H3: canonical-aware enroll fallback — a member stored pre-fix
    # as "042" is invisible to an exact "42" lookup, so its punches
    # would attribute to whichever other member the mapping points at.
    from app.services.bridge_service import find_member_by_enroll_number

    member = find_member_by_enroll_number(gym_id, biometric_user_id)
    if member is not None and member.deleted_at is None:
        return member
    return None


def normalize_attendance(*, gym_id: int, source: str, biometric_user_id: str, punch_time,
                         external_event_id: str | None = None, device_serial: str | None = None,
                         direction: str | None = None, verify_method: str | None = None,
                         integration_id: int | None = None, raw_payload: str = "",
                         auth_method: str | None = None) -> tuple[RRRAttendanceEvent, bool]:
    """Store a source-neutral attendance event once and retain unmapped events.

    ``auth_method`` records how the push was authenticated ("token",
    "token_prev", "serial", or None for non-ADMS sources). The
    commissioning gate reads it: see H1 in the ADMS auth hardening.
    """
    # H7: canonicalize once at the ingest boundary ("042" -> "42") so
    # stored IDs, dedupe keys and mappings all agree. Non-numeric IDs
    # keep their raw form (M16).
    biometric_user_id = _canonical_or_raw(biometric_user_id)
    key = _dedupe_key(source, device_serial, external_event_id, biometric_user_id, punch_time, raw_payload,
                      direction=direction)
    existing = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
    if existing is None:
        # V4-M8 / V4-L13: probe legacy keys before inserting — a re-send
        # of a Yodha-migrated row (old-format key) or of a punch first
        # seen without a direction must dedupe, not insert a duplicate.
        for legacy_key in _legacy_dedupe_keys(
            device_serial, biometric_user_id, punch_time, direction=direction
        ):
            if legacy_key == key:
                continue
            existing = RRRAttendanceEvent.query.filter_by(
                gym_id=gym_id, dedupe_key=legacy_key
            ).first()
            if existing is not None:
                break
    if existing:
        return existing, False
    member = _mapped_member(gym_id, biometric_user_id)

    # Auto-link: if no direct enroll-number match, try high-confidence name matching
    # This runs automatically on every unmapped punch — no button needed.
    # Savepoint: auto-link mutates member rows, and a failed flush (e.g. a
    # duplicate enroll number) poisons the whole session — the next
    # begin_nested() then raises PendingRollbackError, which is NOT an
    # IntegrityError, so it escapes and 500s the entire ATTLOG batch.
    # The terminal retries that batch forever (sync stall, polls green).
    # Rolling back to this savepoint keeps the punch ingestable as unmapped.
    # H11: throttled OFF the ingest hot path — at most one fuzzy scan per
    # gym per interval, and only when this punch's own ID is in the
    # terminal snapshot (otherwise the scan cannot link this punch at
    # all). The OPERLOG post-upload path and the manual scan still run
    # unthrottled; ingest just stops paying the full scan per punch.
    if not member:
        # V3-M15: shared per-gym throttle (see enroll_match_service).
        # V4-M7: the ingest scan is scoped to THIS punch's ID only —
        # auto_link_high_confidence(enroll_number=...) uses the targeted
        # O(members) matcher instead of the full O(snapshot x members)
        # fuzzy scan, so one punch never pays for a whole-gym scan.
        from app.services.enroll_match_service import auto_link_scan_due

        if auto_link_scan_due(gym_id):
            try:
                with db.session.begin_nested():
                    from app.services.enroll_match_service import auto_link_high_confidence
                    result = auto_link_high_confidence(
                        gym_id=gym_id, enroll_number=biometric_user_id
                    )
                    # If this specific ID got linked, fetch the member
                    for linked in result.get("linked", []):
                        if str(linked.get("enroll_number")) == str(biometric_user_id):
                            member = _mapped_member(gym_id, biometric_user_id)
                            break
            except Exception:
                pass  # Auto-link is best-effort; don't break punch ingestion
    
    event = RRRAttendanceEvent(
        gym_id=gym_id,
        integration_id=integration_id,
        member_id=member.id if member else None,
        source=source,
        device_serial=device_serial,
        external_event_id=external_event_id,
        biometric_user_id=biometric_user_id,
        punch_time=punch_time,
        direction=direction,
        verify_method=verify_method,
        dedupe_key=key,
        raw_payload_hash=hashlib.sha256(raw_payload.encode("utf-8")).hexdigest() if raw_payload else None,
        processing_status="processed" if member else "unmapped",
        auth_method=auth_method,
    )
    # Insert in a savepoint: two concurrent ingestions of the same punch
    # both pass the check above; the loser hits the unique constraint and
    # must return the winner's row instead of 500ing the whole batch.
    try:
        with db.session.begin_nested():
            db.session.add(event)
            db.session.flush()
    except IntegrityError:
        existing = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
        if existing is not None:
            return existing, False
        raise
    return event, True


def remap_unresolved(gym_id: int, external_id: str, member: Member, user_id: int | None,
                   source: str | None = None, queue_command: bool = True) -> int:
    """Link a biometric ID to a member, backfilling unmapped punches.

    Raises ValueError on conflict (member already linked to a different ID,
    or ID already linked to a different member). Queues the membership
    command so the terminal state matches (expired members get blocked).
    """
    from app.services.bridge_service import (
        canonical_enroll_number,
        clear_deleted_enroll_holder,
        find_confirmed_mapping,
        find_member_by_enroll_number,
        queue_membership_command,
    )

    external_id = canonical_enroll_number(external_id)
    # V3-M10: never link a biometric ID to a soft-deleted member — the
    # mapping would be confirmed but _mapped_member would never resolve
    # it, and Guard 3 would then brick the ID for every live member.
    if member.deleted_at is not None:
        raise ValueError("Member is deleted and cannot be linked to a biometric ID.")
    # Guard 1: member already linked to a different enroll number.
    # Compare canonical forms — a stored non-canonical value ("0103")
    # is the same ID as the canonical "103", not a different one.
    # V4-L10: use _canonical_or_raw, as confirm_match does — a stored
    # NON-numeric enroll number used to raise a misleading ValueError
    # ("must contain only digits") from canonical_enroll_number here.
    stored = _canonical_or_raw(member.device_enroll_number) if member.device_enroll_number else None
    if stored and stored != external_id:
        raise ValueError(
            f"This member already has enroll number {member.device_enroll_number}. "
            "Remove it first to reassign."
        )
    # Guard 3 BEFORE Guard 2 (V4-M21): in the real linked-then-deleted
    # case the deleted holder keeps device_enroll_number AND may still
    # hold a confirmed mapping, so Guard 2 used to fire first and the
    # stale-mapping cleanup in Guard 3 was unreachable — the ID stayed
    # bricked. Check the mapping first; a stale mapping to a deleted
    # member is dropped here, and the deleted enroll holder is freed
    # in the same step (see clear_deleted_enroll_holder) instead of
    # raising "held by a deleted member".
    # V4-M6: canonical-aware mapping lookup — a stored pre-fix mapping
    # "042" is invisible to an exact "42" lookup.
    existing_mapping = find_confirmed_mapping(gym_id, external_id)
    if existing_mapping is not None and existing_mapping.member_id != member.id:
        # V3-M10: a confirmed mapping pointing at a soft-deleted member
        # is stale — the ID was freed when the member was deleted
        # (delete_identity_mappings), or the link predates that cleanup.
        # Drop the stale row and let the live link proceed instead of
        # bricking the ID with "already linked to another member".
        mapped_member = (
            db.session.get(Member, existing_mapping.member_id)
            if existing_mapping.member_id is not None
            else None
        )
        if mapped_member is not None and mapped_member.deleted_at is not None:
            db.session.delete(existing_mapping)
            existing_mapping = None
            # The deleted holder also keeps device_enroll_number, which
            # Guard 2 (below) would still trip on — free it now, in the
            # same step, so the live link can proceed.
            clear_deleted_enroll_holder(gym_id, external_id, exclude_id=member.id)
        else:
            raise ValueError(
                f"Biometric ID {external_id} is already linked to another member."
            )
    # Guard 2: enroll number already linked to a different member.
    # NOTE: the unique constraint covers soft-deleted rows too, so this
    # check must not filter them out — otherwise the flush throws
    # UniqueViolation and poisons the caller's session.
    # V3-H3: canonical-aware lookup — an exact query misses a stored
    # zero-padded holder ("042"), letting a second member take "42".
    duplicate = find_member_by_enroll_number(
        gym_id, external_id, exclude_id=member.id
    )
    if duplicate is not None:
        if duplicate.deleted_at is not None:
            # V4-M21: the ID-101 class — a deleted member WITH
            # device_enroll_number set. The old code raised here and the
            # ID could never be reused without a manual cleanup. The
            # explicit owner link is the decision to reuse it: free the
            # deleted holder's enroll + mappings in one step and proceed.
            # (Terminal fingerprint purge is still the owner's job —
            # see clear_deleted_enroll_holder.)
            clear_deleted_enroll_holder(gym_id, external_id, exclude_id=member.id)
        else:
            raise ValueError(
                f"Enroll number {external_id} is already linked to {duplicate.full_name}."
            )

    # V4-M6: canonical-aware mapping upsert — a stored pre-fix mapping
    # "042" for this ID must be reused, not duplicated by a second "42"
    # row (the raw-string unique constraint would not fire).
    mapping = find_confirmed_mapping(gym_id, external_id)
    if mapping is None:
        mapping = RRRIdentityMapping.query.filter_by(gym_id=gym_id, external_id=external_id).first()
    if mapping is None:
        for row in RRRIdentityMapping.query.filter_by(gym_id=gym_id).all():
            if _canonical_or_raw(row.external_id) == external_id:
                mapping = row
                break
    if mapping is None:
        mapping = RRRIdentityMapping(
            gym_id=gym_id, external_id=external_id, member_id=member.id,
            source=source or "ebioserver", status="confirmed", confirmed_by_id=user_id,
        )
        db.session.add(mapping)
    else:
        mapping.member_id = member.id
        mapping.status = "confirmed"
        mapping.confirmed_by_id = user_id
    member.device_enroll_number = external_id
    # V3-L6: the canonical-enroll index cache must not keep resolving
    # the member's old ID to them after a remap.
    from app.services.bridge_service import invalidate_adms_enroll_index

    invalidate_adms_enroll_index(gym_id)
    # V4-M3: the enroll just changed hands — cancel any queued/delivered
    # commands for this ID that were intended for a different member, so a
    # stale manual block for the previous holder cannot serve against the
    # new holder (the active-skip link paths queue nothing to displace it).
    from app.services.bridge_service import displace_stale_enroll_commands

    displace_stale_enroll_commands(gym_id, external_id, new_member_id=member.id)
    # Backfill unmapped punches for this ID — including rows stored
    # before the H7 ingest canonicalization under a non-canonical form
    # ("042" vs "42"), which an exact-match query would never replay.
    # The LIKE pre-filter bounds the scan to IDs ending in these digits
    # (external_id is canonical digits-only here); the Python filter
    # then keeps only true canonical matches ("142" is not "42").
    candidates = RRRAttendanceEvent.query.filter(
        RRRAttendanceEvent.gym_id == gym_id,
        RRRAttendanceEvent.processing_status == "unmapped",
        RRRAttendanceEvent.biometric_user_id.like(f"%{external_id}"),
    ).all()
    events = [
        event
        for event in candidates
        if _canonical_or_raw(event.biometric_user_id) == external_id
    ]
    for event in events:
        event.member_id = member.id
        event.processing_status = "processed"
        if event.source == "adms_direct":
            from app.services.access_event_service import process_rrr_attendance_to_access_event

            process_rrr_attendance_to_access_event(event)
    # Only queue a terminal command when the desired state differs from what
    # the terminal already has. For active members the terminal already has
    # them (they were just enrolled/linked) — queuing a redundant "enable"
    # floods the bridge with hundreds of unnecessary commands. Expired
    # members always get their block queued.
    from app.services.bridge_service import desired_command_type
    if queue_command and desired_command_type(member) != "enable_user":
        queue_membership_command(member)
    return len(events)


def _upsert_opportunity(*, gym_id: int, member: Member, pillar: str, reason_code: str,
                        reason_text: str, priority: str, potential_revenue: Decimal,
                        existing: dict | None = None, dedupe_suffix: str = "") -> RRROpportunity:
    # Keep one opportunity per member per reason per membership cycle. A
    # member can renew and later become at risk again, so a lifetime key would
    # permanently suppress the next expiry/no-visit signal.
    cycle = member.membership_end.isoformat() if member.membership_end else "no-end"
    key = f"{pillar}:{reason_code}:{member.id}:{cycle}{dedupe_suffix}"
    row = (existing or {}).get(key)
    if row is None and existing is None:
        row = RRROpportunity.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
    if row is None:
        row = RRROpportunity(
            gym_id=gym_id, member_id=member.id, pillar=pillar, reason_code=reason_code,
            reason_text=reason_text, priority=priority, potential_revenue=potential_revenue,
            dedupe_key=key,
        )
        db.session.add(row)
        if existing is not None:
            existing[key] = row
    elif row.status in {"open", "actioned", "resolved"}:
        if row.status == "resolved":
            row.status = "open"
            row.closed_at = None
            row.outcome_revenue = Decimal("0")
        row.reason_text = reason_text
        row.priority = priority
        row.potential_revenue = potential_revenue
    return row


def refresh_opportunities(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> list[RRROpportunity]:
    """Calculate explainable opportunities from persisted operational data.

    Bulk-fetches everything up front: one members query (plan joined), one
    pending-payments query, one grouped attendance query, one opportunities
    query. No per-member queries — this runs on the dashboard request path.
    """
    rules = rules_for_gym(gym_id)
    today = today_for_gym(gym_timezone)
    now = utcnow()
    members = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None))
        .options(joinedload(Member.plan))
        .all()
    )
    member_ids = [m.id for m in members]
    if not member_ids:
        return []

    # Read the same two attendance sources used by retention nudges. Manual
    # check-ins and legacy bridge events live in AccessEvent; ignoring them
    # makes a member who checked in today look absent for weeks.
    last_visit = dict(
        db.session.query(RRRAttendanceEvent.member_id, func.max(RRRAttendanceEvent.punch_time))
        .filter(
            RRRAttendanceEvent.gym_id == gym_id,
            RRRAttendanceEvent.member_id.in_(member_ids),
        )
        .group_by(RRRAttendanceEvent.member_id)
        .all()
    )
    access_last_visits = (
        db.session.query(AccessEvent.member_id, func.max(AccessEvent.event_timestamp))
        .filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.member_id.in_(member_ids),
            AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]),
        )
        .group_by(AccessEvent.member_id)
        .all()
    )
    for member_id, access_visit in access_last_visits:
        previous = last_visit.get(member_id)
        candidate_cmp = access_visit
        previous_cmp = previous
        if candidate_cmp is not None and candidate_cmp.tzinfo is None:
            candidate_cmp = candidate_cmp.replace(tzinfo=timezone.utc)
        if previous_cmp is not None and previous_cmp.tzinfo is None:
            previous_cmp = previous_cmp.replace(tzinfo=timezone.utc)
        if previous_cmp is None or (candidate_cmp is not None and candidate_cmp > previous_cmp):
            last_visit[member_id] = access_visit

    # Oldest pending payment per member (bulk).
    pending_sub = (
        db.session.query(
            PaymentVerification.member_id,
            func.min(PaymentVerification.created_at).label("first_created"),
        )
        .filter(
            PaymentVerification.gym_id == gym_id,
            PaymentVerification.member_id.in_(member_ids),
            PaymentVerification.status == "pending",
            PaymentVerification.is_test.is_(False),
        )
        .group_by(PaymentVerification.member_id)
        .subquery()
    )
    pending_rows = (
        db.session.query(PaymentVerification)
        .join(pending_sub, (PaymentVerification.member_id == pending_sub.c.member_id)
              & (PaymentVerification.created_at == pending_sub.c.first_created))
        .filter(PaymentVerification.gym_id == gym_id)
        .all()
    )
    pending_by_member = {p.member_id: p for p in pending_rows}

    # Count unique attendance days, not raw entry/exit punch rows.
    counts_by_member = attendance_visit_counts(gym_id, member_ids, gym_timezone, today)

    # Existing open/actioned opportunities keyed by dedupe_key (bulk).
    existing = {
        row.dedupe_key: row
        for row in RRROpportunity.query.filter_by(gym_id=gym_id).all()
    }

    created = []
    for member in members:
        # Member.price is pinned at signup/renewal and preserves negotiated
        # rates. Older imported records may still have the model's zero
        # default; use their current plan price as an estimate until an
        # owner records the member's actual rate.
        value = Decimal(str(member.price or 0))
        if value <= 0 and member.plan is not None:
            value = Decimal(str(member.plan.price or 0))
        if member.membership_end:
            days = (member.membership_end - today).days
            if member.status == "active" and 0 <= days <= rules["expiry_days"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="revenue", reason_code="expiry_approaching",
                    reason_text=f"Membership expires in {days} day(s) on {member.membership_end.isoformat()}.",
                    priority="high" if days <= 7 else "medium", potential_revenue=value,
                    existing=existing,
                ))
            if days < 0 and abs(days) <= rules["recent_expiry_days"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="recover", reason_code="recently_expired",
                    reason_text=f"Membership expired {abs(days)} day(s) ago on {member.membership_end.isoformat()}.",
                    priority="high", potential_revenue=value,
                    existing=existing,
                ))
        pending_payment = pending_by_member.get(member.id)
        if pending_payment and pending_payment.created_at and (now - pending_payment.created_at).days >= 1:
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="payment_friction",
                reason_text=f"A payment of \u20b9{pending_payment.amount} has been awaiting verification since {pending_payment.created_at.date().isoformat()}.",
                priority="high", potential_revenue=Decimal(str(pending_payment.amount or 0)),
                existing=existing, dedupe_suffix=f":payment:{pending_payment.id}",
            ))
        visit = last_visit.get(member.id)
        if visit is not None and visit.tzinfo is None:
            visit = visit.replace(tzinfo=timezone.utc)
        try:
            last_activity_day = (
                visit.astimezone(ZoneInfo(gym_timezone or "Asia/Kolkata")).date()
                if visit is not None else None
            )
        except Exception:
            last_activity_day = visit.astimezone(ZoneInfo("Asia/Kolkata")).date() if visit is not None else None
        # Missing history is not evidence of inactivity. This is especially
        # important on migration day, before old-system attendance has been
        # imported or the terminal has begun sending records.
        no_visit_days = max(0, (today - last_activity_day).days) if last_activity_day else None
        if member.status == "active" and no_visit_days is not None and no_visit_days >= rules["no_visit_days"]:
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="no_recent_visit",
                reason_text=f"No attendance recorded for {no_visit_days} day(s).",
                priority="high" if no_visit_days >= 30 else "medium", potential_revenue=value,
                existing=existing,
            ))
        # Explainable attendance decline: most recent 14-day window vs the
        # preceding 14-day baseline. Skip sparse histories.
        recent_count, baseline_count = counts_by_member.get(member.id, (0, 0))
        if member.status == "active" and baseline_count >= 2:
            decline = round((baseline_count - recent_count) / baseline_count * 100)
            if decline >= rules["attendance_drop_percent"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="retain", reason_code="attendance_decline",
                    reason_text=f"Attendance is down {decline}%: {recent_count} visits in the last 14 days versus {baseline_count} in the prior 14 days.",
                    priority="high" if decline >= 75 else "medium", potential_revenue=value,
                    existing=existing,
                ))
    active_keys = {row.dedupe_key for row in created}
    for row in existing.values():
        if row.status in {"open", "actioned"} and row.dedupe_key not in active_keys:
            # Signals are continuously recalculated. Once the source data no
            # longer supports an opportunity, stop showing it as actionable.
            row.status = "resolved"
            row.closed_at = now
    return created


def _opportunity_payload(row: RRROpportunity) -> dict:
    return {
        "id": row.id, "pillar": row.pillar, "status": row.status, "priority": row.priority,
        "reason_code": row.reason_code, "reason": row.reason_text,
        "potential_revenue": str(row.potential_revenue), "outcome_revenue": str(row.outcome_revenue),
        "member": {"id": row.member.id, "name": row.member.full_name, "phone": row.member.phone,
                   "membership_end": row.member.membership_end.isoformat() if row.member.membership_end else None},
    }


def dashboard_for_gym(gym_id: int, gym_timezone: str) -> dict:
    refresh_opportunities(gym_id, gym_timezone)
    db.session.flush()
    opportunities = RRROpportunity.query.filter_by(gym_id=gym_id).filter(
        RRROpportunity.status.in_(("open", "actioned"))
    ).join(Member, Member.id == RRROpportunity.member_id
    ).filter(Member.deleted_at.is_(None)
    ).order_by(RRROpportunity.priority.desc(), Member.membership_end.asc().nullslast(), RRROpportunity.created_at.desc()).all()
    by_pillar: dict[str, list[RRROpportunity]] = defaultdict(list)
    for item in opportunities:
        by_pillar[item.pillar].append(item)
    # A member may appear in several pillars. The pipeline KPI is a member
    # opportunity estimate, so count the largest estimate once per person.
    potential_by_member: dict[int, Decimal] = {}
    for item in opportunities:
        potential_by_member[item.member_id] = max(
            potential_by_member.get(item.member_id, Decimal("0")),
            Decimal(str(item.potential_revenue or 0)),
        )
    owner_confirmed_revenue = (
        db.session.query(func.coalesce(func.sum(RRROpportunity.outcome_revenue), 0))
        .join(Member, Member.id == RRROpportunity.member_id)
        .filter(
            RRROpportunity.gym_id == gym_id,
            RRROpportunity.status == "closed",
            Member.deleted_at.is_(None),
        )
        .scalar()
        or Decimal("0")
    )
    active_members = Member.query.filter_by(gym_id=gym_id, status="active").filter(Member.deleted_at.is_(None)).count()
    total_members = Member.query.filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None)).count()
    month_start = utcnow() - timedelta(days=30)
    active_member_ids = select(Member.id).where(
        Member.gym_id == gym_id,
        Member.status == "active",
        Member.deleted_at.is_(None),
    )
    visitor_members = db.session.query(
        RRRAttendanceEvent.member_id.label("member_id")
    ).filter(
        RRRAttendanceEvent.gym_id == gym_id,
        RRRAttendanceEvent.member_id.in_(active_member_ids),
        RRRAttendanceEvent.punch_time >= month_start,
    ).union(
        db.session.query(AccessEvent.member_id.label("member_id")).filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.member_id.in_(active_member_ids),
            AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]),
            AccessEvent.event_timestamp >= month_start,
        )
    ).subquery()
    active_visitors = db.session.query(func.count()).select_from(visitor_members).scalar() or 0
    # A configured Direct ADMS integration is authoritative for attendance
    # status and access commands, even when an old bridge remains paired.
    # Preserve bridge/eBioServer selection only for gyms without ADMS.
    integrations = RRRIntegration.query.filter_by(gym_id=gym_id).all()
    adms_integrations = [row for row in integrations if row.connector_type == "adms_direct"]
    integration = next((row for row in adms_integrations if row.status == "connected"), None)
    integration = integration or next(iter(adms_integrations), None)
    integration = integration or next((row for row in integrations if row.connector_type == "direct_bridge" and row.status == "connected"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "ebioserver" and row.status == "connected"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "direct_bridge"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "ebioserver"), None)
    # Legacy Windows bridge (BridgeInstallation) — gyms like Yodha Fitness
    # use the old TCP bridge without an RRRIntegration row. If they have an
    # active bridge installation, treat attendance as connected.
    legacy_bridge = None
    if integration is None:
        from app.models import BridgeInstallation
        legacy_bridge = BridgeInstallation.query.filter_by(
            gym_id=gym_id, is_active=True
        ).first()
    return {
        "members": {"total": total_members, "active": active_members,
                    "attendance_rate": round((active_visitors / active_members * 100), 1) if active_members else 0},
        "integration": (
            integration_payload(integration) if integration
            else ({"type": "legacy_bridge", "status": "connected",
                   "name": "Bridge"}
                  if legacy_bridge else None)
        ),
        "pillars": {
            name: {"count": len(by_pillar[name]),
                   "potential_revenue": str(sum((x.potential_revenue for x in by_pillar[name]), Decimal("0"))),
                   "items": [_opportunity_payload(x) for x in by_pillar[name][:5]]}
            for name in ("revenue", "retain", "recover")
        },
        "total_potential_revenue": str(sum(potential_by_member.values(), Decimal("0"))),
        "owner_confirmed_revenue": str(owner_confirmed_revenue),
        "unmapped_count": RRRAttendanceEvent.query.filter_by(gym_id=gym_id, processing_status="unmapped").count(),
        "opportunities": [_opportunity_payload(x) for x in opportunities[:12]],
        # Setup-checklist signals for new gyms (PWA dashboard).
        "plans_count": MembershipPlan.query.filter(
            MembershipPlan.gym_id == gym_id,
            MembershipPlan.is_active.is_(True),
            MembershipPlan.duration_days > 0,
            MembershipPlan.price > 0,
        ).count(),
        "whatsapp_connected": bool((gym := db.session.get(Gym, gym_id)) and gym.whatsapp_enabled and gym.whatsapp_connection_status == "CONNECTED"),
        "payment_setup_done": bool(
            (qr := QRSettings.query.filter_by(gym_id=gym_id).first())
            and qr.is_active
            and (qr.upi_id or qr.qr_image_path or qr.qr_public_url)
        ),
    }


def adms_terminal_settings(host_url: str | None = None, path_token: str | None = None) -> dict:
    """Authoritative values the owner types into the terminal's ADMS menu.

    Computed from ADMS_PUBLIC_URL (falling back to PUBLIC_BASE_URL, then the
    current request host) so the app never shows a different address than the
    backend listens on. Set ADMS_PUBLIC_URL to a plain-HTTP reverse proxy
    address when terminals cannot do HTTPS.
    """
    from urllib.parse import urlparse

    from flask import current_app, has_request_context, request

    fallback = host_url
    if fallback is None and has_request_context():
        fallback = request.host_url
    parsed = urlparse(fallback or "")
    configured_base = urlparse(str(current_app.config.get("ADMS_PUBLIC_URL") or current_app.config.get("PUBLIC_BASE_URL") or fallback or ""))
    host = configured_base.hostname or parsed.hostname
    # Hard fallback to the known GCP nginx ADMS proxy (plain HTTP) when no
    # env var is set — eSSL terminals cannot do HTTPS, so never hand them
    # the Railway HTTPS URL.
    if not host:
        host = "136.87.19.164"
        port = 80
        use_https = False
    else:
        port = configured_base.port or (443 if configured_base.scheme == "https" else 80)
        use_https = configured_base.scheme == "https"
    return {
        "server_mode": "ADMS",
        "server_address": host,
        "server_port": port,
        "https": use_https,
        # The per-integration path token makes the ADMS URL unguessable;
        # without it the terminal falls back to serial-only auth, which
        # is gated by the integration's allow_serial_fallback flag
        # (off for new integrations).
        "path": f"/iclock/{path_token}" if path_token else "/iclock",
    }


def integration_payload(row: RRRIntegration) -> dict:
    terminal_last_seen = (
        direct_adms_terminal_last_seen_at(row)
        if row.connector_type == "adms_direct"
        else None
    )
    terminal_online = (
        direct_adms_terminal_is_online(row, last_seen_at=terminal_last_seen)
        if row.connector_type == "adms_direct"
        else False
    )
    payload = {
        "id": row.id, "type": row.connector_type, "name": row.display_name,
        "status": (
            "connected"
            if row.connector_type == "adms_direct" and terminal_online
            else (
                "disconnected"
                if row.connector_type == "adms_direct" and row.status == "connected"
                else row.status
            )
        ),
        "primary": row.is_primary, "device_serial": row.device_serial, "device_name": row.device_name,
        "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
        "last_error": row.last_error, "records_synced": row.records_synced,
        "unmapped_records": row.unmapped_records, "commissioning_status": row.commissioning_status,
        "commands_enabled": row.commands_enabled,
    }
    if row.connector_type == "adms_direct":
        payload["last_seen_at"] = terminal_last_seen.isoformat() if terminal_last_seen else None
        # NEVER issue or backfill a token here: a payload read must not
        # mint a credential nobody sees. Tokens are issued only by
        # provision (fresh) and rotate (owner action), and returned once.
        # Hash-only rows therefore report token_present=True with no
        # retrievable path; the owner rotates to re-provision.
        payload["allow_serial_fallback"] = bool(row.allow_serial_fallback)
        payload["adms_token_version"] = row.adms_token_version
        payload["adms_token_grace_until"] = (
            row.adms_token_grace_until.isoformat() if row.adms_token_grace_until else None
        )
        if row.adms_path_token:
            # Legacy plaintext row (pre-hardening): still displayable.
            payload["terminal_settings"] = adms_terminal_settings(path_token=row.adms_path_token)
        elif row.adms_token_hash:
            base = adms_terminal_settings()
            base.update({
                "path": None,
                "token_present": True,
                "token_note": (
                    "Token is stored as a hash and cannot be shown again. "
                    "Rotate the token to re-provision this terminal."
                ),
            })
            payload["terminal_settings"] = base
        else:
            payload["terminal_settings"] = adms_terminal_settings(path_token=None)
    return payload
