from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from flask import Blueprint, flash, redirect, render_template, request, url_for, jsonify
from flask_login import current_user, login_required
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import (
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    Gym,
    Member,
    MembershipPlan,
    PaymentVerification,
    ReminderLog,
    RenewalHistory,
)
from app.models.bot import BotConversation, BotLead, GymBotConfig
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.utils.decorators import active_gym_required, roles_required


operations_bp = Blueprint("operations", __name__, url_prefix="/operations")


@operations_bp.route("/issues")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def issues():
    gym_id = current_user.gym_id
    issues_list = []

    # 1. Failed WhatsApp Reminders
    failed_reminders = (
        ReminderLog.query.filter_by(gym_id=gym_id, status="failed")
        .options(joinedload(ReminderLog.member))
        .order_by(ReminderLog.created_at.desc())
        .limit(20)
        .all()
    )
    for rem in failed_reminders:
        issues_list.append({
            "category": "WhatsApp",
            "level": "warning",
            "title": "WhatsApp Reminder Delivery Failed",
            "description": rem.error_message or "Failed to deliver WhatsApp reminder to member.",
            "resource": rem.member.full_name if rem.member else "Unknown Member",
            "time": rem.created_at,
            "action_url": url_for("reminders.resend", reminder_id=rem.id),
            "action_label": "Resend Reminder",
            "action_method": "POST",
        })

    # 2. Failed Biometric Commands
    failed_commands = (
        BridgeCommand.query.filter_by(gym_id=gym_id, status="failed")
        .options(joinedload(BridgeCommand.member))
        .order_by(BridgeCommand.created_at.desc())
        .limit(20)
        .all()
    )
    for cmd in failed_commands:
        issues_list.append({
            "category": "Biometric",
            "level": "danger",
            "title": f"Biometric Sync Failed: {cmd.command_type.replace('_', ' ').title()}",
            "description": cmd.last_error or "Hardware terminal rejected command or was unreachable.",
            "resource": cmd.member_name or (cmd.member.full_name if cmd.member else f"Enroll #{cmd.enroll_number}"),
            "time": cmd.created_at,
            "action_url": url_for("biometric.retry_command", command_id=cmd.id),
            "action_label": "Retry Sync",
            "action_method": "POST",
        })

    # 3. Offline Bridge Check
    installation = BridgeInstallation.query.filter_by(gym_id=gym_id).first()
    if installation:
        hb = installation.last_heartbeat_at
        is_offline = True
        if hb:
            if hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            is_offline = (utcnow() - hb).total_seconds() > 120

        if is_offline or not installation.is_active:
            issues_list.append({
                "category": "Hardware",
                "level": "danger",
                "title": "Biometric Bridge Offline",
                "description": f"No heartbeat received from gym laptop. Last seen: {installation.last_heartbeat_at.strftime('%d %b %H:%M') if installation.last_heartbeat_at else 'Never'}.",
                "resource": installation.display_name or "Gym PC Bridge",
                "time": installation.last_heartbeat_at or installation.created_at,
                "action_url": url_for("biometric.index"),
                "action_label": "Check Bridge",
                "action_method": "GET",
            })

    # 4. Pending Unverified Payments
    pending_payments = (
        PaymentVerification.query.filter_by(gym_id=gym_id, status="pending")
        .options(joinedload(PaymentVerification.member))
        .order_by(PaymentVerification.created_at.asc())
        .limit(10)
        .all()
    )
    for pmt in pending_payments:
        issues_list.append({
            "category": "Payment",
            "level": "info",
            "title": f"Unverified Payment: ₹{pmt.amount}",
            "description": f"Payment recorded via {pmt.payment_mode.upper()} awaiting verification.",
            "resource": pmt.member.full_name if pmt.member else "Unknown",
            "time": pmt.created_at,
            "action_url": url_for("payments.verify", payment_id=pmt.id),
            "action_label": "Verify Payment",
            "action_method": "POST",
        })

    return render_template("operations/issues.html", issues=issues_list)


