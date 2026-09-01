from __future__ import annotations

import json
from datetime import date, timedelta

from flask import current_app
from sqlalchemy import case, func

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification, ReminderLog
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


def _cache_key(gym_id: int) -> str:
    return f"dashboard_stats:{gym_id}"


def _redis_client():
    redis_url = current_app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        return None
    import redis as _redis

    return _redis.from_url(redis_url, socket_connect_timeout=2)


def _timezone_for_gym(gym_id: int, gym_timezone: str | None = None) -> str:
    """Return a gym timezone without ever falling back to the host timezone."""
    if gym_timezone:
        return gym_timezone
    gym = db.session.get(Gym, gym_id)
    return gym.timezone if gym and gym.timezone else "Asia/Kolkata"


def _fetch_stats(gym_id: int, gym_timezone: str | None = None) -> dict:
    today = today_for_gym(_timezone_for_gym(gym_id, gym_timezone))
    soon = today + timedelta(days=7)

    member_stats = (
        db.session.query(
            func.sum(case((Member.status == "active", 1), else_=0)).label("total_active"),
            func.sum(
                case(
                    ((Member.membership_end >= today) & (Member.membership_end <= soon), 1),
                    else_=0,
                )
            ).label("expiring_soon"),
            func.sum(case((Member.membership_end < today, 1), else_=0)).label("expired"),
        )
        .filter(Member.gym_id == gym_id, Member.deleted_at.is_(None))
        .one()
    )

    payment_stats = (
        db.session.query(
            func.sum(case(((PaymentVerification.status == "pending") & (PaymentVerification.is_test.is_(False)), 1), else_=0)).label(
                "pending"
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (PaymentVerification.status == "verified") & (PaymentVerification.is_test.is_(False)),
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

    risk_stats = (
        db.session.query(
            func.coalesce(
                func.sum(
                    case(
                        (
                            (Member.membership_end >= today)
                            & (Member.membership_end <= soon)
                            & (Member.status == "active"),
                            MembershipPlan.price,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue_at_risk")
        )
        .select_from(Member)
        .outerjoin(MembershipPlan, Member.plan_id == MembershipPlan.id)
        .filter(Member.gym_id == gym_id, Member.deleted_at.is_(None))
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
        "revenue_at_risk": risk_stats.revenue_at_risk,
    }


def gym_dashboard_stats(gym_id: int, gym_timezone: str | None = None) -> dict:
    try:
        redis_client = _redis_client()
        if redis_client:
            cached = redis_client.get(_cache_key(gym_id))
            if cached:
                return json.loads(cached)
    except Exception:
        current_app.logger.exception("Dashboard cache read failed")

    stats = _fetch_stats(gym_id, gym_timezone)
    try:
        redis_client = _redis_client()
        if redis_client:
            redis_client.setex(_cache_key(gym_id), 60, json.dumps(stats, default=str))
    except Exception:
        current_app.logger.exception("Dashboard cache write failed")
    return stats


def invalidate_dashboard_cache(gym_id: int) -> None:
    try:
        redis_client = _redis_client()
        if redis_client:
            redis_client.delete(_cache_key(gym_id))
    except Exception:
        current_app.logger.exception("Dashboard cache invalidation failed")


def gym_revenue_breakdown(gym_id: int, gym_timezone: str | None = None) -> dict:
    """Return verified payment totals for today, this week, and this month."""
    timezone_name = _timezone_for_gym(gym_id, gym_timezone)
    today = today_for_gym(timezone_name)
    week_start = today - timedelta(days=today.weekday())  # Monday
    month_start = today.replace(day=1)

    def _sum_verified(start_date: date) -> str:
        start_at = utc_start_of_gym_day(timezone_name, local_date=start_date)
        result = (
            db.session.query(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (PaymentVerification.status == "verified") & (PaymentVerification.is_test.is_(False)),
                                PaymentVerification.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                )
            )
            .filter(
                PaymentVerification.gym_id == gym_id,
                PaymentVerification.verified_at >= start_at,
                PaymentVerification.is_test.is_(False),
            )
            .scalar()
        )
        return str(result)


    return {
        "revenue_today": _sum_verified(today),
        "revenue_week": _sum_verified(week_start),
        "revenue_month": _sum_verified(month_start),
    }
