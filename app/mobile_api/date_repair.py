"""Owner-only membership date repair endpoints.

Scan compares every member's stored membership_end against the end
implied by their plan and their renewal ledger (RenewalHistory):

- ``ledger_mismatch``: the ledger's latest *started* ``new_end``
  differs from the stored end, i.e. the end was changed outside the
  payment/renewal flow (manual edit, freeze, import). Rows whose
  ``new_start`` is still in the future are PENDING scheduled renewals
  and never count as the ledger's latest end (V4-H1). Proposal: the
  latest started row's new_end.
- ``span_mismatch``: no usable ledger, and the member is still in
  their first period, but the stored span is longer than one plan
  period. Proposal: start + plan duration - 1 (the renewal
  convention: a 30-day period spans 29 days between start and end).
- ``historyless_pushed_end``: no usable ledger, and the member is past
  their first period (the owner renewed by hand-editing end dates, so
  no renewal history exists). The scan steps from the start by plan
  duration, following the renewal chain's own chaining (each period
  starts the day after the previous period ends), to the period
  containing gym-local today, and flags when the stored end runs past
  that expected current end. Review-only: a hand-pushed end may
  reflect a cash payment the owner took without recording it, so the
  data alone cannot prove the member did not pay. The finding shows
  both dates so the owner can confirm per member. Never auto-corrected
  by Apply.
- ``oversized_renewal``: the ledger agrees with the stored end, but at
  least one started renewal applied more days than the plan duration
  in force when that row was written (``RenewalHistory.duration_days``,
  snapshotted at write time — V4-M13 — so a later plan edit cannot
  rewrite history; legacy rows fall back to the live plan duration).
  Creation rows are checked too: a signup that applied more than one
  period is a real error, proposal start + duration - 1. Pending
  (not-yet-started) rows are not counted: their excess belongs to a
  future period, not the stored end.
- ``start_missing``: no start date stored (defensive — the schema marks
  the column NOT NULL, so this only fires for legacy/imported rows).
  Proposal: the creation row's recorded start, when one exists.
- ``start_after_end``: the stored start is after the stored end.
  Proposal: the ledger's recorded pair (latest chain row's start +
  latest end) when the ledger determines both and no restart breaks
  the chain; otherwise review-only.
- ``start_in_future``: the start is after gym-local today. Review-only:
  a future start can be a legitimate pre-registration, so the scan
  never auto-corrects it.
- ``start_ledger_mismatch``: the stored start disagrees with the start
  the renewal ledger records for the current chain — but only when
  the stored start matches NO ledger ``new_start`` at all. The
  renewal flows overwrite ``membership_start`` with each period's
  start (V3-H4), so the stored start is the CURRENT period's start
  (the latest chain row's ``new_start``), not the chain start; a
  stored start equal to any ledger ``new_start`` is legitimate.
  Proposal: the latest *started* chain row's ``new_start`` — never a
  future scheduled start (V4-H1).
- ``period_overlap``: two consecutive ledger periods overlap (a later
  period starts strictly before the previous period ends). Review-only:
  which row is wrong is ambiguous. A shared boundary day is tolerated,
  and a gap larger than one day is a restart after expiry — the code
  already treats restarts as legitimate — so neither is flagged.
- ``payment_coverage_gap``: the member is otherwise clean, but days
  inside the stored period are covered by neither a ledger period nor
  a verified payment. Two evidences, either is enough: (a) a gap
  between two ledger periods that falls inside the stored start/end
  (a restart gap *before* the stored start is still legitimate and
  is not flagged), or (b) verified payments exist for the member but
  their total paid days cover fewer periods than the stored span
  holds. Review-only: a cash payment taken offline, a free period or
  a discount can explain the gap, so the scan never auto-corrects
  it — the owner confirms per member. Hard gate: this check only
  touches members who have at least one verified payment on
  record. Members with no payment at all are left completely
  alone by it — no flag, even on a ledger gap — because cash-only
  members must not be pulled into a payment scan.

Start-date checks run before the end-date checks: a bad start makes
every span derived from it unreliable. Findings without a proposal are
review-only; Apply leaves them for a manual per-member Start/End edit
instead of guessing.

Members whose notes carry freeze markers are reported with
``confidence="review"`` because a freeze legitimately extends the end
beyond the ledger; the UI leaves those unselected by default. Paused
members are scanned too (their freeze markers make their findings
review-confidence); deleted members are excluded entirely.

Apply recomputes the proposal server-side for each requested member
and only writes when the member is still flagged with that proposal,
so a stale scan can never overwrite a member who was fixed meanwhile.
Apply refuses members with freeze markers (or paused status) outright
(V3-H5 freeze guard): a freeze extension must never be stripped by a
bulk apply — the owner fixes those by hand after unfreezing.
For ``oversized_renewal`` Apply also corrects the ledger (V3-H5):
each oversized chain row is shortened to its plan duration and later
chain rows shift earlier by the same amount, so ``chain_last_end``
equals the applied end and the next scan converges instead of
proposing the old oversized end back. The shift moves each shifted
row's ``previous_end`` by the same amount and its ``previous_start``
by the amount the previous row's start moved (V4-M11), or a later
refund would restore the pre-correction oversized end (and a wrong
start) via ``_revert_renewal``. Apply never writes a future
``membership_start`` (V4-H1): proposals come from started rows only,
and Apply drops any future start as a final guard."""
from __future__ import annotations

from datetime import date as _date
from datetime import timedelta

