"""Revenue service — estimated risk and recorded renewal activity.

These are the signature product metrics for Renewal Desk.
Risk values use pinned member prices or current plan prices for legacy rows;
renewal values are amounts on the gym's renewal records. They are not all
independently verified collections or proof of campaign causation.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import and_, func, or_, true

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

    V4-L4: paused (frozen) members are excluded from BOTH branches —
    a freeze is not a churned renewal, so counting a paused member
    as at-risk the day they expire (while contributing ₹0 while
    expiring) inflated the headline and the recovery-rate denominator.

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

    # Recently expired (last 30 days). V4-L4: paused members are
    # excluded here too (the expiring branch already requires
    # status == "active"); other statuses (expired/inactive) count
    # exactly as before.
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
            Member.status != "paused",
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

    Money truth (V3-H1): signup creation rows are excluded from every
    figure here — a paid signup is not a recovery, and creation rows
    carry a payment_verification_id, so even the payment-backed split
    was signup-contaminated before this exclusion. ``total_amount`` is
    the recorded (paid + direct) renewal total excluding signups;
    ``payment_backed_amount`` is the verified-only headline clients
    should quote; ``recorded_amount`` is the explicit alias for the
    recorded total.

    Args:
        period_days: If set, only count renewals within the last N days.
                     If None, count all-time. These records are not by
                     themselves proof of verified payment or causal lift.
    """
    creation_ids = _creation_row_ids(gym_id)
    not_creation = (
        ~RenewalHistory.id.in_(creation_ids) if creation_ids else true()
    )
    query = (
        db.session.query(
            func.count(RenewalHistory.id).label("renewal_count"),
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("total_amount"),
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            not_creation,
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
    # (direct/bulk renewals) explain the difference. Both splits exclude
    # signup creation rows (V3-H1).
    base_filters = [
        RenewalHistory.gym_id == gym_id,
        RenewalHistory.is_test.is_(False),
        not_creation,
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

    # Campaign-attributed portion (signup creation rows excluded, V3-H1).
    campaign_query = (
        db.session.query(
            func.count(RenewalHistory.id).label("count"),
            func.coalesce(func.sum(RenewalHistory.amount), 0).label("amount"),
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            RenewalHistory.campaign_id.isnot(None),
            not_creation,
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
        "recorded_amount": str(result.total_amount),
        "payment_backed_renewals": int(paid.count or 0),
        "payment_backed_amount": str(paid.amount),
        "direct_renewals": int(direct.count or 0),
        "direct_amount": str(direct.amount),
        "campaign_renewals": int(campaign_result.count or 0),
        "campaign_amount": str(campaign_result.amount),
    }


def _row_is_creation(row, first_ids: set) -> bool:
    """True when a ledger row is a signup creation row, not a recovery.

    (V3-M5) Three signals, in order of reliability:
    1. ``is_creation`` — set explicitly at write time by create_member;
       disambiguates every row written after the flag existed.
    2. The legacy heuristic — the member's first ledger row with
       ``previous_end == new_start`` — but only when the backing
       payment cannot prove otherwise: a creation row's backing payment
       has ``paid_on == new_start`` — the row's OWN start (create_member
       writes exactly that) — while a genuine first renewal of an
       imported member is backed by a payment dated after the row's
       start. V5-M2: the old code compared ``paid_on`` to the member's
       *current* ``membership_start``, which moves to the new period on
       every renewal, so a renewed member's genuine signup read as a
       recovery. The anchor is the row, never the member's live dates.
       When the payment dates are absent (legacy/test rows) the
       heuristic stands.
    3. (V4-L5) The create_member-era shape: create_member also writes
       ``previous_start == new_start`` (the pre-signup state). A
       genuine first renewal carries ``previous_start`` = the member's
       old start, which differs from ``new_start`` — so when
       ``previous_start`` is present and differs, the row is a renewal
       even if ``paid_on == membership_start`` (the same-day edge: an
       imported member created and renewed today). ``previous_start``
       is NULL on rows that predate the snapshot column; for those the
       paid_on test alone still applies.
       Residual: a member imported today whose stored start already
       equals the renewal start (a one-day prior period) is still
       shaped exactly like a signup and cannot be told apart from
       the stored fields alone.
    """
    if getattr(row, "is_creation", False):
        return True
    if (
        row.id not in first_ids
        or row.previous_end is None
        or row.previous_end != row.new_start
    ):
        return False
    previous_start = getattr(row, "previous_start", None)
    if previous_start is not None and previous_start != row.new_start:
        return False
    paid_on = getattr(row, "paid_on", None)
    if paid_on is None:
        return True
    # V5-M2: compare to the ROW's own new_start, not the member's
    # current membership_start (which moves on every renewal).
    return paid_on == row.new_start


def _creation_row_ids(gym_id: int) -> set:
    """IDs of signup (creation) ledger rows for one gym.

    Used by the aggregate queries in ``revenue_recovered()``, which
    cannot apply the row-level ``_exclude_creation_rows`` filter.

    V4-L2: the exclusion is computed in SQL — a first-row-per-member
    subquery plus the flag/heuristic/``paid_on`` refinement — instead
    of materialising the gym's entire ledger into Python on every
    dashboard call. The SQL predicate mirrors ``_row_is_creation``
    exactly: flag first, else first row + ``previous_end == new_start``
    + (``previous_start`` NULL or ``== new_start``) + (``paid_on``
    NULL or ``paid_on ==`` the row's own ``new_start``). V5-M2: the
    old SQL compared ``paid_on`` to ``Member.membership_start`` — the
    member's current start, which moves on every renewal — so the
    Member join is gone and the anchor is the row itself.
    """
    first_ids_sq = (
        db.session.query(func.min(RenewalHistory.id).label("first_id"))
        .filter(RenewalHistory.gym_id == gym_id)
        .group_by(RenewalHistory.member_id)
        .subquery()
    )
    rows = (
        db.session.query(RenewalHistory.id)
        .outerjoin(
            PaymentVerification,
            PaymentVerification.id == RenewalHistory.payment_verification_id,
        )
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.id.in_(
                db.session.query(first_ids_sq.c.first_id)
            ),
            or_(
                RenewalHistory.is_creation.is_(True),
                and_(
                    RenewalHistory.previous_end.isnot(None),
                    RenewalHistory.previous_end == RenewalHistory.new_start,
                    or_(
                        RenewalHistory.previous_start.is_(None),
                        RenewalHistory.previous_start == RenewalHistory.new_start,
                    ),
                    or_(
                        PaymentVerification.paid_on.is_(None),
                        PaymentVerification.paid_on == RenewalHistory.new_start,
                    ),
                ),
            ),
        )
        .all()
    )
    return {row.id for row in rows}


def _exclude_creation_rows(gym_id: int, rows: list) -> list:
    """Drop signup (creation) ledger rows from a cohort.

    Member creation writes its first ledger row with
    ``previous_end == new_start == membership_start``
    (``app/mobile_api/members.py``). Every genuine renewal path starts the
    new period after the previous end (``earliest_start = previous_end + 1``,
    or today when expired), so a row matching BOTH signals — the member's
    first ledger row AND ``previous_end == new_start`` — is a signup, not
    a recovery. Rows carrying the explicit ``is_creation`` flag (V3-M5)
    are dropped outright; for unflagged rows the heuristic additionally
    requires the backing payment's ``paid_on`` to equal the row's own
    ``new_start`` (see ``_row_is_creation``) so a backdated first renewal of an
    imported member is no longer mis-excluded.
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
    return [row for row in rows if not _row_is_creation(row, first_ids)]


def recovery_rate(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Calculate renewal recovery for one expiry cohort.

    The cohort includes expiries from the prior 30 days and upcoming expiries
    in the next 7 days. The denominator combines currently outstanding risk
    with the actual amount collected on renewals already recorded for that
    same cohort; the numerator includes only those matched renewals. This
    avoids dividing all recent renewals by a current-risk snapshot from a
    different period.

    Money truth (C1 / B-H3, V3-H2): signup creation rows are excluded from
    the cohort entirely — a new signup is not a recovered renewal — and
    the headline ``revenue_recovered`` and the recovery rate are computed
    from payment-backed renewals ONLY. Direct (unrecorded-payment)
    renewals are still counted in the separately-named
    ``recorded_amount`` / breakdown ``total_amount`` so the two can be
    reconciled, but they are no longer presented as recovered money.
    ``revenue_at_risk`` is the canonical at-risk total (the same
    number the dashboard and reports return); the rate's denominator is
    exposed separately as ``recovery_denominator``.

    V5-L5: numerator and denominator use ACTUAL amounts on the
    recovered side. The denominator is outstanding expected value
    (pinned prices — the unrenewed have no actual yet) + the actual
    amount collected on paid renewals, and the numerator is that same
    actual collected amount. The old denominator used
    ``paid_expected`` (standard price), so a cohort renewed entirely
    at a discount scored <100% despite 100% recovery. ``paid_expected``
    is still exposed in the breakdown for reconciliation.
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
            RenewalHistory.previous_start,
            RenewalHistory.previous_end,
            RenewalHistory.new_start,
            RenewalHistory.payment_verification_id,
            RenewalHistory.is_creation,
            PaymentVerification.paid_on,
            Member.membership_start,
        )
        .outerjoin(
            PaymentVerification,
            PaymentVerification.id == RenewalHistory.payment_verification_id,
        )
        .join(Member, Member.id == RenewalHistory.member_id)
        .filter(
            RenewalHistory.gym_id == gym_id,
            RenewalHistory.is_test.is_(False),
            RenewalHistory.previous_end >= cohort_start,
            RenewalHistory.previous_end <= cohort_end,
        )
        .all()
    )
    recovery_rows = _exclude_creation_rows(gym_id, cohort_rows)
    cohort_actual = sum((Decimal(str(row.amount or 0)) for row in recovery_rows), Decimal("0.00"))
    cohort_expected = sum((Decimal(str(row.expected_value or 0)) for row in recovery_rows), Decimal("0.00"))
    paid_rows = [row for row in recovery_rows if row.payment_verification_id is not None]
    direct_rows = [row for row in recovery_rows if row.payment_verification_id is None]
    campaign_rows = [row for row in recovery_rows if row.campaign_id is not None]
    paid_amount = sum((Decimal(str(row.amount or 0)) for row in paid_rows), Decimal("0.00"))
    # V4-M2: denominator counts PAID expected value only — direct
    # renewals are renewals, not unrecovered risk. V5-L5: the
    # denominator's recovered leg uses the ACTUAL collected amount
    # (same as the numerator), not the standard-price expected value,
    # so a fully-renewed-but-discounted cohort scores 100%.
    paid_expected = sum((Decimal(str(row.expected_value or 0)) for row in paid_rows), Decimal("0.00"))
    direct_expected = cohort_expected - paid_expected

    risk_total = Decimal(risk["total"]) + paid_amount

    if risk_total > 0:
        rate = (paid_amount / risk_total * 100).quantize(Decimal("0.1"))
    else:
        rate = Decimal("0.0")

    return {
        "revenue_at_risk": risk["total"],
        "recovery_denominator": str(risk_total),
        "revenue_recovered": str(paid_amount),
        "recorded_amount": str(cohort_actual),
        "recovery_rate": str(rate),
        "recovery_rate_basis": "payment-backed only — direct renewals excluded from numerator and denominator; actual collected amounts on both sides, so discounted renewals count at what was collected",
        "risk_breakdown": {**risk, "renewed_cohort_expected": str(paid_expected), "renewed_cohort_expected_all": str(cohort_expected), "direct_cohort_expected": str(direct_expected)},
        "recovered_breakdown": {
            "total_renewals": len(recovery_rows),
            "total_amount": str(cohort_actual),
            "recorded_amount": str(cohort_actual),
            "payment_backed_renewals": len(paid_rows),
            "payment_backed_amount": str(paid_amount),
            "direct_renewals": len(direct_rows),
            "direct_amount": str(
                sum((Decimal(str(row.amount or 0)) for row in direct_rows), Decimal("0.00"))
            ),
            "campaign_renewals": len(campaign_rows),
            "campaign_amount": str(
                sum((Decimal(str(row.amount or 0)) for row in campaign_rows), Decimal("0.00"))
            ),
        },
    }

