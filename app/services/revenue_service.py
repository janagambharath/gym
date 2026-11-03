"""Revenue service — Revenue at Risk, Revenue Recovered, and Recovery Rate.

These are the signature product metrics for Renewal Desk.
All numbers are computed from actual recorded data — never fabricated.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models import Member, PaymentVerification, RenewalHistory
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

    # Expiring within 7 days. Uses the per-member pinned price (set at
    # signup/last renewal) so plan price edits don't retroactively reprice
    # the metric. Members without a pinned price contribute count but 0.
    expiring_risk = (
        db.session.query(
            func.count(Member.id).label("count"),
            func.coalesce(func.sum(Member.price), 0).label("amount"),
        )
        .select_from(Member)
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
            func.coalesce(func.sum(Member.price), 0).label("amount"),
        )
        .select_from(Member)
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

    # Split payment-backed vs direct (non-payment) renewals so the owner can
    # reconcile "revenue recovered" against "collections" (which only sums
    # verified PaymentVerification rows). Renewals with no backing payment
    # (direct/bulk renewals) explain the difference.
    base_filters = [
        RenewalHistory.gym_id == gym_id,
        RenewalHistory.is_test.is_(False),
    ]
    if period_days is not None:
        today = today_for_gym(gym_timezone)
        cutoff_date = today - timedelta(days=period_days)
        base_filters.append(RenewalHistory.new_start >= cutoff_date)
    paid = (
        db.session.query(
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("amount"),
            func.count(RenewalHistory.id).label("count"),
        )
        .filter(*base_filters, RenewalHistory.payment_verification_id.isnot(None))
        .one()
    )
    direct = (
        db.session.query(
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("amount"),
            func.count(RenewalHistory.id).label("count"),
        )
        .filter(*base_filters, RenewalHistory.payment_verification_id.is_(None))
        .one()
    )

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
        "payment_backed_renewals": int(paid.count or 0),
        "payment_backed_amount": str(paid.amount),
        "direct_renewals": int(direct.count or 0),
        "direct_amount": str(direct.amount),
        "campaign_renewals": int(campaign_result.count or 0),
        "campaign_amount": str(campaign_result.amount),
    }


def recovery_rate(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate renewal recovery for one expiry cohort.

    The cohort includes expiries from the prior 30 days and upcoming expiries
    in the next 7 days. The denominator combines currently outstanding risk
    with the standard value of renewals already recorded for that same cohort;
    the numerator includes only those matched renewals. This avoids dividing
    all recent renewals by a current-risk snapshot from a different period.
    """
    today = today_for_gym(gym_timezone)
    cohort_start = today - timedelta(days=30)
    cohort_end = today + timedelta(days=7)
    risk = revenue_at_risk(gym_id, gym_timezone)
    cohort_rows = (
        db.session.query(
            RenewalHistory.member_id,
            RenewalHistory.amount,
            func.coalesce(RenewalHistory.standard_price, RenewalHistory.amount),
            RenewalHistory.campaign_id,
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            RenewalHistory.previous_end >= cohort_start,
            RenewalHistory.previous_end <= cohort_end,
        )
        .all()
    )
    cohort_actual = sum((Decimal(str(row[1] or 0)) for row in cohort_rows), Decimal("0"))
    cohort_expected = sum((Decimal(str(row[2] or 0)) for row in cohort_rows), Decimal("0"))
    campaign_rows = [row for row in cohort_rows if row[3] is not None]

    risk_total = Decimal(risk["total"]) + cohort_expected

    if risk_total > 0:
        rate = (cohort_actual / risk_total * 100).quantize(Decimal("0.1"))
    else:
        rate = Decimal("0.0")

    return {
        "revenue_at_risk": str(risk_total),
        "revenue_recovered": str(cohort_actual),
        "recovery_rate": str(rate),
        "risk_breakdown": {**risk, "renewed_cohort_expected": str(cohort_expected)},
        "recovered_breakdown": {
            "total_renewals": len(cohort_rows),
            "total_amount": str(cohort_actual),
            "campaign_renewals": len(campaign_rows),
            "campaign_amount": str(sum((Decimal(str(row[1] or 0)) for row in campaign_rows), Decimal("0"))),
        },
    }

