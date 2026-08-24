"""Service for sending bulk announcements and festival broadcasts via WhatsApp."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from flask import current_app

from app.extensions import db
from app.models import Gym, Member, NotificationTemplate, ReminderLog
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.whatsapp_service import WhatsAppResult, WhatsAppService
from app.utils.helpers import phone_to_whatsapp, today_for_gym

_logger = logging.getLogger(__name__)


def get_target_members(gym_id: int, audience: str = "active") -> list[Member]:
    """Return the list of members for the given audience criteria."""
    query = Member.query.filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None))
    today = date.today()

    if audience == "active":
        return query.filter(Member.status == "active", Member.membership_end >= today).all()
    elif audience == "expired":
        return query.filter((Member.status == "expired") | (Member.membership_end < today)).all()
    elif audience == "expiring_soon":
        seven_days = today + timedelta(days=7)
        return query.filter(
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= seven_days,
        ).all()
    else:  # "all"
        return query.all()


def send_broadcast_announcement(
    gym: Gym,
    announcement_text: str,
    audience: str = "active",
    template_name: str | None = None,
) -> dict[str, Any]:
    """Broadcast an announcement message to all targeted gym members."""
    if not gym.whatsapp_enabled or not gym.phone_number_id:
        return {
            "success": False,
            "error": "WhatsApp Business is not configured or disabled for this gym.",
            "sent": 0,
            "failed": 0,
            "total": 0,
        }

    members = get_target_members(gym.id, audience)
    if not members:
        return {
            "success": True,
            "message": "No members match the selected audience.",
            "sent": 0,
            "failed": 0,
            "total": 0,
        }

    whatsapp = WhatsAppService(gym)
    t_name = template_name or current_app.config.get("WHATSAPP_ANNOUNCEMENT_TEMPLATE_NAME", "gym_announcement")

    sent_count = 0
    failed_count = 0
    errors: list[str] = []

    for member in members:
        phone = phone_to_whatsapp(member.phone)
        if not phone:
            failed_count += 1
            continue

        # Try sending Meta approved announcement template first
        body_params = [
            member.full_name or "Member",
            gym.name,
            announcement_text.strip(),
        ]
        
        result = whatsapp.send_template(
            to=phone,
            template_name=t_name,
            language_code=current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_LANGUAGE", "en"),
            body_parameters=body_params,
        )

        # If template is still in review or fails, try fallback session message if window is open
        if not result.ok:
            fallback_body = (
                f"Hi {member.full_name},\n\n"
                f"Important update from {gym.name}:\n\n"
                f"{announcement_text.strip()}\n\n"
                f"Thank you,\n"
                f"Gym Management"
            )
            result = whatsapp.send_text(to=phone, body=fallback_body)

        if result.ok:
            sent_count += 1
        else:
            failed_count += 1
            if result.error and len(errors) < 3:
                errors.append(f"{member.full_name}: {result.error}")

    audit(
        action="whatsapp_broadcast_announcement",
        resource_type="gym",
        resource_id=gym.id,
        gym_id=gym.id,
        metadata={
            "audience": audience,
            "total": len(members),
            "sent": sent_count,
            "failed": failed_count,
            "preview": announcement_text[:80],
        },
    )
    db.session.commit()

    return {
        "success": True,
        "sent": sent_count,
        "failed": failed_count,
        "total": len(members),
        "errors": errors,
        "message": f"Broadcast delivered to {sent_count} of {len(members)} members.",
    }
