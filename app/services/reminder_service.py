from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Gym, Member, NotificationTemplate, QRSettings, ReminderLog
from app.models.mixins import utcnow
from app.services.whatsapp_service import WhatsAppService
from app.utils.helpers import phone_to_whatsapp, public_upload_url


def stage_for_days(days_before: int) -> str:
    if days_before > 0:
        return f"{days_before}_days_before_expiry"
    if days_before == 0:
        return "expiry_day"
    return "overdue"


def due_members_for_gym(gym_id: int, days_before: int) -> list[Member]:
    target_date = date.today() + timedelta(days=days_before)
    return (
        Member.query.filter_by(gym_id=gym_id, status="active")
        .filter(Member.membership_end == target_date)
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


def create_or_get_log(member: Member, template: NotificationTemplate, days_before: int) -> ReminderLog:
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
        scheduled_for=date.today(),
        phone_snapshot=phone_to_whatsapp(member.phone),
        status="pending",
    )
    db.session.add(log)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        log = ReminderLog.query.filter_by(
            gym_id=member.gym_id,
            member_id=member.id,
            cycle_end_date=member.membership_end,
            reminder_stage=stage,
            channel="whatsapp",
        ).first()
    return log


def send_reminder(log: ReminderLog) -> ReminderLog:
    if log.status == "sent":
        return log

    member = log.member
    gym = Gym.query.get(member.gym_id)
    template = log.template or ensure_default_template(member.gym_id)
    message = template.render(
        gym_name=gym.name,
        member_name=member.full_name,
        expiry_date=member.membership_end.strftime("%d %b %Y"),
    )

    qr = QRSettings.query.filter_by(gym_id=member.gym_id, is_active=True).first()
    qr_url = qr.qr_public_url if qr and qr.qr_public_url else None
    if not qr_url and qr and qr.qr_image_path:
        qr_url = public_upload_url(qr.qr_image_path)

    whatsapp = WhatsAppService()
    log.attempts += 1
    log.message_snapshot = message
    try:
        if qr_url:
            result = whatsapp.send_image(to=log.phone_snapshot, image_url=qr_url, caption=message)
        else:
            result = whatsapp.send_text(to=log.phone_snapshot, body=message)
    except Exception as exc:
        result = type("Result", (), {"ok": False, "error": str(exc), "provider_message_id": None})()

    if result.ok:
        log.status = "sent"
        log.sent_at = utcnow()
        log.provider_message_id = result.provider_message_id
        log.error_message = None
    else:
        log.status = "failed"
        log.error_message = result.error
    return log


def run_due_reminders_for_gym(gym_id: int, days_before_values: list[int]) -> dict:
    counts = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    for days_before in days_before_values:
        template = template_for(gym_id, days_before) or ensure_default_template(gym_id)
        for member in due_members_for_gym(gym_id, days_before):
            log = create_or_get_log(member, template, days_before)
            if log.status == "sent":
                counts["skipped"] += 1
                continue
            send_reminder(log)
            counts["queued"] += 1
            counts[log.status] = counts.get(log.status, 0) + 1
    db.session.commit()
    return counts
