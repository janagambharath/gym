from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import and_, func, or_, select

from app.extensions import db
from app.models import AuditLog, Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.models.mixins import utcnow
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.timezone_service import today_for_gym


# M9 / B-L1: the known payment method / channel sets. Owner-supplied
# values are validated against these on creation; anything else is a
# typo ("cashh", "UPI ") that would silently fall into "other" in the
# payments summary. "bank" is the legacy web form's spelling of a bank
# transfer. Member-side server values ("member_claim",
# "member_request") are set server-side, never user input, and are not
# part of this set.
PAYMENT_METHODS = {"upi", "cash", "card", "bank_transfer", "bank", "other"}
PAYMENT_CHANNELS = {"online", "offline"}


def _is_stale_scheduled_row(row: RenewalHistory, member: Member) -> bool:
    """A scheduled row that can never activate.

    ``apply_due_scheduled_renewals`` only activates a row whose
    ``previous_end`` still matches the member's current end. Once any
    other renewal, bulk renew, or hand edit moves the member's end,
    the row is permanently dead: it must not block future scheduling
    (V3-M16 stuck state) and must not count as "a future renewal".
    """
    return row.previous_end != member.membership_end


def active_scheduled_renewals(
    member: Member,
    today,
    *,
    exclude_payment_verification_id: int | None = None,
) -> list[RenewalHistory]:
    """Live (non-stale) scheduled future renewals for *member*.

    Mirrors the direct path: every RenewalHistory row with
    ``new_start > today``, regardless of whether it is linked to a
    payment (V3-M16 — the old verify check inner-joined
    PaymentVerification, so a direct scheduled renewal was invisible
    to it). Only the payment being verified is excluded. Stale rows
    (previous_end no longer matches the member's current end) are
    ignored: they can never activate, so they must not block a new
    scheduling. They are left in place as inert history — deleting
    them would erase the record of a paid future renewal that a
    later immediate renewal superseded.

    V7-M5: a row is also live on its due date and after a missed
    scheduler window, while it is still activatable
    (``new_start <= today`` and ``new_end >= today`` with
    ``previous_end`` still matching the member's current end). The
    old ``new_start > today`` definition made a due row invisible
    to every guard, so a freeze/renew/refund/edit on the due date
    orphaned the paid row. Liveness is therefore "not stale and
    not expired" (``new_end >= today``), not "starts in future".
    """
    rows = (
        RenewalHistory.query.filter(
            RenewalHistory.member_id == member.id,
            RenewalHistory.new_end >= today,
        )
        .order_by(RenewalHistory.new_start.asc(), RenewalHistory.id.asc())
        .all()
    )
    live = []
    for row in rows:
        if (
            exclude_payment_verification_id is not None
            and row.payment_verification_id == exclude_payment_verification_id
        ):
            continue
        if _is_stale_scheduled_row(row, member):
            continue
        live.append(row)
    return live


def canonical_payment_reference(reference: str | None) -> str | None:
    """Canonical UTR form (V4-M19): strip, upper-case, drop ALL internal
    whitespace (``" utr 123 "`` -> ``"UTR123"``).

    Every write path stores the canonical form, so the existing raw
    partial unique index ``uq_payments_gym_reference_verified`` is
    already a canonical backstop for new rows. The lookup below
    additionally compares canonically in SQL so legacy rows stored
    pre-fix (mixed case / spaced) are still caught.
    """
    if reference is None:
        return None
    canonical = "".join(str(reference).split()).upper()
    return canonical or None


def _reference_norm_expr():
    """SQL expression for the canonical form of the stored reference.

    V5-L4: strips ALL whitespace, matching
    ``canonical_payment_reference`` (which uses ``str.split()``).
    The whitespace characters are bound as parameters, so the same
    expression runs on Postgres and SQLite: space, tab, newline,
    carriage return, vertical tab and form feed — the full ASCII set
    Python's ``split()`` removes. (The v4m19 expression index still
    strips spaces only; it is a backstop, and this lookup is what
    decides duplicates, so legacy rows carrying a tab/newline are now
    caught here.)
    """
    from sqlalchemy import func as _func

    expr = _func.trim(PaymentVerification.reference)
    for _ws in (" ", "\t", "\n", "\r", "\x0b", "\x0c"):
        expr = _func.replace(expr, _ws, "")
    return _func.upper(expr)


