"""Owner-only membership date repair endpoints.

Scan compares every member's stored membership_end against the end
implied by their plan and their renewal ledger (RenewalHistory):

- ``ledger_mismatch``: the ledger's latest ``new_end`` differs from the
  stored end, i.e. the end was changed outside the payment/renewal flow
  (manual edit, freeze, import). Proposal: the ledger's latest new_end.
- ``span_mismatch``: no usable ledger, and the stored span is longer
  than one plan period. Proposal: start + plan duration (the creation
  convention used when a member is added).
- ``oversized_renewal``: the ledger agrees with the stored end, but at
  least one renewal applied more days than that plan's duration — the
  excess is baked into the ledger itself (e.g. a mistyped renewal-days
  value). Proposal: the stored end minus the total excess days.

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
from sqlalchemy import func, select

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, PaymentVerification, RenewalHistory
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


def classify_member(member: Member, rows: list[RenewalHistory]) -> dict | None:
    """Return a scan finding for *member*, or None when dates look right."""
    if member.plan is None or member.membership_start is None or member.membership_end is None:
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
        return None

    # 3) No usable ledger: the span itself must fit one plan period.
    if not rows and span_days > duration + _TOLERANCE_DAYS:
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

    return None


def _scan_gym(gym_id: int) -> list[dict]:
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
        finding = classify_member(member, rows)
        if finding is None:
            continue
        paid_count, paid_total = db.session.execute(
            select(func.count(PaymentVerification.id), func.coalesce(func.sum(PaymentVerification.amount), 0))
            .where(
                PaymentVerification.member_id == member.id,
                PaymentVerification.status == "verified",
            )
        ).one()
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
            if finding is None or not finding.get("proposed_end"):
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "not_flagged"}
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
            proposed = _date.fromisoformat(finding["proposed_end"])
            old_end = member.membership_end
            if old_end == proposed:
                results.append(
                    {"member_id": member_id, "applied": False, "reason": "already_correct"}
                )
                continue
            member.membership_end = proposed
            if member.status not in ("paused", "deleted"):
                member.status = "active" if proposed >= today else "expired"
            queue_membership_command(member)
            audit(
                action="date_repair",
                resource_type="member",
                resource_id=member.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": proposed.isoformat(),
                    "classification": finding["classification"],
                },
            )
            results.append(
                {
                    "member_id": member_id,
                    "applied": True,
                    "old_end": old_end.isoformat() if old_end else None,
                    "new_end": proposed.isoformat(),
                }
            )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"results": results}})
