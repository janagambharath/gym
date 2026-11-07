from __future__ import annotations

import re
import secrets
import threading
import time
import zoneinfo
from datetime import date, datetime, timedelta, timezone

from flask import current_app
from sqlalchemy import and_, or_, select

from app.extensions import db
from app.models import BridgeCommand, BridgeInstallation, Member
from app.models import RRRAdmsCommand, RRRIdentityMapping, RRRIntegration
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.timezone_service import today_for_gym


_ENROLL_NUMBER_RE = re.compile(r"^[0-9]{1,10}$")

BRIDGE_DISABLE_COMMAND_TYPES = frozenset({"disable_user", "delete_user"})
# ADMS actions that deny access and must be revalidated against current
# membership state immediately before delivery. ``block`` uses the tested
# reversible Grp=100 USERINFO update.
ADMS_DISABLE_ACTIONS = frozenset({
    "block",
})
# Enable-type actions/commands: serving one opens (or re-opens) the door.
# They get the mirror-image serve-time revalidation (H8): only a member
# who is currently active with an end date today or in the future may be
# enabled.  Bridge set_valid_date is included because setting a validity
# window is door-opening state, not a neutral read.
ADMS_ENABLE_ACTIONS = frozenset({
    "unblock",
    "essl_group_unblock_test",
    "create_user",
    "restore_template",
})
# Owner-initiated test actions use only the reversible eSSL Group updates.
# They may target a mapped row only after the owner confirms the fake account
# and its exact name matches.
ADMS_TEST_ACTIONS = frozenset({
    "essl_group_block_test",
    "essl_group_unblock_test",
})
ADMS_GROUP_TEST_ACTIONS = frozenset({
    "essl_group_block_test",
    "essl_group_unblock_test",
})
BRIDGE_ENABLE_COMMAND_TYPES = frozenset({"enable_user", "create_user", "set_valid_date"})
ADMS_GROUP_BLOCK_NOTE = (
    "Direct ADMS blocks with USERINFO Grp=100 and restores with Grp=1. "
    "The terminal user and fingerprint stay enrolled."
)
# Single stuck-command timeout shared by the ADMS getrequest reaper and the
# owner test-command endpoint (L5, aligned 2026-10-24). A delivered command
# is failed after this long without an ack; the same value bounds getrequest
# re-sends (L6) — a delivered command is re-served only inside this window.
ADMS_DELIVERED_TIMEOUT_MINUTES = 10
# V6-M9: a queued (never delivered) ADMS command is stale after this long.
# The terminal polls getrequest every 30 s (Delay=30 in cdata), so 10 min
# without delivery means it is offline/misconfigured — the member page
# must stop reporting the queued block as fact past this point.
ADMS_QUEUED_STALE_MINUTES = 10
# Bridge JSON ingestion cap (M12), matching the 256 KB ADMS body cap.
BRIDGE_MAX_JSON_BYTES = 262144


def sanitize_terminal_name(name: object, max_len: int = 24) -> str:
    """Strip control characters from a name interpolated into command text.

    Member names are free text; a tab would inject an extra tab-separated
    field into the PUSH command and a newline would break the
    ``C:<id>:<text>`` getrequest envelope (M6). Control chars (including
    tab/CR/LF) are removed, the result is stripped and truncated. Returns
    "" when nothing survives — callers fall back to a safe default name.
    """

    cleaned = "".join(ch for ch in str(name or "") if ord(ch) >= 32 and ord(ch) != 127)
    return cleaned.strip()[:max_len]
STALE_DISABLE_MARKER = "CANCELLED_STALE_STATE"
STALE_DISABLE_ERROR = (
    "CANCELLED_STALE_STATE: member is not proven blockable (fail-safe rule: "
    "active members are never blocked); disable command was not served."
)
STALE_ENABLE_MARKER = "CANCELLED_STALE_ENABLE"
STALE_ENABLE_ERROR = (
    "CANCELLED_STALE_ENABLE: member is not proven enableable (fail-safe rule: "
    "only a currently active member with an end date today or in the future "
    "may be enabled); enable command was not served."
)


def adms_command_is_forbidden(command: RRRAdmsCommand) -> bool:
    """Recognize a legacy destructive row so it can be rejected at delivery.

    Destructive command generation is removed. Historical rows may remain in
    the audit table, so delivery checks the old action names and wire text and
    cancels them before they can reach a terminal.
    """

    if command.action in {
        "delete_user",
        "block_test",
        "delete_biodata_test",
        "delete_fingertmp_test",
        "probe_del_tmp_bare",
        "probe_del_tmp_fid0",
        "probe_del_tmp_fid1",
        "probe_del_bio_bare",
        "probe_del_bio_type1",
        "probe_del_auth",
        "clear_log",
    }:
        return True
    text = (command.command_text or "").strip().upper()
    return text.startswith("DATA DELETE") or text == "CLEAR LOG"