def is_duplicate_reference_error(exc: Exception) -> bool:
    """True when an IntegrityError is the verified-UTR unique index.

    V5-L3: callers must not map *any* IntegrityError to
    DUPLICATE_REFERENCE. Postgres names the index in the message
    (``uq_payments_gym_reference_verified[_norm]``); SQLite names no
    index, so match its column list instead — that (gym, reference)
    pair is unique to this index.
    """
    text_ = str(getattr(exc, "orig", exc) or "")
    if "uq_payments_gym_reference_verified" in text_:
        return True
    return (
        "payment_verifications.gym_id" in text_
        and "payment_verifications.reference" in text_
    )


def verified_payment_with_reference(gym_id: int, reference: str):
    """Return the verified payment in this gym carrying *reference* (M9).

    A UTR pasted twice must not double-count collections: the creation
    paths reject a second verified payment with the same reference.
    Returns None when the reference is empty or unused.

    V4-M19: the comparison is canonical — ``"UTR123"``, ``"utr123"``
    and ``"UTR 123"`` are the same reference at every layer.
    """
    canonical = canonical_payment_reference(reference)
    if not canonical:
        return None
    return (
        PaymentVerification.query.filter(
            PaymentVerification.gym_id == gym_id,
            PaymentVerification.status == "verified",
            _reference_norm_expr() == canonical,
        )
        .order_by(PaymentVerification.id.asc())
        .first()
    )


def _lock_payment(payment: PaymentVerification) -> PaymentVerification:
    """Re-fetch the payment row with FOR UPDATE and return the locked copy.

    Every state-changing payment operation must go through this so two
    staff members acting on the same payment cannot interleave (e.g. reject
    landing after verify committed).
    """
    return (
        db.session.execute(
            select(PaymentVerification)
            .where(PaymentVerification.id == payment.id)
            .with_for_update()
        )
        .scalar_one()
    )


