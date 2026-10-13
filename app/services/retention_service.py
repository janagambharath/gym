"""RRR Retention Nudges — automated WhatsApp for at-risk members.

Three triggers, all driven by the same RRR signals the dashboard shows:
1. retention_no_visit — active member, no attendance for 14+ days ("we miss you")
2. retention_attendance_drop — attendance down 50%+ vs prior 14 days
3. retention_winback — recently expired member, 3-message sequence over 2 weeks

Each nudge is sent at most once per member per trigger (dedupe via ReminderLog).
Gym owners can customize the message via NotificationTemplate (trigger column).
"""
from __future__ import annotations

from datetime import timedelta
import logging

from app.extensions import db
from app.models import Gym, Member, NotificationTemplate, ReminderLog
from app.services.rrr_service import rules_for_gym
from app.services.timezone_service import today_for_gym
from app.services.whatsapp_service import WhatsAppService
from app.services.whatsapp_template_service import render_message_template

_logger = logging.getLogger(__name__)


# ─── Default templates ───────────────────────────────────────────────────

DEFAULT_TEMPLATES = {
    "retention_no_visit": (
        "Hi {member_name}! We miss you at {gym_name} \U0001f4aa\n\n"
        "It's been a while since your last workout. Everything okay?\n"
        "Your fitness journey matters to us — drop in anytime, we're here to help you stay on track!"
    ),
    "retention_attendance_drop": (
        "Hi {member_name}! Noticed you've been coming in less often at {gym_name}.\n\n"
        "We wanted to check in — is there anything we can do to help you get back to your routine? "
        "Your progress matters to us \U0001f4aa"
    ),
    "retention_winback_1": (
        "Hi {member_name}! Your membership at {gym_name} recently ended.\n\n"
        "We'd love to have you back! Your fitness goals are still within reach. "
        "Reply to this message and we'll help you get restarted."
    ),
    "retention_winback_2": (
        "Hi {member_name}, just checking in from {gym_name}.\n\n"
        "It's been a week since your membership ended. Many of our members find that "
        "getting back into routine is easier than they expect. Want to talk about options?"
    ),
    "retention_winback_3": (
        "Hi {member_name}! Last call from {gym_name} \U0001f3af\n\n"
        "We have a special rejoin offer waiting for you. Don't let your progress slip away — "
        "reply YES and we'll set everything up for you."
    ),
}

# Win-back schedule: days after expiry for each message
WINBACK_SCHEDULE = {
    "retention_winback_1": 3,
    "retention_winback_2": 7,
    "retention_winback_3": 14,
}


def ensure_retention_template(gym_id: int, trigger: str) -> NotificationTemplate:
    """Get or create the template for a retention trigger."""
    template = (
        NotificationTemplate.query.filter_by(
            gym_id=gym_id, trigger=trigger, is_active=True
        ).first()
    )
    if template:
        return template
    template = NotificationTemplate(
        gym_id=gym_id,
        name=f"Retention: {trigger}",
        channel="whatsapp",
        trigger=trigger,
        days_before=0,
        message_body=DEFAULT_TEMPLATES[trigger],
        is_active=True,
    )
    db.session.add(template)
    db.session.flush()
    return template


def _already_sent(gym_id: int, member_id: int, trigger: str) -> bool:
    """Check if this retention nudge was already sent to this member."""
    return (
        db.session.query(ReminderLog.id)
        .join(NotificationTemplate, ReminderLog.template_id == NotificationTemplate.id)
        .filter(
            NotificationTemplate.gym_id == gym_id,
            NotificationTemplate.trigger == trigger,
            ReminderLog.member_id == member_id,
            ReminderLog.status == "sent",
        )
        .first()
        is not None
    )


def _send_nudge(
    gym: Gym,
    member: Member,
    trigger: str,
    gym_timezone: str,
) -> bool:
    """Send a single retention nudge. Returns True if sent."""
    if _already_sent(gym.id, member.id, trigger):
        return False

    try:
        template = ensure_retention_template(gym.id, trigger)
        db.session.commit()
    except Exception:
        db.session.rollback()
        _logger.exception("Failed to resolve retention template %s for gym %s", trigger, gym.id)
        return False

    try:
        message = render_message_template(
            template.message_body,
            gym_name=gym.name,
            member_name=member.full_name or "there",
            expiry_date=member.membership_end.strftime("%d %b %Y") if member.membership_end else "",
        )
        service = WhatsAppService(gym)
        result = service.send_text(member.phone, message)

        log = ReminderLog(
            gym_id=gym.id,
            member_id=member.id,
            template_id=template.id,
            channel="whatsapp",
            status="sent" if result.ok else "failed",
            error=result.error if not result.ok else None,
        )
        db.session.add(log)
        db.session.commit()
        return result.ok
    except Exception:
        db.session.rollback()
        _logger.exception("Failed to send retention nudge %s to member %s", trigger, member.id)
        return False


