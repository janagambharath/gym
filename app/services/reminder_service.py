from __future__ import annotations

from datetime import date, datetime, timedelta, timezone as tz
import logging
import zoneinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import (
    Gym,
    Member,
    NotificationTemplate,
    PaymentVerification,
    QRSettings,
    ReminderLog,
    RenewalHistory,
)
from app.models.mixins import utcnow
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.utils.helpers import normalize_public_media_url, phone_to_whatsapp, signed_upload_url


MAX_REMINDER_ATTEMPTS = 5
_logger = logging.getLogger(__name__)


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


def _due_members_query(gym_id: int, days_before: int, gym_timezone: str):
    target_date = today_for_gym(gym_timezone) + timedelta(days=days_before)
    already_renewed = select(RenewalHistory.member_id).where(
        RenewalHistory.gym_id == gym_id,
        RenewalHistory.previous_end == target_date,
    )
    recent_payment_cutoff = datetime.now(tz=tz.utc) - timedelta(days=7)
    already_paid = select(PaymentVerification.member_id).where(
        PaymentVerification.gym_id == gym_id,
        PaymentVerification.status == "verified",
        PaymentVerification.created_at >= recent_payment_cutoff,
    )
    return (
        Member.query.filter_by(gym_id=gym_id, status="active")
        .filter(Member.deleted_at.is_(None))
        .filter(Member.membership_end == target_date)
        .filter(~Member.id.in_(already_renewed))
        .filter(~Member.id.in_(already_paid))
    )


def due_members_for_gym(
    gym_id: int,
    days_before: int,
    gym_timezone: str = "Asia/Kolkata",
) -> list[Member]:
    return _due_members_query(gym_id, days_before, gym_timezone).order_by(Member.id.asc()).all()


def due_members_for_gym_batched(
    gym_id: int,
    days_before: int,
    gym_timezone: str = "Asia/Kolkata",
    batch_size: int = 100,
):
    last_id = 0
    while True:
        batch = (
            _due_members_query(gym_id, days_before, gym_timezone)
            .filter(Member.id > last_id)
            .order_by(Member.id.asc())
            .limit(batch_size)
            .all()
        )
        if not batch:
            break
        for member in batch:
            last_id = member.id
            yield member


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
    gym_timezone: str = "Asia/Kolkata",
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
        scheduled_for=scheduled_for or today_for_gym(gym_timezone),
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


def resolve_qr_url(gym_id: int) -> str | None:
    qr = QRSettings.query.filter_by(gym_id=gym_id, is_active=True).first()
    if not qr:
        return None

    candidate = normalize_public_media_url(qr.qr_public_url) or None
    if not candidate and qr.qr_image_path:
        if qr.qr_image_path.startswith(("http://", "https://")):
            candidate = qr.qr_image_path
        else:
            candidate = signed_upload_url(qr.qr_image_path)

    if not candidate:
        return None
    return candidate


def create_manual_test_log(
    member: Member,
    template: NotificationTemplate,
    *,
    gym_timezone: str = "Asia/Kolkata",
) -> ReminderLog:
    log = ReminderLog.query.filter_by(
        gym_id=member.gym_id,
        member_id=member.id,
        cycle_end_date=member.membership_end,
        reminder_stage="manual_test",
        channel="whatsapp",
    ).first()
    if log:
        return log

    log = ReminderLog(
        gym_id=member.gym_id,
        member_id=member.id,
        template_id=template.id,
        reminder_stage="manual_test",
        cycle_end_date=member.membership_end,
        scheduled_for=today_for_gym(gym_timezone),
        phone_snapshot=phone_to_whatsapp(member.phone),
        status="pending",
    )
    db.session.add(log)
    db.session.flush()
    return log


def send_reminder(log: ReminderLog, *, force: bool = False) -> ReminderLog:
    if log.status == "sent" and not force:
        return log
    if log.attempts >= MAX_REMINDER_ATTEMPTS and not force:
        raise ValueError(
            f"Reminder {log.id} has reached the maximum of "
            f"{MAX_REMINDER_ATTEMPTS} attempts."
        )

    member = log.member
    gym = db.session.get(Gym, member.gym_id)
    template = log.template or ensure_default_template(member.gym_id)
    message = template.render(
        gym_name=gym.name,
        member_name=member.full_name,
        expiry_date=member.membership_end.strftime("%d %b %Y"),
    )

    qr_url = resolve_qr_url(member.gym_id)
    whatsapp = WhatsAppService()
    log.attempts += 1
    log.message_snapshot = message
    try:
        if qr_url:
            result = whatsapp.send_image(to=log.phone_snapshot, image_url=qr_url, caption=message)
        else:
            result = whatsapp.send_text(to=log.phone_snapshot, body=message)
    except Exception as exc:
        result = WhatsAppResult(ok=False, error=str(exc)[:200], provider_message_id=None)

    if result.ok:
        log.status = "sent"
        log.sent_at = utcnow()
        log.provider_message_id = result.provider_message_id
        log.error_message = None
    else:
        log.status = "failed"
        log.error_message = (result.error or "Unknown error")[:500]
    invalidate_dashboard_cache(log.gym_id)
    return log


def run_due_reminders_for_gym(
    gym_id: int,
    days_before_values: list[int],
    gym_timezone: str = "Asia/Kolkata",
) -> dict:
    counts = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    local_today = today_for_gym(gym_timezone)

    for days_before in days_before_values:
        try:
            template = template_for(gym_id, days_before) or ensure_default_template(gym_id)
            db.session.commit()
        except Exception:
            db.session.rollback()
            _logger.exception(
                "Failed to resolve template for gym %s days_before %s",
                gym_id,
                days_before,
            )
            continue

        for member in due_members_for_gym_batched(gym_id, days_before, gym_timezone):
            member_id = member.id
            try:
                log = create_or_get_log(
                    member,
                    template,
                    days_before,
                    scheduled_for=local_today,
                    gym_timezone=gym_timezone,
                )
                if log.status == "sent":
                    counts["skipped"] += 1
                    db.session.commit()
                    db.session.expire_all()
                    continue
                send_reminder(log)
                counts["queued"] += 1
                counts[log.status] = counts.get(log.status, 0) + 1
                db.session.commit()
                db.session.expire_all()
            except Exception:
                db.session.rollback()
                _logger.exception("Failed reminder for member %s in gym %s", member_id, gym_id)
                counts["failed"] += 1

    return counts
