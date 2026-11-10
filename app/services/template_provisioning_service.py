"""Template Provisioning Service — auto-creates standard Renewal Desk
WhatsApp message templates in each gym's WABA after Embedded Signup.

Meta requires templates to be submitted for review. Templates start in
PENDING status and are approved automatically for UTILITY category in
most cases.

Template names here MUST match the exact names used in:
  - app/services/reminder_service.py (WHATSAPP_REMINDER_TEMPLATE_NAME)
  - app/services/broadcast_service.py (gym_announcement)
  - app/services/campaign_service.py (expired_member_reactivation_01,
    gym_special_offer_01, gym_announcement_01, renewal_desk_test_01)
  - app/mobile_api/member_api.py (vynla_otp)
"""
from __future__ import annotations

import logging
import threading
import time

import requests
from flask import Flask

from app.extensions import db
from app.services.embedded_signup_service import (
    WARNING_TEMPLATES_PREFIX,
    clear_warning_prefix,
    merge_warning,
)

_logger = logging.getLogger(__name__)
_TIMEOUT = 15

# ── Standard Renewal Desk Templates ────────────────────────────────────
# Each gym's WABA gets these templates auto-created after connecting.
# Names match exactly what the backend code sends.

STANDARD_TEMPLATES = [
    # ── 1. renewal_reminder (UTILITY) ──────────────────────────────────
    # Used by: reminder_service.py, campaign_service.py (default fallback)
    # Body params: member_name, gym_name, expiry_date, payment_upi_id
    {
        "name": "renewal_reminder",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Membership Renewal Reminder",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expires on {{3}}. "
                    "Please complete your renewal payment to keep access active. "
                    "UPI: {{4}}"
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "01 Oct 2026", "gym@upi"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 2. membership_renewal_reminder (UTILITY) ──────────────────────
    # Alternate name used by some gyms
    # Body params: member_name, gym_name, expiry_date, days_left
    {
        "name": "membership_renewal_reminder",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Membership Renewal",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expires on {{3}}. "
                    "You have {{4}} day(s) left. "
                    "Renew now to continue your fitness journey!"
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "01 Oct 2026", "7"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 3. gym_announcement (MARKETING) ────────────────────────────────
    # Used by: broadcast_service.py (default WHATSAPP_ANNOUNCEMENT_TEMPLATE_NAME)
    # Body params: member_name, gym_name, announcement_text
    {
        "name": "gym_announcement",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Important Update",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, Important update from {{2}}:\n\n{{3}}"
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "New batch timings from Monday. Morning 6-9 AM, Evening 5-9 PM."]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 4. gym_announcement_01 (MARKETING) ─────────────────────────────
    # Used by: campaign_service.py for announcement campaigns
    # Body params: member_name, gym_name, announcement_text
    {
        "name": "gym_announcement_01",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "📢 Announcement",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}} 👋\n\nAn update from {{2}}:\n\n{{3}}\n\n"
                    "For more details, reply to this message."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "New facilities and timings are now active."]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 5. expired_member_reactivation_01 (MARKETING) ──────────────────
    # Used by: campaign_service.py for re-engagement campaigns
    # Body params: member_name, gym_name, plan_amount, renewal_link
    {
        "name": "expired_member_reactivation_01",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "We Miss You! 💪",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}} 👋\n\nYour membership at {{2}} has expired.\n\n"
                    "We'd love to have you back.\n\n"
                    "Renew your membership for {{3}} and get back on track 💪\n\n"
                    "{{4}}\n\nReply here if you have any questions."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "₹2000", "https://example.com/renew/123"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 6. gym_special_offer_01 (MARKETING) ────────────────────────────
    # Used by: campaign_service.py for special offer campaigns
    # Body params: member_name, gym_name, offer_description, valid_until
    {
        "name": "gym_special_offer_01",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "🎉 Special Offer",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}} 👋\n\n{{2}} has a special offer for you this week.\n\n"
                    "{{3}}\n\nOffer valid until {{4}}.\n\nTap below to learn more."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "Get 20% off on annual memberships!", "31 Oct 2026"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 7. renewal_desk_test_01 (MARKETING) ────────────────────────────
    # Used by: campaign_service.py for test broadcasts
    # Body params: member_name, gym_name
    {
        "name": "renewal_desk_test_01",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Test Message",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}} 👋\n\nThis is a test message from {{2}}.\n\n"
                    "Thank you for using Renewal Desk."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    # ── 8. vynla_otp (AUTHENTICATION) ──────────────────────────────────
    # Used by: member_api.py for OTP delivery
    # Body params: otp_code
    {
        "name": "vynla_otp",
        "category": "AUTHENTICATION",
        "language": "en",
        "components": [
            {
                "type": "BODY",
                "text": "{{1}} is your verification code for Renewal Desk.",
                "example": {
                    "body_text": [
                        ["123456"]
                    ]
                },
            },
        ],
    },
]


