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
        collected = str(stats.get("collected", 0))

        revenue_at_risk_val = str(stats.get("revenue_at_risk", 0))

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

        # Revenue Recovered metrics
        revenue_recovered_data = None
        recovery_rate_data = None
        try:
            from app.services.revenue_service import revenue_recovered, recovery_rate as calc_recovery_rate
            revenue_recovered_data = revenue_recovered(g.gym_id, gym_timezone, period_days=30)
            recovery_rate_data = calc_recovery_rate(g.gym_id, gym_timezone)
        except Exception:
            current_app.logger.warning("Could not load revenue recovered for dashboard gym=%s", g.gym_id)

        # Today's Revenue Actions
        todays_actions = []
        try:
            from app.models.bot import BotLead

            if expiring_today > 0:
                todays_actions.append({
                    "type": "expiring_today",
                    "count": expiring_today,
                    "label": f"{expiring_today} membership{'s' if expiring_today != 1 else ''} expire today",
                    "action": "renewals",
                })

            pending_count = stats.get("pending_payments", 0)
            if pending_count > 0:
                todays_actions.append({
                    "type": "pending_payments",
                    "count": pending_count,
                    "label": f"{pending_count} payment confirmation{'s' if pending_count != 1 else ''} pending",
                    "action": "payments",
                })

            new_leads = BotLead.query.filter_by(gym_id=g.gym_id, status="new").count()
            if new_leads > 0:
                todays_actions.append({
                    "type": "new_leads",
                    "count": new_leads,
                    "label": f"{new_leads} lead{'s' if new_leads != 1 else ''} waiting for follow-up",
                    "action": "inbox",
                })
        except Exception:
            current_app.logger.warning("Could not compute today's actions for gym=%s", g.gym_id)

        # Latest campaign
        latest_campaign = None
        try:
            from app.models.campaign import Campaign
            campaign = (
                Campaign.query.filter_by(gym_id=g.gym_id)
                .filter(Campaign.status.in_(("sent", "completed")))
                .order_by(Campaign.sent_at.desc())
                .first()
            )
            if campaign:
                latest_campaign = {
                    "id": campaign.id,
                    "name": campaign.name,
                    "segment_type": campaign.segment_type,
                    "total_sent": campaign.total_sent,
                    "total_delivered": campaign.total_delivered,
                    "total_read": campaign.total_read,
                    "total_replied": campaign.total_replied,
                    "total_renewed": campaign.total_renewed,
                    "total_revenue_recovered": str(campaign.total_revenue_recovered),
                    "sent_at": campaign.sent_at.isoformat() if campaign.sent_at else None,
                }
        except Exception:
            current_app.logger.warning("Could not load latest campaign for dashboard gym=%s", g.gym_id)

        # Inbound Leads & Bot Handovers summary
        bot_summary = {
            "handover_count": 0,
            "total_leads": 0,
            "new_leads": 0,
            "trial_requests": 0,
            "recent_handovers": [],
        }
        try:
            from app.models.bot import BotConversation, BotLead as BotLeadModel, BotMessage
            handover_convs = (
                BotConversation.query.filter_by(gym_id=g.gym_id, handover_status="human_requested")
                .order_by(BotConversation.last_message_at.desc())
                .all()
            )
            bot_summary["handover_count"] = len(handover_convs)
            bot_summary["total_leads"] = BotLeadModel.query.filter_by(gym_id=g.gym_id).count()
            bot_summary["new_leads"] = BotLeadModel.query.filter_by(gym_id=g.gym_id, status="new").count()
            bot_summary["trial_requests"] = BotLeadModel.query.filter_by(gym_id=g.gym_id, trial_requested=True).count()

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

        # Live Access summary
        access_summary = None
        try:
            from app.services.access_event_service import get_access_summary
            access_summary = get_access_summary(g.gym_id, gym_timezone)
        except Exception:
            current_app.logger.warning("Could not load access summary for dashboard gym=%s", g.gym_id)

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
                "revenue_at_risk": revenue_at_risk_val,
                "revenue_today": revenue.get("revenue_today", "0"),
                "revenue_week": revenue.get("revenue_week", "0"),
                "revenue_month": revenue.get("revenue_month", "0"),
                "expiring_today": expiring_today,
                "revenue_recovered": revenue_recovered_data,
                "recovery_rate": recovery_rate_data,
                "todays_actions": todays_actions,
                "latest_campaign": latest_campaign,
                "bot_summary": bot_summary,
                "access_summary": access_summary,
            },
        })
        resp.headers["Cache-Control"] = "no-store"
        return resp


    @bp.route("/onboarding/progress", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def onboarding_progress():
        """Track new customer onboarding setup checklist progress ordered by Time to First Value."""
        from app.models import Member, MembershipPlan, PaymentVerification, RenewalHistory
        from app.models.bot import GymBotConfig

        gym = g.current_user.gym

        account_created = True
        members_imported = Member.query.filter_by(gym_id=gym.id).filter(Member.deleted_at.is_(None)).count() > 0
        plans_configured = MembershipPlan.query.filter_by(gym_id=gym.id, is_active=True).count() > 0
        first_renewal_completed = (
            RenewalHistory.query.filter_by(gym_id=gym.id).count() > 0
            or PaymentVerification.query.filter_by(gym_id=gym.id).count() > 0
        )
        whatsapp_connected = bool(gym.whatsapp_enabled and gym.phone_number_id)
        bot_configured = bool(
            GymBotConfig.query.filter_by(gym_id=gym.id).first()
            and (gym.address or gym.phone)
        )

        steps = [
            {"id": "members_imported", "title": "Add or Import Members", "completed": members_imported, "route": "Members"},
            {"id": "plans_configured", "title": "Confirm Membership Pricing Plans", "completed": plans_configured, "route": "Plans"},
            {"id": "first_renewal_completed", "title": "Record First Renewal or Payment", "completed": first_renewal_completed, "route": "Renewals"},
            {"id": "whatsapp_connected", "title": "Connect WhatsApp Business", "completed": whatsapp_connected, "route": "WhatsApp"},
            {"id": "bot_configured", "title": "Configure AI Receptionist", "completed": bot_configured, "route": "Bot"},
        ]

        completed_count = sum(1 for s in steps if s["completed"])
        total_count = len(steps)

        return jsonify({
            "success": True,
            "data": {
                "completed_count": completed_count,
                "total_count": total_count,
                "percentage": int((completed_count / total_count) * 100) if total_count > 0 else 100,
                "is_complete": completed_count == total_count,
                "steps": steps,
            },
        })