def _last_visit_map(gym_id: int) -> dict[int, object]:
    """Map member_id -> last attendance datetime."""
    from app.models import Attendance
    from sqlalchemy import func

    rows = (
        db.session.query(
            Attendance.member_id,
            func.max(Attendance.punch_time).label("last_visit"),
        )
        .filter(Attendance.gym_id == gym_id)
        .group_by(Attendance.member_id)
        .all()
    )
    return {r.member_id: r.last_visit for r in rows}


def run_retention_nudges_for_gym(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Run all three retention nudges for a gym. Called by the scheduler."""
    counts = {"no_visit": 0, "attendance_drop": 0, "winback": 0, "skipped": 0}
    gym = Gym.query.filter_by(id=gym_id).first()
    if not gym or not gym.is_operational() or not gym.whatsapp_enabled or not gym.phone_number_id:
        return counts

    rules = rules_for_gym(gym_id)
    local_today = today_for_gym(gym_timezone)
    last_visit = _last_visit_map(gym_id)

    # ── 1. We miss you: no visit for no_visit_days ──
    no_visit_threshold = rules.get("no_visit_days", 14)
    active_members = (
        Member.query.filter_by(gym_id=gym_id, status="active")
        .filter(Member.deleted_at.is_(None))
        .all()
    )
    for member in active_members:
        visit = last_visit.get(member.id)
        if visit is None:
            days_since = 999  # Never visited
        else:
            # visit may be datetime; compare dates
            visit_date = visit.date() if hasattr(visit, "date") else visit
            days_since = (local_today - visit_date).days
        if days_since >= no_visit_threshold:
            if _send_nudge(gym, member, "retention_no_visit", gym_timezone):
                counts["no_visit"] += 1
            else:
                counts["skipped"] += 1

    # ── 2. Attendance drop: 50%+ decline vs prior 14 days ──
    # (Uses the same logic as rrr_service opportunity detection)
    from app.models import Attendance
    from datetime import datetime, timezone as tz

    now_utc = datetime.now(tz=tz.utc)
    recent_start = now_utc - timedelta(days=14)
    baseline_start = now_utc - timedelta(days=28)

    recent_counts: dict[int, int] = {}
    baseline_counts: dict[int, int] = {}
    for row in (
        db.session.query(Attendance.member_id, Attendance.punch_time)
        .filter(
            Attendance.gym_id == gym_id,
            Attendance.punch_time >= baseline_start,
        )
        .all()
    ):
        # Normalize to date for day-level dedup
        punch = row.punch_time
        if punch >= recent_start:
            recent_counts[row.member_id] = recent_counts.get(row.member_id, 0) + 1
        else:
            baseline_counts[row.member_id] = baseline_counts.get(row.member_id, 0) + 1

    drop_threshold = rules.get("attendance_drop_percent", 50)
    for member in active_members:
        baseline = baseline_counts.get(member.id, 0)
        if baseline < 2:
            continue  # Skip sparse histories (same as rrr_service)
        recent = recent_counts.get(member.id, 0)
        decline = round((baseline - recent) / baseline * 100)
        if decline >= drop_threshold:
            if _send_nudge(gym, member, "retention_attendance_drop", gym_timezone):
                counts["attendance_drop"] += 1
            else:
                counts["skipped"] += 1

    # ── 3. Win-back sequence for recently expired ──
    recent_expiry_days = rules.get("recent_expiry_days", 30)
    for trigger, days_after in WINBACK_SCHEDULE.items():
        target_date = local_today - timedelta(days=days_after)
        expired_members = (
            Member.query.filter_by(gym_id=gym_id)
            .filter(Member.deleted_at.is_(None))
            .filter(Member.membership_end == target_date)
            .all()
        )
        for member in expired_members:
            # Only win back if they haven't renewed
            if member.status == "active":
                continue
            if _send_nudge(gym, member, trigger, gym_timezone):
                counts["winback"] += 1
            else:
                counts["skipped"] += 1

    return counts