from flask import g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, PaymentVerification, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)
from app.services.timezone_service import today_for_gym

_TOLERANCE_DAYS = 1


def _applied_days(row: RenewalHistory) -> int | None:
    """Days a ledger row actually added: (new_end - new_start) + 1."""
    if row.new_start is None or row.new_end is None:
        return None
    return (row.new_end - row.new_start).days + 1


def _is_creation_row(row: RenewalHistory, creation_ids: set | None = None) -> bool:
    """The creation row stores previous_end == new_start == start.

    V4-L3: when the caller passes the ledger's precomputed
    ``creation_ids`` (flag first, heuristic + ``paid_on`` refinement
    only for unflagged legacy rows — see
    ``_creation_row_ids_for_ledger``), that set decides. Without it,
    fall back to the flag plus the raw heuristic, which is the old
    behaviour for callers that cannot supply payment context.
    """
    if creation_ids is not None:
        return row.id in creation_ids
    if getattr(row, "is_creation", False):
        return True
    return (
        row.previous_end is not None
        and row.new_start is not None
        and row.previous_end == row.new_start
    )


def _has_override(row: RenewalHistory) -> bool:
    """True when the owner deliberately granted extra days on this row
    (V5-L16) — the row is oversized by approval, not by error, and the
    oversized check/corrector must leave it alone."""
    return bool((getattr(row, "override_reason", None) or "").strip())


def _creation_row_ids_for_ledger(
    rows: list[RenewalHistory],
    member_start,
    payments_by_id: dict,
) -> set:
    """Creation-row ids for one member's ledger (V4-L3, mirrors
    ``revenue_service._row_is_creation``).

    The explicit ``is_creation`` flag decides first. For unflagged
    legacy rows the heuristic (member's first row with
    ``previous_end == new_start``) applies only when the backing
    payment cannot prove otherwise, so a genuine first renewal of an
    imported member backdated onto ``previous_end`` is no longer
    misclassified as a signup here while ``revenue_service`` counts
    it as a recovery.

    V5-M2 / V6-A1 shared predicate: ``paid_on`` is compared to the
    row's OWN ``new_start`` (for a first row, that *is* the start at
    signup time), never to the member's *current*
    ``membership_start`` — every renewal rewrites that field, so the
    old comparison misclassified the signup of any member who has
    renewed since. ``member_start`` is retained as a parameter for
    call compatibility and is no longer read.
    """
    if not rows:
        return set()
    first_id = min(r.id for r in rows)
    ids = set()
    for row in rows:
        if getattr(row, "is_creation", False):
            ids.add(row.id)
            continue
        if (
            row.id != first_id
            or row.previous_end is None
            or row.new_start is None
            or row.previous_end != row.new_start
        ):
            continue
        if row.previous_start is not None and row.previous_start != row.new_start:
            continue
        paid_on = (
            payments_by_id.get(row.payment_verification_id)
            if row.payment_verification_id is not None
            else None
        )
        if paid_on is None or paid_on == row.new_start:
            ids.add(row.id)
    return ids


def _is_restart_row(row: RenewalHistory) -> bool:
    """A renewal after expiry restarts from 'today', breaking the chain."""
    if row.previous_end is None or row.new_start is None:
        return False
    return row.new_start > row.previous_end + timedelta(days=1)


def _creation_row(rows: list[RenewalHistory], creation_ids: set | None = None) -> RenewalHistory | None:
    """First creation row, if the ledger records the original start."""
    for row in rows:
        if _is_creation_row(row, creation_ids):
            return row
    return None


def _chain_start_row(rows: list[RenewalHistory], creation_ids: set | None = None) -> RenewalHistory | None:
    """First row of the current chain: the last restart row, else the
    first row — but only when the app itself recorded that chain start
    (a creation row or a restart row). Returns None for a partial
    (imported) ledger whose chain start is not recorded: the stored
    start may legitimately predate the surviving rows, so the ledger
    cannot judge it."""
    if not rows:
        return None
    start_row = rows[0]
    for row in rows:
        if _is_restart_row(row):
            start_row = row
    if _is_creation_row(start_row, creation_ids) or _is_restart_row(start_row):
        return start_row
    return None


def _current_chain_rows(rows: list[RenewalHistory], creation_ids: set | None = None) -> list[RenewalHistory]:
    """Rows of the current chain: from its recorded start row onward.

    Rows before the last restart belong to an old chain and no longer
    determine the stored dates. Returns all rows when the ledger does
    not record a chain start (partial/imported ledger).
    """
    chain_start = _chain_start_row(rows, creation_ids)
    if chain_start is None:
        return list(rows)
    chain_idx = next((i for i, r in enumerate(rows) if r is chain_start), 0)
    return rows[chain_idx:]


def _row_duration_days(row: RenewalHistory, fallback: int) -> int:
    """Plan duration in force when *row* was written (V4-M13).

    Prefers the snapshot stored on the row; legacy rows without one
    fall back to the row's live plan, then the member's plan duration.
    Comparing against the live duration directly is what let a plan
    edit rewrite history — this helper is the only place the
    oversized checks/corrector read a duration.
    """
    snapshot = getattr(row, "duration_days", None)
    if snapshot is not None:
        return snapshot
    if row.plan is not None:
        return row.plan.duration_days
    return fallback