def _as_utc(value: datetime) -> datetime:
    """Normalise DB timestamps from both PostgreSQL and SQLite."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def canonical_enroll_number(value: object) -> str:
    """Return a safe terminal Enroll Number, or raise ``ValueError``.

    The X990 access-control workflow uses a 32-bit numeric user ID for its
    time-zone APIs.  Keeping the online mapping numeric avoids a command that
    the local bridge could acknowledge but not enforce on the terminal.
    """

    text = str(value or "").strip()
    if not _ENROLL_NUMBER_RE.fullmatch(text):
        raise ValueError("Biometric Enroll Number must contain only digits.")
    number = int(text)
    if number < 1 or number > 2_147_483_647:
        raise ValueError("Biometric Enroll Number must be between 1 and 2147483647.")
    return str(number)


def desired_command_type(member: Member) -> str:
    """Translate the online membership state into a terminal access state.

    V3-L7: a NULL ``membership_end`` is "cannot prove expired" — it must
    never crash this function (``None >= date`` raised TypeError) and
    must never read as an enable. It returns ``"disable_user"`` here,
    which the serve/lease guards then cancel with CANCELLED_STALE_STATE
    (``member_is_proven_blockable`` is False for a NULL end), matching
    the fail-closed invariant.
    """

    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    try:
        local_today = datetime.now(zoneinfo.ZoneInfo(gym_timezone or "Asia/Kolkata")).date()
    except Exception:
        local_today = datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata")).date()
    return (
        "enable_user"
        if member.status == "active"
        and not member.deleted_at
        and member.membership_end is not None
        and member.membership_end >= local_today
        else "disable_user"
    )


def member_is_proven_blockable(member: Member | None) -> bool:
    """The ONLY state in which a disable may reach a terminal (fail-safe).

    Bharath's hard invariant (2026-10-23): "Whatever u do, active members
    should not be blocked."  A member is proven blockable only when the row
    exists, is not deleted, and either:

    * ``status == "paused"`` — a deliberate freeze, blockable on any dates; or
    * ``membership_end`` is set, strictly before gym-local today, and
      ``status != "active"`` — a genuinely expired membership.

    Every other state fails safe (NOT blockable): status ``active`` on any
    date, end date today or in the future, a NULL end date, a deleted row,
    or a missing member.  The incident population — stored status ``expired``
    with a future end date — is not blockable under this rule.
    """

    if member is None or member.deleted_at is not None:
        return False
    if member.status == "paused":
        return True
    if member.membership_end is None or member.status == "active":
        return False
    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    return member.membership_end < today_for_gym(gym_timezone)


def disable_must_be_cancelled(member: Member | None) -> bool:
    """Serve/queue/retry guard: cancel unless the member is proven blockable."""

    return not member_is_proven_blockable(member)


def member_is_proven_enableable(member: Member | None) -> bool:
    """The ONLY state in which an enable may reach a terminal (fail-safe,
    H8 mirror of :func:`member_is_proven_blockable`).

    The member row must exist, not be deleted, have ``status == "active"``,
    and have ``membership_end`` set and on/after gym-local today.  Paused,
    expired, deleted, missing, and NULL-end members are all NOT enableable:
    a stale enable must never re-open the door after membership changed.
    """

    if member is None or member.deleted_at is not None:
        return False
    if member.status != "active" or member.membership_end is None:
        return False
    gym_timezone = member.gym.timezone if member.gym else "Asia/Kolkata"
    return member.membership_end >= today_for_gym(gym_timezone)


def enable_must_be_cancelled(member: Member | None) -> bool:
    """Serve/lease/retry guard: cancel an enable unless proven enableable."""

    return not member_is_proven_enableable(member)


def resolve_bridge_command_member(command: BridgeCommand) -> Member | None:
    """Resolve a bridge command to its member, gym-checked (M2).

    A ``member_id`` pointing at a member of a DIFFERENT gym is treated as
    unresolvable (returns None), never as that other gym's member: the
    command's gym is the authority, and a cross-gym reference must fail
    safe under both the disable and the enable guard.  The enroll-number
    fallback is gym-scoped by construction.
    """

    member = None
    if command.member_id is not None:
        member = command.member or db.session.get(Member, command.member_id)
        if member is not None and member.gym_id != command.gym_id:
            return None
    if member is None and command.enroll_number:
        # Manual commands may carry only an enroll number; resolve it so the
        # command is judged on the member's real state.  Unresolvable stays
        # unproven and is cancelled below (fail-safe).
        # V4-L6: canonical-aware lookup (a stored "042" must match a
        # canonical "42" command), matching resolve_adms_member.
        member = find_member_by_enroll_number(command.gym_id, command.enroll_number)
    return member


def bridge_command_must_be_cancelled(command: BridgeCommand) -> bool:
    """Whether a bridge command is a disable for a non-blockable member."""

    if command.command_type not in BRIDGE_DISABLE_COMMAND_TYPES:
        return False
    return disable_must_be_cancelled(resolve_bridge_command_member(command))


def _set_valid_date_window_is_past(command: BridgeCommand) -> bool:
    """True when a ``set_valid_date`` command's window already ended (V4-M4).

    A past validity window is a door-CLOSING intent, not an enable: the
    lease guard must judge it as a disable, or an owner explicitly ending
    validity for an expired member gets cancelled as a "stale enable" and
    the terminal keeps the previous future validity in force. A missing or
    unparseable ``valid_to`` is not a past window (judged as an enable,
    as before).
    """

    if command.command_type != "set_valid_date":
        return False
    valid_to = (command.valid_to or "").strip()
    if not valid_to:
        return False
    try:
        valid_to_date = date.fromisoformat(valid_to)
    except ValueError:
        return False
    member = resolve_bridge_command_member(command)
    gym_timezone = "Asia/Kolkata"
    if member is not None and member.gym is not None and member.gym.timezone:
        gym_timezone = member.gym.timezone
    return valid_to_date < today_for_gym(gym_timezone)


def bridge_set_valid_date_is_disable(command: BridgeCommand) -> bool:
    """Whether a ``set_valid_date`` command closes the door (V4-M4)."""

    return _set_valid_date_window_is_past(command)


def bridge_enable_must_be_cancelled(command: BridgeCommand) -> bool:
    """Whether a bridge command is an enable for a non-enableable member."""

    if command.command_type not in BRIDGE_ENABLE_COMMAND_TYPES:
        return False
    if _set_valid_date_window_is_past(command):
        # Past window = disable intent: cancel unless the member is
        # blockable. Deleted members count as blockable here (V4-H2) — a
        # set_valid_date that ends validity is the delete-time block's
        # bridge twin.
        return disable_must_be_cancelled_including_deleted(
            resolve_bridge_command_member(command)
        )
    return enable_must_be_cancelled(resolve_bridge_command_member(command))


def cancel_bridge_command(
    command: BridgeCommand,
    *,
    marker: str = STALE_DISABLE_MARKER,
    error: str = STALE_DISABLE_ERROR,
) -> None:
    """Terminal-state a stale bridge disable/enable without a schema migration.

    Both command tables constrain ``status`` by database CHECK constraints,
    so this hotfix uses the existing ``failed`` terminal state plus an
    unmistakable marker.  ``failed`` is never leased or served again; the
    state-aware retry paths check the same guard before any resurrection.
    Pass the STALE_ENABLE_* pair when cancelling an enable.
    """

    command.status = "failed"
    command.last_error = error
    command.lease_token = None
    command.lease_expires_at = None
    command.acknowledged_at = utcnow()


# V3-L6: per-gym canonical-enroll index cache. ``resolve_adms_member``'s
# legacy fallback used to load EVERY member row of the gym on each miss
# (a full-table scan per unmapped punch). The index below is built from
# one lightweight (id, device_enroll_number) column query and cached per
# gym for a short TTL. NOTE: the review's premise of "the same TTLCache
# used by resolve_adms_member" was wrong — no TTLCache exists anywhere in
# this codebase (cachetools is not installed), so this is a small stdlib
# TTL dict instead. The cache only avoids the scan; it never authorises
# a resolution on its own — every hit is re-verified against the live
# member row before it is returned.
_ADMS_ENROLL_INDEX_TTL_SECONDS = 120
_adms_enroll_index_cache: dict[int, tuple[float, dict[str, int]]] = {}
_adms_enroll_index_lock = threading.Lock()


def invalidate_adms_enroll_index(gym_id: int) -> None:
    """Drop the cached canonical-enroll index for *gym_id* (V3-L6).

    Call after any change to a member's ``device_enroll_number`` so the
    next resolve rebuilds from the database instead of serving a stale
    mapping for up to the TTL. The TTL itself is only a backstop.
    """

    with _adms_enroll_index_lock:
        _adms_enroll_index_cache.pop(gym_id, None)


def _adms_enroll_index(gym_id: int) -> dict[str, int]:
    """Canonical enroll number -> member id for one gym (V3-L6)."""

    now = time.monotonic()
    with _adms_enroll_index_lock:
        entry = _adms_enroll_index_cache.get(gym_id)
        if entry is not None and entry[0] > now:
            return entry[1]
    index: dict[str, int] = {}
    rows = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.device_enroll_number.isnot(None))
        .order_by(Member.id.asc())
        .with_entities(Member.id, Member.device_enroll_number)
        .all()
    )
    for member_id, enroll in rows:
        try:
            # First holder wins (lowest id), matching the old scan's
            # first-match behaviour when two rows share one canonical ID.
            index.setdefault(canonical_enroll_number(enroll), member_id)
        except ValueError:
            continue
    with _adms_enroll_index_lock:
        _adms_enroll_index_cache[gym_id] = (
            now + _ADMS_ENROLL_INDEX_TTL_SECONDS,
            index,
        )
    return index


def find_confirmed_mapping(gym_id: int, external_id: str):
    """Canonical-aware confirmed-mapping lookup (V4-M6).

    Mappings created pre-fix can store a zero-padded ``external_id``
    ("042") while every caller passes the canonical form ("42"), so an
    exact-match lookup misses the row and a second mapping/owner can be
    created for the same canonical ID. Exact match first (indexed fast
    path), then a canonical-compare scan of the gym's confirmed rows.
    Returns the mapping or ``None``.
    """
    from app.services.rrr_service import _canonical_or_raw

    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=gym_id, external_id=external_id, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    if mapping is not None:
        return mapping
    try:
        canonical = canonical_enroll_number(external_id)
    except ValueError:
        return None
    for row in (
        RRRIdentityMapping.query.filter_by(gym_id=gym_id, status="confirmed")
        .order_by(RRRIdentityMapping.id.desc())
        .all()
    ):
        if _canonical_or_raw(row.external_id) == canonical:
            return row
    return None


def clear_deleted_enroll_holder(
    gym_id: int, enroll_number: str, exclude_id: int | None = None
):
    """Free a terminal ID held only by a soft-deleted member (V4-M21).

    The real linked-then-deleted case: the deleted member keeps
    ``device_enroll_number`` (by design, as a fingerprint tombstone)
    and may still hold a confirmed identity mapping, so Guard 2 fires
    before Guard 3 can ever free the ID and the ID stays bricked for
    every live member. An explicit owner link/enroll of that ID to a
    live member is the audited decision to reuse it: clear the deleted
    holder's enroll number and delete its mappings in one step, flush
    so the unique constraint sees the freed value, and return the
    freed holder (``None`` when the holder is live or absent).

    Caveat: clearing the enroll number does NOT purge the old
    fingerprint from the terminal itself — the owner must still
    delete/re-enrol the user on the terminal to retire the old
    template. This only frees the server-side identity.
    """
    holder = find_member_by_enroll_number(gym_id, enroll_number, exclude_id=exclude_id)
    if holder is None or holder.deleted_at is None:
        return None
    import logging

    logging.getLogger(__name__).warning(
        "V4-M21: freeing enroll %s from deleted member %s (gym %s) for reuse",
        enroll_number,
        holder.id,
        gym_id,
    )
    holder.device_enroll_number = None
    for row in RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, member_id=holder.id
    ).all():
        db.session.delete(row)
    invalidate_adms_enroll_index(gym_id)
    db.session.flush()
    return holder


def _other_holder_by_canonical(
    gym_id: int, canonical: str, exclude_id: int | None
) -> Member | None:
    """Scan for another holder of *canonical* besides *exclude_id* (V4-L9).

    The cached index maps one canonical ID to its first (lowest-id)
    holder only, so when that holder is the excluded member the lookup
    used to return ``None`` even though a second member holds the same
    canonical ID (e.g. stored "042" vs "42"). Rare path (guard checks
    only) — a full gym scan is acceptable here.
    """
    rows = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.device_enroll_number.isnot(None))
        .with_entities(Member.id, Member.device_enroll_number)
        .all()
    )
    for member_id, enroll in rows:
        if member_id == exclude_id:
            continue
        try:
            if canonical_enroll_number(enroll) == canonical:
                return db.session.get(Member, member_id)
        except ValueError:
            continue
    return None


def find_member_by_enroll_number(
    gym_id: int, enroll_number: str | None, exclude_id: int | None = None
) -> Member | None:
    """Canonical-aware member lookup by terminal enroll number (V3-H3).

    Stored enroll numbers may carry leading zeros ("042") from before
    ingest canonicalization, while callers pass the canonical form
    ("42"). An exact-match-only lookup misses the stored row, so a
    second member can end up owning the same canonical ID. This does
    an exact canonical match first, then a canonical-compare fallback
    via the cached per-gym index (:func:`_adms_enroll_index`) — the
    same pattern :func:`resolve_adms_member` used to carry inline.

    Does NOT filter soft-deleted members: callers must see deleted
    holders to give the "held by a deleted member" error instead of a
    UniqueViolation at flush time (Guard 2 / enroll endpoint).
    Returns ``None`` when nothing matches (or the only match is the
    excluded member).
    """
    if enroll_number is None:
        return None
    try:
        canonical = canonical_enroll_number(enroll_number)
    except ValueError:
        # Non-numeric IDs (M16) keep their raw form — exact match only.
        member = Member.query.filter_by(
            gym_id=gym_id, device_enroll_number=str(enroll_number).strip()
        ).first()
        if member is not None and member.id != exclude_id:
            return member
        return None
    member = Member.query.filter_by(
        gym_id=gym_id, device_enroll_number=canonical
    ).first()
    if member is not None and member.id != exclude_id:
        return member
    # V4-L9: the exact holder may be the excluded member while a second
    # member holds the same canonical ID under a padded spelling — keep
    # scanning instead of returning None on the excluded id.
    if member is not None and member.id == exclude_id:
        other = _other_holder_by_canonical(gym_id, canonical, exclude_id)
        if other is not None:
            return other
    # Legacy fallback: a stored enroll number may carry leading zeros
    # ("042") from before canonicalization. The index maps canonical
    # forms (first holder wins); verify against the live row, rebuild
    # once on a stale entry, then give up.
    for _attempt in range(2):
        member_id = _adms_enroll_index(gym_id).get(canonical)
        if member_id is None:
            # V4-L9: a cached index miss is not definitive — the index
            # is per-process with a 120 s TTL, so a holder created by
            # another worker (or after the index was built) is missing
            # from it. Fall back to a ground-truth DB scan before
            # concluding the ID has no holder.
            return _other_holder_by_canonical(gym_id, canonical, exclude_id)
        if member_id == exclude_id:
            # V4-L9: the indexed first holder is excluded — a second
            # holder may still exist under the same canonical ID.
            return _other_holder_by_canonical(gym_id, canonical, exclude_id)
        candidate = db.session.get(Member, member_id)
        if (
            candidate is not None
            and candidate.gym_id == gym_id
            and candidate.device_enroll_number is not None
        ):
            try:
                if canonical_enroll_number(candidate.device_enroll_number) == canonical:
                    return candidate
            except ValueError:
                pass
        # Stale index entry — rebuild once and retry; if the rebuilt
        # index still disagrees, the ID genuinely has no holder.
        invalidate_adms_enroll_index(gym_id)
    return None


def resolve_adms_member(gym_id: int, enroll_number: str | None) -> Member | None:
    """Resolve an ADMS command's terminal identity back to a member row.

    Gym-checked on both branches (M2): a confirmed mapping whose member
    belongs to a different gym is NEVER returned — resolution falls through
    to the gym-scoped ``device_enroll_number`` query, so a cross-gym
    mapping can only ever resolve to a member of this gym, or to None.

    V3-M14: a soft-deleted member never resolves on either branch — its
    terminal ID must read as unknown, not as a named ex-member.
    """

    if not enroll_number:
        return None
    try:
        canonical = canonical_enroll_number(enroll_number)
    except ValueError:
        return None

    mapping = find_confirmed_mapping(gym_id, canonical)
    if mapping is not None and mapping.member_id is not None:
        member = db.session.get(Member, mapping.member_id)
        if (
            member is not None
            and member.gym_id == gym_id
            and member.deleted_at is None
        ):
            return member
    member = find_member_by_enroll_number(gym_id, canonical)
    if member is not None and member.deleted_at is None:
        return member
    return None


def cancel_adms_command(
    command: RRRAdmsCommand,
    *,
    marker: str = STALE_DISABLE_MARKER,
    error: str = STALE_DISABLE_ERROR,
) -> None:
    """Terminal-state a stale ADMS disable/enable (see :func:`cancel_bridge_command`).

    Pass the STALE_ENABLE_* pair when cancelling an enable.
    """

    command.status = "failed"
    command.result_code = marker
    command.result_message = error
    command.acknowledged_at = utcnow()


# Marker for a command cancelled because its terminal ID changed hands
# (V4-M3): superseded, not stale-state. The serve-time guards must not
# treat it as evidence the member was unblockable.
STALE_COMMAND_SUPERSEDED_MARKER = "CANCELLED_SUPERSEDED"


def member_is_proven_blockable_including_deleted(member: Member | None) -> bool:
    """Disable-branch variant of :func:`member_is_proven_blockable` (V4-H2).

    A soft-deleted member is blockable: no active membership exists to
    protect, so the delete-time block may serve. Every other state uses
    the standard fail-safe predicate. Only the disable branches (ADMS
    getrequest, bridge lease) use this — enables, punches and tests keep
    the strict predicate.
    """

    if member is not None and member.deleted_at is not None:
        return True
    return member_is_proven_blockable(member)


def disable_must_be_cancelled_including_deleted(member: Member | None) -> bool:
    """Disable-branch guard: cancel unless blockable, deleted included."""

    return not member_is_proven_blockable_including_deleted(member)


def resolve_adms_member_for_disable(gym_id: int, enroll_number: str | None) -> Member | None:
    """Disable-branch resolver (V4-H2): like :func:`resolve_adms_member`,
    but a soft-deleted holder still resolves, so its delete-time block can
    serve. A live holder always wins: if the enroll resolves to a live
    member, that member is returned and the normal guard judges them; only
    when no live holder exists is a deleted holder returned. Punches,
    enables and tests must keep using :func:`resolve_adms_member`.
    """

    member = resolve_adms_member(gym_id, enroll_number)
    if member is not None:
        return member
    if not enroll_number:
        return None
    try:
        canonical = canonical_enroll_number(enroll_number)
    except ValueError:
        return None
    deleted_candidate: Member | None = None
    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=gym_id, external_id=canonical, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    if mapping is not None and mapping.member_id is not None:
        mapped = db.session.get(Member, mapping.member_id)
        if (
            mapped is not None
            and mapped.gym_id == gym_id
            and mapped.deleted_at is not None
        ):
            deleted_candidate = mapped
    candidate = find_member_by_enroll_number(gym_id, canonical)
    if candidate is not None and candidate.deleted_at is None:
        return candidate
    if candidate is not None and candidate.deleted_at is not None:
        if deleted_candidate is None:
            deleted_candidate = candidate
    if deleted_candidate is None:
        return None
    # The enroll branch returns only the first holder: a live second holder
    # (dual-holder legacy rows, V4-L9 class) must win over a deleted first
    # holder, or the block would land on the new holder.
    live_rows = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(
            Member.device_enroll_number.isnot(None),
            Member.deleted_at.is_(None),
        )
        .with_entities(Member.id, Member.device_enroll_number)
        .all()
    )
    for member_id, enroll in live_rows:
        try:
            if canonical_enroll_number(enroll) == canonical:
                return db.session.get(Member, member_id)
        except ValueError:
            continue
    return deleted_candidate


def bridge_disable_must_be_cancelled_at_lease(command: BridgeCommand) -> bool:
    """Lease-time disable guard (V4-H2): like
    :func:`bridge_command_must_be_cancelled`, but a soft-deleted member is
    blockable — the delete-time block must be able to serve. Only the
    lease path uses this; queue/retry/display paths keep the strict guard.
    """

    if command.command_type not in BRIDGE_DISABLE_COMMAND_TYPES:
        return False
    member = resolve_bridge_command_member(command)
    return disable_must_be_cancelled_including_deleted(member)


def bridge_command_enroll_holder_mismatch(command: BridgeCommand) -> bool:
    """True when a bridge command's enroll number now belongs to a different
    live member than the command's ``member_id`` (V4-M3).

    The bridge executes by enroll number, so a command queued for a
    previous holder must never execute against the new holder. A deleted
    holder is not a mismatch (it cannot be harmed, and the H2 lease guard
    judges the command's own member). Commands without a member are not
    member-targeted and are left to their own guards.
    """

    if command.member_id is None or not command.enroll_number:
        return False
    holder = find_member_by_enroll_number(command.gym_id, command.enroll_number)
    if holder is None or holder.id == command.member_id:
        return False
    if holder.deleted_at is not None:
        return False
    return True


# Queue-time audit actions that record which member an ADMS command was
# queued for (V4-L8 / V4-M3). The audit row's metadata carries member_id.
_ADMS_QUEUE_AUDIT_ACTIONS = frozenset({
    "adms_membership_block_queued",
    "adms_membership_unblock_queued",
    "adms_manual_block_queued",
    "adms_manual_unblock_queued",
})


def adms_command_intended_member_id(command: RRRAdmsCommand) -> int | None:
    """Member id an ADMS command was queued for.

    V7-L10: prefer the ``intended_member_id`` stamped on the command row
    at queue time — it survives the 90-day audit purge. Fall back to the
    queue-time audit row for legacy rows queued before the column existed.

    Returns ``None`` when no queue audit survives (legacy rows, or audit
    retention purged it). Callers treat unknown intent as NOT matching, so
    a recycled ID never inherits the previous holder's acked block — a
    redundant Grp=100 block is idempotent, a missing one is not.
    """

    # V7-M1/V7-L10: row-stamped intent (see RRRAdmsCommand docstring).
    stamped = getattr(command, "intended_member_id", None)
    if isinstance(stamped, bool):
        stamped = None
    if isinstance(stamped, int):
        return stamped
    try:
        if stamped is not None:
            return int(stamped)
    except (TypeError, ValueError):
        pass

    from app.models.audit_log import AuditLog

    row = (
        AuditLog.query.filter_by(
            resource_type="rrr_adms_command", resource_id=str(command.id)
        )
        .filter(AuditLog.action.in_(_ADMS_QUEUE_AUDIT_ACTIONS))
        .order_by(AuditLog.id.desc())
        .first()
    )
    if row is None:
        return None
    member_id = (row.metadata_json or {}).get("member_id")
    if isinstance(member_id, bool):
        return None
    if isinstance(member_id, int):
        return member_id
    try:
        return int(member_id)
    except (TypeError, ValueError):
        return None


def displace_stale_enroll_commands(
    gym_id: int, enroll_number: str | None, *, new_member_id: int
) -> int:
    """Cancel commands for *enroll_number* intended for a previous holder
    (V4-M3).

    Called when a terminal ID is (re)linked to a new holder — remap,
    auto-link, enroll. A stale queued manual block for the previous holder
    survives the recycle on the active-skip link paths (nothing is queued
    to displace it), and the ADMS owner branch serves a block for any
    resolved member. Commands intended for the NEW holder are kept, as are
    commands with unknown intent (serve-time guards judge automatic
    blocks; owner manual blocks are B-H1's domain). Bridge leased
    commands are left to the lease-time holder-mismatch check.

    Returns the number of commands cancelled. Does not commit.
    """

    try:
        canonical = canonical_enroll_number(enroll_number)
    except ValueError:
        canonical = str(enroll_number or "").strip()
    if not canonical:
        return 0
    cancelled = 0
    # ADMS: queued + delivered (getrequest re-serves delivered rows until
    # acked inside the window, so cancelling stops the re-send).
    adms_rows = RRRAdmsCommand.query.filter(
        RRRAdmsCommand.gym_id == gym_id,
        RRRAdmsCommand.test_enroll_number == canonical,
        RRRAdmsCommand.status.in_(["queued", "delivered"]),
        RRRAdmsCommand.action.in_(["block", "unblock", "create_user"]),
    ).all()
    for row in adms_rows:
        intended = adms_command_intended_member_id(row)
        if intended is not None and intended != new_member_id:
            cancel_adms_command(
                row,
                marker=STALE_COMMAND_SUPERSEDED_MARKER,
                error="Superseded: terminal ID remapped to another member; queue the access change again if still needed.",
            )
            cancelled += 1
    # Bridge: pending commands carry member_id directly.
    bridge_rows = BridgeCommand.query.filter(
        BridgeCommand.gym_id == gym_id,
        BridgeCommand.enroll_number == canonical,
        BridgeCommand.status == "pending",
        BridgeCommand.member_id.isnot(None),
        BridgeCommand.member_id != new_member_id,
    ).all()
    for row in bridge_rows:
        cancel_bridge_command(
            row,
            marker=STALE_COMMAND_SUPERSEDED_MARKER,
            # BridgeCommand has no result_code column — the marker only
            # survives inside last_error, so it is embedded in the text.
            error=f"{STALE_COMMAND_SUPERSEDED_MARKER}: Terminal ID remapped to another member; queue the access change again if still needed.",
        )
        cancelled += 1
    # V5-M4: displace can only cancel queued/delivered rows — it cannot
    # undo an ACKED block the terminal already applied for the previous
    # holder. If the enroll's latest acked state is a block and the new
    # holder is proven enableable, queue a corrective unblock for them
    # even on the active-skip link paths (remap only queues when desired
    # != enable, and confirm_match skips commands for active members, so
    # without this the new active holder stays door-denied until the
    # daily reconcile). The corrective queue's own dedupe returns an
    # already-queued unblock instead of stacking a second one.
    _queue_corrective_unblock_for_recycled_enroll(gym_id, canonical, new_member_id)
    return cancelled


def _queue_corrective_unblock_for_recycled_enroll(
    gym_id: int, canonical_enroll: str, new_member_id: int
) -> RRRAdmsCommand | BridgeCommand | None:
    """Queue an unblock when a recycled enroll's last acked state is a block
    for a previous holder and the new holder is proven enableable (V5-M4).

    Returns the corrective command, or ``None`` when none is needed (new
    holder not enableable, no acked block on record, or the latest acked
    state is already an unblock). Does not commit.
    """
    new_member = db.session.get(Member, new_member_id)
    if new_member is None or not member_is_proven_enableable(new_member):
        return None
    acked_block = False
    latest_adms = (
        RRRAdmsCommand.query.filter(
            RRRAdmsCommand.gym_id == gym_id,
            RRRAdmsCommand.test_enroll_number == canonical_enroll,
            RRRAdmsCommand.action.in_(["block", "unblock"]),
            RRRAdmsCommand.status == "acked",
        )
        .order_by(RRRAdmsCommand.created_at.desc(), RRRAdmsCommand.id.desc())
        .first()
    )
    if latest_adms is not None and latest_adms.action == "block":
        acked_block = True
    if not acked_block:
        latest_bridge = (
            BridgeCommand.query.filter(
                BridgeCommand.gym_id == gym_id,
                BridgeCommand.enroll_number == canonical_enroll,
                BridgeCommand.command_type.in_(["disable_user", "enable_user"]),
                BridgeCommand.status == "acked",
            )
            .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
            .first()
        )
        if latest_bridge is not None and latest_bridge.command_type == "disable_user":
            acked_block = True
    if not acked_block:
        return None
    return queue_membership_command(new_member)


def _active_installation(gym_id: int) -> BridgeInstallation | None:
    return BridgeInstallation.query.filter_by(gym_id=gym_id, is_active=True).first()


# ─── Direct ADMS automatic block/unblock ─────────────────────────────────────

def adms_command_text(
    action: str,
    enroll_number: str | None,
    *,
    member_name: str | None = None,
    delay_seconds: int = 5,
) -> str:
    """Return the PUSH SDK wire text for a direct-ADMS terminal command.

    ``block``/``unblock`` are the automatic membership commands and use the
    X2008-verified USERINFO groups: Grp=100 denies access, Grp=1 restores it.
    Advanced commands added for the no-laptop direct-ADMS path:

    * ``create_user`` — ``DATA UPDATE USERINFO PIN=<id>\tName=<name>``
    * ``unlock_door`` — ``CONTROL DEVICE 1 <delay_tenths>``
    * ``reboot``      — ``REBOOT``
    * ``check``       — ``CHECK``
    * ``sync_users``  — ``DATA QUERY USERINFO`` (terminal uploads its user table;
      the cdata handler stores it as the command's result_data for smart matching)
    """

    if action == "sync_users":
        # X2008 (ZAM180_TFT classic) may need explicit PIN=ALL to upload USERINFO
        return "DATA QUERY USERINFO PIN=ALL"

    if action == "probe_info":
        return "INFO"
    if action == "check":
        return "CHECK"
    if action == "reboot":
        return "REBOOT"
    if action == "unlock_door":
        # CONTROL DEVICE <operation> <param>
        # operation=1 = unlock door, param = delay in tenths of a second
        delay_tenths = max(10, delay_seconds * 10)  # minimum 1 second
        return f"CONTROL DEVICE 1 {delay_tenths}"

    if action == "create_user":
        name = sanitize_terminal_name(member_name) or "Member"
        return f"DATA UPDATE USERINFO PIN={enroll_number}\tName={name}\tPri=0"

    if action in {"block", "unblock", "essl_group_block_test", "essl_group_unblock_test"}:
        name = sanitize_terminal_name(member_name) or "ADMS TEST"
        group = "100" if action in {"block", "essl_group_block_test"} else "1"
        return f"DATA UPDATE USERINFO PIN={enroll_number}\tName={name}\tGrp={group}"
    raise ValueError(f"Unknown ADMS command action: {action!r}")


def resolve_adms_enroll_number(member: Member) -> str | None:
    """Return the terminal enroll number for a member on the direct-ADMS path.

    Prefers the confirmed RRR identity mapping (the biometric ID the terminal
    actually reported), then falls back to the member's device enroll number.
    Returns ``None`` when the member has no usable terminal identity.
    """

    mapping = (
        RRRIdentityMapping.query.filter_by(
            gym_id=member.gym_id, member_id=member.id, status="confirmed"
        )
        .order_by(RRRIdentityMapping.id.desc())
        .first()
    )
    candidate = (mapping.external_id if mapping else None) or member.device_enroll_number
    if not candidate:
        return None
    return canonical_enroll_number(candidate)


def _adms_integration(gym_id: int) -> RRRIntegration | None:
    return RRRIntegration.query.filter_by(gym_id=gym_id, connector_type="adms_direct").first()


def queue_adms_membership_command(member: Member, *, force: bool = False) -> RRRAdmsCommand | None:
    """Queue an automatic block/unblock for the direct-ADMS terminal.

    This is the direct-path twin of :func:`queue_membership_command`.  It is
    deliberately gated on ``commands_enabled``: the owner must finish
    supervised commissioning before any automatic command is queued.

    Delivery is pull-based (the terminal polls ``/iclock/getrequest`` and
    re-sends ``delivered`` commands until acknowledged), so queueing while the
    terminal is temporarily offline is safe.  Commands are never queued for a
    terminal that has never connected.

    Like the bridge twin, this function does not commit.
    """

    integration = _adms_integration(member.gym_id)
    if integration is None or not integration.commands_enabled:
        return None
    if integration.last_success_at is None:
        # The terminal never checked in; do not pile commands into the void.
        return None

    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    action = "block" if desired_command_type(member) == "disable_user" else "unblock"
    command_text = adms_command_text(action, enroll_number, member_name=member.full_name)

    # Lock the latest command for this terminal identity so a concurrent
    # renewal/expiry cannot reorder or duplicate the terminal's final state.
    latest = db.session.execute(
        select(RRRAdmsCommand)
        .where(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.test_enroll_number == enroll_number,
            # M1: only membership-state commands participate in dedup.
            # OPERLOG snapshot rows (action="operlog_snapshot") share the
            # table and must not shadow the real block/unblock state.
            RRRAdmsCommand.action.in_(["block", "unblock", "delete_user", "create_user"]),
        )
        .order_by(RRRAdmsCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if latest.status == "queued":
            if latest.action == action:
                # Rewrite a pre-deployment queued DELETE block before it can
                # reach the terminal; the tested automatic block is Grp=100.
                if action == "block" and adms_command_is_forbidden(latest):
                    latest.command_text = command_text
                    latest.result_code = None
                    latest.result_message = None
                elif adms_command_intended_member_id(latest) != member.id:
                    # V4-L8: the queued command was intended for a previous
                    # holder of this enroll (recycled ID) — rewrite it for
                    # this member (name + audit) instead of returning it
                    # as theirs. Unknown intent rewrites too: a redundant
                    # Grp=100 block is idempotent, a misattributed one
                    # renames the terminal user and poisons the audit.
                    latest.command_text = command_text
                    latest.result_code = None
                    latest.result_message = None
                    latest.requested_by_id = None
                    # V7-M1/V7-L10: re-stamp intent on the row itself.
                    latest.intended_member_id = member.id
                    audit(
                        action=f"adms_membership_{action}_queued",
                        resource_type="rrr_adms_command",
                        resource_id=latest.id,
                        gym_id=member.gym_id,
                        metadata={"member_id": member.id, "enroll_number": enroll_number, "replaced": True,
                                  **({"method": "essl_userinfo_group", "group": "100"}
                                     if action == "block" else {})},
                    )
                elif member.deleted_at is not None and latest.requested_by_id is not None:
                    # V4-H2: a delete-time block aliasing a queued manual
                    # block must serve through the automatic branch — the
                    # owner branch cancels it (deleted members never
                    # resolve there). Demoting is safe: the member is gone,
                    # so no owner block for a live member is lost.
                    latest.requested_by_id = None
                    # V7-M1/V7-L10: stamp intent so the block can serve
                    # after the mappings are deleted.
                    latest.intended_member_id = member.id
                    audit(
                        action=f"adms_membership_{action}_queued",
                        resource_type="rrr_adms_command",
                        resource_id=latest.id,
                        gym_id=member.gym_id,
                        metadata={"member_id": member.id, "enroll_number": enroll_number,
                                  "owner_override_cleared": True,
                                  **({"method": "essl_userinfo_group", "group": "100"}
                                     if action == "block" else {})},
                    )
                return latest
            # A not-yet-delivered command can be replaced by the newest state.
            # V8-L11: EXCEPT a queued create_user — a membership queue must
            # never silently discard a pending enrollment. Fall through and
            # queue the membership command as a fresh row behind it (the
            # terminal serves in FIFO order, so enrollment lands first);
            # the preservation is audited, not silent.
            if latest.action == "create_user":
                audit(
                    action=f"adms_membership_{action}_queued",
                    resource_type="rrr_adms_command",
                    resource_id=latest.id,
                    gym_id=member.gym_id,
                    metadata={"member_id": member.id, "enroll_number": enroll_number,
                              "create_user_preserved": True,
                              **({"method": "essl_userinfo_group", "group": "100"}
                                 if action == "block" else {})},
                )
            else:
                latest.action = action
                latest.test_enroll_number = enroll_number
                latest.command_text = command_text
                latest.result_code = None
                latest.result_message = None
                latest.requested_by_id = None
                # V7-M1/V7-L10: re-stamp intent on the row itself.
                latest.intended_member_id = member.id
                audit(
                    action=f"adms_membership_{action}_queued",
                    resource_type="rrr_adms_command",
                    resource_id=latest.id,
                    gym_id=member.gym_id,
                    metadata={"member_id": member.id, "enroll_number": enroll_number, "replaced": True,
                              **({"method": "essl_userinfo_group", "group": "100"}
                                 if action == "block" else {})},
                )
                return latest
        if latest.status == "delivered":
            if latest.action == action:
                if action == "block" and adms_command_is_forbidden(latest):
                    # A delivered legacy DELETE may still be sitting in the
                    # device queue. Retire it and queue the tested update.
                    cancel_adms_command(
                        latest,
                        error="Legacy DELETE block was canceled; a Grp=100 update has replaced it.",
                    )
                else:
                    if member.deleted_at is not None and latest.requested_by_id is not None:
                        # V4-H2: demote like the queued branch above, so
                        # the re-send takes the automatic branch.
                        latest.requested_by_id = None
                        # V7-M1/V7-L10: stamp intent so the block can serve
                        # after the mappings are deleted.
                        latest.intended_member_id = member.id
                        audit(
                            action=f"adms_membership_{action}_queued",
                            resource_type="rrr_adms_command",
                            resource_id=latest.id,
                            gym_id=member.gym_id,
                            metadata={"member_id": member.id, "enroll_number": enroll_number,
                                      "owner_override_cleared": True,
                                      **({"method": "essl_userinfo_group", "group": "100"}
                                         if action == "block" else {})},
                        )
                    if adms_command_intended_member_id(latest) == member.id:
                        # The terminal holds it and getrequest re-sends until acked.
                        return latest
                    # V4-L8: delivered for a different member — fall
                    # through and queue a fresh command for this member.
            # A different-state command is already in flight; queue the
            # follow-up.  getrequest serves older IDs first, so the terminal
            # converges on the newest state.
        elif latest.status == "acked" and latest.action == action and not force:
            # V4-L8: an acked block for this enroll is this member's only
            # when it was queued for them — a recycled ID must not inherit
            # the previous holder's ack (the terminal may have been
            # re-enabled between holders). Unknown intent re-queues: a
            # redundant Grp=100 block is idempotent, a missing one is not.
            if adms_command_intended_member_id(latest) == member.id:
                return latest
        # "failed" (or a forced repair, or an acked/delivered command for a
        # different member) always queues a fresh command below.

    command = RRRAdmsCommand(
        gym_id=member.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll_number,
        command_text=command_text,
        requested_by_id=None,
        # V7-M1/V7-L10: stamp intent on the row itself.
        intended_member_id=member.id,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"adms_membership_{action}_queued",
        resource_type="rrr_adms_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number,
                  **({"method": "essl_userinfo_group", "group": "100"}
                     if action == "block" else {})},
    )
    return command


# V6-L9 (2026-11-06): _queue_template_restore_commands was DELETED here.
# It was dead code — no caller ever queued a fingerprint-template restore —
# so its presence implied a restore happens on unblock/re-enroll when none
# does. Wiring it in was rejected as the riskier option: an untested restore
# could re-enroll a previous holder's fingerprint onto a recycled enroll
# number. Template backup on USERINFO upload is unaffected.


def queue_manual_adms_member_command(
    member: Member, action: str, actor_id: int | None
) -> RRRAdmsCommand | None:
    """Queue an owner-initiated block/unblock for one member's terminal identity.

    Unlike :func:`queue_adms_membership_command` (which derives the action
    from membership state), the owner explicitly chooses ``block`` or
    ``unblock`` here — e.g. blocking a member for misconduct while their
    membership is still active.  Gated on supervised commissioning exactly
    like the automatic path.  Returns ``None`` when there is no commissioned
    direct-ADMS terminal or the member has no terminal identity.
    Does not commit.

    V6-M5: mirrors the automatic path's dedupe — the latest block/unblock
    command for this enroll is locked; a queued command of the same action
    is returned (rewritten for this member when it was queued for a
    previous holder), a queued command of the opposite action is replaced
    in place, a delivered/acked command of the same action for this member
    is returned, and anything else queues a fresh command. Repeated taps
    therefore never stack duplicate commands, and block→unblock converges
    on the owner's latest intent instead of serving both in FIFO order.
    """
    if action not in {"block", "unblock"}:
        raise ValueError(f"Unknown manual ADMS action: {action!r}")
    integration = _adms_integration(member.gym_id)
    if integration is None or not integration.commands_enabled:
        return None
    if integration.last_success_at is None:
        return None
    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    command_text = adms_command_text(action, enroll_number, member_name=member.full_name)
    # Lock the latest manual-membership command for this terminal identity
    # so a concurrent tap cannot reorder or duplicate the terminal's final
    # state. create_user/delete_user rows are out of scope here: a manual
    # block must never silently replace a queued enrollment.
    latest = db.session.execute(
        select(RRRAdmsCommand)
        .where(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.test_enroll_number == enroll_number,
            RRRAdmsCommand.action.in_(["block", "unblock"]),
        )
        .order_by(RRRAdmsCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if latest.status == "queued":
            if latest.action == action:
                if adms_command_intended_member_id(latest) not in (None, member.id):
                    # V4-L8: the queued command was intended for a previous
                    # holder of this enroll — rewrite it for this member
                    # (name + owner) instead of returning it as theirs.
                    latest.command_text = command_text
                    latest.result_code = None
                    latest.result_message = None
                    latest.requested_by_id = actor_id
                    # V7-M1/V7-L10: re-stamp intent on the row itself.
                    latest.intended_member_id = member.id
                    audit(
                        action=f"adms_manual_{action}_queued",
                        resource_type="rrr_adms_command",
                        resource_id=latest.id,
                        gym_id=member.gym_id,
                        actor_id=actor_id,
                        metadata={"member_id": member.id, "enroll_number": enroll_number,
                                  "replaced": True,
                                  **({"method": "essl_userinfo_group", "group": "100"}
                                     if action == "block" else {})},
                    )
                elif adms_command_intended_member_id(latest) is None:
                    # V8-L10: a legacy row with unknown intent must be
                    # re-stamped like the automatic path does — otherwise
                    # displace + the V6-M6 intent check can never catch
                    # it when this enroll is recycled to a new holder.
                    latest.intended_member_id = member.id
                return latest
            # A not-yet-delivered command is replaced by the owner's newest
            # explicit choice (block→unblock or unblock→block).
            latest.action = action
            latest.command_text = command_text
            latest.result_code = None
            latest.result_message = None
            latest.requested_by_id = actor_id
            # V7-M1/V7-L10: re-stamp intent on the row itself.
            latest.intended_member_id = member.id
            audit(
                action=f"adms_manual_{action}_queued",
                resource_type="rrr_adms_command",
                resource_id=latest.id,
                gym_id=member.gym_id,
                actor_id=actor_id,
                metadata={"member_id": member.id, "enroll_number": enroll_number,
                          "replaced": True,
                          **({"method": "essl_userinfo_group", "group": "100"}
                             if action == "block" else {})},
            )
            return latest
        if latest.status == "delivered" and latest.action == action:
            if adms_command_intended_member_id(latest) == member.id:
                # The terminal holds it and getrequest re-sends until acked.
                return latest
            # Delivered for a different holder: fall through and queue a
            # fresh command for this member.
        elif latest.status == "acked" and latest.action == action:
            if adms_command_intended_member_id(latest) == member.id:
                # The terminal already holds the requested state.
                return latest
            # Acked for a different holder (recycled ID): fall through and
            # queue a fresh command — unknown intent also re-queues, since
            # a redundant Grp=100 block is idempotent but a missing
            # unblock is not.
        # "failed" (or a delivered/acked command for a different member or
        # the opposite action) always queues a fresh command below.

    command = RRRAdmsCommand(
        gym_id=member.gym_id,
        integration_id=integration.id,
        action=action,
        test_enroll_number=enroll_number,
        command_text=command_text,
        requested_by_id=actor_id,
        # V7-M1/V7-L10: stamp intent on the row itself.
        intended_member_id=member.id,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"adms_manual_{action}_queued",
        resource_type="rrr_adms_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        actor_id=actor_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number,
                  **({"method": "essl_userinfo_group", "group": "100"}
                     if action == "block" else {})},
    )
    return command


def door_blocked_state(member: Member) -> dict[str, object]:
    """Return the latest requested or acknowledged access state for a member.

    A command queued by the owner is the effective requested state while it
    waits for the device. Only access-changing acknowledgements participate;
    unrelated INFO, sync, and enrollment commands must not reset the toggle.
    The terminal identity may come from a confirmed ADMS mapping even when
    ``members.device_enroll_number`` has not been populated.

    V6-M8: a failure newer than the latest candidate is surfaced as a
    distinct ``failed`` state (``failed_action`` / ``failed_at``) instead
    of silently reverting to the previous acked state — the member page
    can show "failed — tap to retry" (re-tapping the toggle queues a
    fresh command; failed rows never dedupe). V6-M9: a queued/pending
    command older than ``ADMS_QUEUED_STALE_MINUTES`` (the terminal polls
    every 30 s, so 10 min without delivery means offline/misconfigured)
    is ``stale_queued`` and no longer reports ``blocked=True`` as fact;
    ``queued_since`` / ``terminal_last_seen_at`` tell the owner how stale
    the request is.
    """
    candidates: list[tuple[datetime, int, bool, str, str, str | None]] = []
    failures: list[tuple[datetime, int, str, str | None, str | None]] = []

    if _adms_integration(member.gym_id) is None:
        bridge_cmd = db.session.execute(
            select(BridgeCommand)
            .where(
                BridgeCommand.gym_id == member.gym_id,
                BridgeCommand.member_id == member.id,
                BridgeCommand.command_type.in_(("disable_user", "enable_user")),
                BridgeCommand.status.in_(("pending", "leased", "acked")),
            )
            .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if bridge_cmd is not None:
            candidates.append((
                _as_utc(bridge_cmd.created_at),
                bridge_cmd.id,
                bridge_cmd.command_type == "disable_user",
                bridge_cmd.status,
                "bridge",
                None,
            ))
        bridge_failure = db.session.execute(
            select(BridgeCommand)
            .where(
                BridgeCommand.gym_id == member.gym_id,
                BridgeCommand.member_id == member.id,
                BridgeCommand.command_type.in_(("disable_user", "enable_user")),
                BridgeCommand.status == "failed",
            )
            .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if bridge_failure is not None:
            failures.append((
                _as_utc(bridge_failure.created_at),
                bridge_failure.id,
                "bridge",
                bridge_failure.last_error,
                "block" if bridge_failure.command_type == "disable_user" else "unblock",
            ))

    try:
        enroll = resolve_adms_enroll_number(member)
    except ValueError:
        enroll = None
    if enroll:
        ids = {enroll}
        try:
            ids.add(canonical_enroll_number(enroll))
        except ValueError:
            pass
        adms_cmd = db.session.execute(
            select(RRRAdmsCommand)
            .where(
                RRRAdmsCommand.gym_id == member.gym_id,
                RRRAdmsCommand.test_enroll_number.in_(ids),
                RRRAdmsCommand.action.in_(("block", "unblock", "delete_user")),
                RRRAdmsCommand.status.in_(("queued", "delivered", "acked")),
            )
            .order_by(RRRAdmsCommand.created_at.desc(), RRRAdmsCommand.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if adms_cmd is not None:
            candidates.append((
                _as_utc(adms_cmd.created_at),
                adms_cmd.id,
                adms_cmd.action in {"block", "delete_user"},
                adms_cmd.status,
                "adms_direct",
                adms_cmd.result_message,
            ))
        adms_failure = db.session.execute(
            select(RRRAdmsCommand)
            .where(
                RRRAdmsCommand.gym_id == member.gym_id,
                RRRAdmsCommand.test_enroll_number.in_(ids),
                RRRAdmsCommand.action.in_(("block", "unblock")),
                RRRAdmsCommand.status == "failed",
            )
            .order_by(RRRAdmsCommand.created_at.desc(), RRRAdmsCommand.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if adms_failure is not None:
            failures.append((
                _as_utc(adms_failure.created_at),
                adms_failure.id,
                "adms_direct",
                adms_failure.result_message,
                adms_failure.action if adms_failure.action in ("block", "unblock") else None,
            ))

    latest = max(candidates, key=lambda item: (item[0], item[1])) if candidates else None
    latest_failure = max(failures, key=lambda item: (item[0], item[1])) if failures else None
    # V6-M8: the newest event is a failure — the door's real state is
    # unknown (the terminal may have applied it and lost the ack), so
    # report the failure distinctly instead of the stale previous state.
    failed = bool(latest_failure and (latest is None or latest_failure[:2] > latest[:2]))
    failed_action = latest_failure[4] if failed else None
    failed_at = latest_failure[0].isoformat() if failed else None
    if latest is None:
        blocked = False
        status = ""
        connector = latest_failure[2] if latest_failure else None
    else:
        _, _, blocked, status, connector, _ = latest
    pending = status in {"pending", "leased", "queued", "delivered"}
    # The pending action is what was requested, even when a stale queued
    # block no longer counts as blocked=True below (V6-M9).
    requested_blocked = blocked
    # V6-M9: a queued/pending command the terminal never picked up is
    # stale, not a fact — stop asserting blocked and say since when.
    stale_queued = False
    queued_since = None
    if latest is not None and status in {"queued", "pending"}:
        created_at = latest[0]
        if utcnow() - created_at > timedelta(minutes=ADMS_QUEUED_STALE_MINUTES):
            stale_queued = True
            queued_since = created_at.isoformat()
            blocked = False
    terminal_last_seen_at = None
    integration = _adms_integration(member.gym_id)
    if integration is not None and integration.last_success_at is not None:
        terminal_last_seen_at = _as_utc(integration.last_success_at).isoformat()
    detail = None
    if latest_failure and (latest is None or latest_failure[:2] > latest[:2]):
        detail = latest_failure[3]
        connector = latest_failure[2]
    return {
        "blocked": blocked,
        "pending": pending,
        "pending_action": ("block" if requested_blocked else "unblock") if pending else None,
        "connector": connector,
        "detail": detail,
        "failed": failed,
        "failed_action": failed_action,
        "failed_at": failed_at,
        "stale_queued": stale_queued,
        "queued_since": queued_since,
        "terminal_last_seen_at": terminal_last_seen_at,
    }


def queue_manual_bridge_member_command(
    member: Member, action: str, actor_id: int | None
) -> BridgeCommand | None:
    """Queue an owner-initiated block/unblock for a bridge (TCP) terminal.

    The bridge equivalent of :func:`queue_manual_adms_member_command`:
    the owner explicitly chooses ``block``/``unblock`` (mapped to
    ``disable_user``/``enable_user``) instead of the action being derived
    from membership state.  The bridge .exe picks the command up on its
    next poll; a block switches the member's terminal time-zone to the
    deny schedule, an unblock restores it.

    Safety is enforced at serve time, not here: the lease path cancels a
    disable for a non-blockable member (fail-safe) and an enable for a
    non-enableable member (H8), so a manual unblock can never re-open the
    door for a paused/expired member.  Callers that want a clear,
    actionable error up front (e.g. "fix the dates first") should check
    :func:`member_is_proven_enableable` before calling.

    Returns ``None`` when there is no active bridge installation or the
    member has no enroll number.  Does not commit.
    """
    if action not in {"block", "unblock"}:
        raise ValueError(f"Unknown manual bridge action: {action!r}")
    installation = _active_installation(member.gym_id)
    if installation is None:
        return None
    # V7-M1: resolve mapping-preferred, like the ADMS queue — a
    # mapping-only member has no device_enroll_number but still has a
    # terminal identity, and its delete-time block must queue.
    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None
    command_type = "disable_user" if action == "block" else "enable_user"

    # Deduplicate against the latest command for this member: never stack
    # a second pending command of the same type, and let a not-yet-served
    # pending command be replaced by the owner's explicit choice.
    latest = db.session.execute(
        select(BridgeCommand)
        .where(BridgeCommand.bridge_id == installation.id, BridgeCommand.member_id == member.id)
        .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()
    if latest is not None:
        if (
            latest.status in {"pending", "leased"}
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            return latest
        if latest.status == "pending":
            latest.command_type = command_type
            latest.enroll_number = enroll_number
            latest.member_name = member.full_name
            latest.delay_seconds = None
            latest.last_error = None
            latest.retry_attempt = 0
            latest.not_before = None
            db.session.flush()
            audit(
                action=f"bridge_manual_{action}_queued",
                resource_type="bridge_command",
                resource_id=latest.id,
                gym_id=member.gym_id,
                actor_id=actor_id,
                metadata={"member_id": member.id, "enroll_number": enroll_number,
                          "replaced_pending": True},
            )
            return latest

    command = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type=command_type,
        enroll_number=enroll_number,
        member_name=member.full_name,
    )
    db.session.add(command)
    db.session.flush()
    audit(
        action=f"bridge_manual_{action}_queued",
        resource_type="bridge_command",
        resource_id=command.id,
        gym_id=member.gym_id,
        actor_id=actor_id,
        metadata={"member_id": member.id, "enroll_number": enroll_number},
    )
    return command


def queue_manual_member_block(member: Member, actor_id: int | None):
    """Queue an owner-initiated block for one member, ADMS-first (V7-M2).

    Same dispatch as :func:`queue_membership_command`: a configured
    direct-ADMS integration is authoritative for the gym, bridge-only gyms
    use their connector. Used by unenroll, where the owner explicitly
    removes terminal access — so this is a *manual* (owner) block, not an
    automatic membership-derived one: on ADMS it serves through the owner
    branch (B-H1), which is the same branch the manual access toggle
    uses. On bridge gyms the lease guard still judges it (an active
    member's block is lease-cancelled per the fail-closed invariant —
    there is no bridge owner-override; see V7-M2 note in the unenroll
    endpoint). Returns ``None`` when no terminal is commissioned or the
    member has no terminal identity. Does not commit.
    """

    if _adms_integration(member.gym_id) is not None:
        return queue_manual_adms_member_command(member, "block", actor_id)
    return queue_manual_bridge_member_command(member, "block", actor_id)


def queue_membership_command(
    member: Member, *, force: bool = False
) -> BridgeCommand | RRRAdmsCommand | None:
    """Queue the latest required terminal state, without duplicating work.

    This function deliberately does not commit.  Call it in the same database
    transaction as the membership change, so a renewal/expiry can never be
    saved without its corresponding device command.

    A configured direct-ADMS integration is authoritative for the gym. Its
    commands are queued only after supervised commissioning; the legacy
    Windows bridge is never used as a fallback for that gym. Bridge-only
    gyms continue to use their active Windows connector.
    """

    if _adms_integration(member.gym_id) is not None:
        return queue_adms_membership_command(member, force=force)
    return _queue_bridge_membership_command(member, force=force)


def _queue_bridge_membership_command(member: Member, *, force: bool = False) -> BridgeCommand | None:
    # V7-M1: resolve mapping-preferred, like the ADMS queue — a
    # mapping-only member has no device_enroll_number but still has a
    # terminal identity, and its delete-time block must queue (the bridge
    # leg previously returned None here, so the block never existed).
    try:
        enroll_number = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not enroll_number:
        return None

    installation = _active_installation(member.gym_id)
    if installation is None:
        return None

    command_type = desired_command_type(member)
    # This lock is essential: a dashboard renewal must never mutate a command
    # that the polling request has already leased and handed to the laptop.
    latest = db.session.execute(
        select(BridgeCommand)
        .where(BridgeCommand.bridge_id == installation.id, BridgeCommand.member_id == member.id)
        .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    if latest is not None:
        if (
            latest.status in {"pending", "leased"}
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            if force and latest.status == "pending":
                latest.not_before = None
            return latest
        if latest.status == "pending":
            # A not-yet-delivered command can safely be replaced by the most
            # recent membership state.  A leased command is left immutable;
            # its follow-up command preserves correct final ordering.
            latest.command_type = command_type
            latest.enroll_number = enroll_number
            latest.member_name = member.full_name
            latest.delay_seconds = None
            latest.last_error = None
            latest.retry_attempt = 0
            latest.not_before = None
            return latest
        if (
            latest.status == "acked"
            and latest.command_type == command_type
            and latest.enroll_number == enroll_number
        ):
            # A normal membership edit has nothing new to deliver once the
            # terminal acknowledged the required state.  A reconciliation is
            # different: it deliberately re-sends the present state so a
            # terminal that was manually changed can be repaired.
            if not force:
                return latest

    command = BridgeCommand(
        bridge_id=installation.id,
        gym_id=member.gym_id,
        member_id=member.id,
        command_type=command_type,
        enroll_number=enroll_number,
        member_name=member.full_name,
    )
    db.session.add(command)
    return command


def _has_newer_manual_block(member: Member) -> bool:
    """True when the member's latest acked state is an owner (manual) block
    queued after the member's last membership change (V6-M7).

    An owner blocking an active member for misconduct is a deliberate
    override of the membership-derived desired state (B-H1). A routine
    Re-sync must not silently undo it by re-asserting "active → unblock".
    The block only protects while it is newer than the last membership
    change (``member.updated_at``): a renewal/edit after the block means
    the owner has since touched the membership, so reconcile may proceed.
    ADMS manual blocks carry ``requested_by_id`` on the command row;
    bridge manual blocks are identified through their queue-time audit
    row (bridge rows carry no actor). A missing audit row (legacy/purged)
    fails open — documented limitation, not a silent undo: the audit is
    the only record that a bridge block was manual.
    """
    updated_at = member.updated_at
    if updated_at is not None:
        updated_at = _as_utc(updated_at)
    try:
        enroll = resolve_adms_enroll_number(member)
    except ValueError:
        enroll = None
    if enroll:
        ids = {enroll}
        try:
            ids.add(canonical_enroll_number(enroll))
        except ValueError:
            pass
        manual_block = (
            RRRAdmsCommand.query.filter(
                RRRAdmsCommand.gym_id == member.gym_id,
                RRRAdmsCommand.test_enroll_number.in_(ids),
                RRRAdmsCommand.action == "block",
                RRRAdmsCommand.status == "acked",
                RRRAdmsCommand.requested_by_id.isnot(None),
            )
            .order_by(RRRAdmsCommand.created_at.desc(), RRRAdmsCommand.id.desc())
            .first()
        )
        if manual_block is not None and (
            updated_at is None or _as_utc(manual_block.created_at) > updated_at
        ):
            return True
    latest_bridge = (
        BridgeCommand.query.filter(
            BridgeCommand.gym_id == member.gym_id,
            BridgeCommand.member_id == member.id,
            BridgeCommand.command_type == "disable_user",
            BridgeCommand.status == "acked",
        )
        .order_by(BridgeCommand.created_at.desc(), BridgeCommand.id.desc())
        .first()
    )
    if latest_bridge is not None:
        from app.models.audit_log import AuditLog

        manual_audit = (
            AuditLog.query.filter_by(
                resource_type="bridge_command",
                resource_id=str(latest_bridge.id),
                action="bridge_manual_block_queued",
            )
            .order_by(AuditLog.id.desc())
            .first()
        )
        if manual_audit is not None and (
            updated_at is None or _as_utc(manual_audit.created_at) > updated_at
        ):
            return True
    return False


def queue_gym_reconciliation(gym_id: int) -> int:
    """Queue access state for enrolled members through the gym's connector.

    V6-M7: an active member whose latest acked state is a manual block
    newer than their last membership change is SKIPPED — reconcile must
    not silently undo an owner's misconduct block. (The daily scheduler
    job does not call this function; it has its own expired/paused-only
    reconcile, so this skip only affects the owner-triggered Re-sync.)
    """

    adms = _adms_integration(gym_id)
    if adms is None and _active_installation(gym_id) is None:
        return 0
    members_query = Member.query.filter(
        Member.gym_id == gym_id,
        Member.deleted_at.is_(None),
    )
    if adms is None:
        members_query = members_query.filter(Member.device_enroll_number.is_not(None))
    else:
        # Confirmed ADMS mappings are authoritative too. Older/imported member
        # rows may have an identity mapping before device_enroll_number was
        # backfilled, and resolve_adms_enroll_number handles both forms.
        mapped_member_ids = select(RRRIdentityMapping.member_id).where(
            RRRIdentityMapping.gym_id == gym_id,
            RRRIdentityMapping.status == "confirmed",
        )
        members_query = members_query.filter(
            or_(Member.device_enroll_number.is_not(None), Member.id.in_(mapped_member_ids))
        )
    members = members_query.order_by(Member.id.asc()).all()
    queued = 0
    for member in members:
        if (
            desired_command_type(member) == "enable_user"
            and _has_newer_manual_block(member)
        ):
            continue
        if queue_membership_command(member, force=True) is not None:
            queued += 1
    return queued


def lease_pending_commands(installation: BridgeInstallation) -> list[BridgeCommand]:
    """Lease due commands for one short polling interval.

    Commands are never removed by a GET.  If the laptop loses power or an ACK
    fails, the expired lease is delivered again with a new token.
    """

    # Once a gym has configured Direct ADMS, it is the sole authority for
    # access changes. Do not let an old paired Windows bridge lease stale
    # commands that were queued before the gym moved to the PC-free path.
    if _adms_integration(installation.gym_id) is not None:
        return []

    now = utcnow()
    lease_seconds = max(30, int(current_app.config["BRIDGE_COMMAND_LEASE_SECONDS"]))
    ready = (
        BridgeCommand.query.filter(
            BridgeCommand.bridge_id == installation.id,
            or_(
                BridgeCommand.status == "pending",
                and_(
                    BridgeCommand.status == "leased",
                    BridgeCommand.lease_expires_at.is_not(None),
                    BridgeCommand.lease_expires_at <= now,
                ),
            ),
            or_(BridgeCommand.not_before.is_(None), BridgeCommand.not_before <= now),
        )
        .order_by(BridgeCommand.created_at.asc(), BridgeCommand.id.asc())
        .limit(max(1, int(current_app.config["BRIDGE_COMMAND_BATCH_SIZE"])))
        .with_for_update()
        .all()
    )
    leased: list[BridgeCommand] = []
    for command in ready:
        # V4-M3: a command queued for a member who no longer holds this
        # enroll number must never execute against the new holder — the
        # bridge executes by enroll number, so judge the CURRENT holder.
        if bridge_command_enroll_holder_mismatch(command):
            cancel_bridge_command(
                command,
                marker=STALE_COMMAND_SUPERSEDED_MARKER,
                # BridgeCommand has no result_code column — the marker only
                # survives inside last_error, so it is embedded in the text.
                error=f"{STALE_COMMAND_SUPERSEDED_MARKER}: Terminal ID now belongs to a different member; queue the access change again if still needed.",
            )
            continue
        # Final guard at the point of no return (fail-safe): hand a disable
        # to the bridge only for a proven-blockable member — paused, or
        # expired with a past end date.  Everything else (active on any
        # date, future/NULL end, missing member) is cancelled here.
        # V4-H2: a soft-deleted member is blockable — no active membership
        # exists to protect, and the delete-time block must be servable.
        if bridge_disable_must_be_cancelled_at_lease(command):
            cancel_bridge_command(command)
            continue
        # Mirror guard for enables (H8): hand an enable to the bridge only
        # for a proven-enableable member — active with an end date today
        # or in the future.  A stale enable for a paused/expired member
        # must never re-open the door.
        if bridge_enable_must_be_cancelled(command):
            # V4-M4: a past-window set_valid_date was judged as a disable,
            # so its cancel is a stale DISABLE, not a stale enable.
            if bridge_set_valid_date_is_disable(command):
                cancel_bridge_command(command)
            else:
                cancel_bridge_command(
                    command, marker=STALE_ENABLE_MARKER, error=STALE_ENABLE_ERROR
                )
            continue
        command.lease(secrets.token_urlsafe(32), now + timedelta(seconds=lease_seconds))
        leased.append(command)
    return leased


def schedule_retry_after_failed_command(command: BridgeCommand) -> BridgeCommand | None:
    """Schedule a bounded new-ID retry after a physical device failure.

    The laptop persists command outcomes by command ID, so the same failed ID
    must never be re-executed.  A retry is therefore a delayed command with a
    new ID.  This avoids a tight loop while still recovering from transient
    Wi-Fi, terminal, or power failures.
    """

    max_attempts = max(1, int(current_app.config["BRIDGE_COMMAND_MAX_EXECUTION_ATTEMPTS"]))
    if command.retry_attempt + 1 >= max_attempts or command.member_id is None:
        return None
    member = db.session.get(Member, command.member_id)
    if member is None:
        return None
    # V7-M1: a mapping-only member has no device_enroll_number — resolve
    # mapping-preferred so its delete-time block can still be re-driven.
    try:
        member_enroll = resolve_adms_enroll_number(member)
    except ValueError:
        return None
    if not member_enroll:
        return None
    if member.gym_id != command.gym_id:
        # M2: a cross-gym member reference must never authorise a retry.
        return None
    if (
        command.command_type in BRIDGE_DISABLE_COMMAND_TYPES
        and disable_must_be_cancelled_including_deleted(member)
    ):
        # Fail-safe: never schedule a retry disable for a member who is not
        # proven blockable, even if the plain desired-state check agrees.
        # V5-M5: the including-deleted guard (not the strict one) — a
        # soft-deleted member's delete-time block must be re-driven after
        # a transient failure, or the ex-member keeps door access forever.
        return None
    if (
        command.command_type in BRIDGE_ENABLE_COMMAND_TYPES
        and bridge_enable_must_be_cancelled(command)
    ):
        # H8 mirror: never schedule a retry enable for a member who is not
        # proven enableable. V5-L8: use the bridge-aware guard, not the
        # plain member guard — a past-window set_valid_date is a DISABLE
        # intent (V4-M4) and must be judged by the including-deleted
        # disable guard, or its retry is wrongly refused for every
        # expired/deleted member.
        return None
    if command.command_type in ("create_user", "set_valid_date"):
        # V5-L8: desired_command_type only ever returns enable/disable, so
        # comparing a create_user / set_valid_date retry against it could
        # never match and these commands were never retried. Judge them on
        # their own intent instead: a past-window set_valid_date closes
        # the door (disable-like), anything else opens it (enable-like).
        intent = (
            "disable_user"
            if bridge_set_valid_date_is_disable(command)
            else "enable_user"
        )
        if desired_command_type(member) != intent:
            # A later membership transaction will queue the correct
            # current state.
            return None
    elif desired_command_type(member) != command.command_type:
        # A later membership transaction will queue the correct current state.
        return None
    if member_enroll != command.enroll_number:
        return None

    base_delay = max(30, int(current_app.config["BRIDGE_COMMAND_RETRY_SECONDS"]))
    delay_seconds = min(3600, base_delay * (2 ** command.retry_attempt))
    retry = BridgeCommand(
        bridge_id=command.bridge_id,
        gym_id=command.gym_id,
        member_id=command.member_id,
        command_type=command.command_type,
        enroll_number=command.enroll_number,
        member_name=command.member_name,
        retry_attempt=command.retry_attempt + 1,
        not_before=utcnow() + timedelta(seconds=delay_seconds),
    )
    db.session.add(retry)
    return retry


def acknowledge_command(
    command: BridgeCommand,
    *,
    status: str,
    lease_token: str,
    error_message: str | None,
    result_data: str | None = None,
) -> tuple[bool, str | None]:
    """Apply a bridge ACK.  Returns ``(accepted, error_code)``."""

    if status not in {"acked", "failed", "accepted"}:
        return False, "invalid_status"

    if command.status in {"acked", "failed"}:
        # Retrying an already received ACK is safe only when it agrees with
        # the durable result.  It must never mutate a completed command.
        return (command.status == status, None if command.status == status else "already_final")

    if command.status != "leased":
        return False, "not_leased"
    if not lease_token or not secrets.compare_digest(command.lease_token or "", lease_token):
        return False, "lease_mismatch"
    if command.lease_expires_at is None or _as_utc(command.lease_expires_at) < utcnow():
        return False, "lease_expired"

    if status == "accepted":
        # The connector's server accepted the command but device delivery is
        # unconfirmed (e.g. eBioServer queues the push for the terminal's next
        # poll). Keep the command pending so it is re-leased and retried;
        # never report it as done. Escalate if the device never confirms.
        command.lease_token = None
        command.lease_expires_at = None
        note = (error_message or "Accepted by server; device delivery unconfirmed.").strip()[:1000]
        if command.delivery_attempts >= 10:
            command.acknowledge(
                "failed",
                f"Device did not confirm delivery after {command.delivery_attempts} attempts: {note}",
            )
        else:
            command.status = "pending"
            command.last_error = note
        return True, None
    command.acknowledge(status, error_message, result_data=result_data)
    return True, None

