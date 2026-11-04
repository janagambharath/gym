"""RRR Retention Nudges — automated WhatsApp for at-risk members.

Three triggers, all driven by the same RRR signals the dashboard shows:
1. retention_no_visit — active member, no attendance for 14+ days ("we miss you")
2. retention_attendance_drop — attendance down 50%+ vs prior 14 days
3. retention_winback — recently expired member, 3-message sequence over 2 weeks

Each nudge is sent at most once per member per trigger (dedupe via ReminderLog).
Gym owners can customize the message via NotificationTemplate (trigger column).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone as tz
import logging
from zoneinfo import ZoneInfo

from flask import current_app
from app.extensions import db
from app.models import AccessEvent, Gym, Member, NotificationTemplate, ReminderLog
from app.models.rrr import RRRAttendanceEvent
from app.services.rrr_service import attendance_visit_counts, rules_for_gym
from app.services.timezone_service import today_for_gym
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.services.whatsapp_template_service import render_message_template
from app.utils.helpers import phone_to_whatsapp

_logger = logging.getLogger(__name__)


# ─── Default templates ───────────────────────────────────────────────────

DEFAULT_TEMPLATES = {
    "retention_no_visit": (
        "Hi {{ member_name }}! We miss you at {{ gym_name }} \U0001f4aa\n\n"
        "It's been a while since your last workout. Everything okay?\n"
        "Your fitness journey matters to us — drop in anytime, we're here to help you stay on track!"
    ),
    "retention_attendance_drop": (
        "Hi {{ member_name }}! Noticed you've been coming in less often at {{ gym_name }}.\n\n"
        "We wanted to check in — is there anything we can do to help you get back to your routine? "
        "Your progress matters to us \U0001f4aa"
    ),
    "retention_winback_1": (
        "Hi {{ member_name }}! Your membership at {{ gym_name }} recently ended.\n\n"
        "We'd love to have you back! Your fitness goals are still within reach. "
        "Reply to this message and we'll help you get restarted."
    ),
    "retention_winback_2": (
        "Hi {{ member_name }}, just checking in from {{ gym_name }}.\n\n"
        "It's been a week since your membership ended. Many of our members find that "
        "getting back into routine is easier than they expect. Want to talk about options?"
    ),
    "retention_winback_3": (
        "Hi {{ member_name }}! Last call from {{ gym_name }} \U0001f3af\n\n"
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


def _retention_log(gym_id: int, member: Member, trigger: str) -> ReminderLog | None:
    """Return this trigger's log for the member's current membership cycle."""
    cycle_end = member.membership_end or member.membership_start
    return (
        ReminderLog.query
        .filter(
            ReminderLog.gym_id == gym_id,
            ReminderLog.member_id == member.id,
            ReminderLog.cycle_end_date == cycle_end,
            ReminderLog.reminder_stage == trigger,
            ReminderLog.channel == "whatsapp",
        )
        .first()
    )


def _send_nudge(
    gym: Gym,
    member: Member,
    trigger: str,
    gym_timezone: str,
) -> bool:
    """Send a single retention nudge. Returns True if sent."""
    # Retention messages are proactive marketing. Never send without the
    # member's recorded WhatsApp opt-in, even if the gym enabled WhatsApp.
    if not member.whatsapp_opted_in or not member.phone:
        return False

    try:
        template = ensure_retention_template(gym.id, trigger)
        db.session.commit()
    except Exception:
        db.session.rollback()
        _logger.exception("Failed to resolve retention template %s for gym %s", trigger, gym.id)
        return False

    try:
        # Older generated rows stored Python-style placeholders. Convert only
        # the supported token names so customized template wording survives a
        # deploy and does not send literal braces to members.
        template_body = template.message_body or ""
        for variable in ("member_name", "gym_name", "expiry_date", "days_left", "payment_upi_id"):
            template_body = template_body.replace(f"{{{variable}}}", f"{{{{ {variable} }}}}")
        message = render_message_template(
            template_body,
            gym_name=gym.name,
            member_name=member.full_name or "there",
            expiry_date=member.membership_end.strftime("%d %b %Y") if member.membership_end else "",
            days_left=(member.membership_end - today_for_gym(gym_timezone)).days if member.membership_end else 0,
        )
        log = _retention_log(gym.id, member, trigger)
        if log and log.status == "sent":
            return False
        if log is None:
            log = ReminderLog(
                gym_id=gym.id,
                member_id=member.id,
                template_id=template.id,
                channel="whatsapp",
                reminder_stage=trigger,
                cycle_end_date=member.membership_end or member.membership_start,
                scheduled_for=today_for_gym(gym_timezone),
                phone_snapshot=phone_to_whatsapp(member.phone),
            )
            db.session.add(log)
        log.template_id = template.id
        log.phone_snapshot = phone_to_whatsapp(member.phone)
        log.message_snapshot = message
        log.status = "sending"
        log.attempts = (log.attempts or 0) + 1
        db.session.commit()

        service = WhatsAppService(gym)
        template_name = current_app.config.get("WHATSAPP_RETENTION_TEMPLATE_NAME", "")
        if template_name:
            parameter_names = current_app.config.get(
                "WHATSAPP_RETENTION_TEMPLATE_BODY_PARAMS", ["member_name", "gym_name"]
            )
            context = {
                "member_name": member.full_name or "there",
                "gym_name": gym.name,
                "expiry_date": member.membership_end.strftime("%d %b %Y") if member.membership_end else "",
                "days_left": (member.membership_end - today_for_gym(gym_timezone)).days if member.membership_end else 0,
                "payment_upi_id": getattr(getattr(gym, "qr_settings", None), "upi_id", "") or "",
            }
            result = service.send_template(
                to=log.phone_snapshot,
                template_name=template_name,
                language_code=current_app.config.get("WHATSAPP_RETENTION_TEMPLATE_LANGUAGE", "en"),
                body_parameters=[str(context.get(name, "")) for name in parameter_names],
            )
            if not result.ok and member.has_open_whatsapp_session:
                result = service.send_text(to=log.phone_snapshot, body=message)
        elif member.has_open_whatsapp_session:
            result = service.send_text(to=log.phone_snapshot, body=message)
        else:
            result = WhatsAppResult(
                ok=False,
                error="No approved retention WhatsApp template is configured and the 24-hour reply window is closed.",
            )
        log.status = "sent" if result.ok else "failed"
        log.sent_at = datetime.now(tz=tz.utc) if result.ok else None
        log.provider_message_id = result.provider_message_id
        log.error_message = result.error if not result.ok else None
        db.session.commit()
        return result.ok
    except Exception:
        db.session.rollback()
        _logger.exception("Failed to send retention nudge %s to member %s", trigger, member.id)
        return False


def _last_visit_map(gym_id: int) -> dict[int, object]:
    """Map member_id -> last attendance datetime."""
    from sqlalchemy import func

    rows = (
        db.session.query(
            RRRAttendanceEvent.member_id,
            func.max(RRRAttendanceEvent.punch_time).label("last_visit"),
        )
        .filter(
            RRRAttendanceEvent.gym_id == gym_id,
            RRRAttendanceEvent.member_id.isnot(None),
        )
        .group_by(RRRAttendanceEvent.member_id)
        .all()
    )
    latest = {r.member_id: r.last_visit for r in rows}
    access_rows = (
        db.session.query(
            AccessEvent.member_id,
            func.max(AccessEvent.event_timestamp).label("last_visit"),
        )
        .filter(
            AccessEvent.gym_id == gym_id,
            AccessEvent.member_id.isnot(None),
            AccessEvent.event_type.in_(["ENTRY", "ATTENDANCE"]),
        )
        .group_by(AccessEvent.member_id)
        .all()
    )
    for row in access_rows:
        previous = latest.get(row.member_id)
        candidate_time = row.last_visit
        previous_time = previous
        if candidate_time is not None and candidate_time.tzinfo is None:
            candidate_time = candidate_time.replace(tzinfo=tz.utc)
        if previous_time is not None and previous_time.tzinfo is None:
            previous_time = previous_time.replace(tzinfo=tz.utc)
        if previous_time is None or (candidate_time is not None and candidate_time > previous_time):
            latest[row.member_id] = row.last_visit
    return latest


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
            # A newly enrolled member should not be labelled inactive before
            # their no-visit window has actually elapsed.
            days_since = max(0, (local_today - member.membership_start).days)
        else:
            if visit.tzinfo is None:
                visit = visit.replace(tzinfo=tz.utc)
            try:
                visit_date = visit.astimezone(ZoneInfo(gym_timezone or "Asia/Kolkata")).date()
            except Exception:
                visit_date = visit.astimezone(ZoneInfo("Asia/Kolkata")).date()
            days_since = (local_today - visit_date).days
        if days_since >= no_visit_threshold:
            if _send_nudge(gym, member, "retention_no_visit", gym_timezone):
                counts["no_visit"] += 1
            else:
                counts["skipped"] += 1

    # ── 2. Attendance drop: 50%+ decline vs prior 14 days ──
    # (Uses the same logic as rrr_service opportunity detection)
    visit_counts = attendance_visit_counts(
        gym_id, [member.id for member in active_members], gym_timezone, local_today
    )

    drop_threshold = rules.get("attendance_drop_percent", 50)
    for member in active_members:
        recent, baseline = visit_counts.get(member.id, (0, 0))
        if baseline < 2:
            continue  # Skip sparse histories (same as rrr_service)
        decline = round((baseline - recent) / baseline * 100)
        if decline >= drop_threshold:
            if _send_nudge(gym, member, "retention_attendance_drop", gym_timezone):
                counts["attendance_drop"] += 1
            else:
                counts["skipped"] += 1

    # ── 3. Win-back sequence for recently expired ──
    recent_expiry_days = rules.get("recent_expiry_days", 30)
    expired_members = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None))
        .filter(Member.membership_end < local_today)
        .filter(Member.membership_end >= local_today - timedelta(days=recent_expiry_days))
        .all()
    )
    for member in expired_members:
        # Send only the latest due stage. This catches a scheduler outage
        # without blasting all three messages on the next run. A stage's
        # ReminderLog prevents duplicate delivery on subsequent daily runs.
        days_expired = (local_today - member.membership_end).days
        due_stages = [
            (trigger, days_after)
            for trigger, days_after in WINBACK_SCHEDULE.items()
            if days_expired >= days_after
        ]
        if not due_stages:
            continue
        trigger, _days_after = due_stages[-1]
        if member.status == "active":
            continue
        if _send_nudge(gym, member, trigger, gym_timezone):
            counts["winback"] += 1
        else:
            counts["skipped"] += 1

    return counts
