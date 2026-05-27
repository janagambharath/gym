from __future__ import annotations

import json
from datetime import date, timedelta

from flask import current_app
from sqlalchemy import case, func

from app.extensions import db
from app.models import Member, PaymentVerification, ReminderLog


def _cache_key(gym_id: int) -> str:
    return f"dashboard_stats:{gym_id}"


def _redis_client():
    redis_url = current_app.config.get("REDIS_URL", "memory://")
    if redis_url == "memory://":
        return None
    import redis as _redis

    return _redis.from_url(redis_url, socket_connect_timeout=2)


def _fetch_stats(gym_id: int) -> dict:
    today = date.today()
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


def gym_dashboard_stats(gym_id: int) -> dict:
    try:
        redis_client = _redis_client()
        if redis_client:
            cached = redis_client.get(_cache_key(gym_id))
            if cached:
                return json.loads(cached)
    except Exception:
        current_app.logger.exception("Dashboard cache read failed")

    stats = _fetch_stats(gym_id)
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
