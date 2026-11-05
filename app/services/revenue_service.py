"""Revenue service — estimated risk and recorded renewal activity.

These are the signature product metrics for Renewal Desk.
Risk values use pinned member prices or current plan prices for legacy rows;
renewal values are amounts on the gym's renewal records. They are not all
independently verified collections or proof of campaign causation.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models import Member, MembershipPlan, PaymentVerification, RenewalHistory
from app.models.campaign import Campaign, CampaignRecipient
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


def revenue_at_risk(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate the total membership revenue currently at risk.

    Estimated value at risk = sum of pinned member prices, or current plan
    prices for older rows without a pinned amount, for:
    - Members expiring within 7 days
    - Members already expired (within last 30 days)
    - Members with no recent activity (inactive)

    Returns a forecast breakdown and total, not collected cash.
    """
    today = today_for_gym(gym_timezone)
    soon = today + timedelta(days=7)
    expired_cutoff = today - timedelta(days=30)

    # Expiring within 7 days. Use the per-member pinned price when present.
    # Legacy imported rows with the model's zero default use the current plan
    # price as an estimate so missing history does not erase the pipeline.
    risk_value = func.coalesce(func.nullif(Member.price, 0), MembershipPlan.price, 0)
    expiring_risk = (
        db.session.query(
            func.count(Member.id).label("count"),
            func.coalesce(func.sum(risk_value), 0).label("amount"),
        )
        .select_from(Member)
        .outerjoin(MembershipPlan, MembershipPlan.id == Member.plan_id)
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
            func.coalesce(func.sum(risk_value), 0).label("amount"),
        )
        .select_from(Member)
        .outerjoin(MembershipPlan, MembershipPlan.id == Member.plan_id)
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

    Recorded renewal value = sum of owner-entered renewal amounts from:
    - Direct renewals (owner-confirmed)
    - Campaign-attributed renewals
    - Reactivations (expired member who renewed)

    Args:
        period_days: If set, only count renewals within the last N days.
                     If None, count all-time. These records are not by
                     themselves proof of verified payment or causal lift.
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
        cutoff_at = utc_start_of_gym_day(gym_timezone, local_date=cutoff_date)
        query = query.filter(RenewalHistory.created_at >= cutoff_at)

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
        cutoff_at = utc_start_of_gym_day(gym_timezone, local_date=cutoff_date)
        base_filters.append(RenewalHistory.created_at >= cutoff_at)
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
        cutoff_at = utc_start_of_gym_day(gym_timezone, local_date=cutoff_date)
        campaign_query = campaign_query.filter(RenewalHistory.created_at >= cutoff_at)

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


def _exclude_creation_rows(gym_id: int, rows: list) -> list:
    """Drop signup (creation) ledger rows from a cohort.

    Member creation writes its first ledger row with
    ``previous_end == new_start == membership_start``
    (``app/mobile_api/members.py``). Every genuine renewal path starts the
    new period after the previous end (``earliest_start = previous_end + 1``,
    or today when expired), so a row matching BOTH signals — the member's
    first ledger row AND ``previous_end == new_start`` — is a signup, not
    a recovery. Requiring both avoids misreading a backdated first renewal
    of an imported member (who has no creation row) as a signup.
    """
    if not rows:
        return []
    member_ids = {row.member_id for row in rows}
    first_ids = {
        row[0]
        for row in db.session.query(func.min(RenewalHistory.id))
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.member_id.in_(member_ids),
        )
        .group_by(RenewalHistory.member_id)
        .all()
    }
    return [
        row
        for row in rows
        if not (
            row.id in first_ids
            and row.previous_end is not None
            and row.previous_end == row.new_start
        )
    ]


def recovery_rate(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate renewal recovery for one expiry cohort.

    The cohort includes expiries from the prior 30 days and upcoming expiries
    in the next 7 days. The denominator combines currently outstanding risk
    with the standard value of renewals already recorded for that same cohort;
    the numerator includes only those matched renewals. This avoids dividing
    all recent renewals by a current-risk snapshot from a different period.

    Money truth (C1 / B-H3): signup creation rows are excluded from the
    cohort entirely — a new signup is not a recovered renewal — and the
    recovered breakdown splits payment-backed renewals from direct
    (unrecorded-payment) renewals so clients can display verified-only
    money. ``revenue_at_risk`` is the canonical at-risk total (the same
    number the dashboard and reports return); the rate's denominator is
    exposed separately as ``recovery_denominator``.
    """
    today = today_for_gym(gym_timezone)
    cohort_start = today - timedelta(days=30)
    cohort_end = today + timedelta(days=7)
    risk = revenue_at_risk(gym_id, gym_timezone)
    cohort_rows = (
        db.session.query(
            RenewalHistory.id,
            RenewalHistory.member_id,
            RenewalHistory.amount,
            func.coalesce(RenewalHistory.standard_price, RenewalHistory.amount).label(
                "expected_value"
            ),
            RenewalHistory.campaign_id,
            RenewalHistory.previous_end,
            RenewalHistory.new_start,
            RenewalHistory.payment_verification_id,
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            RenewalHistory.previous_end >= cohort_start,
            RenewalHistory.previous_end <= cohort_end,
        )
        .all()
    )
    recovery_rows = _exclude_creation_rows(gym_id, cohort_rows)
    cohort_actual = sum((Decimal(str(row.amount or 0)) for row in recovery_rows), Decimal("0"))
    cohort_expected = sum((Decimal(str(row.expected_value or 0)) for row in recovery_rows), Decimal("0"))
    paid_rows = [row for row in recovery_rows if row.payment_verification_id is not None]
    direct_rows = [row for row in recovery_rows if row.payment_verification_id is None]
    campaign_rows = [row for row in recovery_rows if row.campaign_id is not None]

    risk_total = Decimal(risk["total"]) + cohort_expected

    if risk_total > 0:
        rate = (cohort_actual / risk_total * 100).quantize(Decimal("0.1"))
    else:
        rate = Decimal("0.0")

    return {
        "revenue_at_risk": risk["total"],
        "recovery_denominator": str(risk_total),
        "revenue_recovered": str(cohort_actual),
        "recovery_rate": str(rate),
        "risk_breakdown": {**risk, "renewed_cohort_expected": str(cohort_expected)},
        "recovered_breakdown": {
            "total_renewals": len(recovery_rows),
            "total_amount": str(cohort_actual),
            "payment_backed_renewals": len(paid_rows),
            "payment_backed_amount": str(
                sum((Decimal(str(row.amount or 0)) for row in paid_rows), Decimal("0"))
            ),
            "direct_renewals": len(direct_rows),
            "direct_amount": str(
                sum((Decimal(str(row.amount or 0)) for row in direct_rows), Decimal("0"))
            ),
            "campaign_renewals": len(campaign_rows),
            "campaign_amount": str(
                sum((Decimal(str(row.amount or 0)) for row in campaign_rows), Decimal("0"))
            ),
        },
    }