@operations_bp.route("/reports")
@login_required
@active_gym_required
@roles_required("gym_owner")
def reports():
    gym_id = current_user.gym_id
    today = date.today()

    # 1. Total Recovered Verified Revenue This Month
    first_of_month = today.replace(day=1)
    monthly_verified_revenue = (
        db.session.query(func.coalesce(func.sum(PaymentVerification.amount), 0))
        .filter(
            PaymentVerification.gym_id == gym_id,
            PaymentVerification.status == "verified",
            PaymentVerification.paid_on >= first_of_month,
        )
        .scalar()
        or 0
    )

    # 2. Total Verified Revenue All Time
    total_verified_revenue = (
        db.session.query(func.coalesce(func.sum(PaymentVerification.amount), 0))
        .filter(
            PaymentVerification.gym_id == gym_id,
            PaymentVerification.status == "verified",
        )
        .scalar()
        or 0
    )

    # 3. Renewal Funnel Stats
    total_active_members = Member.query.filter_by(gym_id=gym_id, status="active", deleted_at=None).count()
    expiring_soon_count = (
        Member.query.filter_by(gym_id=gym_id, status="active", deleted_at=None)
        .filter(Member.membership_end >= today, Member.membership_end <= today + timedelta(days=7))
        .count()
    )
    reminders_sent_month = (
        ReminderLog.query.filter_by(gym_id=gym_id, status="sent")
        .filter(ReminderLog.created_at >= first_of_month)
        .count()
    )
    renewals_month_count = (
        RenewalHistory.query.filter_by(gym_id=gym_id)
        .filter(RenewalHistory.created_at >= first_of_month)
        .count()
    )

    # 4. Lead Funnel Stats
    total_inbound_leads = BotLead.query.filter_by(gym_id=gym_id).count()
    trial_bookings = BotLead.query.filter_by(gym_id=gym_id, status="trial_booked").count()
    converted_leads = BotLead.query.filter_by(gym_id=gym_id, status="converted").count()

    # 5. Biometric Sync Stats
    installation = BridgeInstallation.query.filter_by(gym_id=gym_id).first()
    biometric_synced_count = 0
    biometric_failed_count = 0
    today_punches = 0
    if installation:
        biometric_synced_count = BridgeCommand.query.filter_by(bridge_id=installation.id, status="acked").count()
        biometric_failed_count = BridgeCommand.query.filter_by(bridge_id=installation.id, status="failed").count()
        today_punches = BridgeAttendance.query.filter_by(bridge_id=installation.id).filter(BridgeAttendance.received_at >= first_of_month).count()

    return render_template(
        "operations/reports.html",
        monthly_verified_revenue=monthly_verified_revenue,
        total_verified_revenue=total_verified_revenue,
        total_active_members=total_active_members,
        expiring_soon_count=expiring_soon_count,
        reminders_sent_month=reminders_sent_month,
        renewals_month_count=renewals_month_count,
        total_inbound_leads=total_inbound_leads,
        trial_bookings=trial_bookings,
        converted_leads=converted_leads,
        biometric_synced_count=biometric_synced_count,
        biometric_failed_count=biometric_failed_count,
        today_punches=today_punches,
    )


@operations_bp.route("/search")
@login_required
@active_gym_required
def search():
    gym_id = current_user.gym_id
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify({"members": [], "payments": [], "leads": []})

    like_term = f"%{query}%"

    # Search Members
    members = (
        Member.query.filter_by(gym_id=gym_id, deleted_at=None)
        .filter(
            or_(
                Member.full_name.ilike(like_term),
                Member.phone.ilike(like_term),
                Member.device_enroll_number.ilike(like_term),
                Member.email.ilike(like_term),
            )
        )
        .limit(6)
        .all()
    )

    # Search Payments
    payments = (
        PaymentVerification.query.filter_by(gym_id=gym_id)
        .options(joinedload(PaymentVerification.member))
        .filter(
            or_(
                PaymentVerification.reference.ilike(like_term),
                func.cast(PaymentVerification.amount, db.String).ilike(like_term),
            )

        )
        .limit(6)
        .all()
    )

    # Search Leads
    leads = (
        BotLead.query.filter_by(gym_id=gym_id)
        .filter(or_(BotLead.name.ilike(like_term), BotLead.phone.ilike(like_term)))
        .limit(6)
        .all()
    )

    return jsonify({
        "members": [
            {
                "id": m.id,
                "name": m.full_name,
                "phone": m.phone,
                "status": m.status,
                "enroll_number": m.device_enroll_number or "—",
                "url": url_for("members.detail", member_id=m.id),
            }
            for m in members
        ],
        "payments": [
            {
                "id": p.id,
                "member_name": p.member.full_name if p.member else "Unknown",
                "amount": str(p.amount),
                "status": p.status,
                "reference": p.reference or "—",
                "url": url_for("payments.index"),
            }
            for p in payments
        ],
        "leads": [
            {
                "id": l.id,
                "name": l.name or l.phone,
                "phone": l.phone,
                "status": l.status,
                "url": url_for("bot_web.leads"),
            }
            for l in leads
        ],
    })