def provision_templates(
    *,
    waba_id: str,
    access_token: str,
    api_version: str = "v20.0",
) -> dict[str, str]:
    """Check existing templates and create any missing standard templates.

    Returns a dict mapping template name → status ('exists', 'created', 'failed').
    """
    results: dict[str, str] = {}

    # 1. Fetch existing templates
    existing_names: set[str] = set()
    try:
        resp = requests.get(
            f"https://graph.facebook.com/{api_version}/{waba_id}/message_templates",
            params={"fields": "name,status,category,language", "limit": 250},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=_TIMEOUT,
        )
        if resp.status_code == 200:
            for tpl in resp.json().get("data", []):
                existing_names.add(tpl.get("name", ""))
            _logger.info(
                "Found %d existing templates in WABA %s: %s",
                len(existing_names), waba_id, ", ".join(sorted(existing_names)),
            )
    except Exception as exc:
        _logger.warning("Failed to list templates for WABA %s: %s", waba_id, exc)

    # 2. Create missing templates
    for template_def in STANDARD_TEMPLATES:
        name = template_def["name"]
        if name in existing_names:
            results[name] = "exists"
            _logger.info("Template '%s' already exists in WABA %s — skipped", name, waba_id)
            continue

        try:
            payload = {
                "name": name,
                "category": template_def["category"],
                "language": template_def["language"],
                "components": template_def["components"],
            }
            resp = requests.post(
                f"https://graph.facebook.com/{api_version}/{waba_id}/message_templates",
                json=payload,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=_TIMEOUT,
            )
            if resp.status_code == 200:
                template_id = resp.json().get("id", "unknown")
                results[name] = f"created (id={template_id})"
                _logger.info(
                    "Template '%s' created in WABA %s (id=%s, status=PENDING)",
                    name, waba_id, template_id,
                )
            else:
                error_msg = resp.text[:300]
                results[name] = f"failed: {error_msg}"
                _logger.warning(
                    "Failed to create template '%s' in WABA %s: %s %s",
                    name, waba_id, resp.status_code, error_msg,
                )
        except Exception as exc:
            results[name] = f"error: {exc}"
            _logger.warning("Template creation error for '%s': %s", name, exc)

    _logger.info("Template provisioning results for WABA %s: %s", waba_id, results)
    return results


# ── Background provisioning (W-C1 / W-H5) ───────────────────────────────
# Mechanism chosen 2026-11-10: a daemon ``threading.Thread`` spawned by
# the connect route AFTER it commits — NOT an APScheduler one-shot job.
# Why: the APScheduler only runs on the single worker that holds the
# Redis scheduler lock (``reminder_scheduler.configure_scheduler``); a
# connect landing on any other gunicorn worker would never run a
# scheduler job, and with REDIS_URL unset the scheduler never starts at
# all. A thread runs on whichever worker handled the request, needs no
# Redis and no scheduler config. Cost: the thread dies if that worker
# restarts — mitigated, not hidden: failure is stored on the gym row
# (``whatsapp_templates_provisioned=False`` + a "Templates not
# provisioned: ..." warning the status endpoint surfaces) and is
# retryable via POST /whatsapp/retry-templates, via a re-POST of
# connect-waba with the same WABA/phone (dedup re-triggers it), and by
# the worker's own 3 attempts with 30s gaps. Provisioning never blocks
# the connect response and never touches the block fail-safe (no door
# commands anywhere in this flow).

_PROVISION_MAX_ATTEMPTS = 3
_PROVISION_RETRY_DELAY_S = 30


def _provision_all_ok(results: dict[str, str]) -> bool:
    if not results:
        return False
    return all(
        value == "exists" or value.startswith("created")
        for value in results.values()
    )


def _first_failure_excerpt(results: dict[str, str]) -> str:
    for name, status in results.items():
        if status != "exists" and not status.startswith("created"):
            return f"{name}: {status[:120]}"
    return "unknown Meta error"


