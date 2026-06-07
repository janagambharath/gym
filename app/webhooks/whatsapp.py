from __future__ import annotations

import hashlib
import hmac

from flask import Blueprint, current_app, request

from app.extensions import csrf, db
from app.models import Gym, Member, ReminderLog
from app.models.gym import DEFAULT_WHATSAPP_WELCOME_TEMPLATE
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.reminder_service import send_template_fallback_for_reengagement
from app.services.whatsapp_service import WhatsAppService
from app.services.whatsapp_template_service import render_message_template
from app.utils.helpers import phone_to_whatsapp


webhooks_bp = Blueprint("webhooks", __name__, url_prefix="/webhook")
csrf.exempt(webhooks_bp)


def _verify_signature(payload: bytes, signature_header: str) -> bool:
    secret = current_app.config.get("WHATSAPP_WEBHOOK_SECRET", "")
    if not secret:
        current_app.logger.error(
            "WHATSAPP_WEBHOOK_SECRET is not set. Rejecting WhatsApp webhook call."
        )
        return False
    expected = "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")


@webhooks_bp.get("/whatsapp")
def verify():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")
    verify_token = current_app.config.get("WHATSAPP_VERIFY_TOKEN", "")
    if mode == "subscribe" and token and token == verify_token:
        return challenge or "", 200
    return "Forbidden", 403


@webhooks_bp.post("/whatsapp")
def receive():
    signature = request.headers.get("X-Hub-Signature-256", "")
    if not _verify_signature(request.get_data(), signature):
        current_app.logger.warning("Rejected WhatsApp webhook with invalid signature")
        return "Forbidden", 403

    data = request.get_json(silent=True) or {}
    changed = False
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            gym = _gym_for_value(value)
            if not gym:
                continue
            for status in value.get("statuses", []):
                changed = _process_status(gym.id, status) or changed
            for message in value.get("messages", []):
                changed = _process_message(gym, message) or changed
    if changed:
        db.session.commit()
    return "ok", 200


def _gym_for_value(value: dict) -> Gym | None:
    phone_number_id = str(value.get("metadata", {}).get("phone_number_id") or "").strip()
    if not phone_number_id:
        current_app.logger.warning("Ignored WhatsApp webhook without phone_number_id")
        return None
    gym = Gym.query.filter_by(phone_number_id=phone_number_id).first()
    if not gym:
        current_app.logger.warning(
            "Ignored WhatsApp webhook for unconfigured phone_number_id=%s",
            phone_number_id,
        )
    return gym


def _process_status(gym_id: int, status: dict) -> bool:
    provider_id = status.get("id")
    whatsapp_status = status.get("status")
    if not provider_id or not whatsapp_status:
        return False

    log = ReminderLog.query.filter_by(
        gym_id=gym_id,
        provider_message_id=provider_id,
    ).first()
    if not log:
        return False

    if whatsapp_status in {"sent", "delivered", "read"}:
        log.status = "sent"
        return True
    if whatsapp_status == "failed":
        log.status = "failed"
        errors = status.get("errors") or []
        if errors:
            log.error_message = _format_status_error(errors[0])
        current_app.logger.warning(
            "WhatsApp provider marked delivery failed log=%s gym=%s provider_id=%s error=%s",
            log.id,
            gym_id,
            provider_id,
            log.error_message or "Unknown provider error",
        )
        if _is_reengagement_error(errors, log.error_message):
            send_template_fallback_for_reengagement(
                log,
                original_error=log.error_message,
            )
            return True
        return True
    return False


