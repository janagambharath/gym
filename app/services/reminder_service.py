from __future__ import annotations

from datetime import date, datetime, timedelta, timezone as tz
import zoneinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Gym, Member, NotificationTemplate, QRSettings, ReminderLog, RenewalHistory
from app.models.mixins import utcnow
from app.services.whatsapp_service import WhatsAppService
from app.utils.helpers import phone_to_whatsapp, signed_upload_url


def today_for_gym(gym_timezone: str) -> date:
    """Return the current calendar date in the gym's local timezone."""
    try:
        zone = zoneinfo.ZoneInfo(gym_timezone)
    except Exception:
        zone = zoneinfo.ZoneInfo("Asia/Kolkata")
    return datetime.now(tz=zone).date()


def stage_for_days(days_before: int) -> str:
    if days_before > 0:
        return f"{days_before}_days_before_expiry"
    if days_before == 0:
        return "expiry_day"
    return "overdue"


def due_members_for_gym(
    gym_id: int,
    days_before: int,
    gym_timezone: str = "Asia/Kolkata",
) -> list[Member]:
    target_date = today_for_gym(gym_timezone) + timedelta(days=days_before)
    already_renewed = select(RenewalHistory.member_id).where(
        RenewalHistory.gym_id == gym_id,
        RenewalHistory.previous_end == target_date,
    )
    return (
        Member.query.filter_by(gym_id=gym_id, status="active")
        .filter(Member.deleted_at.is_(None))
        .filter(Member.membership_end == target_date)
        .filter(~Member.id.in_(already_renewed))
        .all()
    )


def template_for(gym_id: int, days_before: int) -> NotificationTemplate | None:
    template = (
        NotificationTemplate.query.filter_by(
            gym_id=gym_id,
            trigger="expiry_reminder",
            channel="whatsapp",
            days_before=days_before,
            is_active=True,
        )
        .order_by(NotificationTemplate.id.desc())
        .first()
    )
    if template:
        return template
    return (
        NotificationTemplate.query.filter_by(
            gym_id=gym_id,
            trigger="expiry_reminder",
            channel="whatsapp",
            is_active=True,
        )
        .order_by(NotificationTemplate.days_before.asc())
        .first()
    )


def ensure_default_template(gym_id: int) -> NotificationTemplate:
    template = template_for(gym_id, 3)
    if template:
        return template
    template = NotificationTemplate(
        gym_id=gym_id,
        name="Default renewal reminder",
        days_before=3,
        message_body=(
            "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
            "{{ expiry_date }}. Please renew to keep access active."
        ),
    )
    db.session.add(template)
    db.session.flush()
    return template


def create_or_get_log(
    member: Member,
    template: NotificationTemplate,
    days_before: int,
    *,
    scheduled_for: date | None = None,
) -> ReminderLog:
    stage = stage_for_days(days_before)
    log = ReminderLog.query.filter_by(
        gym_id=member.gym_id,
        member_id=member.id,
        cycle_end_date=member.membership_end,
        reminder_stage=stage,
        channel="whatsapp",
    ).first()
    if log:
        return log

    log = ReminderLog(
        gym_id=member.gym_id,
        member_id=member.id,
        template_id=template.id,
        reminder_stage=stage,
        cycle_end_date=member.membership_end,
        scheduled_for=scheduled_for or today_for_gym("Asia/Kolkata"),
        phone_snapshot=phone_to_whatsapp(member.phone),
        status="pending",
    )
    db.session.add(log)
    try:
        db.session.flush()
    except IntegrityError as exc:
        db.session.rollback()
        log = ReminderLog.query.filter_by(
            gym_id=member.gym_id,
            member_id=member.id,
            cycle_end_date=member.membership_end,
            reminder_stage=stage,
            channel="whatsapp",
        ).first()
        if log is None:
            raise exc
    return log


def _resolve_qr_url(gym_id: int) -> str | None:
    qr = QRSettings.query.filter_by(gym_id=gym_id, is_active=True).first()
    if not qr:
        return None

    candidate = qr.qr_public_url or None
    if not candidate and qr.qr_image_path:
        if qr.qr_image_path.startswith(("http://", "https://")):
            candidate = qr.qr_image_path
        else:
            candidate = signed_upload_url(qr.qr_image_path)

    if not candidate:
        return None
    return candidate


def send_reminder(log: ReminderLog) -> ReminderLog:
    if log.status == "sent":
        return log

    member = log.member
    gym = db.session.get(Gym, member.gym_id)
    template = log.template or ensure_default_template(member.gym_id)
    message = template.render(
        gym_name=gym.name,
        member_name=member.full_name,
        expiry_date=member.membership_end.strftime("%d %b %Y"),
    )

    qr_url = _resolve_qr_url(member.gym_id)
    whatsapp = WhatsAppService()
    log.attempts += 1
    log.message_snapshot = message
    try:
        if qr_url:
            result = whatsapp.send_image(to=log.phone_snapshot, image_url=qr_url, caption=message)
        else:
            result = whatsapp.send_text(to=log.phone_snapshot, body=message)
    except Exception as exc:
        result = type(
            "Result", (), {"ok": False, "error": str(exc)[:200], "provider_message_id": None}
        )()

    if result.ok:
        log.status = "sent"
        log.sent_at = utcnow()
        log.provider_message_id = result.provider_message_id
        log.error_message = None
    else:
        log.status = "failed"
        log.error_message = (result.error or "Unknown error")[:500]
    return log


def run_due_reminders_for_gym(
    gym_id: int,
    days_before_values: list[int],
    gym_timezone: str = "Asia/Kolkata",
) -> dict:
    counts = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    import logging

    logger = logging.getLogger(__name__)
    local_today = today_for_gym(gym_timezone)

    for days_before in days_before_values:
        try:
            template = template_for(gym_id, days_before) or ensure_default_template(gym_id)
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.exception(
                "Failed to resolve template for gym %s days_before %s",
                gym_id,
                days_before,
            )
            continue

        members = due_members_for_gym(gym_id, days_before, gym_timezone)
        for member in members:
            member_id = member.id
            try:
                log = create_or_get_log(
                    member,
                    template,
                    days_before,
                    scheduled_for=local_today,
                )
                if log.status == "sent":
                    counts["skipped"] += 1
                    db.session.commit()
                    continue
                send_reminder(log)
                counts["queued"] += 1
                counts[log.status] = counts.get(log.status, 0) + 1
                db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception("Failed reminder for member %s in gym %s", member_id, gym_id)
                counts["failed"] += 1

    return counts
