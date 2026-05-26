from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select

from app.extensions import db
from app.models import Member, PaymentVerification, RenewalHistory
from app.models.mixins import utcnow


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
    if locked_payment.status != "pending":
        raise ValueError(f"Payment {locked_payment.id} is not pending.")

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
    new_start = max(date.today(), previous_end + timedelta(days=1))
    new_end = new_start + timedelta(days=renewal_days - 1)

    locked_payment.status = "verified"
    locked_payment.verified_by_id = verified_by_id
    locked_payment.verified_at = utcnow()

    member.membership_start = new_start
    member.membership_end = new_end
    member.status = "active"

    renewal = RenewalHistory(
        gym_id=locked_payment.gym_id,
        member_id=member.id,
        plan_id=member.plan_id,
        payment_verification_id=locked_payment.id,
        renewed_by_id=verified_by_id,
        previous_end=previous_end,
        new_start=new_start,
        new_end=new_end,
        amount=locked_payment.amount,
        notes=locked_payment.notes,
    )
    db.session.add(renewal)
    return renewal


def reject_payment(payment: PaymentVerification, *, verified_by_id: int) -> None:
    if payment.status == "verified":
        raise ValueError("Cannot reject an already verified payment.")
    payment.status = "rejected"
    payment.verified_by_id = verified_by_id
    payment.verified_at = utcnow()
