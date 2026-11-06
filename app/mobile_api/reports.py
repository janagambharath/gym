"""Mobile API reports endpoint."""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from flask import g, jsonify, request
from sqlalchemy import case, func

from app.extensions import db
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, PaymentVerification, ReminderLog, RenewalHistory
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


def _parse_period(period: str, gym_timezone: str | None = None) -> datetime:
    """Return the UTC timestamp at the selected gym-local reporting boundary."""
    today = today_for_gym(gym_timezone)
    if period == "7d":
        start_date = today - timedelta(days=7)
    elif period == "30d":
        start_date = today - timedelta(days=30)
    else:
        start_date = today  # "today"
    return utc_start_of_gym_day(gym_timezone, local_date=start_date)


def register_reports_routes(bp):
    @bp.route("/reports/summary", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reports_summary():
        period = request.args.get("period", "30d").strip()
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        start_at = _parse_period(period, gym_timezone)
        today = today_for_gym(gym_timezone)
        if period == "7d":
            period_start_date = today - timedelta(days=7)
        elif period == "30d":
            period_start_date = today - timedelta(days=30)
        else:
            period_start_date = today
        gym_id = g.gym_id

        # Members
        total_members = (
            db.session.query(func.count(Member.id))
            .filter(Member.gym_id == gym_id, Member.deleted_at.is_(None))
            .scalar() or 0
        )
        active_members = (
            db.session.query(func.count(Member.id))
            .filter(Member.gym_id == gym_id, Member.deleted_at.is_(None), Member.status == "active")
            .scalar() or 0
        )
        expired_members = (
            db.session.query(func.count(Member.id))
            .filter(Member.gym_id == gym_id, Member.deleted_at.is_(None), Member.status == "expired")
            .scalar() or 0
        )
        new_members = (
            db.session.query(func.count(Member.id))
            .filter(
                Member.gym_id == gym_id,
                Member.deleted_at.is_(None),
                Member.created_at >= start_at,
            )
            .scalar() or 0
        )

        # Revenue
        revenue_collected = (
            db.session.query(
                func.coalesce(
                    func.sum(
                        case(
                            (PaymentVerification.status == "verified", PaymentVerification.amount),
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
        revenue_pending = (
            db.session.query(
                func.coalesce(
                    func.sum(
                        case(
                            (PaymentVerification.status == "pending", PaymentVerification.amount),
                            else_=0,
                        )
                    ),
                    0,
                )
            )
            .filter(PaymentVerification.gym_id == gym_id, PaymentVerification.is_test.is_(False))
            .scalar()
        )

        # Revenue at risk — H1 canonical definition (revenue_service):
        # active members expiring within 7 days PLUS members expired in the
        # last 30 days, pinned member price falling back to plan price.
        # Must match the dashboard and recovery-rate numbers, not a third
        # definition.
        from app.services.revenue_service import revenue_at_risk as _canonical_at_risk

        revenue_at_risk = Decimal(str(_canonical_at_risk(gym_id, gym_timezone)["total"]))

        # Renewals (V3-M1): signup creation rows are not renewals. Both the
        # completed count and the cohort numerator reuse the revenue
        # service's creation-row exclusion (explicit flag + paid_on check),
        # so new signups no longer inflate "completed renewals" or the rate.
        from app.services.revenue_service import _exclude_creation_rows

        _renewal_cols = (
            RenewalHistory.id,
            RenewalHistory.member_id,
            RenewalHistory.previous_start,
            RenewalHistory.previous_end,
            RenewalHistory.new_start,
            RenewalHistory.is_creation,
            PaymentVerification.paid_on,
            Member.membership_start,
        )
        _renewal_join = (
            db.session.query(*_renewal_cols)
            .outerjoin(
                PaymentVerification,
                PaymentVerification.id == RenewalHistory.payment_verification_id,
            )
            .join(Member, Member.id == RenewalHistory.member_id)
        )
        renewals_completed = len(
            _exclude_creation_rows(
                gym_id,
                _renewal_join.filter(
                    RenewalHistory.gym_id == gym_id,
                    RenewalHistory.created_at >= start_at,
                    RenewalHistory.is_test.is_(False),
                ).all(),
            )
        )
        # Measure a completed-expiry cohort: memberships whose old end date
        # fell in the period, plus those still expired today. Do not divide
        # renewal activity by every currently expired member, which mixes
        # unrelated time windows and inflates/deflates the rate.
        renewed_member_ids = {
            row.member_id
            for row in _exclude_creation_rows(
                gym_id,
                _renewal_join.filter(
                    RenewalHistory.gym_id == gym_id,
                    RenewalHistory.is_test.is_(False),
                    RenewalHistory.previous_end >= period_start_date,
                    RenewalHistory.previous_end < today,
                ).all(),
            )
        }
        unrenewed_member_ids = {
            row[0] for row in db.session.query(Member.id)
            .filter(
                Member.gym_id == gym_id,
                Member.deleted_at.is_(None),
                Member.status.in_(("active", "expired")),
                Member.membership_end >= period_start_date,
                Member.membership_end < today,
            )
            .all()
        }
        due_member_ids = renewed_member_ids | unrenewed_member_ids
        renewal_rate = round(len(renewed_member_ids) / len(due_member_ids) * 100, 1) if due_member_ids else 0.0

        # WhatsApp
        reminders_sent = (
            db.session.query(func.count(ReminderLog.id))
            .filter(
                ReminderLog.gym_id == gym_id,
                ReminderLog.status == "sent",
                ReminderLog.created_at >= start_at,
            )
            .scalar() or 0
        )
        reminders_failed = (
            db.session.query(func.count(ReminderLog.id))
            .filter(
                ReminderLog.gym_id == gym_id,
                ReminderLog.status == "failed",
                ReminderLog.created_at >= start_at,
            )
            .scalar() or 0
        )

        return jsonify({
            "success": True,
            "data": {
                "period": period,
                "members": {
                    "total": total_members,
                    "active": active_members,
                    "expired": expired_members,
                    "new": new_members,
                },
                "revenue": {
                    "collected": str(revenue_collected),
                    "pending": str(revenue_pending),
                    "at_risk": str(revenue_at_risk),
                },
                "renewals": {
                    "completed": renewals_completed,
                    "renewal_rate": renewal_rate,
                },
                "whatsapp": {
                    "sent": reminders_sent,
                    "failed": reminders_failed,
                },
            },
        })