def _correct_oversized_ledger(
    chain_rows: list[RenewalHistory],
    duration: int,
    creation_ids: set | None = None,
    today=None,
) -> None:
    """Shorten oversized chain rows so the ledger matches the repair.

    Each chain renewal that applied more days than its plan allows is
    cut back to its plan duration, and every later chain row shifts
    earlier by the accumulated excess — so chaining is preserved
    (each period still starts the day after the previous one ends),
    no row stays oversized, and the chain's last end equals the
    applied end. Creation rows are shortened too when THEY applied
    more than one period (V4-M13): a signup written with the wrong
    span is a real error, and leaving it long would keep the scan
    flagging the member forever. Callers must flush/commit; rows are
    mutated in place.

    V5-L6: ``creation_ids`` is the caller's refined flag-first set —
    the ``previous_start`` shift decision must use it, not the raw
    heuristic, or a genuine first renewal misclassified as creation
    gets its ``previous_start`` shifted by the wrong amount and a
    later refund restores a wrong (too-early) start.
    V5-L14: pending rows (``new_start > today``) keep their paid
    dates — only their ``previous_end`` is re-chained to the
    shortened previous period. Shifting their ``new_start`` earlier
    could cross today and activate the "future" renewal early.
    V5-L16: owner-approved override rows keep their span (no
    shortening, no excess) but still shift with the chain.
    """
    shift = 0
    # Shift applied to the PREVIOUS row's new_start. A row's
    # previous_start is the member's start before that renewal, i.e.
    # the previous period's start — so it moves by the amount the
    # previous row's new_start moved, NOT by the amount this row
    # moves (this row also absorbs the previous row's own shortening
    # via `shift`, which must not leak into previous_start).
    prev_shift = 0
    # How much the previous row's new_end moved (== shift_before for
    # started rows; 0 after a pending row, whose end never moves).
    # previous_end tracks the previous period's END, so it moves by
    # this, not by shift_before, once pending rows are in the chain.
    prev_end_shift = 0
    for row in chain_rows:
        if row.new_start is None or row.new_end is None:
            # V5-L6: a dateless row must not stale prev_shift /
            # prev_end_shift for the next row — it never moved.
            prev_shift = 0
            prev_end_shift = 0
            continue
        shift_before = shift
        if today is not None and row.new_start > today:
            # V5-L14: pending row — re-chain previous_end only; the
            # paid new_start/new_end (and previous_start) stay put,
            # and the row contributes no excess of its own.
            if row.previous_end is not None and prev_end_shift:
                row.previous_end = row.previous_end - timedelta(days=prev_end_shift)
            prev_shift = 0
            prev_end_shift = 0
            continue
        if shift_before or prev_end_shift:
            row.new_start = row.new_start - timedelta(days=shift_before)
            row.new_end = row.new_end - timedelta(days=shift_before)
            # V4-M11: previous_start/previous_end are snapshots of the
            # same chain — move them with it, or a later refund
            # resurrects the oversized end: _revert_renewal restores
            # membership_end from previous_end. previous_end tracks
            # the previous period's END, which moved by exactly
            # prev_end_shift. previous_start tracks the previous
            # period's START, which moved only by prev_shift. (A
            # creation row's previous_* equal its own new_start, so
            # they move with the row itself.) Moving previous_end by
            # the same amount also keeps a restart row recognisable
            # (_is_restart_row compares new_start against
            # previous_end + 1), so the old chain cannot re-enter
            # scope for later scans.
            if row.previous_end is not None:
                row.previous_end = row.previous_end - timedelta(days=prev_end_shift)
            if row.previous_start is not None:
                _start_shift = (
                    shift_before if _is_creation_row(row, creation_ids) else prev_shift
                )
                if _start_shift:
                    row.previous_start = row.previous_start - timedelta(
                        days=_start_shift
                    )
        # Total movement of this row's new_end so far; its own excess
        # (if any) adds to it below.
        end_shift = shift_before
        prev_shift = shift_before
        applied = _applied_days(row)
        if applied is None:
            prev_end_shift = end_shift
            continue
        if _has_override(row):
            # V5-L16: owner-approved extra days — keep the span, add
            # no excess, but the row already shifted with the chain.
            prev_end_shift = end_shift
            continue
        row_duration = _row_duration_days(row, duration)
        if applied > row_duration + _TOLERANCE_DAYS:
            excess = applied - row_duration
            row.new_end = row.new_end - timedelta(days=excess)
            shift += excess
            end_shift += excess
        prev_end_shift = end_shift


def _expected_current_end(
    start: _date, duration: int, today: _date
) -> _date:
    """End of the period containing *today*, stepping from *start*.

    Periods follow the renewal convention: one plan period spans
    ``duration`` days inclusive, ``[start, start + duration - 1]``,
    and the next period starts the day after the previous one ends
    (``new_start = previous new_end + 1``). So period ``k`` spans
    ``[start + k * duration, start + k * duration + duration - 1]``.
    """
    period_span = duration
    k = (today - start).days // period_span
    return start + timedelta(days=k * period_span + duration - 1)


def _overlapping_pair(rows: list[RenewalHistory]) -> tuple | None:
    """First consecutive pair whose periods overlap.

    The renewal flows chain periods as new_start = previous new_end + 1
    day. A boundary day shared between two periods (new_start ==
    previous new_end) is tolerated — inclusive day-counting makes that
    ambiguous — but a start strictly before the previous end means days
    are counted twice. Gaps larger than one day are restarts after
    expiry, which the code already treats as legitimate, so they are
    not flagged here.
    """
    for prev, cur in zip(rows, rows[1:]):
        if prev.new_end is None or cur.new_start is None:
            continue
        if cur.new_start < prev.new_end:
            return prev, cur
    return None