def verify_payment(payment: PaymentVerification, *, verified_by_id: int, renewal_days: int) -> RenewalHistory:
    locked_payment = (
        db.session.execute(
            select(PaymentVerification)
            .where(PaymentVerification.id == payment.id)
            .with_for_update()
        )
        .scalar_one()
    )
    if locked_payment.status == "verified":
        if locked_payment.renewal:
            return locked_payment.renewal
        raise ValueError(f"Payment {locked_payment.id} is already verified.")
    if locked_payment.status not in ("pending", "processing"):
        raise ValueError(f"Payment {locked_payment.id} is {locked_payment.status}.")

    # V3-M3: verify-time re-check under the FOR UPDATE lock. The create
    # paths only reject a duplicate when a VERIFIED payment already
    # carries the reference, so two pending payments sharing one UTR
    # could otherwise both verify and double-count collections. The
    # partial unique index (uq_payments_gym_reference_verified) is the
    # backstop for a race between two concurrent verifies.
    # V4-M19: canonicalised — a pending "utr123" clashes with a
    # verified "UTR123" (or "UTR 123").
    _reference = canonical_payment_reference(locked_payment.reference)
    if _reference:
        _clash = verified_payment_with_reference(locked_payment.gym_id, _reference)
        if _clash is not None and _clash.id != locked_payment.id:
            raise ValueError(
                f"DUPLICATE_REFERENCE: payment {_clash.id} is already verified "
                f"with reference {_reference}."
            )

    member = (
        db.session.execute(
            select(Member).where(Member.id == locked_payment.member_id).with_for_update()
        )
        .scalar_one()
    )
    if member.gym_id != locked_payment.gym_id:
        raise RuntimeError(
            f"TENANT VIOLATION: payment {locked_payment.id} gym {locked_payment.gym_id} "
            f"vs member gym {member.gym_id}"
        )

    previous_start = member.membership_start
    previous_end = member.membership_end
    # V3-M18: snapshot plan/price before mutation so a refund/delete
    # can restore them.
    previous_plan_id = member.plan_id
    previous_price = member.price
    gym_timezone = (
        member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
    )
    today = today_for_gym(gym_timezone)
    earliest_start = previous_end + timedelta(days=1) if previous_end and previous_end >= today else today
    new_start = locked_payment.renewal_start_date or earliest_start
    # V7-M4: the start is floored at previous_end + 1 whenever a
    # previous period exists — for an EXPIRED member too. The old
    # guard only fired while previous_end >= today, so an expired
    # member could backdate a renewal inside (or before) the
    # previous period, double-paying days and leaving a permanent
    # period_overlap flag. A backdate to previous_end + 1 is still
    # allowed (the paid gap is preserved); it just cannot overlap.
    # The default (no explicit start) never violates the floor:
    # active members default to previous_end + 1, expired members
    # default to today, which is past previous_end.
    if previous_end and new_start < previous_end + timedelta(days=1):
        raise ValueError(
            f"Renewal start date must be {(previous_end + timedelta(days=1)).isoformat()} or later so it does not overlap the previous paid period."
        )
    new_end = new_start + timedelta(days=renewal_days - 1)
    if new_start <= today and new_end < today:
        raise ValueError("This renewal would already be expired. Choose a later start date.")

    # V5-L17: re-validate the plan-days rule at verify time. Create
    # paths enforce it, but a legacy / pre-strict payment (or one
    # created via a path that skipped the check) used to verify with
    # arbitrary days and write an oversized ledger row. An override
    # the owner already granted at creation (stored on the payment)
    # still honours the exception; a fresh override cannot be granted
    # here — the payment must be created with one.
    _target_plan_id = locked_payment.plan_id or member.plan_id
    _target_plan = (
        db.session.get(MembershipPlan, _target_plan_id)
        if _target_plan_id is not None
        else None
    )
    _stored_override = (
        (getattr(locked_payment, "override_reason", None) or "").strip() or None
    )
    _verifier_is_owner = False
    if verified_by_id is not None:
        from app.models import User

        _verifier = db.session.get(User, verified_by_id)
        _verifier_is_owner = bool(_verifier and _verifier.role == "gym_owner")
    from app.mobile_api.date_rules import plan_days_error

    _plan_err = plan_days_error(
        renewal_days,
        _target_plan.duration_days if _target_plan is not None else None,
        override_reason=_stored_override,
        is_owner=_verifier_is_owner or _stored_override is not None,
    )
    if _plan_err is not None:
        raise ValueError(_plan_err)

    # A verified future renewal is stored now but only becomes the member's
    # current access period on its start date. This lets an existing paid
    # period run to expiry and prevents a selected gap from keeping the door
    # open. Only one verified future renewal may be waiting for a member.
    # V3-M16: mirror the direct path — a direct scheduled renewal
    # (payment_verification_id IS NULL) counts too, and stale rows
    # that can never activate do not block.
    # V6-M3: the live-scheduled check is NOT gated on this renewal
    # being scheduled. When the current period already expired and a
    # live scheduled renewal waits in the future, an immediate renewal
    # used to take the else branch, rewrite membership_end, and orphan
    # the paid future period (its previous_end no longer matched).
    # Bulk renew checks unconditionally — verify must too.
    scheduled = new_start > today
    if active_scheduled_renewals(
        member, today, exclude_payment_verification_id=locked_payment.id
    ):
        raise ValueError("This member already has a verified future renewal scheduled.")

    locked_payment.renewal_start_date = new_start

    locked_payment.status = "verified"
    locked_payment.verified_by_id = verified_by_id
    locked_payment.verified_at = utcnow()

    target_plan_id = locked_payment.plan_id or member.plan_id
    if not scheduled:
        member.membership_start = new_start
        member.membership_end = new_end
        # M3: a paused member stays paused through a verified payment —
        # only the explicit unfreeze flow clears paused. The dates still
        # extend; the door stays blocked while paused.
        if member.status != "paused":
            member.status = "active"
        member.price = locked_payment.amount
        if locked_payment.plan_id:
            member.plan_id = locked_payment.plan_id
        queue_membership_command(member)

    # V4-M13: snapshot the plan duration in force NOW, before the
    # renewal row is written — the oversized check must compare
    # against this, not the plan's live duration after a later edit.
    # No plan: the applied span itself (never flags as oversized).
    _snapshot_plan = (
        db.session.get(MembershipPlan, target_plan_id)
        if target_plan_id is not None
        else None
    )
    _snapshot_duration = (
        _snapshot_plan.duration_days if _snapshot_plan is not None else renewal_days
    )

    renewal = RenewalHistory(
        gym_id=locked_payment.gym_id,
        member_id=member.id,
        plan_id=target_plan_id,
        payment_verification_id=locked_payment.id,
        renewed_by_id=verified_by_id,
        previous_start=previous_start,
        previous_end=previous_end,
        previous_plan_id=previous_plan_id,
        previous_price=previous_price,
        duration_days=_snapshot_duration,
        new_start=new_start,
        new_end=new_end,
        standard_price=locked_payment.standard_price,
        discount=locked_payment.discount or Decimal("0.00"),
        amount=locked_payment.amount,
        channel=locked_payment.channel or "offline",
        notes=locked_payment.notes,
        # V5-L16: carry the owner-approved override onto the ledger
        # row so Date Repair skips it instead of stripping it.
        override_reason=_stored_override,
        # V7-L15: propagate is_test from the payment into the
        # renewal row inside verify_payment — the single funnel —
        # so no future caller can verify a test payment and leak
        # its amount into payment_backed_amount. The admin route's
        # post-hoc patch stays as a harmless redundant set.
        is_test=bool(getattr(locked_payment, "is_test", False)),
    )
    db.session.add(renewal)
    db.session.flush()

    # Campaign attribution — check if this renewal was prompted by a campaign
    try:
        from app.services.campaign_service import attribute_renewal_to_campaign
        campaign_id = attribute_renewal_to_campaign(
            member_id=member.id,
            gym_id=locked_payment.gym_id,
            renewal_id=renewal.id,
            renewal_amount=locked_payment.amount,
        )
        if campaign_id:
            renewal.campaign_id = campaign_id
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Campaign attribution failed for renewal %s", renewal.id
        )

    invalidate_dashboard_cache(locked_payment.gym_id)
    return renewal


