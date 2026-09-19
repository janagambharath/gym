"""Template Provisioning Service — auto-creates standard Renewal Desk
WhatsApp message templates in each gym's WABA after Embedded Signup.

Meta requires templates to be submitted for review. Templates start in
PENDING status and are approved automatically for UTILITY category in
most cases.
"""
from __future__ import annotations

import logging

import requests

_logger = logging.getLogger(__name__)
_TIMEOUT = 15

# ── Standard Renewal Desk Templates ────────────────────────────────────
# Each gym's WABA gets these templates auto-created after connecting.

STANDARD_TEMPLATES = [
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
                        ["Rahul", "PowerFit Gym", "2026-10-01", "gym@upi"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "renewal_7_days",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "7-Day Renewal Notice",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expires in 7 days on {{3}}. "
                    "Renew now to avoid any interruption."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "2026-10-01"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "renewal_3_days",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "3-Day Renewal Notice",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expires in 3 days on {{3}}. "
                    "Renew today to keep access."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "2026-10-01"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "renewal_today",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Membership Expires Today",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expires today ({{3}}). "
                    "Renew now to continue access without interruption."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "2026-10-01"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "renewal_overdue",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Membership Expired",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your {{2}} membership expired on {{3}}. "
                    "Renew your membership to regain access."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "2026-09-25"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "payment_confirmation",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Payment Confirmed",
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, your payment of {{2}} for {{3}} has been confirmed. "
                    "Your membership is now active until {{4}}. Thank you!"
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "₹2000", "PowerFit Gym", "2027-01-01"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "welcome_member",
        "category": "UTILITY",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "Welcome to {{1}}!",
                "example": {
                    "header_text": ["PowerFit Gym"]
                },
            },
            {
                "type": "BODY",
                "text": (
                    "Hi {{1}}, welcome to {{2}}! "
                    "You'll receive membership updates and renewal reminders on WhatsApp. "
                    "Your membership is active until {{3}}."
                ),
                "example": {
                    "body_text": [
                        ["Rahul", "PowerFit Gym", "2027-01-01"]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
            },
        ],
    },
    {
        "name": "broadcast_announcement",
        "category": "MARKETING",
        "language": "en",
        "components": [
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": "📢 {{1}} Update",
                "example": {
                    "header_text": ["PowerFit Gym"]
                },
            },
            {
                "type": "BODY",
                "text": "{{1}}",
                "example": {
                    "body_text": [
                        ["Special Diwali offer! Get 20% off on annual memberships. Valid until Oct 31."]
                    ]
                },
            },
            {
                "type": "FOOTER",
                "text": "Sent via Renewal Desk",
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
    except Exception as exc:
        _logger.warning("Failed to list templates for WABA %s: %s", waba_id, exc)

    # 2. Create missing templates
    for template_def in STANDARD_TEMPLATES:
        name = template_def["name"]
        if name in existing_names:
            results[name] = "exists"
            _logger.info("Template '%s' already exists in WABA %s", name, waba_id)
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
                results[name] = "created"
                _logger.info(
                    "Template '%s' created in WABA %s (status=PENDING)",
                    name, waba_id,
                )
            else:
                error_msg = resp.text[:200]
                results[name] = f"failed: {error_msg}"
                _logger.warning(
                    "Failed to create template '%s' in WABA %s: %s %s",
                    name, waba_id, resp.status_code, error_msg,
                )
        except Exception as exc:
            results[name] = f"error: {exc}"
            _logger.warning("Template creation error for '%s': %s", name, exc)

    return results