def provision_templates_for_gym(
    app: Flask,
    gym_id: int,
    *,
    max_attempts: int = _PROVISION_MAX_ATTEMPTS,
    retry_delay_s: int = _PROVISION_RETRY_DELAY_S,
    expected_waba_id: str | None = None,
    expected_phone_number_id: str | None = None,
) -> bool:
    """Provision templates for one gym, with retries, in an app context.

    Safe to call from a background thread: opens its own app context and
    commits (or rolls back) per attempt. Returns True when every
    standard template exists or was created. On final failure the gym
    row keeps ``whatsapp_templates_provisioned=False`` and records a
    short reason the connection-status endpoint surfaces — the gym stays
    CONNECTED, templates are retryable, nothing is hidden.

    ``expected_*``: the WABA/phone the scheduling connect saved. If the
    gym has since reconnected to different IDs (or the row now belongs
    to a different connect), the run aborts — a stale thread must never
    provision or warn against a connection it was not scheduled for.
    """
    with app.app_context():
        from app.models import Gym

        for attempt in range(1, max_attempts + 1):
            try:
                gym = db.session.get(Gym, gym_id)
                if gym is None:
                    _logger.warning("Template provisioning: gym %s not found", gym_id)
                    return False
                if gym.whatsapp_templates_provisioned:
                    return True
                if (
                    expected_waba_id is not None
                    and gym.whatsapp_business_account_id != expected_waba_id
                ) or (
                    expected_phone_number_id is not None
                    and gym.phone_number_id != expected_phone_number_id
                ):
                    _logger.info(
                        "Template provisioning gym=%s stale (reconnected) — aborting",
                        gym_id,
                    )
                    return False
                waba_id = gym.whatsapp_business_account_id or ""
                token = gym.get_whatsapp_token() or app.config.get(
                    "WHATSAPP_ACCESS_TOKEN", ""
                )
                if not waba_id or not token:
                    reason = "no WABA ID or access token available for this gym"
                    gym.whatsapp_connection_error = merge_warning(
                        gym.whatsapp_connection_error,
                        WARNING_TEMPLATES_PREFIX,
                        reason,
                    )
                    db.session.commit()
                    _logger.warning(
                        "Template provisioning gym=%s failed: %s", gym_id, reason
                    )
                    return False
                api_version = app.config.get("WHATSAPP_API_VERSION", "v20.0")
                results = provision_templates(
                    waba_id=waba_id, access_token=token, api_version=api_version
                )
                if _provision_all_ok(results):
                    gym.whatsapp_templates_provisioned = True
                    gym.whatsapp_connection_error = clear_warning_prefix(
                        gym.whatsapp_connection_error, WARNING_TEMPLATES_PREFIX
                    )
                    db.session.commit()
                    _logger.info(
                        "Template provisioning gym=%s succeeded (attempt %d)",
                        gym_id, attempt,
                    )
                    return True
                reason = _first_failure_excerpt(results)
                _logger.warning(
                    "Template provisioning gym=%s attempt %d/%d incomplete: %s",
                    gym_id, attempt, max_attempts, reason,
                )
                if attempt == max_attempts:
                    gym.whatsapp_templates_provisioned = False
                    gym.whatsapp_connection_error = merge_warning(
                        gym.whatsapp_connection_error,
                        WARNING_TEMPLATES_PREFIX,
                        f"Meta did not confirm all templates ({reason})",
                    )
                    db.session.commit()
                    return False
            except Exception:
                db.session.rollback()
                _logger.exception(
                    "Template provisioning gym=%s attempt %d/%d errored",
                    gym_id, attempt, max_attempts,
                )
                if attempt == max_attempts:
                    try:
                        gym = db.session.get(Gym, gym_id)
                        if gym is not None:
                            gym.whatsapp_templates_provisioned = False
                            gym.whatsapp_connection_error = merge_warning(
                                gym.whatsapp_connection_error,
                                WARNING_TEMPLATES_PREFIX,
                                "provisioning errored — retry from WhatsApp setup",
                            )
                            db.session.commit()
                    except Exception:
                        db.session.rollback()
                    return False
            if attempt < max_attempts:
                time.sleep(retry_delay_s)
    return False


def _provision_worker(app: Flask, gym_id: int, waba_id: str = "", phone_number_id: str = "") -> None:
    try:
        provision_templates_for_gym(
            app,
            gym_id,
            expected_waba_id=waba_id or None,
            expected_phone_number_id=phone_number_id or None,
        )
    except Exception:
        _logger.exception("Template provisioning worker failed gym=%s", gym_id)


def schedule_template_provisioning(
    app: Flask,
    gym_id: int,
    waba_id: str = "",
    phone_number_id: str = "",
) -> bool:
    """Spawn the background provisioning thread for a gym. Never raises."""
    try:
        thread = threading.Thread(
            target=_provision_worker,
            args=(app, gym_id, waba_id, phone_number_id),
            daemon=True,
            name=f"wa-provision-{gym_id}",
        )
        thread.start()
        _logger.info("Template provisioning scheduled in background gym=%s", gym_id)
        return True
    except Exception:
        _logger.exception(
            "Could not schedule template provisioning gym=%s", gym_id
        )
        return False