_logger = logging.getLogger(__name__)


def _activate_scheduled_row(gym, renewal: RenewalHistory, member: Member, today, *, force: bool = False) -> str:
    """Activate one due scheduled row against its (locked) member.

    Returns ``"activated"``, ``"already_applied"`` or ``"stale"``.
    Raises ValueError when the row is past its window and this is not
    a force activation — the caller decides how to surface that.

    ``force`` (V6-L20, owner-triggered) activates even a row whose
    ``new_end`` already passed; the member lands ``expired`` with the
    paid period on record instead of the row silently dying.
    """
    if member.membership_start == renewal.new_start and member.membership_end == renewal.new_end:
        # V6-L22: dates already match — the period IS live, but the
        # row was never consumed as an activation: no price/plan was
        # pinned, no status re-derived, no audit written. Pin them
        # now — but only when something actually differs. A row whose
        # price/plan/status already agree is a no-op: auditing and
        # counting it on EVERY scheduler run would spam the audit log
        # and break apply_due's idempotency (a second call must return
        # 0 once the row is fully consumed).
        _changed = False
        if member.price != renewal.amount:
            member.price = renewal.amount
            _changed = True
        if renewal.plan_id and member.plan_id != renewal.plan_id:
            member.plan_id = renewal.plan_id
            _changed = True
        if member.status != "paused":
            _status = "active" if renewal.new_end >= today else "expired"
            if member.status != _status:
                member.status = _status
                _changed = True
        if not _changed:
            return "already_applied_noop"
        audit(
            action="scheduled_renewal_activated",
            resource_type="renewal_history",
            resource_id=renewal.id,
            gym_id=gym.id,
            actor_id=None,
            metadata={
                "member_id": member.id,
                "start_date": renewal.new_start.isoformat(),
                "already_applied": True,
                "force": force,
            },
        )
        return "already_applied"
    if member.membership_end != renewal.previous_end:
        return "stale"
    if renewal.new_end < today and not force:
        raise ValueError(
            f"Scheduled renewal {renewal.id} for member {member.id} "
            f"ended {renewal.new_end.isoformat()} before today "
            f"({today.isoformat()}); it never activated."
        )
    member.membership_start = renewal.new_start
    member.membership_end = renewal.new_end
    # M3: a paused member stays paused when a scheduled renewal
    # activates — only the explicit unfreeze flow clears paused.
    if member.status != "paused":
        member.status = "active" if renewal.new_end >= today else "expired"
    member.price = renewal.amount
    if renewal.plan_id:
        member.plan_id = renewal.plan_id
    queue_membership_command(member)
    audit(
        action="scheduled_renewal_activated",
        resource_type="renewal_history",
        resource_id=renewal.id,
        gym_id=gym.id,
        actor_id=None,
        metadata={
            "member_id": member.id,
            "start_date": renewal.new_start.isoformat(),
            "force": force,
        },
    )
    return "activated"


