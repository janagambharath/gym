"""Push Notification Service — Expo HTTP/2 Push API & In-App Notification Manager."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from flask import current_app

from app.extensions import db
from app.models import AppNotification, Gym, Member, PaymentVerification, User, UserPushToken
from app.models.bot import BotConversation, BotLead

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def send_expo_push_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Send a batch of push notifications to Expo Push service."""
    if not messages:
        return []

    req = urllib.request.Request(
        EXPO_PUSH_URL,
        data=json.dumps(messages).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("data", [])
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
            logger.error("Expo push notification HTTP error %d: %s", exc.code, body)
        except Exception:
            logger.error("Expo push notification HTTP error %d", exc.code)
        return []
    except Exception as exc:
        logger.error("Failed to send Expo push notifications: %s", exc)
        return []


def create_and_dispatch_notification(
    *,
    gym_id: int,
    title: str,
    body: str,
    category: str = "general",
    data: Optional[Dict[str, Any]] = None,
    target_user_ids: Optional[List[int]] = None,
    channel_id: str = "default",
    sound: str = "default",
    priority: str = "high",
) -> AppNotification:
    """Creates in-app notification record and dispatches native push notifications to active device tokens."""
    data_payload = data or {}
    data_payload["category"] = category

    # 1. Save in-app notification record
    notif = AppNotification(
        gym_id=gym_id,
        user_id=target_user_ids[0] if target_user_ids and len(target_user_ids) == 1 else None,
        title=title,
        body=body,
        category=category,
        data=data_payload,
        is_read=False,
    )
    db.session.add(notif)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("Failed to save AppNotification for gym_id=%s", gym_id)

    # 2. Find active push tokens for target users or all gym staff/owners
    token_query = UserPushToken.query.filter_by(gym_id=gym_id, is_active=True)
    if target_user_ids:
        token_query = token_query.filter(UserPushToken.user_id.in_(target_user_ids))

    tokens = token_query.all()
    if not tokens:
        return notif

    # 3. Format Expo Push messages
    messages = []
    token_map = {}
    for t in tokens:
        if not t.push_token or not t.push_token.startswith("ExponentPushToken"):
            continue
        messages.append({
            "to": t.push_token,
            "title": title,
            "body": body,
            "sound": sound,
            "priority": priority,
            "channelId": channel_id,
            "data": data_payload,
            "badge": 1,
        })
        token_map[t.push_token] = t

    if not messages:
        return notif

    # 4. Dispatch via Expo API
    tickets = send_expo_push_messages(messages)
    
    # 5. Handle unregistered or invalid tokens
    for idx, ticket in enumerate(tickets):
        if ticket.get("status") == "error":
            details = ticket.get("details", {})
            error_code = details.get("error")
            if error_code in ("DeviceNotRegistered", "InvalidCredentials", "MessageTooBig"):
                push_token_str = messages[idx]["to"]
                token_obj = token_map.get(push_token_str)
                if token_obj:
                    token_obj.is_active = False
                    logger.info("Deactivated invalid push token for user_id=%s due to %s", token_obj.user_id, error_code)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()

    return notif


# ─── Trigger Functions ───────────────────────────────────────────────

def notify_handover_requested(gym: Gym, conversation: BotConversation, customer_message: str) -> None:
    """Triggered when a lead or member asks for human staff on WhatsApp."""
    customer_display = conversation.customer_name or f"+{conversation.phone}"
    snippet = customer_message[:80] + ("..." if len(customer_message) > 80 else "")
    title = f"🚨 Staff Handover: {customer_display}"
    body = f"Requested staff assistance: \"{snippet}\""
    
    create_and_dispatch_notification(
        gym_id=gym.id,
        title=title,
        body=body,
        category="handover",
        data={
            "screen": "BotConversationDetail",
            "conversation_id": conversation.id,
            "phone": conversation.phone,
            "customer_name": conversation.customer_name,
        },
        channel_id="urgent-alerts",
        sound="default",
        priority="high",
    )


def notify_new_lead(gym: Gym, lead: BotLead) -> None:
    """Triggered when a new prospective lead initiates a chat."""
    lead_display = lead.name or f"+{lead.phone}"
    title = f"🎯 New WhatsApp Lead: {lead_display}"
    intent = lead.intent or "membership inquiry"
    body = f"New inquiry regarding {intent}. Tap to view conversation."

    create_and_dispatch_notification(
        gym_id=gym.id,
        title=title,
        body=body,
        category="lead",
        data={
            "screen": "BotLeadDetail",
            "lead_id": lead.id,
            "phone": lead.phone,
            "name": lead.name,
        },
        channel_id="leads",
        sound="default",
        priority="high",
    )


def notify_trial_requested(gym: Gym, lead: BotLead) -> None:
    """Triggered when a lead requests a free trial workout."""
    lead_display = lead.name or f"+{lead.phone}"
    title = f"🎁 Free Trial Request: {lead_display}"
    body = "Lead requested a free workout trial pass. Follow up now!"

    create_and_dispatch_notification(
        gym_id=gym.id,
        title=title,
        body=body,
        category="trial",
        data={
            "screen": "BotLeadDetail",
            "lead_id": lead.id,
            "phone": lead.phone,
            "name": lead.name,
        },
        channel_id="leads",
        sound="default",
        priority="high",
    )


def notify_new_payment(gym: Gym, payment: PaymentVerification) -> None:
    """Triggered when a member payment is recorded / awaiting verification."""
    member_name = payment.member.full_name if payment.member else f"Member #{payment.member_id}"
    curr_symbols = {"INR": "₹", "USD": "$", "AED": "AED ", "GBP": "£", "EUR": "€", "AUD": "A$", "CAD": "C$", "SAR": "SAR "}
    symbol = curr_symbols.get(gym.currency or "INR", f"{gym.currency or 'INR'} ")
    title = f"💳 Payment Received: {symbol}{payment.amount}"
    body = f"{member_name} paid {symbol}{payment.amount} via {payment.method.upper()}. Tap to verify."

    create_and_dispatch_notification(
        gym_id=gym.id,
        title=title,
        body=body,
        category="payment",
        data={
            "screen": "PaymentDetail",
            "payment_id": payment.id,
            "member_id": payment.member_id,
        },
        channel_id="payments",
        sound="default",
        priority="high",
    )


def notify_expiring_members_daily(gym: Gym, expiring_count: int, expired_count: int) -> None:
    """Triggered during morning reminder run if members are expiring or overdue."""
    if expiring_count == 0 and expired_count == 0:
        return

    parts = []
    if expiring_count > 0:
        parts.append(f"{expiring_count} expiring today")
    if expired_count > 0:
        parts.append(f"{expired_count} overdue")

    title = "⏰ Daily Membership Alert"
    body = f"{', '.join(parts)}. WhatsApp reminders have been dispatched."

    create_and_dispatch_notification(
        gym_id=gym.id,
        title=title,
        body=body,
        category="renewal",
        data={"screen": "RenewalsHome"},
        channel_id="renewals",
        sound="default",
        priority="normal",
    )
