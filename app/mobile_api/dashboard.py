"""Mobile API dashboard endpoint."""
from __future__ import annotations

from datetime import date, timedelta

from flask import g, jsonify

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member
from app.services.analytics_service import gym_dashboard_stats, gym_revenue_breakdown
from sqlalchemy import text


def register_dashboard_routes(bp):
    @bp.route("/health", methods=["GET"])
    @limiter.exempt
    def mobile_health():
        try:
            db.session.execute(text("SELECT 1"))
            return jsonify({"success": True, "data": {"status": "ok", "api": "mobile/v1"}})
        except Exception:
            return jsonify({"success": False, "error": {"code": "DB_ERROR", "message": "Database unavailable."}}), 503

    @bp.route("/dashboard", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def dashboard():
        stats = gym_dashboard_stats(g.gym_id)
        # Ensure Decimal values are serialized as strings for JSON safety.
        collected = stats.get("collected", 0)
        if hasattr(collected, "is_finite"):
            collected = str(collected)
        else:
            collected = str(collected)

        # Revenue breakdown (today / week / month).
        try:
            revenue = gym_revenue_breakdown(g.gym_id)
        except Exception:
            revenue = {"revenue_today": "0", "revenue_week": "0", "revenue_month": "0"}

        # Expiring today count.
        today = date.today()
        try:
            expiring_today = (
                Member.query.filter_by(gym_id=g.gym_id, status="active")
                .filter(Member.deleted_at.is_(None))
                .filter(Member.membership_end == today)
                .count()
            )
        except Exception:
            expiring_today = 0

        resp = jsonify({
            "success": True,
            "data": {
                "total_active": stats.get("total_active", 0),
                "expiring_soon": stats.get("expiring_soon", 0),
                "expired": stats.get("expired", 0),
                "pending_payments": stats.get("pending_payments", 0),
                "sent_reminders": stats.get("sent_reminders", 0),
                "failed_reminders": stats.get("failed_reminders", 0),
                "total_collected": collected,
                "revenue_today": revenue.get("revenue_today", "0"),
                "revenue_week": revenue.get("revenue_week", "0"),
                "revenue_month": revenue.get("revenue_month", "0"),
                "expiring_today": expiring_today,
            },
        })
        resp.headers["Cache-Control"] = "no-store"
        return resp
