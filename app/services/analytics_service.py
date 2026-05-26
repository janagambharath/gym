from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func

from app.models import Member, PaymentVerification, ReminderLog


def gym_dashboard_stats(gym_id: int) -> dict:
    today = date.today()
    soon = today + timedelta(days=7)
    total_active = Member.query.filter_by(gym_id=gym_id, status="active").count()
    expiring_soon = (
        Member.query.filter(Member.gym_id == gym_id)
        .filter(Member.membership_end >= today, Member.membership_end <= soon)
        .count()
    )
    expired = (
        Member.query.filter(Member.gym_id == gym_id)
        .filter((Member.status == "expired") | (Member.membership_end < today))
        .count()
    )
    pending_payments = PaymentVerification.query.filter_by(gym_id=gym_id, status="pending").count()
    sent_reminders = ReminderLog.query.filter_by(gym_id=gym_id, status="sent").count()
    failed_reminders = ReminderLog.query.filter_by(gym_id=gym_id, status="failed").count()
    collected = (
        PaymentVerification.query.with_entities(func.coalesce(func.sum(PaymentVerification.amount), 0))
        .filter_by(gym_id=gym_id, status="verified")
        .scalar()
    )
    return {
        "total_active": total_active,
        "expiring_soon": expiring_soon,
        "expired": expired,
        "pending_payments": pending_payments,
        "sent_reminders": sent_reminders,
        "failed_reminders": failed_reminders,
        "collected": collected,
    }