def force_activate_scheduled_renewal(renewal: RenewalHistory, *, actor_id: int | None = None) -> str:
    """Owner-triggered manual activation of one due scheduled renewal
    (V6-L20) — the lever V5-M10's expired-row surfacing pairs with.
    The caller commits. Raises ValueError when the row is not due
    yet, or its chain is stale (the member's end no longer matches
    the row's previous_end, so the period it was chained to is gone).
    Returns ``"activated"`` or ``"already_applied"``.
    """
    gym_id = renewal.gym_id
    member = (
        db.session.execute(
            select(Member).where(Member.id == renewal.member_id).with_for_update()
        ).scalar_one_or_none()
    )
    if member is None or member.gym_id != gym_id or member.deleted_at is not None:
        raise ValueError("Member not found for this scheduled renewal.")
    gym_tz = member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
    today = today_for_gym(gym_tz)
    if renewal.new_start > today:
        raise ValueError(
            f"Scheduled renewal starts {renewal.new_start.isoformat()} "
            "and is not due yet."
        )
    # The shared helper audits with actor_id=None (system); rewrite
    # the audit's actor to the forcing owner when one is given.
    outcome = _activate_scheduled_row(
        member.gym, renewal, member, today, force=True
    )
    if outcome == "stale":
        raise ValueError(
            "This scheduled renewal can no longer activate: the "
            "member's current end no longer matches the renewal's "
            "previous end (the period was changed after scheduling)."
        )
    # A fully-consumed row reports as already applied to the caller.
    if outcome == "already_applied_noop":
        outcome = "already_applied"
    if actor_id is not None:
        audit(
            action="scheduled_renewal_force_activated",
            resource_type="renewal_history",
            resource_id=renewal.id,
            gym_id=gym_id,
            actor_id=actor_id,
            metadata={
                "member_id": member.id,
                "start_date": renewal.new_start.isoformat(),
                "outcome": outcome,
            },
        )
    return outcome


def rechain_scheduled_renewals(member: Member, *, old_end, today, actor_id: int | None = None) -> list[RenewalHistory]:
    """Re-point scheduled rows chained to ``old_end`` at the member's
    (just-edited) current end (V5-M9). Call AFTER the member's
    membership_end has been updated: a manual date edit moves the end
    a scheduled row was chained to, and without this the row can never
    activate. The row's own new_start/new_end (the paid future
    period) are preserved. Rows chained to any other end are left
    alone — they were already stale before this edit. Returns the
    re-chained rows.
    """
    if old_end is None:
        return []
    chained = (
        RenewalHistory.query.filter(
            RenewalHistory.member_id == member.id,
            # V7-M5: new_end >= today, not new_start >= today — a
            # row starting today (due, not yet activated) or after
            # a missed scheduler window still needs re-chaining.
            # Rows whose window already ended (new_end < today)
            # can never activate and are left alone.
            RenewalHistory.new_end >= today,
            RenewalHistory.previous_end == old_end,
        )
        .order_by(RenewalHistory.new_start.asc(), RenewalHistory.id.asc())
        .all()
    )
    for row in chained:
        if (
            member.membership_start == row.new_start
            and member.membership_end == row.new_end
        ):
            continue
        row.previous_end = member.membership_end
        audit(
            action="scheduled_renewal_rechained",
            resource_type="renewal_history",
            resource_id=row.id,
            gym_id=member.gym_id,
            actor_id=actor_id,
            metadata={
                "member_id": member.id,
                "old_previous_end": old_end.isoformat() if old_end else None,
                "new_previous_end": member.membership_end.isoformat() if member.membership_end else None,
                "reason": "manual_date_edit",
            },
        )
    return chained


