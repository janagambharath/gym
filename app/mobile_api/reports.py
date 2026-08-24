"""Mobile API reports endpoint."""
from __future__ import annotations

from datetime import date, timedelta

from flask import g, jsonify, request
from sqlalchemy import case, func

from app.extensions import db
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, PaymentVerification, ReminderLog, RenewalHistory


def _parse_period(period: str) -> date:
    today = date.today()
    if period == "7d":
        return today - timedelta(days=7)
    if period == "30d":
        return today - timedelta(days=30)
    return today  # "today"


def register_reports_routes(bp):
    @bp.route("/reports/summary", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reports_summary():
        period = request.args.get("period", "30d").strip()
        start_date = _parse_period(period)
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
                Member.created_at >= start_date,
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
                PaymentVerification.verified_at >= start_date,
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
            .filter(PaymentVerification.gym_id == gym_id)
            .scalar()
        )

        # Renewals
        renewals_completed = (
            db.session.query(func.count(RenewalHistory.id))
            .filter(
                RenewalHistory.gym_id == gym_id,
                RenewalHistory.created_at >= start_date,
            )
            .scalar() or 0
        )

        # WhatsApp
        reminders_sent = (
            db.session.query(func.count(ReminderLog.id))
            .filter(
                ReminderLog.gym_id == gym_id,
                ReminderLog.status == "sent",
                ReminderLog.created_at >= start_date,
            )
            .scalar() or 0
        )
        reminders_failed = (
            db.session.query(func.count(ReminderLog.id))
            .filter(
                ReminderLog.gym_id == gym_id,
                ReminderLog.status == "failed",
                ReminderLog.created_at >= start_date,
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
                },
                "renewals": {
                    "completed": renewals_completed,
                },
                "whatsapp": {
                    "sent": reminders_sent,
                    "failed": reminders_failed,
                },
            },
        })
