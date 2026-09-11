"""Campaign service — segment targeting, sending, delivery tracking, and attribution.

Implements the core campaign lifecycle:
  create → preview segment → send → track delivery → attribute renewals
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone as tz
from decimal import Decimal
from typing import Any

from flask import current_app
from sqlalchemy import func

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification, ReminderLog
from app.models.campaign import Campaign, CampaignRecipient, SEGMENT_TYPES
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.timezone_service import today_for_gym
from app.services.whatsapp_service import WhatsAppService
from app.utils.helpers import normalize_phone_e164, phone_to_whatsapp

_logger = logging.getLogger(__name__)


# ── Approved Meta Templates ──────────────────────────────────────────

APPROVED_TEMPLATES: dict[str, dict[str, Any]] = {
    "expired_member_reactivation_01": {
        "name": "expired_member_reactivation_01",
        "category": "MARKETING",
        "language": "en",
        "campaign_type": "recovery",
        "title": "Expired Member Reactivation",
        "body": (
            "Hi {{1}} 👋\n\n"
            "Your membership at {{2}} has expired.\n\n"
            "We'd love to have you back.\n\n"
            "Renew your membership for {{3}} and get back on track 💪\n\n"
            "{{4}}\n\n"
            "Reply here if you have any questions."
        ),
        "variables": [
            {"key": "{{1}}", "label": "Member Name", "example": "Rahul"},
            {"key": "{{2}}", "label": "Gym Name", "example": "PowerFit Gym"},
            {"key": "{{3}}", "label": "Renewal Amount", "example": "₹1,500"},
            {"key": "{{4}}", "label": "Renewal Link", "example": "https://gym-production-910c.up.railway.app/renew/101"},
        ],
        "button": {"type": "QUICK_REPLY", "text": "Renew Now"},
        "status": "APPROVED",
    },
    "gym_special_offer_01": {
        "name": "gym_special_offer_01",
        "category": "MARKETING",
        "language": "en",
        "campaign_type": "promotion",
        "title": "Special Offer",
        "body": (
            "Hi {{1}} 👋\n\n"
            "{{2}} has a special offer for you this week.\n\n"
            "{{3}}\n\n"
            "Offer valid until {{4}}.\n\n"
            "Tap below to learn more."
        ),
        "variables": [
            {"key": "{{1}}", "label": "Customer Name", "example": "Rahul"},
            {"key": "{{2}}", "label": "Gym Name", "example": "PowerFit Gym"},
            {"key": "{{3}}", "label": "Offer Description", "example": "Get 20% off on your quarterly renewal"},
            {"key": "{{4}}", "label": "Offer Expiry", "example": "Sunday midnight"},
        ],
        "button": {"type": "QUICK_REPLY", "text": "View Offer"},
        "status": "APPROVED",
    },
    "gym_announcement_01": {
        "name": "gym_announcement_01",
        "category": "MARKETING",
        "language": "en",
        "campaign_type": "promotion",
        "title": "Gym Announcement",
        "body": (
            "Hi {{1}} 👋\n\n"
            "An update from {{2}}:\n\n"
            "{{3}}\n\n"
            "For more details, reply to this message."
        ),
        "variables": [
            {"key": "{{1}}", "label": "Customer Name", "example": "Rahul"},
            {"key": "{{2}}", "label": "Gym Name", "example": "PowerFit Gym"},
            {"key": "{{3}}", "label": "Announcement", "example": "Our new CrossFit area opens this Monday morning!"},
        ],
        "button": {"type": "QUICK_REPLY", "text": "Contact Gym"},
        "status": "APPROVED",
    },
    "renewal_desk_test_01": {
        "name": "renewal_desk_test_01",
        "category": "MARKETING",
        "language": "en",
        "campaign_type": "test",
        "title": "Test Message (Meta Verification)",
        "body": (
            "Hi {{1}} 👋\n\n"
            "This is a test message from {{2}}.\n\n"
            "Thank you for using Renewal Desk."
        ),
        "variables": [
            {"key": "{{1}}", "label": "Recipient Name", "example": "Test User"},
            {"key": "{{2}}", "label": "Gym Name", "example": "PowerFit Gym"},
        ],
        "button": None,
        "status": "APPROVED",
    },
}


def get_approved_templates(campaign_type: str | None = None) -> list[dict[str, Any]]:
    """Return approved templates filtered by campaign_type if provided."""
    templates = list(APPROVED_TEMPLATES.values())
    if campaign_type:
        templates = [t for t in templates if t.get("campaign_type") in (campaign_type, "test")]
    return templates


def _parse_date(val: Any) -> date | None:
    """Parse dates in ISO, DD/MM/YYYY, or DD-MM-YYYY formats."""
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# ── Import & Validation ──────────────────────────────────────────────


def validate_imported_contacts(
    gym_id: int,
    contacts_data: list[dict],
    campaign_type: str = "recovery",
    gym_timezone: str = "Asia/Kolkata",
) -> dict[str, Any]:
    """Validate rows from an uploaded CSV/spreadsheet for campaign outreach."""
    today = today_for_gym(gym_timezone)
    valid_rows = []
    invalid_rows = []
    seen_phones: set[str] = set()
    duplicate_count = 0

    for idx, row in enumerate(contacts_data, start=1):
        name = str(row.get("name") or "").strip()
        raw_phone = str(row.get("phone") or "").strip()

        if not name:
            invalid_rows.append({
                "row_index": idx,
                "name": name,
                "phone": raw_phone,
                "reason": "Name is required.",
            })
            continue

        if not raw_phone:
            invalid_rows.append({
                "row_index": idx,
                "name": name,
                "phone": raw_phone,
                "reason": "Phone number is required.",
            })
            continue

        try:
            norm_phone = normalize_phone_e164(raw_phone)
            from app.utils.helpers import E164_RE
            if not E164_RE.match(norm_phone) or len(norm_phone) < 11:
                invalid_rows.append({
                    "row_index": idx,
                    "name": name,
                    "phone": raw_phone,
                    "reason": f"Invalid phone format '{raw_phone}'. Must be a valid 10-digit or E.164 number.",
                })
                continue
        except Exception as err:
            invalid_rows.append({
                "row_index": idx,
                "name": name,
                "phone": raw_phone,
                "reason": f"Invalid phone number: {err}",
            })
            continue

        if norm_phone in seen_phones:
            duplicate_count += 1
            invalid_rows.append({
                "row_index": idx,
                "name": name,
                "phone": raw_phone,
                "reason": f"Duplicate phone number '{norm_phone}' in file.",
            })
            continue

        seen_phones.add(norm_phone)

        # For recovery campaigns, expiry date is required and must be in the past
        expiry_date = None
        if campaign_type == "recovery":
            raw_expiry = row.get("expiry_date")
            if not raw_expiry:
                invalid_rows.append({
                    "row_index": idx,
                    "name": name,
                    "phone": raw_phone,
                    "reason": "Expiry date is required for expired member recovery.",
                })
                continue
            expiry_date = _parse_date(raw_expiry)
            if not expiry_date:
                invalid_rows.append({
                    "row_index": idx,
                    "name": name,
                    "phone": raw_phone,
                    "reason": f"Invalid date format '{raw_expiry}'. Use YYYY-MM-DD or DD/MM/YYYY.",
                })
                continue
            if expiry_date >= today:
                invalid_rows.append({
                    "row_index": idx,
                    "name": name,
                    "phone": raw_phone,
                    "reason": f"Member membership end date ({expiry_date}) is not expired yet.",
                })
                continue

        # Optional renewal amount
        renewal_amount = None
        raw_amount = row.get("renewal_amount") or row.get("amount")
        if raw_amount:
            try:
                renewal_amount = str(Decimal(str(raw_amount).replace(",", "").replace("₹", "").strip()))
            except Exception:
                pass

        plan_name = str(row.get("plan") or "").strip() or None

        valid_rows.append({
            "row_index": idx,
            "name": name,
            "phone": norm_phone,
            "expiry_date": expiry_date.isoformat() if expiry_date else None,
            "plan": plan_name,
            "renewal_amount": renewal_amount,
        })

    return {
        "total": len(contacts_data),
        "valid_count": len(valid_rows),
        "invalid_count": len(invalid_rows),
        "duplicate_count": duplicate_count,
        "valid_rows": valid_rows,
        "invalid_rows": invalid_rows,
        "preview": valid_rows[:20],
    }


# ── Cooldown checking ────────────────────────────────────────────────


def check_cooldown_recipients(
    gym_id: int,
    segment_type: str | None = None,
    member_ids: list[int] | None = None,
    phone_numbers: list[str] | None = None,
    cooldown_days: int = 7,
    gym_timezone: str = "Asia/Kolkata",
) -> dict[str, Any]:
    """Check how many target recipients were contacted within cooldown_days."""
    cutoff = utcnow() - timedelta(days=cooldown_days)
    target_member_ids: set[int] = set(member_ids or [])

    if segment_type and not target_member_ids and not phone_numbers:
        members = get_segment_members(gym_id, segment_type, gym_timezone)
        target_member_ids = {m.id for m in members}

    if phone_numbers:
        norm_phones = [normalize_phone_e164(p) for p in phone_numbers if p]
        if norm_phones:
            existing_members = Member.query.filter_by(gym_id=gym_id).filter(Member.phone.in_(norm_phones)).all()
            for m in existing_members:
                target_member_ids.add(m.id)

    if not target_member_ids:
        return {"total": 0, "in_cooldown": 0, "eligible": 0, "in_cooldown_member_ids": []}

    cooldown_recipients = (
        CampaignRecipient.query.filter_by(gym_id=gym_id)
        .filter(CampaignRecipient.member_id.in_(target_member_ids))
        .filter(CampaignRecipient.sent_at >= cutoff)
        .all()
    )
    in_cooldown_ids = {r.member_id for r in cooldown_recipients}
    total = len(target_member_ids)
    in_cooldown = len(in_cooldown_ids)
    eligible = total - in_cooldown

    return {
        "total": total,
        "in_cooldown": in_cooldown,
        "eligible": eligible,
        "in_cooldown_member_ids": list(in_cooldown_ids),
    }


# ── Segment queries ───────────────────────────────────────────────────


def _inactive_since(gym_id: int, days: int, gym_timezone: str) -> list[Member]:
    """Members whose last attendance/renewal is older than `days` ago."""
    today = today_for_gym(gym_timezone)
    cutoff = today - timedelta(days=days)
    return (
        Member.query.filter_by(gym_id=gym_id, status="active")
        .filter(Member.deleted_at.is_(None))
        .filter(Member.membership_end >= today)  # still active
        .filter(Member.updated_at <= datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=tz.utc))
        .order_by(Member.membership_end.asc())
        .all()
    )


def get_segment_members(gym_id: int, segment_type: str, gym_timezone: str = "Asia/Kolkata") -> list[Member]:
    """Return the list of members matching a campaign segment."""
    today = today_for_gym(gym_timezone)

    base_query = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None))
        .filter(Member.whatsapp_opted_in.is_(True))
    )

    if segment_type == "expiring_today":
        return base_query.filter(
            Member.status == "active",
            Member.membership_end == today,
        ).order_by(Member.full_name.asc()).all()

    elif segment_type == "expiring_3d":
        end = today + timedelta(days=3)
        return base_query.filter(
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= end,
        ).order_by(Member.membership_end.asc()).all()

    elif segment_type == "expiring_7d":
        end = today + timedelta(days=7)
        return base_query.filter(
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= end,
        ).order_by(Member.membership_end.asc()).all()

    elif segment_type == "expiring_14d":
        end = today + timedelta(days=14)
        return base_query.filter(
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= end,
        ).order_by(Member.membership_end.asc()).all()

    elif segment_type == "expiring_30d":
        end = today + timedelta(days=30)
        return base_query.filter(
            Member.status == "active",
            Member.membership_end >= today,
            Member.membership_end <= end,
        ).order_by(Member.membership_end.asc()).all()

    elif segment_type == "recently_expired":
        cutoff = today - timedelta(days=30)
        return base_query.filter(
            Member.membership_end < today,
            Member.membership_end >= cutoff,
        ).order_by(Member.membership_end.desc()).all()

    elif segment_type == "inactive_30d":
        return _inactive_since(gym_id, 30, gym_timezone)

    elif segment_type == "inactive_60d":
        return _inactive_since(gym_id, 60, gym_timezone)

    elif segment_type == "inactive_90d":
        return _inactive_since(gym_id, 90, gym_timezone)

    elif segment_type == "all_active":
        return base_query.filter(
            Member.status == "active",
            Member.membership_end >= today,
        ).order_by(Member.full_name.asc()).all()

    elif segment_type == "all_expired":
        return base_query.filter(
            Member.membership_end < today,
        ).order_by(Member.membership_end.desc()).all()

    elif segment_type == "all_customers":
        return base_query.order_by(Member.full_name.asc()).all()

    return []


def preview_segment(gym_id: int, segment_type: str, gym_timezone: str = "Asia/Kolkata") -> dict:
    """Return a count and preview of members for a segment (without sending)."""
    members = get_segment_members(gym_id, segment_type, gym_timezone)
    return {
        "segment_type": segment_type,
        "total": len(members),
        "preview": [
            {
                "id": m.id,
                "full_name": m.full_name,
                "phone": m.phone,
                "membership_end": m.membership_end.isoformat() if m.membership_end else None,
                "days_until_expiry": (m.membership_end - today_for_gym(gym_timezone)).days if m.membership_end else None,
                "plan_name": m.plan.name if m.plan else None,
                "plan_price": str(m.plan.price) if m.plan else None,
            }
            for m in members[:20]
        ],
    }


# ── Campaign CRUD ─────────────────────────────────────────────────────


def create_campaign(
    gym_id: int,
    name: str,
    segment_type: str,
    created_by_id: int,
    campaign_type: str = "recovery",
    promo_preset: str | None = None,
    message_template: str | None = None,
    whatsapp_template_name: str | None = None,
    attribution_window_days: int = 7,
    imported_contacts: list[dict] | None = None,
    exclude_recent: bool = False,
    gym_timezone: str = "Asia/Kolkata",
) -> Campaign:
    """Create a new campaign in draft status."""
    campaign = Campaign(
        gym_id=gym_id,
        name=name,
        campaign_type=campaign_type,
        promo_preset=promo_preset,
        segment_type=segment_type,
        status="draft",
        message_template=message_template,
        whatsapp_template_name=whatsapp_template_name,
        attribution_window_days=attribution_window_days,
        created_by_id=created_by_id,
    )
    db.session.add(campaign)
    db.session.flush()

    today = today_for_gym(gym_timezone)
    cooldown_cutoff = utcnow() - timedelta(days=7)

    # Ingest / link imported contacts directly into recipients
    if imported_contacts:
        for contact in imported_contacts:
            name_val = str(contact.get("name") or "").strip()
            raw_phone = str(contact.get("phone") or "").strip()
            if not name_val or not raw_phone:
                continue

            try:
                norm_phone = normalize_phone_e164(raw_phone)
            except Exception:
                continue

            member = Member.query.filter_by(gym_id=gym_id, phone=norm_phone).first()
            raw_exp = contact.get("expiry_date")
            exp_date = _parse_date(raw_exp) if raw_exp else None

            if not member:
                member = Member(
                    gym_id=gym_id,
                    full_name=name_val,
                    phone=norm_phone,
                    status="expired" if campaign_type == "recovery" else "active",
                    membership_start=exp_date - timedelta(days=30) if exp_date else today,
                    membership_end=exp_date if exp_date else today,
                    whatsapp_opted_in=True,
                    whatsapp_opted_in_at=utcnow(),
                )
                db.session.add(member)
                db.session.flush()
            elif campaign_type == "recovery" and exp_date:
                member.membership_end = exp_date
                member.status = "expired"

            # Check cooldown exclusion
            if exclude_recent:
                recent = CampaignRecipient.query.filter_by(
                    gym_id=gym_id, member_id=member.id
                ).filter(CampaignRecipient.sent_at >= cooldown_cutoff).first()
                if recent:
                    continue

            renewal_amt = None
            if contact.get("renewal_amount"):
                try:
                    renewal_amt = Decimal(str(contact.get("renewal_amount")).replace(",", "").replace("₹", ""))
                except Exception:
                    pass

            recipient = CampaignRecipient(
                campaign_id=campaign.id,
                member_id=member.id,
                gym_id=gym_id,
                phone_snapshot=norm_phone,
                renewal_amount=renewal_amt,
            )
            db.session.add(recipient)

    audit(
        action="create_campaign",
        resource_type="campaign",
        resource_id=campaign.id,
        gym_id=gym_id,
        actor_id=created_by_id,
        metadata={"segment_type": segment_type, "name": name, "campaign_type": campaign_type},
    )
    return campaign


def send_campaign(campaign_id: int, gym_id: int) -> dict[str, Any]:
    """Send a campaign to all members in its segment or pre-populated recipients.

    Returns a summary of sent/failed counts.
    """
    campaign = Campaign.query.filter_by(id=campaign_id, gym_id=gym_id).first()
    if not campaign:
        return {"success": False, "error": "Campaign not found."}
    if campaign.status not in ("draft", "failed"):
        return {"success": False, "error": f"Campaign is already {campaign.status}."}

    gym = db.session.get(Gym, gym_id)
    if not gym or not gym.whatsapp_enabled or not gym.phone_number_id:
        campaign.status = "failed"
        campaign.error_message = "WhatsApp Business is not configured."
        db.session.commit()
        return {"success": False, "error": "WhatsApp Business is not configured."}

    gym_timezone = gym.timezone or "Asia/Kolkata"

    # Check for pre-populated recipients (e.g. from imported CSV)
    recipients = CampaignRecipient.query.filter_by(campaign_id=campaign.id).all()

    if not recipients:
        # Segment-based lookup
        members = get_segment_members(gym_id, campaign.segment_type, gym_timezone)
        if not members:
            campaign.status = "completed"
            campaign.sent_at = utcnow()
            campaign.completed_at = utcnow()
            campaign.total_recipients = 0
            db.session.commit()
            return {"success": True, "sent": 0, "failed": 0, "total": 0, "message": "No members match this segment."}

        for member in members:
            recipient = CampaignRecipient(
                campaign_id=campaign.id,
                member_id=member.id,
                gym_id=gym_id,
                phone_snapshot=member.phone,
            )
            db.session.add(recipient)
        db.session.flush()
        recipients = CampaignRecipient.query.filter_by(campaign_id=campaign.id).all()

    campaign.status = "sending"
    campaign.sent_at = utcnow()
    campaign.total_recipients = len(recipients)
    db.session.flush()

    whatsapp = WhatsAppService(gym)
    template_name = campaign.whatsapp_template_name or current_app.config.get(
        "WHATSAPP_REMINDER_TEMPLATE_NAME", ""
    )
    template_language = current_app.config.get("WHATSAPP_REMINDER_TEMPLATE_LANGUAGE", "en")

    sent = 0
    failed = 0

    for recipient in recipients:
        member = recipient.member
        if not member:
            failed += 1
            continue

        phone = phone_to_whatsapp(member.phone)
        if not phone:
            failed += 1
            continue

        if recipient.sent_at:
            sent += 1
            continue

        expiry_date = member.membership_end.strftime("%d %b %Y") if member.membership_end else "N/A"
        days_left = (member.membership_end - today_for_gym(gym_timezone)).days if member.membership_end else 0
        plan_amount = str(recipient.renewal_amount or (member.plan.price if member.plan else "1500"))
        renewal_link = f"https://gym-production-910c.up.railway.app/renew/{member.id}"

        # Resolve body parameters based on template name
        body_params = []
        fallback_text = ""

        if template_name == "expired_member_reactivation_01":
            body_params = [
                member.full_name or "Member",
                gym.name,
                f"₹{plan_amount}",
                renewal_link,
            ]
            fallback_text = (
                f"Hi {member.full_name or 'Member'} 👋\n\n"
                f"Your membership at {gym.name} has expired.\n\n"
                f"We'd love to have you back.\n\n"
                f"Renew your membership for ₹{plan_amount} and get back on track 💪\n\n"
                f"{renewal_link}\n\n"
                f"Reply here if you have any questions."
            )
        elif template_name == "gym_special_offer_01":
            offer_desc = campaign.message_template or "Get a special renewal discount this week!"
            offer_valid = (today_for_gym(gym_timezone) + timedelta(days=7)).strftime("%d %b %Y")
            body_params = [
                member.full_name or "Valued Customer",
                gym.name,
                offer_desc,
                offer_valid,
            ]
            fallback_text = (
                f"Hi {member.full_name or 'Valued Customer'} 👋\n\n"
                f"{gym.name} has a special offer for you this week.\n\n"
                f"{offer_desc}\n\n"
                f"Offer valid until {offer_valid}.\n\n"
                f"Tap below to learn more."
            )
        elif template_name == "gym_announcement_01":
            announcement = campaign.message_template or "New facilities and timings are now active."
            body_params = [
                member.full_name or "Valued Customer",
                gym.name,
                announcement,
            ]
            fallback_text = (
                f"Hi {member.full_name or 'Valued Customer'} 👋\n\n"
                f"An update from {gym.name}:\n\n"
                f"{announcement}\n\n"
                f"For more details, reply to this message."
            )
        elif template_name == "renewal_desk_test_01":
            body_params = [
                member.full_name or "Test User",
                gym.name,
            ]
            fallback_text = (
                f"Hi {member.full_name or 'Test User'} 👋\n\n"
                f"This is a test message from {gym.name}.\n\n"
                f"Thank you for using Renewal Desk."
            )
        else:
            body_params = [
                member.full_name or "Member",
                gym.name,
                expiry_date,
                str(max(days_left, 0)),
            ]
            fallback_text = (
                campaign.message_template
                or gym.renewal_reminder_template
                or f"Hi {member.full_name}, your membership at {gym.name} expires on {expiry_date}."
            )

        result = None
        if template_name:
            result = whatsapp.send_template(
                to=phone,
                template_name=template_name,
                language_code=template_language,
                body_parameters=body_params,
            )

        if not result or not result.ok:
            result = whatsapp.send_text(to=phone, body=fallback_text)

        if result and result.ok:
            recipient.sent_at = utcnow()
            recipient.status = "sent"
            recipient.provider_message_id = result.provider_message_id
            sent += 1
        else:
            recipient.status = "failed"
            recipient.error_message = result.error if result else "Failed to send"
            failed += 1

    campaign.total_sent = sent
    campaign.status = "sent"
    campaign.completed_at = utcnow()
    if failed and not sent:
        campaign.status = "failed"
        campaign.error_message = f"All {failed} messages failed to send."

    audit(
        action="send_campaign",
        resource_type="campaign",
        resource_id=campaign.id,
        gym_id=gym_id,
        metadata={"sent": sent, "failed": failed, "total": len(recipients)},
    )
    db.session.commit()

    return {
        "success": True,
        "sent": sent,
        "failed": failed,
        "total": len(recipients),
        "message": f"Campaign sent to {sent} of {len(recipients)} contacts.",
    }


# ── Delivery tracking (called from webhook) ──────────────────────────


def update_campaign_delivery(provider_message_id: str, status: str) -> bool:
    """Update campaign recipient delivery status from WhatsApp webhook.

    Returns True if a campaign recipient was updated.
    """
    if not provider_message_id:
        return False

    recipient = CampaignRecipient.query.filter_by(
        provider_message_id=provider_message_id
    ).first()
    if not recipient:
        return False

    now = utcnow()
    updated = False

    if status in ("sent", "delivered") and not recipient.delivered_at:
        recipient.delivered_at = now
        recipient.status = "delivered"
        updated = True
        # Update campaign counter
        campaign = recipient.campaign
        if campaign:
            campaign.total_delivered = (
                CampaignRecipient.query.filter_by(campaign_id=campaign.id)
                .filter(CampaignRecipient.delivered_at.isnot(None))
                .count()
            )

    if status == "read" and not recipient.read_at:
        if not recipient.delivered_at:
            recipient.delivered_at = now
        recipient.read_at = now
        recipient.status = "read"
        updated = True
        campaign = recipient.campaign
        if campaign:
            campaign.total_read = (
                CampaignRecipient.query.filter_by(campaign_id=campaign.id)
                .filter(CampaignRecipient.read_at.isnot(None))
                .count()
            )

    return updated


def track_campaign_reply(gym_id: int, sender_phone: str) -> bool:
    """Track a reply from a member against any recent campaign they received.

    Called when the webhook processes an inbound message from a known member.
    Returns True if a campaign recipient was updated.
    """
    # Find recent campaigns sent to this phone
    recent_cutoff = utcnow() - timedelta(days=14)
    recipient = (
        CampaignRecipient.query.filter_by(gym_id=gym_id)
        .filter(CampaignRecipient.phone_snapshot == sender_phone)
        .filter(CampaignRecipient.sent_at >= recent_cutoff)
        .filter(CampaignRecipient.reply_at.is_(None))
        .order_by(CampaignRecipient.sent_at.desc())
        .first()
    )
    if not recipient:
        return False

    recipient.reply_at = utcnow()
    if recipient.status in ("sent", "delivered", "read"):
        recipient.status = "replied"

    campaign = recipient.campaign
    if campaign:
        campaign.total_replied = (
            CampaignRecipient.query.filter_by(campaign_id=campaign.id)
            .filter(CampaignRecipient.reply_at.isnot(None))
            .count()
        )

    return True


# ── Campaign attribution ──────────────────────────────────────────────


def attribute_renewal_to_campaign(
    member_id: int, gym_id: int, renewal_id: int, renewal_amount: Decimal
) -> int | None:
    """Check if this renewal should be attributed to a recent campaign.

    Looks for the most recent campaign recipient record for this member
    within the campaign's attribution window.

    Returns the campaign_id if attributed, None otherwise.
    """
    now = utcnow()

    # Find campaign recipients for this member, most recent first
    recipients = (
        CampaignRecipient.query.filter_by(member_id=member_id, gym_id=gym_id)
        .filter(CampaignRecipient.sent_at.isnot(None))
        .filter(CampaignRecipient.renewed_at.is_(None))
        .join(Campaign)
        .order_by(CampaignRecipient.sent_at.desc())
        .all()
    )

    for recipient in recipients:
        campaign = recipient.campaign
        if not campaign:
            continue

        window = timedelta(days=campaign.attribution_window_days)
        if recipient.sent_at:
            sent_at = recipient.sent_at if recipient.sent_at.tzinfo is not None else recipient.sent_at.replace(tzinfo=tz.utc)
            cmp_now = now if now.tzinfo is not None else now.replace(tzinfo=tz.utc)
            if (cmp_now - sent_at) <= window:
                # Within attribution window — attribute this renewal
                recipient.renewed_at = now
                recipient.renewal_amount = renewal_amount
                recipient.renewal_id = renewal_id
                recipient.status = "renewed"

                # Update campaign counters
                campaign.total_renewed = (
                    CampaignRecipient.query.filter_by(campaign_id=campaign.id)
                    .filter(CampaignRecipient.renewed_at.isnot(None))
                    .count()
                )
                campaign.total_revenue_recovered = (
                    db.session.query(func.coalesce(func.sum(CampaignRecipient.renewal_amount), 0))
                    .filter(
                        CampaignRecipient.campaign_id == campaign.id,
                        CampaignRecipient.renewed_at.isnot(None),
                        CampaignRecipient.renewal_amount.isnot(None),
                    )
                    .scalar()
                )

                _logger.info(
                    "Attributed renewal %s to campaign %s for member %s (₹%s)",
                    renewal_id, campaign.id, member_id, renewal_amount,
                )
                return campaign.id

    return None


# ── Campaign results ──────────────────────────────────────────────────


def get_campaign_results(campaign_id: int, gym_id: int) -> dict[str, Any] | None:
    """Return detailed results for a campaign."""
    campaign = Campaign.query.filter_by(id=campaign_id, gym_id=gym_id).first()
    if not campaign:
        return None

    return {
        "id": campaign.id,
        "name": campaign.name,
        "segment_type": campaign.segment_type,
        "status": campaign.status,
        "sent_at": campaign.sent_at.isoformat() if campaign.sent_at else None,
        "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
        "total_recipients": campaign.total_recipients,
        "total_sent": campaign.total_sent,
        "total_delivered": campaign.total_delivered,
        "total_read": campaign.total_read,
        "total_replied": campaign.total_replied,
        "total_renewed": campaign.total_renewed,
        "total_revenue_recovered": str(campaign.total_revenue_recovered),
        "attribution_window_days": campaign.attribution_window_days,
        "created_by": campaign.created_by.full_name if campaign.created_by else None,
        "error_message": campaign.error_message,
        "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
    }
