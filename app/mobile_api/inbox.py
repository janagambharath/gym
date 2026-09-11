"""Unified inbox endpoint — all conversations in one place.

Returns recent WhatsApp conversations, bot handovers, and campaign replies
in a single sorted list for the owner's inbox tab.
"""
from __future__ import annotations

from flask import g, jsonify, request
from sqlalchemy import desc, or_

from app.extensions import db
from app.models import Member, ReminderLog
from app.models.bot import BotConversation, BotMessage
from app.models.campaign import CampaignRecipient


def register_inbox_routes(bp):
    @bp.route("/inbox", methods=["GET"])
    def inbox():
        """Return a unified inbox of all recent conversations."""
        from app.mobile_api.middleware import token_required, roles_required

        @token_required
        @roles_required("gym_owner", "staff")
        def _inner():
            page = request.args.get("page", 1, type=int)
            page_size = min(request.args.get("page_size", 20, type=int), 50)
            filter_type = request.args.get("type", "all").strip()

            conversations = []

            # Bot conversations
            if filter_type in ("all", "bot"):
                bot_convos = (
                    BotConversation.query.filter_by(gym_id=g.gym_id)
                    .order_by(BotConversation.last_message_at.desc())
                    .limit(50)
                    .all()
                )
                for c in bot_convos:
                    last_msg = (
                        BotMessage.query.filter_by(conversation_id=c.id)
                        .order_by(BotMessage.created_at.desc())
                        .first()
                    )
                    conversations.append({
                        "id": f"bot-{c.id}",
                        "type": "bot",
                        "phone": c.phone,
                        "name": c.customer_name or f"+{c.phone}",
                        "last_message": last_msg.body[:100] if last_msg else "",
                        "last_message_at": (c.last_message_at or c.created_at).isoformat(),
                        "timestamp": (c.last_message_at or c.created_at).isoformat(),
                        "status": c.handover_status or c.state,
                        "is_handover": c.handover_status == "human_requested",
                        "unread": c.handover_status == "human_requested",
                        "source_id": c.id,
                    })

            # Campaign replies (members who replied to a campaign)
            if filter_type in ("all", "campaign"):
                campaign_replies = (
                    CampaignRecipient.query.filter_by(gym_id=g.gym_id)
                    .filter(CampaignRecipient.reply_at.isnot(None))
                    .order_by(CampaignRecipient.reply_at.desc())
                    .limit(30)
                    .all()
                )
                for r in campaign_replies:
                    member = r.member
                    conversations.append({
                        "id": f"campaign-{r.id}",
                        "type": "campaign_reply",
                        "phone": r.phone_snapshot or (member.phone if member else ""),
                        "name": member.full_name if member else f"+{r.phone_snapshot}",
                        "last_message": f"Replied to campaign: {r.campaign.name}" if r.campaign else "Campaign reply",
                        "last_message_at": r.reply_at.isoformat() if r.reply_at else "",
                        "timestamp": r.reply_at.isoformat() if r.reply_at else "",
                        "status": r.status,
                        "is_handover": False,
                        "unread": r.status == "replied",
                        "source_id": r.id,
                        "campaign_id": r.campaign_id,
                        "member_id": r.member_id,
                    })

            # Member inbound messages (from reminder logs)
            if filter_type in ("all", "member"):
                inbound_members = (
                    Member.query.filter_by(gym_id=g.gym_id)
                    .filter(Member.deleted_at.is_(None))
                    .filter(Member.last_inbound_at.isnot(None))
                    .order_by(Member.last_inbound_at.desc())
                    .limit(30)
                    .all()
                )
                # Exclude members already in bot conversations
                bot_phones = {c["phone"] for c in conversations if c["type"] == "bot"}
                for m in inbound_members:
                    phone = m.phone.lstrip("+").replace(" ", "") if m.phone else ""
                    if phone in bot_phones:
                        continue
                    conversations.append({
                        "id": f"member-{m.id}",
                        "type": "member",
                        "phone": phone,
                        "name": m.full_name,
                        "last_message": f"Last message from {m.full_name}",
                        "last_message_at": m.last_inbound_at.isoformat() if m.last_inbound_at else "",
                        "timestamp": m.last_inbound_at.isoformat() if m.last_inbound_at else "",
                        "status": m.status,
                        "is_handover": False,
                        "unread": False,
                        "source_id": m.id,
                        "member_id": m.id,
                    })

            # Sort all conversations by timestamp descending
            conversations.sort(key=lambda c: c.get("timestamp", ""), reverse=True)

            # Paginate
            total = len(conversations)
            start = (page - 1) * page_size
            end = start + page_size
            paginated = conversations[start:end]

            return jsonify({
                "success": True,
                "data": {
                    "conversations": paginated,
                    "pagination": {
                        "page": page,
                        "page_size": page_size,
                        "total": total,
                        "total_pages": (total + page_size - 1) // page_size,
                    },
                    "summary": {
                        "total": total,
                        "handovers": sum(1 for c in conversations if c.get("is_handover")),
                        "unread": sum(1 for c in conversations if c.get("unread")),
                    },
                },
            })

        return _inner()
