from __future__ import annotations

import json
import logging
import threading
from datetime import timedelta

from flask import Flask, current_app
from sqlalchemy import func, or_

from app.extensions import db
from app.models import Announcement, AnnouncementDelivery, Gym, Member
from app.models.mixins import utcnow
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.services.whatsapp_template_service import render_message_template
from app.utils.helpers import phone_to_whatsapp


_logger = logging.getLogger(__name__)
_LEASE_SECONDS = 300
_MODES = {"session_message", "approved_template"}


def announcement_recipient_counts(gym_id: int) -> dict[str, int]:
    """Count people the dashboard can legally and technically message now."""

    members = _consented_members(gym_id)
    return {
        "consented": len(members),
        "open_session": sum(member.has_open_whatsapp_session for member in members),
        "not_consented": Member.query.filter(
            Member.gym_id == gym_id,
            Member.deleted_at.is_(None),
            Member.whatsapp_opted_in.is_(False),
        ).count(),
    }


def create_announcement(
    *,
    gym: Gym,
    actor_user_id: int,
    title: str,
    delivery_mode: str,
    message_body: str,
    template_name: str | None = None,
    template_language: str | None = None,
    template_body_parameters: list[str] | None = None,
    test_member_id: int | None = None,
) -> Announcement:
    """Persist a test or full announcement before any WhatsApp request is made.

    WhatsApp consent is deliberately a hard gate.  An approved Meta template
    lets a business contact a consented member outside the 24-hour service
    window; it is not permission to message someone who never opted in.
    """

    if delivery_mode not in _MODES:
        raise ValueError("Unsupported announcement delivery mode.")
    if not gym.whatsapp_enabled or not gym.phone_number_id:
        raise ValueError("Connect and enable this gym's WhatsApp Business number first.")

    candidates = _eligible_members(gym.id, delivery_mode)
    if test_member_id is not None:
        candidates = [member for member in candidates if member.id == test_member_id]
        if not candidates:
            if delivery_mode == "session_message":
                raise ValueError(
                    "That member is not eligible for a normal message. They need recorded consent and an open 24-hour WhatsApp chat."
                )
            raise ValueError(
                "That member is not eligible for a template message. Record their WhatsApp consent first."
            )

    deliveries: list[AnnouncementDelivery] = []
    for member in candidates:
        try:
            recipient_phone = phone_to_whatsapp(member.phone)
        except ValueError:
            # Imported legacy data can contain an invalid number.  It is not a
            # valid campaign recipient and is never handed to Meta.
            continue
        deliveries.append(
            AnnouncementDelivery(
                gym_id=gym.id,
                member_id=member.id,
                phone_snapshot=recipient_phone,
            )
        )

    if not deliveries:
        if delivery_mode == "session_message":
            raise ValueError(
                "No consented members currently have an open 24-hour WhatsApp chat. Use an approved Meta template after obtaining consent."
            )
        raise ValueError("No consented members with valid WhatsApp numbers are available.")

    announcement = Announcement(
        gym_id=gym.id,
        created_by_user_id=actor_user_id,
        title=title.strip(),
        message_body=(message_body or "").strip() or f"Approved Meta template: {template_name}",
        delivery_mode=delivery_mode,
        template_name=(template_name or "").strip() or None,
        template_language=(template_language or "").strip() or None,
        template_body_parameters=json.dumps(template_body_parameters or []),
        is_test=test_member_id is not None,
        total_recipients=len(deliveries),
        status="queued",
    )
    announcement.deliveries.extend(deliveries)
    db.session.add(announcement)
    db.session.flush()
    return announcement


def start_announcement_dispatch(app: Flask, announcement_id: int) -> None:
    """Start an isolated delivery worker after the announcement is committed."""

    def _run() -> None:
        with app.app_context():
            try:
                dispatch_announcement(announcement_id)
            except Exception:
                db.session.rollback()
                _logger.exception("Announcement delivery worker failed announcement=%s", announcement_id)
            finally:
                db.session.remove()

    threading.Thread(
        target=_run,
        name=f"whatsapp-announcement-{announcement_id}",
        daemon=True,
    ).start()


def dispatch_announcement(announcement_id: int) -> bool:
    """Deliver a queued announcement once, safely resumable after a restart."""

    if not _claim_announcement(announcement_id):
        return False

    while True:
        delivery = (
            AnnouncementDelivery.query.filter_by(
                announcement_id=announcement_id,
                status="pending",
            )
            .order_by(AnnouncementDelivery.id.asc())
            .first()
        )
        if delivery is None:
            break
        _deliver_one(delivery)

    _finish_announcement(announcement_id)
    return True


def resume_pending_announcements() -> int:
    """Resume work that was interrupted by a web-worker restart.

    This is called by the existing single-instance scheduler.  Sent deliveries
    are persisted individually, so resumed work cannot send them again.
    """

    now = utcnow()
    announcement_ids = [
        row[0]
        for row in Announcement.query.with_entities(Announcement.id)
        .filter(
            Announcement.status.in_(("queued", "sending")),
            or_(
                Announcement.dispatch_lease_expires_at.is_(None),
                Announcement.dispatch_lease_expires_at < now,
            ),
        )
        .order_by(Announcement.created_at.asc())
        .limit(10)
        .all()
    ]
    resumed = 0
    for announcement_id in announcement_ids:
        try:
            if dispatch_announcement(announcement_id):
                resumed += 1
        except Exception:
            db.session.rollback()
            _logger.exception("Could not resume announcement=%s", announcement_id)
    return resumed


