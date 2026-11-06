from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select

from app.extensions import db
from app.models import Member, PaymentVerification, RenewalHistory
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
    """
    rows = (
        RenewalHistory.query.filter(
            RenewalHistory.member_id == member.id,
            RenewalHistory.new_start > today,
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


def verified_payment_with_reference(gym_id: int, reference: str):
    """Return the verified payment in this gym carrying *reference* (M9).

    A UTR pasted twice must not double-count collections: the creation
    paths reject a second verified payment with the same reference.
    Returns None when the reference is empty or unused.
    """
    reference = (reference or "").strip()
    if not reference:
        return None
    return PaymentVerification.query.filter_by(
        gym_id=gym_id, reference=reference, status="verified"
    ).first()


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
    _reference = (locked_payment.reference or "").strip()
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
    if previous_end and previous_end >= today and new_start < earliest_start:
        raise ValueError(
            f"Renewal start date must be {earliest_start.isoformat()} or later so the current paid membership is not shortened."
        )
    new_end = new_start + timedelta(days=renewal_days - 1)
    if new_start <= today and new_end < today:
        raise ValueError("This renewal would already be expired. Choose a later start date.")

    # A verified future renewal is stored now but only becomes the member's
    # current access period on its start date. This lets an existing paid
    # period run to expiry and prevents a selected gap from keeping the door
    # open. Only one verified future renewal may be waiting for a member.
    # V3-M16: mirror the direct path — a direct scheduled renewal
    # (payment_verification_id IS NULL) counts too, and stale rows
    # that can never activate do not block.
    scheduled = new_start > today
    if scheduled:
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
        new_start=new_start,
        new_end=new_end,
        standard_price=locked_payment.standard_price,
        discount=locked_payment.discount or Decimal("0.00"),
        amount=locked_payment.amount,
        channel=locked_payment.channel or "offline",
        notes=locked_payment.notes,
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
        member = db.session.execute(
            select(Member).where(Member.id == renewal.member_id).with_for_update()
        ).scalar_one_or_none()
        if member is None or member.gym_id != gym.id or member.deleted_at is not None:
            continue
        if member.membership_start == renewal.new_start and member.membership_end == renewal.new_end:
            continue
        if member.membership_end != renewal.previous_end or renewal.new_end < today:
            continue
        member.membership_start = renewal.new_start
        member.membership_end = renewal.new_end
        # M3: a paused member stays paused when a scheduled renewal
        # activates — only the explicit unfreeze flow clears paused.
        if member.status != "paused":
            member.status = "active"
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
            metadata={"member_id": member.id, "start_date": renewal.new_start.isoformat()},
        )
        activated += 1
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
    payment.verified_by_id = verified_by_id
    payment.verified_at = utcnow()
    invalidate_dashboard_cache(payment.gym_id)


def _revert_renewal(member: Member, renewal: RenewalHistory) -> None:
    """Roll a member's membership back to the pre-renewal state.

    V3-M18: restores plan/price from the snapshot on the renewal row
    (when present), and refunding a signup no longer leaves a 1-day
    active stub: a creation row (previous_end == new_start, the
    pre-signup state) reverts to status "expired" instead of "active".
    """
    if member.membership_end == renewal.new_end:
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
        # B-M3: a paused member stays paused through a refund/delete
        # revert — only the explicit unfreeze flow clears paused.
        if member.status == "paused":
            return
        # A creation row records the pre-signup state: there was no
        # membership before it, so the refunded member is expired —
        # not a 1-day "active" stub with the door open. Legacy
        # creation rows (previous_start NULL) are detected the same
        # way; a genuine first renewal of an imported member carries
        # a previous_start that differs from new_start, so it is not
        # mistaken for a creation row.
        if renewal.previous_end is not None and renewal.previous_end == renewal.new_start and (
            renewal.previous_start is None or renewal.previous_start == renewal.new_start
        ):
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
    if cancelled_by_id:
        payment.verified_by_id = cancelled_by_id
    payment.verified_at = utcnow()
    invalidate_dashboard_cache(payment.gym_id)