def apply_due_scheduled_renewals(gym) -> int:
    """Activate verified future renewals whose gym-local start date arrived.

    Date and command changes are made in one transaction by the caller. A
    stale scheduled row never overwrites a later manual edit or renewal: the
    member's current end must still match the snapshot saved when the
    renewal was verified.
    """
    today = today_for_gym(gym.timezone or "Asia/Kolkata")
    rows = (
        RenewalHistory.query.outerjoin(
            PaymentVerification,
            RenewalHistory.payment_verification_id == PaymentVerification.id,
        )
        .filter(
            RenewalHistory.gym_id == gym.id,
            RenewalHistory.new_start <= today,
            or_(
                RenewalHistory.payment_verification_id.is_(None),
                PaymentVerification.status == "verified",
            ),
        )
        .order_by(RenewalHistory.new_start.asc(), RenewalHistory.id.asc())
        .all()
    )
    activated = 0
    for renewal in rows:
        # V6-L19: per-row containment — one member's error (a failing
        # terminal command, a bad row) must not roll back the gym's
        # whole activation batch. Each row runs in its own savepoint;
        # failures are logged + audited and the rest still activate.
        try:
            with db.session.begin_nested():
                member = db.session.execute(
                    select(Member).where(Member.id == renewal.member_id).with_for_update()
                ).scalar_one_or_none()
                if member is None or member.gym_id != gym.id or member.deleted_at is not None:
                    continue
                try:
                    outcome = _activate_scheduled_row(gym, renewal, member, today)
                except ValueError as exc:
                    # V5-M10: a paid row whose window already passed
                    # (scheduler missed it — gym suspended, outage,
                    # deploy gap) is no longer silently dropped. It is
                    # audited + logged so the owner can refund,
                    # re-schedule, or force-activate it (V6-L20).
                    _logger.warning(
                        "Scheduled renewal %s for member %s skipped: %s",
                        renewal.id,
                        member.id,
                        exc,
                    )
                    # V8-L9: a dead row re-audited on EVERY scheduler
                    # run — the audit log filled with one identical
                    # row per run per dead renewal. Audit once: a
                    # prior audit for this row means the owner was
                    # already told, and the row is unchanged since.
                    _already_audited = (
                        AuditLog.query.filter_by(
                            action="scheduled_renewal_expired_unactivated",
                            resource_id=str(renewal.id),
                        ).first()
                        is not None
                    )
                    if not _already_audited:
                        audit(
                            action="scheduled_renewal_expired_unactivated",
                            resource_type="renewal_history",
                            resource_id=renewal.id,
                            gym_id=gym.id,
                            actor_id=None,
                            metadata={
                                "member_id": member.id,
                                "new_start": renewal.new_start.isoformat(),
                                "new_end": renewal.new_end.isoformat(),
                                "reason": str(exc),
                            },
                        )
                    continue
                if outcome in ("activated", "already_applied"):
                    activated += 1
                elif outcome == "stale":
                    # V7-M5: a stale row is inert history by design
                    # (V3-M16) — it can never activate — but it must
                    # not die silently. Audit it so a paid row
                    # orphaned by a missed scheduler window + a
                    # later refund/edit is visible to the owner.
                    _logger.warning(
                        "Scheduled renewal %s for member %s is stale "
                        "(previous_end %s != current end %s); it can "
                        "never activate.",
                        renewal.id,
                        member.id,
                        renewal.previous_end,
                        member.membership_end,
                    )
                    audit(
                        action="scheduled_renewal_stale_unactivated",
                        resource_type="renewal_history",
                        resource_id=renewal.id,
                        gym_id=gym.id,
                        actor_id=None,
                        metadata={
                            "member_id": member.id,
                            "new_start": renewal.new_start.isoformat() if renewal.new_start else None,
                            "new_end": renewal.new_end.isoformat() if renewal.new_end else None,
                            "previous_end": renewal.previous_end.isoformat() if renewal.previous_end else None,
                            "current_end": member.membership_end.isoformat() if member.membership_end else None,
                        },
                    )
        except Exception:
            _logger.exception(
                "Scheduled renewal activation failed for renewal %s (member %s, gym %s)",
                renewal.id,
                renewal.member_id,
                gym.id,
            )
            audit(
                action="scheduled_renewal_activation_failed",
                resource_type="renewal_history",
                resource_id=renewal.id,
                gym_id=gym.id,
                actor_id=None,
                metadata={"member_id": renewal.member_id},
            )
            continue
    if activated:
        invalidate_dashboard_cache(gym.id)
    return activated


def reject_payment(payment: PaymentVerification, *, verified_by_id: int) -> None:
    payment = _lock_payment(payment)
    if payment.status == "verified":
        raise ValueError("Cannot reject an already verified payment.")
    if payment.status == "rejected":
        raise ValueError("Payment is already rejected.")
    if payment.status == "cancelled":
        raise ValueError("Payment is already cancelled.")
    payment.status = "rejected"
    # V4-L35: the verification audit trail is immutable — a rejected
    # payment was never verified, so verified_at/verified_by_id must
    # stay untouched (NULL here). The rejection records its own time
    # and actor, same pattern as the V3-L2 refund fix.
    payment.rejected_at = utcnow()
    payment.rejected_by_id = verified_by_id
    invalidate_dashboard_cache(payment.gym_id)