def _process_message(gym: Gym, message: dict) -> bool:
    if not gym.whatsapp_enabled or not gym.is_operational():
        return False

    message_type = message.get("type") or "text"
    if message_type not in {"text", "image", "audio", "video", "document", "sticker", "button"}:
        return False

    sender = str(message.get("from") or "").strip()
    try:
        whatsapp_phone = phone_to_whatsapp(f"+{sender.lstrip('+')}")
    except ValueError:
        current_app.logger.warning("Ignored WhatsApp message with invalid sender for gym %s", gym.id)
        return False

    members = _matching_members_for_sender(gym.id, whatsapp_phone)
    if len(members) != 1:
        reason = "not found" if not members else "ambiguous"
        current_app.logger.warning(
            "Ignored WhatsApp opt-in: member phone %s in gym %s was %s",
            _masked_phone(whatsapp_phone),
            gym.id,
            reason,
        )
        audit(
            action="whatsapp_opt_in_ignored",
            resource_type="member",
            gym_id=gym.id,
            metadata={
                "provider_message_id": message.get("id"),
                "sender": _masked_phone(whatsapp_phone),
                "reason": reason,
                "matches": len(members),
            },
        )
        return True

    member = members[0]
    canonical_phone = f"+{whatsapp_phone}"
    phone_normalized = member.phone != canonical_phone
    if phone_normalized:
        member.phone = canonical_phone

    if member.whatsapp_opted_in:
        if not member.whatsapp_opted_in_at:
            member.whatsapp_opted_in_at = utcnow()
            return True
        return phone_normalized

    member.whatsapp_opted_in = True
    member.whatsapp_opted_in_at = utcnow()
    audit(
        action="whatsapp_opt_in",
        resource_type="member",
        resource_id=member.id,
        gym_id=gym.id,
        metadata={
            "provider_message_id": message.get("id"),
            "phone_normalized": phone_normalized,
        },
    )

    expiry_date = member.membership_end.strftime("%d %b %Y")
    try:
        welcome_message = render_message_template(
            gym.welcome_message_template,
            gym_name=gym.name,
            member_name=member.full_name,
            expiry_date=expiry_date,
            days_left=member.days_until_expiry,
        )
    except Exception:
        current_app.logger.exception("Could not render WhatsApp welcome template for gym %s", gym.id)
        welcome_message = render_message_template(
            DEFAULT_WHATSAPP_WELCOME_TEMPLATE,
            gym_name=gym.name,
            member_name=member.full_name,
            expiry_date=expiry_date,
            days_left=member.days_until_expiry,
        )

    result = WhatsAppService(gym).send_text(to=whatsapp_phone, body=welcome_message)
    if not result.ok:
        current_app.logger.warning(
            "Could not send WhatsApp welcome message for gym %s member %s: %s",
            gym.id,
            member.id,
            result.error,
        )
    return True


def _phone_digits(value: str | None) -> str:
    return "".join(char for char in (value or "") if char.isdigit())


def _matching_members_for_sender(gym_id: int, whatsapp_phone: str) -> list[Member]:
    members = (
        Member.query.filter(
            Member.gym_id == gym_id,
            Member.deleted_at.is_(None),
        )
        .order_by(Member.id.asc())
        .with_for_update()
        .all()
    )
    exact_matches = [
        member for member in members if _phone_digits(member.phone) == whatsapp_phone
    ]
    if exact_matches:
        return exact_matches[:2]

    suffix_matches = [
        member
        for member in members
        if (digits := _phone_digits(member.phone))
        and len(digits) >= 10
        and whatsapp_phone.endswith(digits)
    ]
    return suffix_matches[:2]


def _masked_phone(phone: str) -> str:
    return f"***{phone[-4:]}" if len(phone) >= 4 else "***"


def _format_status_error(error: dict) -> str:
    if not isinstance(error, dict):
        return str(error)[:500]

    parts = [
        str(
            error.get("title")
            or error.get("message")
            or error.get("details")
            or "WhatsApp delivery failed"
        )
    ]
    if error.get("details") and error.get("details") not in parts:
        parts.append(str(error["details"]))
    if error.get("code"):
        parts.append(f"code {error['code']}")
    return " | ".join(parts)[:500]


def _is_reengagement_error(errors: list[dict], formatted_error: str | None) -> bool:
    if any(str(error.get("code")) == "131047" for error in errors if isinstance(error, dict)):
        return True
    error_text = (formatted_error or "").lower()
    return "re-engagement" in error_text or "131047" in error_text
