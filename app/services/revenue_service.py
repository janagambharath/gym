"""Revenue service — Revenue at Risk, Revenue Recovered, and Recovery Rate.

These are the signature product metrics for Renewal Desk.
All numbers are computed from actual recorded data — never fabricated.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models import Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.models.campaign import Campaign, CampaignRecipient
from app.services.timezone_service import today_for_gym


def revenue_at_risk(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate the total membership revenue currently at risk.

    Revenue at risk = sum of plan prices for:
    - Members expiring within 7 days
    - Members already expired (within last 30 days)
    - Members with no recent activity (inactive)

    Returns breakdown and total.
    """
    today = today_for_gym(gym_timezone)
    soon = today + timedelta(days=7)
    expired_cutoff = today - timedelta(days=30)

    # Expiring within 7 days
    expiring_risk = (
        db.session.query(
            func.count(Member.id).label("count"),
            func.coalesce(func.sum(MembershipPlan.price), 0).label("amount"),
        )
        .select_from(Member)
        .outerjoin(MembershipPlan, Member.plan_id == MembershipPlan.id)
        .filter(
            Member.gym_id == gym_id,
            Member.deleted_at.is_(None),
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= soon,
        )
        .one()
    )

    # Recently expired (last 30 days)
    expired_risk = (
        db.session.query(
            func.count(Member.id).label("count"),
            func.coalesce(func.sum(MembershipPlan.price), 0).label("amount"),
        )
        .select_from(Member)
        .outerjoin(MembershipPlan, Member.plan_id == MembershipPlan.id)
        .filter(
            Member.gym_id == gym_id,
            Member.deleted_at.is_(None),
            Member.membership_end < today,
            Member.membership_end >= expired_cutoff,
        )
        .one()
    )

    total = Decimal(str(expiring_risk.amount)) + Decimal(str(expired_risk.amount))

    return {
        "total": str(total),
        "expiring_count": int(expiring_risk.count or 0),
        "expiring_amount": str(expiring_risk.amount),
        "expired_count": int(expired_risk.count or 0),
        "expired_amount": str(expired_risk.amount),
    }


def revenue_recovered(
    gym_id: int,
    gym_timezone: str = "Asia/Kolkata",
    period_days: int | None = None,
) -> dict:
    """Calculate revenue recovered through Renewal Desk.

    Revenue recovered = sum of actual renewal amounts from:
    - Direct renewals (owner-confirmed)
    - Campaign-attributed renewals
    - Reactivations (expired member who renewed)

    Args:
        period_days: If set, only count renewals within the last N days.
                     If None, count all-time.
    """
    query = (
        db.session.query(
            func.count(RenewalHistory.id).label("renewal_count"),
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("total_amount"),
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
        )
    )

    if period_days is not None:
        today = today_for_gym(gym_timezone)
        cutoff_date = today - timedelta(days=period_days)
        query = query.filter(RenewalHistory.new_start >= cutoff_date)

    result = query.one()

    # Campaign-attributed portion
    campaign_query = (
        db.session.query(
            func.count(RenewalHistory.id).label("count"),
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("amount"),
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            RenewalHistory.campaign_id.isnot(None),
        )
    )

    if period_days is not None:
        today = today_for_gym(gym_timezone)
        cutoff_date = today - timedelta(days=period_days)
        campaign_query = campaign_query.filter(RenewalHistory.new_start >= cutoff_date)

    campaign_result = campaign_query.one()

    return {
        "total_renewals": int(result.renewal_count or 0),
        "total_amount": str(result.total_amount),
        "campaign_renewals": int(campaign_result.count or 0),
        "campaign_amount": str(campaign_result.amount),
    }


def recovery_rate(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate the revenue recovery rate.

    Recovery Rate = Revenue Recovered / Revenue at Risk × 100

    Returns the rate as a percentage and component values.
    """
    risk = revenue_at_risk(gym_id, gym_timezone)
    recovered = revenue_recovered(gym_id, gym_timezone, period_days=30)

    risk_total = Decimal(risk["total"])
    recovered_total = Decimal(recovered["total_amount"])

    if risk_total > 0:
        rate = (recovered_total / risk_total * 100).quantize(Decimal("0.1"))
    else:
        rate = Decimal("0.0")

    return {
        "revenue_at_risk": risk["total"],
        "revenue_recovered": recovered["total_amount"],
        "recovery_rate": str(rate),
        "risk_breakdown": risk,
        "recovered_breakdown": recovered,
    }


def revenue_recovered_breakdown(
    gym_id: int, gym_timezone: str = "Asia/Kolkata"
) -> dict:
    """Return revenue recovered broken down by period: today, week, month, all-time."""
    return {
        "today": revenue_recovered(gym_id, gym_timezone, period_days=1),
        "week": revenue_recovered(gym_id, gym_timezone, period_days=7),
        "month": revenue_recovered(gym_id, gym_timezone, period_days=30),
        "all_time": revenue_recovered(gym_id, gym_timezone),
    }
