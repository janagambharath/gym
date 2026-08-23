"""Mobile API dashboard endpoint."""
from __future__ import annotations

from flask import g, jsonify

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.services.analytics_service import gym_dashboard_stats
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
            },
        })
        resp.headers["Cache-Control"] = "no-store"
        return resp
