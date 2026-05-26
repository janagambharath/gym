from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import case, func

from app.extensions import db
from app.models import Member, PaymentVerification, ReminderLog


def gym_dashboard_stats(gym_id: int) -> dict:
    today = date.today()
    soon = today + timedelta(days=7)

    member_stats = (
        db.session.query(
            func.sum(case((Member.status == "active", 1), else_=0)).label("total_active"),
            func.sum(
                case(
                    (
                        (Member.membership_end >= today) & (Member.membership_end <= soon),
                        1,
                    ),
                    else_=0,
                )
            ).label("expiring_soon"),
            func.sum(
                case(
                    ((Member.status == "expired") | (Member.membership_end < today), 1),
                    else_=0,
                )
            ).label("expired"),
        )
        .filter(Member.gym_id == gym_id)
        .one()
    )

    payment_stats = (
        db.session.query(
            func.sum(case((PaymentVerification.status == "pending", 1), else_=0)).label(
                "pending"
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            PaymentVerification.status == "verified",
                            PaymentVerification.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("collected"),
        )
        .filter(PaymentVerification.gym_id == gym_id)
        .one()
    )

    reminder_stats = (
        db.session.query(
            func.sum(case((ReminderLog.status == "sent", 1), else_=0)).label("sent"),
            func.sum(case((ReminderLog.status == "failed", 1), else_=0)).label("failed"),
        )
        .filter(ReminderLog.gym_id == gym_id)
        .one()
    )

    return {
        "total_active": int(member_stats.total_active or 0),
        "expiring_soon": int(member_stats.expiring_soon or 0),
        "expired": int(member_stats.expired or 0),
        "pending_payments": int(payment_stats.pending or 0),
        "sent_reminders": int(reminder_stats.sent or 0),
        "failed_reminders": int(reminder_stats.failed or 0),
        "collected": payment_stats.collected,
    }