def _revert_renewal(member: Member, renewal: RenewalHistory) -> None:
    """Roll a member's membership back to the pre-renewal state.

    V3-M18: restores plan/price from the snapshot on the renewal row
    (when present), and refunding a signup no longer leaves a 1-day
    active stub: a creation row (previous_end == new_start, the
    pre-signup state) reverts to status "expired" instead of "active".

    V7-M6: the old guard reverted ONLY when the member's current end
    still equalled the refunded row's new_end. That is correct for a
    genuine later renewal (the current end belongs to the later
    period and must not be clobbered) — but a freeze extends the end
    and a manual edit moves it, so renew → freeze → refund silently
    kept the paid period. Distinguish the cases: revert whenever no
    later RenewalHistory row covers the current end, EXCEPT a
    scheduled (not-yet-current) row (new_start in the future), whose
    refund must move no dates at all.
    """
    _revert_tz = member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
    _revert_today = today_for_gym(_revert_tz)
    if member.membership_end == renewal.new_end:
        _should_revert = True
    elif renewal.new_start is not None and renewal.new_start <= _revert_today:
        # V7-M6: the end moved since this row was applied (freeze
        # extended it, or a hand edit moved it). Revert UNLESS a
        # genuine later renewal owns the current period. A later
        # row is detected three ways, because a freeze also moves
        # the later row's end off the member's current end:
        # (1) a row whose new_end still equals the current end;
        # (2) a directly-chained successor (previous_end == this
        # row's new_end) that already started; (3) a row whose
        # new_start is the member's current start and already
        # started. A merely SCHEDULED successor (new_start in the
        # future) matches none of these, so refunding the current
        # row still reverts and re-chains it (V5-M8).
        _later = RenewalHistory.query.filter(
            RenewalHistory.member_id == member.id,
            RenewalHistory.id != renewal.id,
            or_(
                RenewalHistory.new_end == member.membership_end,
                and_(
                    RenewalHistory.previous_end == renewal.new_end,
                    RenewalHistory.new_start <= _revert_today,
                ),
                and_(
                    RenewalHistory.new_start == member.membership_start,
                    RenewalHistory.new_start <= _revert_today,
                ),
            ),
        ).first()
        _should_revert = _later is None
    else:
        _should_revert = False
    if not _should_revert:
        return
    if _should_revert:
        member.membership_end = renewal.previous_end
        if renewal.previous_start is not None:
            member.membership_start = renewal.previous_start
        # V3-M18: restore the pre-renewal plan/price. NULL means the
        # row predates the snapshot (or is a creation row with no
        # prior plan/price) — leave the member's current values.
        if renewal.previous_plan_id is not None:
            member.plan_id = renewal.previous_plan_id
        if renewal.previous_price is not None:
            member.price = renewal.previous_price
        # V5-M8: a live scheduled renewal was chained to the refunded
        # row's new_end (its previous_end). Re-point it at the
        # reverted end so the paid future period can still activate
        # instead of being orphaned forever; its own new_start (the
        # paid start date) is preserved. Queried directly — the
        # shared live-scheduled check would call these rows stale,
        # because their previous_end still points at the pre-revert
        # end.
        _gym_tz = member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
        _today = today_for_gym(_gym_tz)
        _chained = (
            RenewalHistory.query.filter(
                RenewalHistory.member_id == member.id,
                # V7-M5: new_end >= today — a due row still needs
                # re-chaining after a refund, like a future one.
                RenewalHistory.new_end >= _today,
                RenewalHistory.previous_end == renewal.new_end,
            )
            .order_by(RenewalHistory.new_start.asc(), RenewalHistory.id.asc())
            .all()
        )
        for _scheduled in _chained:
            if (
                member.membership_start == _scheduled.new_start
                and member.membership_end == _scheduled.new_end
            ):
                continue
            _scheduled.previous_end = renewal.previous_end
            audit(
                action="scheduled_renewal_rechained",
                resource_type="renewal_history",
                resource_id=_scheduled.id,
                gym_id=member.gym_id,
                actor_id=None,
                metadata={
                    "member_id": member.id,
                    "old_previous_end": renewal.new_end.isoformat() if renewal.new_end else None,
                    "new_previous_end": renewal.previous_end.isoformat() if renewal.previous_end else None,
                    "reason": "refund_revert",
                    "reverted_renewal_id": renewal.id,
                },
            )
        # B-M3: a paused member stays paused through a refund/delete
        # revert — only the explicit unfreeze flow clears paused.
        if member.status == "paused":
            return
        # A creation row records the pre-signup state: there was no
        # membership before it, so the refunded member is expired —
        # not a 1-day "active" stub with the door open.
        # V4-L15: branch on the explicit ``is_creation`` flag first
        # (set at write time by create_member); the
        # previous_end == new_start heuristic is only the fallback
        # for legacy rows that predate the flag. A genuine first
        # renewal of an imported member that happens to satisfy the
        # heuristic must not be mistaken for a signup — unless its
        # previous_start also equals new_start (the create_member
        # shape), it reverts to the pre-renewal dates instead.
        _is_creation = bool(getattr(renewal, "is_creation", False)) or (
            renewal.previous_end is not None
            and renewal.previous_end == renewal.new_start
            and (
                renewal.previous_start is None
                or renewal.previous_start == renewal.new_start
            )
        )
        if _is_creation:
            member.status = "expired"
            return
        if renewal.previous_end:
            gym_tz = member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
            today = today_for_gym(gym_tz)
            member.status = "active" if renewal.previous_end >= today else "expired"
        else:
            member.status = "expired"