def _ledger_gap_inside_period(
    rows: list[RenewalHistory], start: _date, end: _date
) -> int:
    """Days between consecutive ledger periods that fall inside the
    stored period. A restart gap before the stored start is not
    counted: the stored period starts at the restart, so those days
    were never granted by the member's dates."""
    gap_days = 0
    for prev, cur in zip(rows, rows[1:]):
        if prev.new_end is None or cur.new_start is None:
            continue
        gap_start = prev.new_end + timedelta(days=1)
        gap_end = cur.new_start - timedelta(days=1)
        if gap_end < gap_start:
            continue
        inside_start = max(gap_start, start)
        inside_end = min(gap_end, end)
        if inside_end >= inside_start:
            gap_days += (inside_end - inside_start).days + 1
    return gap_days


def classify_member(
    member: Member,
    rows: list[RenewalHistory],
    today: _date | None = None,
    payments: list | None = None,
) -> dict | None:
    """``payments`` is the member's verified, non-test payments (or
    None when payment data was not fetched); it is only used for the
    payment-coverage check at the end of this function."""
    """Return a scan finding for *member*, or None when dates look right.

    Start-date checks run before the end-date checks: a bad start makes
    every span derived from it unreliable. Findings with a proposal are
    corrected by Apply; findings without one are review-only and Apply
    leaves them for a manual per-member edit.
    """
    # V4-L3: creation-row identity for this ledger, flag first with
    # the paid_on refinement for unflagged legacy rows — computed once
    # so the scan, the chain scoping and the oversized checks all agree
    # with revenue_service on which rows are signups.
    _payments_by_id = {p.id: p.paid_on for p in (payments or [])}
    creation_ids = _creation_row_ids_for_ledger(
        rows, member.membership_start, _payments_by_id
    )
    # 0) A missing start cannot be evaluated further. The schema marks
    #    membership_start NOT NULL, so this is defensive: it can only
    #    fire for legacy/imported rows. The creation row, when present,
    #    records the original start.
    if member.membership_start is None:
        creation = _creation_row(rows, creation_ids)
        finding = {
            "member_id": member.id,
            "full_name": member.full_name,
            "phone": member.phone,
            "plan_name": member.plan.name if member.plan else None,
            "plan_duration_days": member.plan.duration_days if member.plan else None,
            "membership_start": None,
            "membership_end": member.membership_end.isoformat()
            if member.membership_end
            else None,
            "span_days": None,
            "ledger_periods": len(rows),
            "freeze_events": (member.notes or "").count("[Paused on"),
            "confidence": "review",
            "classification": "start_missing",
            "reason": "The member has no start date stored.",
        }
        if creation is not None and creation.new_start is not None:
            finding["proposed_start"] = creation.new_start.isoformat()
            finding["reason"] += (
                " The renewal history records the original start as "
                f"{creation.new_start.isoformat()}."
            )
        return finding

    if member.plan is None or member.membership_end is None:
        return None

    start = member.membership_start
    end = member.membership_end
    duration = member.plan.duration_days
    span_days = (end - start).days
    freeze_events = (member.notes or "").count("[Paused on")

    base = {
        "member_id": member.id,
        "full_name": member.full_name,
        "phone": member.phone,
        "plan_name": member.plan.name,
        "plan_duration_days": duration,
        "membership_start": start.isoformat(),
        "membership_end": end.isoformat(),
        "span_days": span_days,
        "ledger_periods": len(rows),
        "freeze_events": freeze_events,
        "confidence": "review" if freeze_events else "high",
    }

    renewals = [r for r in rows if not _is_creation_row(r, creation_ids)]
    has_restart = any(_is_restart_row(r) for r in renewals)
    chain_start = _chain_start_row(rows, creation_ids)
    # M5: the ledger checks below are scoped to the CURRENT chain (from
    # its recorded start row onward). Rows before the last restart belong
    # to an old chain and no longer determine the stored end — but a
    # restart no longer blinds the checks entirely.
    chain_rows = _current_chain_rows(rows, creation_ids)
    # V4-H1: rows that have not started yet are PENDING scheduled
    # renewals, not the ledger's latest end. A member with a live
    # scheduled renewal must not be flagged ledger_mismatch against
    # the future period's end, and no proposal may ever carry a future
    # date. When today is unknown, every row counts as started (the
    # old behaviour).
    if today is not None:
        active_chain_rows = [
            r for r in chain_rows if r.new_start is None or r.new_start <= today
        ]
    else:
        active_chain_rows = list(chain_rows)
    chain_last_end = (
        active_chain_rows[-1].new_end if active_chain_rows else None
    )
    # V4-M13: the oversized check runs over started chain rows
    # INCLUDING creation rows — a signup that applied more than one
    # period is a real error. Pending rows are excluded: their excess
    # belongs to a future period, not the stored end.
    chain_renewals = list(active_chain_rows)

    # S1) The stored start is after the stored end: the period is
    #     incoherent. When the ledger determines the coherent pair and
    #     no restart breaks the chain, propose both dates; otherwise
    #     the owner fixes it by hand.
    if start > end:
        finding = {
            **base,
            "classification": "start_after_end",
            "reason": (
                f"The start date {start.isoformat()} is after the end "
                f"date {end.isoformat()}."
            ),
        }
        if (
            active_chain_rows
            and chain_last_end is not None
            and not has_restart
            and chain_start is not None
            and active_chain_rows[-1].new_start is not None
        ):
            # V3-H4: the proposed start is the CURRENT period's start
            # (latest started chain row), not the chain start — the
            # renewal flows overwrite membership_start on every
            # renewal. V4-H1: a pending scheduled row's future start
            # is never proposed.
            finding["proposed_start"] = active_chain_rows[-1].new_start.isoformat()
            finding["proposed_end"] = chain_last_end.isoformat()
            finding["reason"] += (
                " The renewal history records this period as "
                f"{active_chain_rows[-1].new_start.isoformat()} to "
                f"{chain_last_end.isoformat()}."
            )
        else:
            finding["confidence"] = "review"
        return finding

    # S2) The start is in the future. Review-only: a future start can
    #     be a legitimate pre-registration, so the scan never
    #     auto-corrects it. Skipped when today is unknown.
    if today is not None and start > today:
        return {
            **base,
            "classification": "start_in_future",
            "confidence": "review",
            "reason": (
                f"The start date {start.isoformat()} is after today "
                f"({today.isoformat()}) — check whether this is a "
                "pre-registered member or a mistyped date."
            ),
        }

    # S3) The stored start matches NO ledger new_start at all, while
    #     the ledger does record a chain start (creation or restart
    #     row) — so the ledger can judge it. V3-H4: the stored start
    #     is the CURRENT period's start (the renewal flows overwrite
    #     membership_start = new_start on every renewal), so a stored
    #     start equal to ANY ledger new_start — creation row or latest
    #     renewal — is legitimate and is not flagged. A partial
    #     (imported) ledger with no recorded chain start cannot judge
    #     the start either: the stored start may legitimately predate
    #     the surviving rows. V4-L14: ledger_starts is built from the
    #     CURRENT chain only — a stored start matching a pre-restart
    #     (old-chain) row is stale, not legitimate. Proposal: the
    #     latest STARTED chain row's new_start (V4-H1: never the
    #     future scheduled start). When no chain row has started yet
    #     there is no current period to propose, so S3 does not fire.
    ledger_starts = {
        r.new_start for r in chain_rows if r.new_start is not None
    }
    if (
        chain_start is not None
        and active_chain_rows
        and active_chain_rows[-1].new_start is not None
        and start not in ledger_starts
    ):
        return {
            **base,
            "classification": "start_ledger_mismatch",
            "proposed_start": active_chain_rows[-1].new_start.isoformat(),
            "reason": (
                f"The renewal history records no period starting "
                f"{start.isoformat()}; the current period starts "
                f"{active_chain_rows[-1].new_start.isoformat()}."
            ),
        }

    # S4) Two consecutive ledger periods overlap: days counted twice.
    #     Review-only — which row is wrong is ambiguous. V6-L17: run
    #     over the CURRENT chain only — an overlap between two
    #     pre-restart rows is stale history that no longer determines
    #     the stored dates, and flagging it would mask later real
    #     findings for this member.
    pair = _overlapping_pair(chain_rows)
    if pair is not None:
        prev, cur = pair
        return {
            **base,
            "classification": "period_overlap",
            "confidence": "review",
            "reason": (
                f"Two renewal periods overlap: the period ending "
                f"{prev.new_end.isoformat()} and the next period "
                f"starting {cur.new_start.isoformat()} share days. "
                "Check the payments before fixing by hand."
            ),
        }

    # 1) The stored end disagrees with the payment ledger (current
    #    chain, started rows only — V4-H1: a pending scheduled row's
    #    future end is never the comparison target). A restart no
    #    longer skips this: the chain's latest new_end is still the
    #    latest recorded period end, so a stored end that disagrees
    #    with it was changed outside a renewal.
    if active_chain_rows and chain_last_end is not None and chain_last_end != end:
        return {
            **base,
            "classification": "ledger_mismatch",
            "proposed_end": chain_last_end.isoformat(),
            "reason": (
                f"Renewal history ends at {chain_last_end.isoformat()} but the "
                f"member's end date is {end.isoformat()} — it was changed "
                "outside a payment/renewal."
            ),
        }

    # 2) The ledger agrees, but a renewal applied more days than the
    #    plan allows — the excess is inside the ledger. Scoped to the
    #    current chain's STARTED rows: excess from a pre-restart chain
    #    no longer affects the stored end, but excess inside the
    #    current chain does, restart or not. Creation rows count too
    #    (V4-M13), and the duration compared against is the snapshot
    #    from write time, not the plan's live duration. A pending
    #    scheduled row's excess is not counted: it belongs to a future
    #    period, and subtracting it from the stored (current) end
    #    would be wrong.
    if active_chain_rows and chain_last_end == end:
        excess = 0
        for row in chain_renewals:
            # V5-L16: owner-approved extra days are not an error.
            if _has_override(row):
                continue
            applied = _applied_days(row)
            if applied is None:
                continue
            row_duration = _row_duration_days(row, duration)
            if applied > row_duration + _TOLERANCE_DAYS:
                excess += applied - row_duration
        if excess > 0:
            proposed = end - timedelta(days=excess)
            return {
                **base,
                "classification": "oversized_renewal",
                "proposed_end": proposed.isoformat(),
                "confidence": "review",
                "reason": (
                    f"One or more renewals applied {excess} more days than "
                    f"the plan duration allows. Check the payments before "
                    "applying."
                ),
            }
        # Ledger agrees and no renewal is oversized: fall through to
        # the payment-coverage check below instead of returning None.

    # 3) No usable ledger. A member still in their first period keeps
    #    the old span check: the span itself must fit one plan period.
    #    A member past their first period has no ledger because the
    #    owner renewed by hand-editing end dates — cutting such a
    #    member back to start + one period would erase months of
    #    membership. Instead, step from the start to the period
    #    containing today and flag (review-only) when the stored end
    #    runs past that expected current end. A hand-pushed end may
    #    reflect a cash payment the owner took without recording it,
    #    so the data alone cannot prove the member did not pay: the
    #    finding shows both dates and Apply never corrects it.
    if not rows:
        if (
            today is not None
            and duration > 0
            and start + timedelta(days=duration - 1) < today
        ):
            expected_end = _expected_current_end(start, duration, today)
            if end > expected_end + timedelta(days=_TOLERANCE_DAYS):
                excess = (end - expected_end).days
                return {
                    **base,
                    "classification": "historyless_pushed_end",
                    "confidence": "review",
                    "expected_end": expected_end.isoformat(),
                    "reason": (
                        f"No renewal history, but the end date "
                        f"{end.isoformat()} runs {excess} days past the "
                        f"end of the current {duration}-day period "
                        f"({expected_end.isoformat()}) counted from the "
                        f"start date {start.isoformat()}. The end may "
                        "have been pushed by hand — possibly for a cash "
                        "payment that was never recorded — so check the "
                        "payments before fixing by hand."
                    ),
                }
            return None
        if span_days > duration + _TOLERANCE_DAYS:
            proposed = start + timedelta(days=duration - 1)
            return {
                **base,
                "classification": "span_mismatch",
                "proposed_end": proposed.isoformat(),
                "reason": (
                    f"No renewal history, but the membership spans "
                    f"{span_days} days on a {duration}-day plan."
                ),
            }
        # No ledger at all and no earlier finding: the history-less
        # checks above already own this member, so do not reach the
        # payment check (which needs a ledger to check against).
        return None

    # 4) Payment coverage: otherwise clean, but days inside the
    #    stored period are covered by neither a ledger period nor a
    #    verified payment. Review-only, no proposal: Apply returns
    #    needs_review for it, and the owner fixes it by hand after
    #    confirming whether the extra time was paid in cash, free,
    #    or discounted.
    # Payment scan only touches members who have a payment on record.
    # Members with no verified payment at all are left completely
    # alone by this check — no flag, no date change — even if their
    # ledger has a gap. That gap is a ledger matter, not a payment
    # matter, and cash-only members must not be pulled in here.
    if rows and duration > 0 and payments:
        gap_days = _ledger_gap_inside_period(rows, start, end)
        # V5-L18 / V6-L16: only payments whose backing renewal overlaps
        # the stored [start, end] window count toward coverage, and
        # only when that renewal has started (new_start <= today). A
        # verified future scheduled payment must not mask a current
        # gap, and pre-start / old-chain payments must not mask an
        # unpaid current period either. A payment with no backing
        # renewal row (legacy) keeps the old behaviour and counts.
        _renewals_by_payment: dict[int, list] = {}
        for _r in rows:
            if _r.payment_verification_id is not None:
                _renewals_by_payment.setdefault(
                    _r.payment_verification_id, []
                ).append(_r)
        paid_days = 0
        for p in payments:
            if getattr(p, "is_test", False):
                continue
            _backing = _renewals_by_payment.get(p.id)
            if not _backing:
                paid_days += p.renewal_days or 0
                continue
            for _r in _backing:
                if _r.new_start is None or _r.new_end is None:
                    continue
                if today is not None and _r.new_start > today:
                    continue
                if _r.new_start <= end and _r.new_end >= start:
                    paid_days += p.renewal_days or 0
                    break
        paid_periods = paid_days // duration if duration else 0
        # Stored span in whole plan periods, rounded to the nearest:
        # periods count inclusively, so a stored span of 59 days on a
        # 30-day plan is 2 periods, not 3.
        expected_periods = (span_days + duration // 2) // duration
        short_periods = 0
        if payments and paid_periods < expected_periods:
            short_periods = expected_periods - paid_periods
        if gap_days > 0 or short_periods > 0:
            parts = []
            if gap_days > 0:
                parts.append(
                    f"{gap_days} days inside the stored period "
                    f"{start.isoformat()} to {end.isoformat()} have no "
                    "renewal period covering them"
                )
            if short_periods > 0:
                parts.append(
                    f"verified payments cover {paid_periods} "
                    f"{'period' if paid_periods == 1 else 'periods'} "
                    f"({paid_days} days) but the stored period holds "
                    f"{expected_periods} "
                    f"{'period' if expected_periods == 1 else 'periods'}"
                )
            finding = {
                **base,
                "classification": "payment_coverage_gap",
                "confidence": "review",
                "paid_days": paid_days,
                "expected_periods": expected_periods,
                "paid_periods": paid_periods,
                "gap_days": gap_days,
                "reason": (
                    "Days in the membership period are not covered by "
                    "a payment on record: " + " and ".join(parts) + ". "
                    "Check whether the extra time was paid in cash, "
                    "given free, or discounted before fixing by hand."
                ),
            }
            return finding

    return None


def _scan_gym(gym_id: int) -> list[dict]:
    gym = db.session.get(Gym, gym_id)
    gym_tz = gym.timezone if gym and gym.timezone else "Asia/Kolkata"
    today = today_for_gym(gym_tz)
    members = (
        db.session.execute(
            select(Member)
            .where(
                Member.gym_id == gym_id,
                Member.deleted_at.is_(None),
                # M5: paused members ARE scanned — a freeze legitimately
                # extends the end, so their findings carry review
                # confidence via the freeze marker instead of being
                # silently skipped. Deleted members stay excluded.
            )
            .order_by(Member.full_name.asc())
        )
        .scalars()
        .all()
    )
    findings = []
    for member in members:
        rows = (
            db.session.execute(
                select(RenewalHistory)
                .where(RenewalHistory.member_id == member.id)
                .order_by(RenewalHistory.created_at.asc(), RenewalHistory.id.asc())
            )
            .scalars()
            .all()
        )
        payments = (
            db.session.execute(
                select(PaymentVerification)
                .where(
                    PaymentVerification.member_id == member.id,
                    PaymentVerification.status == "verified",
                    PaymentVerification.is_test == False,  # noqa: E712
                )
                .order_by(PaymentVerification.id.asc())
            )
            .scalars()
            .all()
        )
        finding = classify_member(member, rows, today=today, payments=payments)
        if finding is None:
            continue
        paid_count = len(payments)
        paid_total = sum((p.amount for p in payments), 0)
        finding["verified_payments"] = paid_count
        finding["verified_paid_total"] = str(paid_total)
        findings.append(finding)
    return findings


def register_date_repair_routes(bp):
    @bp.route("/date-repair/scan", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def date_repair_scan():
        findings = _scan_gym(g.gym_id)
        return jsonify(
            {
                "success": True,
                "data": {"flagged": findings, "flagged_count": len(findings)},
            }
        )

    @bp.route("/date-repair/apply", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def date_repair_apply():
        data = request.get_json(silent=True) or {}
        member_ids = data.get("member_ids") or []
        if not isinstance(member_ids, list) or not member_ids:
            return error_response(
                "VALIDATION_ERROR", "member_ids must be a non-empty list.", 400
            )
        # A retry after an apply must replay the stored per-member
        # results: re-running would report the already-fixed members
        # as "not_flagged" instead of the applied corrections, and
        # could propose a different end from a changed ledger.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="date_repair_apply",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        findings = {f["member_id"]: f for f in _scan_gym(g.gym_id)}
        gym_tz = (
            g.current_user.gym.timezone
            if g.current_user and g.current_user.gym
            else "Asia/Kolkata"
        )
        today = today_for_gym(gym_tz)
        results = []
        for member_id in member_ids:
            finding = findings.get(member_id)
            if finding is None:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "not_flagged"}
                )
                continue
            proposed_end = (
                _date.fromisoformat(finding["proposed_end"])
                if finding.get("proposed_end")
                else None
            )
            proposed_start = (
                _date.fromisoformat(finding["proposed_start"])
                if finding.get("proposed_start")
                else None
            )
            # V4-H1: Apply must NEVER set membership_start to a future
            # date. The scan only proposes started rows' starts, but
            # a stale scan or a hand-edited ledger must not slip a
            # future start through here either — drop the start and
            # still apply the end when one was proposed.
            if proposed_start is not None and proposed_start > today:
                proposed_start = None
            if proposed_end is None and proposed_start is None:
                # Review-only finding (e.g. a future start or an
                # overlapping ledger): never guessed, fix by hand.
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "needs_review"}
                )
                continue
            member = db.session.execute(
                select(Member)
                .where(Member.id == member_id, Member.gym_id == g.gym_id)
                .with_for_update()
            ).scalar_one_or_none()
            if member is None:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "not_found"}
                )
                continue
            # V3-H5 freeze guard: REFUSE outright. A freeze marker
            # means the end was legitimately extended past the
            # ledger; applying any proposal could strip that
            # extension. The scan only demotes such findings to
            # review-confidence and relies on the client leaving
            # them unselected — the backend must not trust that.
            # The owner fixes frozen members by hand after unfreezing.
            if finding.get("freeze_events", 0) > 0 or member.status == "paused":
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "frozen"}
                )
                continue
            old_end = member.membership_end
            old_start = member.membership_start
            if (proposed_end is None or old_end == proposed_end) and (
                proposed_start is None or old_start == proposed_start
            ):
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "already_correct"}
                )
                continue
            if proposed_start is not None:
                member.membership_start = proposed_start
            if proposed_end is not None:
                member.membership_end = proposed_end
            # V3-H5: an oversized_renewal repair must also correct
            # the ledger, or the next scan proposes the old oversized
            # end back. Shorten each oversized chain row to its plan
            # duration and shift later rows earlier, so chain_last_end
            # equals the applied end and the repair converges.
            ledger_corrected = False
            if finding["classification"] == "oversized_renewal" and proposed_end is not None:
                rows = (
                    db.session.execute(
                        select(RenewalHistory)
                        .where(RenewalHistory.member_id == member.id)
                        .order_by(RenewalHistory.created_at.asc(), RenewalHistory.id.asc())
                    )
                    .scalars()
                    .all()
                )
                # V4-L3: same flag-first creation identity as the
                # scan, so the chain start agrees with what the
                # scan proposed from. V6-L15: the scan fetches
                # payments with is_test == False — Apply must use
                # the same filter, or a test payment's paid_on can
                # flip the heuristic and Apply recomputes a different
                # chain than the scan proposed from.
                _apply_creation_ids = _creation_row_ids_for_ledger(
                    rows,
                    member.membership_start,
                    {
                        p.id: p.paid_on
                        for p in db.session.execute(
                            select(PaymentVerification).where(
                                PaymentVerification.member_id == member.id,
                                PaymentVerification.status == "verified",
                                PaymentVerification.is_test == False,  # noqa: E712
                            )
                        )
                        .scalars()
                        .all()
                    },
                )
                chain_rows = _current_chain_rows(
                    rows,
                    _apply_creation_ids,
                )
                # V4-M12: the stored start is the current period's
                # start — move it when it tracked ANY shifted chain
                # row's old start, not just the latest row's. A
                # stored start equal to an intermediate shifted row's
                # old start would otherwise go stale and the next
                # scan would flag start_ledger_mismatch against the
                # (future, scheduled) latest start. V5-L15: build
                # old_starts from STARTED rows only — a stored start
                # matching a pending row's future start must never
                # be followed into the future.
                old_starts = {
                    r.new_start: r
                    for r in chain_rows
                    if r.new_start is not None
                    and (today is None or r.new_start <= today)
                }
                _correct_oversized_ledger(
                    chain_rows,
                    member.plan.duration_days if member.plan else 30,
                    creation_ids=_apply_creation_ids,
                    today=today,
                )
                ledger_corrected = True
                if member.membership_start in old_starts:
                    _followed = old_starts[member.membership_start]
                    # V5-L15: re-check the followed start against
                    # today before writing — the shift only ever moves
                    # it earlier, but a stale scan must not slip a
                    # future start through here either.
                    if (
                        _followed.new_start != member.membership_start
                        and _followed.new_start <= today
                    ):
                        member.membership_start = _followed.new_start
            final_end = proposed_end if proposed_end is not None else old_end
            if member.status not in ("paused", "deleted") and final_end is not None:
                member.status = "active" if final_end >= today else "expired"
            queue_membership_command(member)
            audit(
                action="date_repair",
                resource_type="member",
                resource_id=member.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": final_end.isoformat() if final_end else None,
                    "old_start": old_start.isoformat() if old_start else None,
                    "new_start": member.membership_start.isoformat()
                    if member.membership_start
                    else None,
                    "classification": finding["classification"],
                    "ledger_corrected": ledger_corrected,
                },
            )
            result_entry = {
                "member_id": member_id,
                "applied": True,
                "old_end": old_end.isoformat() if old_end else None,
                "new_end": final_end.isoformat() if final_end else None,
                "old_start": old_start.isoformat() if old_start else None,
                "new_start": proposed_start.isoformat()
                if proposed_start is not None
                else (old_start.isoformat() if old_start else None),
            }
            if ledger_corrected:
                result_entry["ledger_corrected"] = True
                result_entry["new_start"] = member.membership_start.isoformat()
            results.append(result_entry)
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": {"results": results}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="date_repair_apply",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="date_repair_apply",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/date-repair/confirm", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def date_repair_confirm():
        """Confirm a review-only historyless_pushed_end finding.

        Strict rule for old bad dates: the scan alone can never
        shorten a member whose end was pushed by hand, because that
        push may reflect a cash payment never recorded. This endpoint
        is the only path that writes the expected end, and it requires
        the owner to explicitly confirm (``confirmed_no_extra_payment:
        true``) that the member did not pay for the extra time. The
        confirmation, old end, and new end are all audited. Every
        other review-only classification still needs a hand edit.
        """
        data = request.get_json(silent=True) or {}
        member_ids = data.get("member_ids") or []
        if not isinstance(member_ids, list) or not member_ids:
            return error_response(
                "VALIDATION_ERROR", "member_ids must be a non-empty list.", 400
            )
        if data.get("confirmed_no_extra_payment") is not True:
            return error_response(
                "VALIDATION_ERROR",
                "confirmed_no_extra_payment must be true: confirm the "
                "member did not pay for time past the expected end.",
                400,
            )
        # Same retry hazard as Apply: a re-run would report the
        # already-confirmed members as "already_correct" / "not_flagged"
        # instead of the applied corrections.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="date_repair_confirm",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        findings = {f["member_id"]: f for f in _scan_gym(g.gym_id)}
        gym_tz = (
            g.current_user.gym.timezone
            if g.current_user and g.current_user.gym
            else "Asia/Kolkata"
        )
        today = today_for_gym(gym_tz)
        results = []
        for member_id in member_ids:
            finding = findings.get(member_id)
            if finding is None:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "not_flagged"}
                )
                continue
            if finding.get("classification") != "historyless_pushed_end" or not finding.get("expected_end"):
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "needs_review"}
                )
                continue
            member = db.session.execute(
                select(Member)
                .where(Member.id == member_id, Member.gym_id == g.gym_id)
                .with_for_update()
            ).scalar_one_or_none()
            if member is None:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "not_found"}
                )
                continue
            # V3-H5 freeze guard, same as Apply: confirming a pushed
            # end on a frozen member would strip the freeze extension.
            if finding.get("freeze_events", 0) > 0 or member.status == "paused":
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "frozen"}
                )
                continue
            old_end = member.membership_end
            new_end = _date.fromisoformat(finding["expected_end"])
            if old_end == new_end:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "already_correct"}
                )
                continue
            member.membership_end = new_end
            if member.status not in ("paused", "deleted"):
                member.status = "active" if new_end >= today else "expired"
            queue_membership_command(member)
            audit(
                action="date_repair_review_confirm",
                resource_type="member",
                resource_id=member.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": new_end.isoformat(),
                    "classification": finding["classification"],
                    "confirmed_no_extra_payment": True,
                },
            )
            results.append(
                {
                    "member_id": member_id,
                    "applied": True,
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": new_end.isoformat(),
                }
            )
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": {"results": results}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="date_repair_confirm",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="date_repair_confirm",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)
