from __future__ import annotations

from datetime import date, datetime, timedelta, timezone as tz
import logging
import time
import zoneinfo

from flask import current_app
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
from app.models.gym import DEFAULT_WHATSAPP_RENEWAL_REMINDER_TEMPLATE
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.services.whatsapp_template_service import render_message_template
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
        .filter(Member.whatsapp_opted_in.is_(True))
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


def auto_expire_members_for_gym(gym: Gym) -> int:
    local_today = today_for_gym(gym.timezone or "Asia/Kolkata")
    expired_members = (
        Member.query.filter(
            Member.gym_id == gym.id,
            Member.membership_end < local_today,
            Member.status == "active",
            Member.deleted_at.is_(None),
        )
        .with_for_update()
        .order_by(Member.id.asc())
        .all()
    )
    for member in expired_members:
        member.status = "expired"
        audit(
            action="auto_expired",
            resource_type="member",
            resource_id=member.id,
            gym_id=gym.id,
            metadata={"membership_end": str(member.membership_end)},
        )
    if expired_members:
        invalidate_dashboard_cache(gym.id)
    return len(expired_members)


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
        message_body=DEFAULT_WHATSAPP_RENEWAL_REMINDER_TEMPLATE,
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


def _combine_send_errors(image_error: str | None, text_error: str | None) -> str:
    if image_error and text_error:
        return f"Image send failed: {image_error}; text fallback failed: {text_error}"[:500]
    return (text_error or image_error or "Unknown error")[:500]


def _template_body_parameters(context: dict[str, object]) -> list[str]:
    configured_params = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_BODY_PARAMS", [])
    return [str(context.get(param_name, "")) for param_name in configured_params]


def _template_context(gym: Gym, member: Member) -> dict[str, object]:
    qr_settings = QRSettings.query.filter_by(gym_id=gym.id).first()
    expiry_date = member.membership_end.strftime("%d %b %Y")
    days_left = (member.membership_end - today_for_gym(gym.timezone)).days
    return {
        "gym_name": gym.name,
        "member_name": member.full_name,
        "expiry_date": expiry_date,
        "days_left": days_left,
        "payment_upi_id": (qr_settings.upi_id if qr_settings else "") or "",
    }


def send_template_fallback_for_reengagement(
    log: ReminderLog,
    *,
    original_error: str | None = None,
) -> bool:
    template_name = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_NAME", "")
    if not template_name:
        return False

    member = log.member
    gym = Gym.query.filter_by(id=log.gym_id).first()
    if not member or not gym or not gym.whatsapp_enabled or not gym.phone_number_id:
        return False

    result = WhatsAppService(gym).send_template(
        to=log.phone_snapshot,
        template_name=template_name,
        language_code=current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_LANGUAGE", "en_US"),
        body_parameters=_template_body_parameters(_template_context(gym, member)),
    )
    if result.ok:
        log.status = "sent"
        log.sent_at = utcnow()
        log.provider_message_id = result.provider_message_id
        log.error_message = None
        _logger.warning(
            "WhatsApp template fallback sent after re-engagement failure log=%s gym=%s provider_id=%s",
            log.id,
            log.gym_id,
            result.provider_message_id,
        )
        return True

    log.status = "failed"
    log.provider_message_id = result.provider_message_id or log.provider_message_id
    log.error_message = (
        f"{original_error or 'Re-engagement message'}; "
        f"template fallback failed: {result.error or 'Unknown error'}"
    )[:500]
    _logger.warning(
        "WhatsApp template fallback failed after re-engagement failure log=%s gym=%s error=%s",
        log.id,
        log.gym_id,
        log.error_message,
    )
    return True


def _send_whatsapp_message(
    whatsapp: WhatsAppService,
    *,
    to: str,
    message: str,
    qr_url: str | None,
    template_context: dict[str, object],
) -> WhatsAppResult:
    session_result = _send_session_message(whatsapp, to=to, message=message, qr_url=qr_url)
    if session_result.ok:
        return session_result

    template_name = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_NAME", "")
    if template_name:
        template_result = whatsapp.send_template(
            to=to,
            template_name=template_name,
            language_code=current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_LANGUAGE", "en_US"),
            body_parameters=_template_body_parameters(template_context),
        )
        if template_result.ok:
            _logger.warning(
                "WhatsApp settings reminder failed for %s: %s; template fallback succeeded",
                to,
                session_result.error or "Unknown error",
            )
            return template_result
        _logger.warning(
            "WhatsApp settings reminder failed for %s: %s; template fallback also failed: %s",
            to,
            session_result.error or "Unknown error",
            template_result.error or "Unknown error",
        )
        return WhatsAppResult(
            ok=False,
            provider_message_id=(
                template_result.provider_message_id or session_result.provider_message_id
            ),
            error=(
                f"WhatsApp Settings message failed: {session_result.error or 'Unknown error'}; "
                f"template fallback failed: {template_result.error or 'Unknown error'}"
            )[:500],
        )

    _logger.warning(
        "WhatsApp settings reminder failed for %s and no template fallback is configured: %s",
        to,
        session_result.error or "Unknown error",
    )
    return session_result