def _unwind_campaign_attribution(renewal: RenewalHistory) -> None:
    """Remove campaign credit for a reversed renewal and recompute counters."""
    from app.models import Campaign, CampaignRecipient

    recipient = CampaignRecipient.query.filter_by(renewal_id=renewal.id).first()
    if not recipient:
        return
    campaign_id = recipient.campaign_id
    recipient.renewed_at = None
    recipient.renewal_amount = None
    recipient.renewal_id = None
    recipient.is_payment_backed = None
    recipient.status = "sent"
    db.session.flush()
    campaign = db.session.get(Campaign, campaign_id)
    if campaign:
        from app.services.campaign_service import recompute_campaign_revenue

        campaign.total_renewed = (
            CampaignRecipient.query.filter_by(campaign_id=campaign.id)
            .filter(CampaignRecipient.renewed_at.isnot(None))
            .count()
        )
        recompute_campaign_revenue(campaign)


def delete_payment(payment: PaymentVerification) -> None:
    """Delete a payment record and revert any renewal history.

    (V3-L4) Only UNVERIFIED payments may be deleted. A verified payment
    is money that was collected and counted — deleting it (and its
    renewal row) erases the money trail entirely. Refund it instead,
    which keeps the record with status='refunded' and reverts the
    membership. Unverified (pending/rejected/cancelled/failed) payments
    carry no collected money and can still be deleted.
    """
    payment = _lock_payment(payment)
    if payment.status == "verified":
        raise ValueError(
            "Cannot delete a verified payment — it is part of the money trail. "
            "Refund it instead."
        )
    gym_id = payment.gym_id
    member = (
        db.session.execute(
            select(Member).where(Member.id == payment.member_id).with_for_update()
        ).scalar_one_or_none()
        if payment.member_id else None
    )
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).first()
    if renewal:
        if member:
            _revert_renewal(member, renewal)
            # The device must reflect the reverted membership immediately.
            queue_membership_command(member)
        _unwind_campaign_attribution(renewal)
        db.session.delete(renewal)

    db.session.delete(payment)
    invalidate_dashboard_cache(gym_id)


def refund_payment(payment: PaymentVerification, *, refunded_by_id: int) -> None:
    """Refund a verified payment: keep the money record, revert everything else.

    Sets status='refunded' (the money trail is preserved), rolls the
    membership back, unwinds campaign attribution, and pushes the corrected
    access state to the biometric device.
    """
    payment = _lock_payment(payment)
    if payment.status != "verified":
        raise ValueError(f"Only verified payments can be refunded (status={payment.status}).")
    member = (
        db.session.execute(
            select(Member).where(Member.id == payment.member_id).with_for_update()
        ).scalar_one()
    )
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).first()
    if renewal:
        _revert_renewal(member, renewal)
        _unwind_campaign_attribution(renewal)
        db.session.delete(renewal)

    payment.status = "refunded"
    # V3-L2: the verification audit trail is immutable — verified_at /
    # verified_by_id keep the original verification. The refund records
    # its own time and actor separately.
    payment.refunded_at = utcnow()
    payment.refunded_by_id = refunded_by_id
    queue_membership_command(member)
    invalidate_dashboard_cache(payment.gym_id)


def cancel_payment(payment: PaymentVerification, *, cancelled_by_id: int | None = None) -> None:
    """Cancel an unverified payment or renewal demand."""
    payment = _lock_payment(payment)
    if payment.status == "verified":
        raise ValueError("Cannot cancel an already verified payment.")
    if payment.status == "cancelled":
        return
    if payment.status == "rejected":
        raise ValueError("Payment is already rejected.")
    payment.status = "cancelled"
    # V4-L35: same as reject — a cancelled payment was never verified,
    # so verified_at/verified_by_id stay untouched. The cancellation
    # records its own time and actor.
    if cancelled_by_id:
        payment.cancelled_by_id = cancelled_by_id
    payment.cancelled_at = utcnow()
    invalidate_dashboard_cache(payment.gym_id)


