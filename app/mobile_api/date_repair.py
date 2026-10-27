"""Owner-only membership date repair endpoints.

Scan compares every member's stored membership_end against the end
implied by their plan and their renewal ledger (RenewalHistory):

- ``ledger_mismatch``: the ledger's latest ``new_end`` differs from the
  stored end, i.e. the end was changed outside the payment/renewal flow
  (manual edit, freeze, import). Proposal: the ledger's latest new_end.
- ``span_mismatch``: no usable ledger, and the member is still in
  their first period, but the stored span is longer than one plan
  period. Proposal: start + plan duration (the creation convention
  used when a member is added).
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
  least one renewal applied more days than that plan's duration — the
  excess is baked into the ledger itself (e.g. a mistyped renewal-days
  value). Proposal: the stored end minus the total excess days.
- ``start_missing``: no start date stored (defensive — the schema marks
  the column NOT NULL, so this only fires for legacy/imported rows).
  Proposal: the creation row's recorded start, when one exists.
- ``start_after_end``: the stored start is after the stored end.
  Proposal: the ledger's recorded pair (chain start + latest end) when
  the ledger determines both and no restart breaks the chain; otherwise
  review-only.
- ``start_in_future``: the start is after gym-local today. Review-only:
  a future start can be a legitimate pre-registration, so the scan
  never auto-corrects it.
- ``start_ledger_mismatch``: the stored start disagrees with the start
  the renewal ledger records for the current chain (its creation row,
  or its last restart row). Proposal: that recorded start.
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
and deleted members are excluded entirely.

Apply recomputes the proposal server-side for each requested member
and only writes when the member is still flagged with that proposal,
so a stale scan can never overwrite a member who was fixed meanwhile.
"""
from __future__ import annotations

from datetime import date as _date
from datetime import timedelta

from flask import g, jsonify, request
from sqlalchemy import select

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, PaymentVerification, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.timezone_service import today_for_gym

_TOLERANCE_DAYS = 1


def _applied_days(row: RenewalHistory) -> int | None:
    """Days a ledger row actually added: (new_end - new_start) + 1."""
    if row.new_start is None or row.new_end is None:
        return None
    return (row.new_end - row.new_start).days + 1


def _is_creation_row(row: RenewalHistory) -> bool:
    """The creation row stores previous_end == new_start == start."""
    return (
        row.previous_end is not None
        and row.new_start is not None
        and row.previous_end == row.new_start
    )


def _is_restart_row(row: RenewalHistory) -> bool:
    """A renewal after expiry restarts from 'today', breaking the chain."""
    if row.previous_end is None or row.new_start is None:
        return False
    return row.new_start > row.previous_end + timedelta(days=1)


def _creation_row(rows: list[RenewalHistory]) -> RenewalHistory | None:
    """First creation row, if the ledger records the original start."""
    for row in rows:
        if _is_creation_row(row):
            return row
    return None


def _chain_start_row(rows: list[RenewalHistory]) -> RenewalHistory | None:
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
    if _is_creation_row(start_row) or _is_restart_row(start_row):
        return start_row
    return None


def _expected_current_end(
    start: _date, duration: int, today: _date
) -> _date:
    """End of the period containing *today*, stepping from *start*.

    Periods follow the renewal chain's own chaining: period ``k`` spans
    ``[start + k * (duration + 1), start + k * (duration + 1) + duration]``
    — each period starts the day after the previous period ends, the
    same rule the renewal flows use (see ``_overlapping_pair``). The
    chain convention is used deliberately: it is the latest end any
    correctly kept member could have, so a member kept by either
    convention is never flagged for excess.
    """
    period_span = duration + 1
    k = (today - start).days // period_span
    return start + timedelta(days=k * period_span + duration)


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
    # 0) A missing start cannot be evaluated further. The schema marks
    #    membership_start NOT NULL, so this is defensive: it can only
    #    fire for legacy/imported rows. The creation row, when present,
    #    records the original start.
    if member.membership_start is None:
        creation = _creation_row(rows)
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

    renewals = [r for r in rows if not _is_creation_row(r)]
    has_restart = any(_is_restart_row(r) for r in renewals)
    last_end = rows[-1].new_end if rows else None
    chain_start = _chain_start_row(rows)

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
            rows
            and last_end is not None
            and not has_restart
            and chain_start is not None
            and chain_start.new_start is not None
        ):
            finding["proposed_start"] = chain_start.new_start.isoformat()
            finding["proposed_end"] = last_end.isoformat()
            finding["reason"] += (
                " The renewal history records this period as "
                f"{chain_start.new_start.isoformat()} to "
                f"{last_end.isoformat()}."
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

    # S3) The stored start disagrees with the start the ledger records
    #     for the current chain (its creation row, or its last restart
    #     row). The recorded start is a single-row fact, so it is
    #     proposed even when the chain contains a restart.
    if (
        chain_start is not None
        and chain_start.new_start is not None
        and chain_start.new_start != start
    ):
        return {
            **base,
            "classification": "start_ledger_mismatch",
            "proposed_start": chain_start.new_start.isoformat(),
            "reason": (
                f"The renewal history records this period as starting "
                f"{chain_start.new_start.isoformat()}, but the "
                f"member's start date is {start.isoformat()}."
            ),
        }

    # S4) Two consecutive ledger periods overlap: days counted twice.
    #     Review-only — which row is wrong is ambiguous.
    pair = _overlapping_pair(rows)
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

    # 1) The stored end disagrees with the payment ledger.
    if rows and last_end is not None and last_end != end and not has_restart:
        return {
            **base,
            "classification": "ledger_mismatch",
            "proposed_end": last_end.isoformat(),
            "reason": (
                f"Renewal history ends at {last_end.isoformat()} but the "
                f"member's end date is {end.isoformat()} — it was changed "
                "outside a payment/renewal."
            ),
        }

    # 2) The ledger agrees, but a renewal applied more days than the
    #    plan allows — the excess is inside the ledger.
    if rows and last_end == end and not has_restart:
        excess = 0
        for row in renewals:
            applied = _applied_days(row)
            if applied is None:
                continue
            row_duration = (
                row.plan.duration_days if row.plan is not None else duration
            )
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
            and start + timedelta(days=duration) < today
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
            proposed = start + timedelta(days=duration)
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
        paid_days = sum(
            (p.renewal_days or 0) for p in payments if not getattr(p, "is_test", False)
        )
        paid_periods = paid_days // duration if duration else 0
        # Stored span in whole plan periods, rounded to the nearest:
        # the chain convention adds ~1 day per period, so a stored
        # span of 61 days on a 30-day plan is 2 periods, not 3.
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
                Member.status != "paused",
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
                    "new_start": proposed_start.isoformat()
                    if proposed_start is not None
                    else (old_start.isoformat() if old_start else None),
                    "classification": finding["classification"],
                },
            )
            results.append(
                {
                    "member_id": member_id,
                    "applied": True,
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": final_end.isoformat() if final_end else None,
                    "old_start": old_start.isoformat() if old_start else None,
                    "new_start": proposed_start.isoformat()
                    if proposed_start is not None
                    else (old_start.isoformat() if old_start else None),
                }
            )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"results": results}})

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
        db.session.commit()
        return jsonify({"success": True, "data": {"results": results}})
