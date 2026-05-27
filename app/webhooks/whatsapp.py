from __future__ import annotations

import hashlib
import hmac

from flask import Blueprint, current_app, request

from app.extensions import csrf, db
from app.models import ReminderLog


webhooks_bp = Blueprint("webhooks", __name__, url_prefix="/webhook")
csrf.exempt(webhooks_bp)


def _verify_signature(payload: bytes, signature_header: str) -> bool:
    secret = current_app.config.get("WHATSAPP_WEBHOOK_SECRET") or current_app.config.get(
        "WHATSAPP_ACCESS_TOKEN", ""
    )
    if not secret:
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
        return "Forbidden", 403

    data = request.get_json(silent=True) or {}
    changed = False
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for status in value.get("statuses", []):
                changed = _process_status(status) or changed
    if changed:
        db.session.commit()
    return "ok", 200


def _process_status(status: dict) -> bool:
    provider_id = status.get("id")
    whatsapp_status = status.get("status")
    if not provider_id or not whatsapp_status:
        return False

    log = ReminderLog.query.filter_by(provider_message_id=provider_id).first()
    if not log:
        return False

    if whatsapp_status in {"sent", "delivered", "read"}:
        log.status = "sent"
        return True
    if whatsapp_status == "failed":
        log.status = "failed"
        errors = status.get("errors") or []
        if errors:
            log.error_message = str(errors[0].get("title") or errors[0])[:500]
        return True
    return False
