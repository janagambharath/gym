"""Mobile API dashboard endpoint."""
from __future__ import annotations

from flask import current_app, g, jsonify

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member
from app.services.analytics_service import gym_dashboard_stats, gym_revenue_breakdown
from app.services.timezone_service import today_for_gym
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
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        stats = gym_dashboard_stats(g.gym_id, gym_timezone)
        # Ensure Decimal values are serialized as strings for JSON safety.
        collected = stats.get("collected", 0)
        if hasattr(collected, "is_finite"):
            collected = str(collected)
        else:
            collected = str(collected)

        # Revenue breakdown (today / week / month).
        try:
            revenue = gym_revenue_breakdown(g.gym_id, gym_timezone)
        except Exception:
            revenue = {"revenue_today": "0", "revenue_week": "0", "revenue_month": "0"}

        # Expiring today count.
        today = today_for_gym(gym_timezone)
        try:
            expiring_today = (
                Member.query.filter_by(gym_id=g.gym_id, status="active")
                .filter(Member.deleted_at.is_(None))
                .filter(Member.membership_end == today)
                .count()
            )
        except Exception:
            expiring_today = 0

        # Inbound Leads & Bot Handovers summary
        bot_summary = {
            "handover_count": 0,
            "total_leads": 0,
            "new_leads": 0,
            "trial_requests": 0,
            "recent_handovers": [],
        }
        try:
            from app.models.bot import BotConversation, BotLead, BotMessage
            handover_convs = (
                BotConversation.query.filter_by(gym_id=g.gym_id, handover_status="human_requested")
                .order_by(BotConversation.last_message_at.desc())
                .all()
            )
            bot_summary["handover_count"] = len(handover_convs)
            bot_summary["total_leads"] = BotLead.query.filter_by(gym_id=g.gym_id).count()
            bot_summary["new_leads"] = BotLead.query.filter_by(gym_id=g.gym_id, status="new").count()
            bot_summary["trial_requests"] = BotLead.query.filter_by(gym_id=g.gym_id, trial_requested=True).count()

            recent_list = []
            for c in handover_convs[:3]:
                last_msg = (
                    BotMessage.query.filter_by(conversation_id=c.id)
                    .order_by(BotMessage.created_at.desc())
                    .first()
                )
                recent_list.append({
                    "id": c.id,
                    "phone": c.phone,
                    "customer_name": c.customer_name or f"+{c.phone}",
                    "state": c.state,
                    "handover_status": c.handover_status,
                    "last_message": last_msg.body if last_msg else "Requested staff handover",
                    "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
                })
            bot_summary["recent_handovers"] = recent_list
        except Exception:
            current_app.logger.warning("Could not load bot summary for dashboard gym=%s", g.gym_id)

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
                "bot_summary": bot_summary,
            },
        })
        resp.headers["Cache-Control"] = "no-store"
        return resp

