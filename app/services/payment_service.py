from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from app.extensions import db
from app.models import Member, PaymentVerification, RenewalHistory
from app.models.mixins import utcnow
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.bridge_service import queue_membership_command
from app.services.timezone_service import today_for_gym


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

    previous_end = member.membership_end
    gym_timezone = (
        member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
    )
    today = today_for_gym(gym_timezone)
    if previous_end and previous_end >= today:
        new_start = previous_end + timedelta(days=1)
    else:
        new_start = today
        member.membership_start = new_start
    new_end = new_start + timedelta(days=renewal_days - 1)

    locked_payment.status = "verified"
    locked_payment.verified_by_id = verified_by_id
    locked_payment.verified_at = utcnow()

    member.membership_end = new_end
    member.status = "active"
    queue_membership_command(member)

    target_plan_id = locked_payment.plan_id or member.plan_id
    if locked_payment.plan_id and locked_payment.plan_id != member.plan_id:
        member.plan_id = locked_payment.plan_id

    renewal = RenewalHistory(
        gym_id=locked_payment.gym_id,
        member_id=member.id,
        plan_id=target_plan_id,
        payment_verification_id=locked_payment.id,
        renewed_by_id=verified_by_id,
        previous_end=previous_end,
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


def reject_payment(payment: PaymentVerification, *, verified_by_id: int) -> None:
    if payment.status == "verified":
        raise ValueError("Cannot reject an already verified payment.")
    if payment.status == "rejected":
        raise ValueError("Payment is already rejected.")
    payment.status = "rejected"
    payment.verified_by_id = verified_by_id
    payment.verified_at = utcnow()
    invalidate_dashboard_cache(payment.gym_id)


def delete_payment(payment: PaymentVerification) -> None:
    """Safely delete a payment verification record and revert any renewal history."""
    gym_id = payment.gym_id
    member = payment.member
    renewal = RenewalHistory.query.filter_by(payment_verification_id=payment.id).first()
    if renewal:
        if member and member.membership_end == renewal.new_end:
            member.membership_end = renewal.previous_end
            if renewal.previous_end:
                gym_tz = member.gym.timezone if member.gym and member.gym.timezone else "Asia/Kolkata"
                today = today_for_gym(gym_tz)
                member.status = "active" if renewal.previous_end >= today else "expired"
        db.session.delete(renewal)

    db.session.delete(payment)
    invalidate_dashboard_cache(gym_id)


def cancel_payment(payment: PaymentVerification, *, cancelled_by_id: int | None = None) -> None:
    """Cancel an unverified payment or renewal demand."""
    if payment.status == "verified":
        raise ValueError("Cannot cancel an already verified payment.")
    if payment.status == "cancelled":
        return
    payment.status = "cancelled"
    if cancelled_by_id:
        payment.verified_by_id = cancelled_by_id
    payment.verified_at = utcnow()
    invalidate_dashboard_cache(payment.gym_id)