def _send_session_message(
    whatsapp: WhatsAppService,
    *,
    to: str,
    message: str,
    qr_url: str | None,
) -> WhatsAppResult:
    if not qr_url:
        return whatsapp.send_text(to=to, body=message)

    image_result = whatsapp.send_image(to=to, image_url=qr_url, caption=message)
    if image_result.ok:
        return image_result

    _logger.warning(
        "WhatsApp image reminder failed for %s; falling back to text: %s",
        to,
        image_result.error or "Unknown error",
    )
    text_result = whatsapp.send_text(to=to, body=message)
    if text_result.ok:
        return text_result

    return WhatsAppResult(
        ok=False,
        provider_message_id=text_result.provider_message_id or image_result.provider_message_id,
        error=_combine_send_errors(image_result.error, text_result.error),
    )


def send_reminder(log: ReminderLog, *, force: bool = False) -> ReminderLog:
    if log.status == "sent" and not force:
        return log
    if log.attempts >= MAX_REMINDER_ATTEMPTS and not force:
        raise ValueError(
            f"Reminder {log.id} has reached the maximum of "
            f"{MAX_REMINDER_ATTEMPTS} attempts."
        )

    member = log.member
    if member.gym_id != log.gym_id:
        raise ValueError("Reminder tenant does not match member tenant.")
    if not member.whatsapp_opted_in:
        raise ValueError("Member has not opted in to WhatsApp reminders.")

    gym = Gym.query.filter_by(id=log.gym_id).first()
    if not gym or not gym.whatsapp_enabled or not gym.phone_number_id:
        raise ValueError("WhatsApp is not configured and enabled for this gym.")

    template_context = _template_context(gym, member)
    try:
        message = render_message_template(
            gym.renewal_reminder_template,
            **template_context,
        )
    except Exception:
        _logger.exception("Could not render renewal reminder template for gym %s", gym.id)
        message = render_message_template(
            DEFAULT_WHATSAPP_RENEWAL_REMINDER_TEMPLATE,
            **template_context,
        )

    qr_url = resolve_qr_url(member.gym_id)
    whatsapp = WhatsAppService(gym)
    log.attempts += 1
    log.message_snapshot = message
    log.provider_message_id = None
    try:
        result = _send_whatsapp_message(
            whatsapp,
            to=log.phone_snapshot,
            message=message,
            qr_url=qr_url,
            template_context=template_context,
        )
    except Exception as exc:
        result = WhatsAppResult(ok=False, error=str(exc)[:200], provider_message_id=None)

    if result.ok:
        log.status = "sent"
        log.sent_at = utcnow()
        log.provider_message_id = result.provider_message_id
        log.error_message = None
    else:
        log.status = "failed"
        log.provider_message_id = result.provider_message_id
        log.error_message = (result.error or "Unknown error")[:500]
        _logger.warning(
            "WhatsApp reminder failed log=%s gym=%s member=%s phone=%s attempts=%s error=%s",
            log.id,
            log.gym_id,
            member.id,
            log.phone_snapshot,
            log.attempts,
            log.error_message,
        )
    invalidate_dashboard_cache(log.gym_id)
    return log


def run_due_reminders_for_gym(
    gym_id: int,
    days_before_values: list[int],
    gym_timezone: str = "Asia/Kolkata",
) -> dict:
    counts = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    gym = Gym.query.filter_by(id=gym_id).first()
    if (
        not gym
        or not gym.is_operational()
        or not gym.whatsapp_enabled
        or not gym.phone_number_id
    ):
        return counts

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
                time.sleep(0.05)
            except Exception:
                db.session.rollback()
                _logger.exception("Failed reminder for member %s in gym %s", member_id, gym_id)
                counts["failed"] += 1

    return counts
