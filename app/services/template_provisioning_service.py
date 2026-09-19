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

import requests

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
