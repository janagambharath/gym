from __future__ import annotations

from datetime import date, timedelta

from app.extensions import db
from app.models import Member, PaymentVerification, RenewalHistory
from app.models.mixins import utcnow


def verify_payment(payment: PaymentVerification, *, verified_by_id: int, renewal_days: int) -> RenewalHistory:
    member = payment.member
    previous_end = member.membership_end
    new_start = max(date.today(), previous_end + timedelta(days=1))
    new_end = new_start + timedelta(days=renewal_days - 1)

    payment.status = "verified"
    payment.verified_by_id = verified_by_id
    payment.verified_at = utcnow()

    member.membership_start = new_start
    member.membership_end = new_end
    member.status = "active"

    renewal = RenewalHistory(
        gym_id=payment.gym_id,
        member_id=member.id,
        plan_id=member.plan_id,
        payment_verification_id=payment.id,
        renewed_by_id=verified_by_id,
        previous_end=previous_end,
        new_start=new_start,
        new_end=new_end,
        amount=payment.amount,
        notes=payment.notes,
    )
    db.session.add(renewal)
    return renewal


def reject_payment(payment: PaymentVerification, *, verified_by_id: int) -> None:
    payment.status = "rejected"
    payment.verified_by_id = verified_by_id
    payment.verified_at = utcnow()