def _consented_members(gym_id: int) -> list[Member]:
    return (
        Member.query.filter(
            Member.gym_id == gym_id,
            Member.deleted_at.is_(None),
            Member.whatsapp_opted_in.is_(True),
        )
        .order_by(Member.id.asc())
        .all()
    )


def _eligible_members(gym_id: int, delivery_mode: str) -> list[Member]:
    members = _consented_members(gym_id)
    if delivery_mode == "session_message":
        return [member for member in members if member.has_open_whatsapp_session]
    return members


def _claim_announcement(announcement_id: int) -> bool:
    now = utcnow()
    lease_expires = now + timedelta(seconds=_LEASE_SECONDS)
    claimed = (
        Announcement.query.filter(
            Announcement.id == announcement_id,
            Announcement.status.in_(("queued", "sending")),
            or_(
                Announcement.dispatch_lease_expires_at.is_(None),
                Announcement.dispatch_lease_expires_at < now,
            ),
        )
        .update(
            {
                Announcement.status: "sending",
                Announcement.dispatch_lease_expires_at: lease_expires,
                Announcement.started_at: func.coalesce(Announcement.started_at, now),
            },
            synchronize_session=False,
        )
    )
    db.session.commit()
    return claimed == 1


def _deliver_one(delivery: AnnouncementDelivery) -> None:
    announcement = delivery.announcement
    member = delivery.member
    gym = Gym.query.filter_by(id=announcement.gym_id).first()

    if not gym or not gym.is_operational() or not gym.whatsapp_enabled:
        _mark_delivery(delivery, status="failed", error="WhatsApp is not enabled for this gym.")
        return
    if not member or member.gym_id != announcement.gym_id or member.deleted_at is not None:
        _mark_delivery(delivery, status="skipped", error="Member is no longer available.")
        return
    if not member.whatsapp_opted_in:
        _mark_delivery(delivery, status="skipped", error="No WhatsApp consent is recorded for this member.")
        return
    if announcement.delivery_mode == "session_message" and not member.has_open_whatsapp_session:
        _mark_delivery(
            delivery,
            status="skipped",
            error="The 24-hour WhatsApp chat window closed before delivery.",
        )
        return

    delivery.attempts += 1
    delivery.attempted_at = utcnow()
    _renew_lease(announcement.id)
    try:
        result = _send_delivery(announcement, gym, member, delivery.phone_snapshot)
    except Exception as exc:
        result = WhatsAppResult(ok=False, error=str(exc)[:500])

    if result.ok:
        _mark_delivery(
            delivery,
            status="sent",
            provider_message_id=result.provider_message_id,
        )
    else:
        _mark_delivery(
            delivery,
            status="failed",
            provider_message_id=result.provider_message_id,
            error=result.error or "Unknown WhatsApp delivery error.",
        )


def _send_delivery(
    announcement: Announcement,
    gym: Gym,
    member: Member,
    recipient_phone: str,
) -> WhatsAppResult:
    whatsapp = WhatsAppService(gym)
    if announcement.delivery_mode == "session_message":
        body = render_message_template(
            announcement.message_body,
            member_name=member.full_name,
            gym_name=gym.name,
            expiry_date="",
            days_left=0,
            announcement_title=announcement.title,
        )
        return whatsapp.send_text(to=recipient_phone, body=body)

    try:
        parameter_names = json.loads(announcement.template_body_parameters or "[]")
    except json.JSONDecodeError:
        return WhatsAppResult(ok=False, error="Stored template variables are invalid.")
    context = {
        "member_name": member.full_name,
        "gym_name": gym.name,
        "announcement_title": announcement.title,
    }
    return whatsapp.send_template(
        to=recipient_phone,
        template_name=announcement.template_name or "",
        language_code=announcement.template_language or "en_US",
        body_parameters=[str(context.get(name, "")) for name in parameter_names],
    )


def _mark_delivery(
    delivery: AnnouncementDelivery,
    *,
    status: str,
    provider_message_id: str | None = None,
    error: str | None = None,
) -> None:
    delivery.status = status
    delivery.provider_message_id = provider_message_id
    delivery.error_message = error[:500] if error else None
    delivery.sent_at = utcnow() if status == "sent" else None
    db.session.commit()


def _renew_lease(announcement_id: int) -> None:
    Announcement.query.filter_by(id=announcement_id).update(
        {Announcement.dispatch_lease_expires_at: utcnow() + timedelta(seconds=_LEASE_SECONDS)},
        synchronize_session=False,
    )
    db.session.commit()


def _finish_announcement(announcement_id: int) -> None:
    announcement = db.session.get(Announcement, announcement_id)
    if announcement is None:
        return
    counts = dict(
        db.session.query(AnnouncementDelivery.status, func.count(AnnouncementDelivery.id))
        .filter_by(announcement_id=announcement_id)
        .group_by(AnnouncementDelivery.status)
        .all()
    )
    announcement.sent_count = counts.get("sent", 0)
    announcement.failed_count = counts.get("failed", 0)
    announcement.skipped_count = counts.get("skipped", 0)
    announcement.total_recipients = sum(counts.values())
    has_pending = counts.get("pending", 0) > 0
    if has_pending:
        announcement.status = "queued"
    elif announcement.failed_count:
        announcement.status = "completed_with_failures"
        announcement.completed_at = utcnow()
    else:
        announcement.status = "completed"
        announcement.completed_at = utcnow()
    announcement.dispatch_lease_expires_at = None
    db.session.commit()
