from __future__ import annotations

from datetime import datetime, timezone
from flask import Blueprint, flash, redirect, render_template, request, url_for, jsonify
from flask_login import current_user, login_required
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import Gym, Member
from app.models.bot import (
    BotConversation,
    BotMessage,
    BotLead,
    BotFAQ,
    GymBotConfig,
    BotKnowledgeItem,
)
from app.services.audit_service import audit
from app.services.whatsapp_service import WhatsAppService
from app.utils.decorators import active_gym_required, roles_required


bot_web_bp = Blueprint("bot_web", __name__, url_prefix="/bot")


@bot_web_bp.route("/")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def index():
    gym_id = current_user.gym_id
    total_conversations = BotConversation.query.filter_by(gym_id=gym_id).count()
    active_handovers = BotConversation.query.filter(
        BotConversation.gym_id == gym_id,
        BotConversation.handover_status.in_(["human_requested", "human_active"]),
    ).count()
    total_leads = BotLead.query.filter_by(gym_id=gym_id).count()
    trials_booked = BotLead.query.filter_by(gym_id=gym_id, status="trial_booked").count()

    recent_leads = (
        BotLead.query.filter_by(gym_id=gym_id)
        .order_by(BotLead.created_at.desc())
        .limit(8)
        .all()
    )

    recent_conversations = (
        BotConversation.query.filter_by(gym_id=gym_id)
        .order_by(BotConversation.last_message_at.desc().nullslast())
        .limit(8)
        .all()
    )

    return render_template(
        "bot/index.html",
        total_conversations=total_conversations,
        active_handovers=active_handovers,
        total_leads=total_leads,
        trials_booked=trials_booked,
        recent_leads=recent_leads,
        recent_conversations=recent_conversations,
    )


@bot_web_bp.route("/inbox")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def inbox():
    gym_id = current_user.gym_id
    selected_id = request.args.get("conv_id", type=int)
    filter_mode = request.args.get("filter", "all").strip()

    query = BotConversation.query.filter_by(gym_id=gym_id)
    if filter_mode == "human":
        query = query.filter(BotConversation.handover_status.in_(["human_requested", "human_active"]))
    elif filter_mode == "ai":
        query = query.filter(BotConversation.handover_status.in_(["bot_active", "bot_resumed"]))

    conversations = query.order_by(BotConversation.last_message_at.desc().nullslast()).limit(50).all()

    selected_conv = None
    messages = []
    lead = None
    member = None

    if selected_id:
        selected_conv = BotConversation.query.filter_by(id=selected_id, gym_id=gym_id).first()
    elif conversations:
        selected_conv = conversations[0]

    if selected_conv:
        messages = (
            BotMessage.query.filter_by(conversation_id=selected_conv.id)
            .order_by(BotMessage.created_at.asc())
            .all()
        )
        lead = BotLead.query.filter_by(conversation_id=selected_conv.id).first()
        member = Member.query.filter_by(gym_id=gym_id, phone=selected_conv.phone, deleted_at=None).first()

    return render_template(
        "bot/inbox.html",
        conversations=conversations,
        selected_conv=selected_conv,
        messages=messages,
        lead=lead,
        member=member,
        filter_mode=filter_mode,
    )


@bot_web_bp.route("/conversations/<int:conv_id>/handover", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def toggle_handover(conv_id: int):
    gym_id = current_user.gym_id
    conv = BotConversation.query.filter_by(id=conv_id, gym_id=gym_id).first()
    if not conv:
        flash("Conversation not found.", "warning")
        return redirect(url_for("bot_web.inbox"))

    is_human = conv.handover_status in ["human_requested", "human_active"]
    conv.handover_status = "bot_active" if is_human else "human_active"
    db.session.commit()

    action_label = "Handed Back to AI Receptionist" if is_human else "Human Staff Takeover Active"
    audit(
        action="toggle_bot_handover",
        resource_type="bot_conversation",
        resource_id=conv.id,
        metadata={"handover_status": conv.handover_status},
    )
    flash(f"Conversation {conv.phone}: {action_label}.", "success")
    return redirect(url_for("bot_web.inbox", conv_id=conv.id))


@bot_web_bp.route("/conversations/<int:conv_id>/send", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def send_staff_message(conv_id: int):
    gym_id = current_user.gym_id
    conv = BotConversation.query.filter_by(id=conv_id, gym_id=gym_id).first()
    if not conv:
        flash("Conversation not found.", "warning")
        return redirect(url_for("bot_web.inbox"))

    body = (request.form.get("message") or "").strip()
    if not body:
        flash("Enter a message to send.", "warning")
        return redirect(url_for("bot_web.inbox", conv_id=conv.id))

    ws = WhatsAppService(gym=current_user.gym)
    res = ws.send_text(to=conv.phone, body=body)

    if not res.ok:
        flash(f"Failed to send WhatsApp message: {res.error}", "danger")
        return redirect(url_for("bot_web.inbox", conv_id=conv.id))

    msg = BotMessage(
        conversation_id=conv.id,
        sender="staff",
        body=body,
        created_at=datetime.now(timezone.utc),
    )
    conv.last_message_at = datetime.now(timezone.utc)
    conv.handover_status = "human_active"  # Automatically maintain human handover once staff replies
    db.session.add(msg)
    db.session.commit()

    audit(
        action="send_staff_reply",
        resource_type="bot_message",
        resource_id=msg.id,
        metadata={"to": conv.phone, "conv_id": conv.id},
    )
    flash("Message sent to WhatsApp.", "success")
    return redirect(url_for("bot_web.inbox", conv_id=conv.id))


@bot_web_bp.route("/leads")
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def leads():
    gym_id = current_user.gym_id
    page = request.args.get("page", 1, type=int)
    status_filter = request.args.get("status", "").strip()

    query = BotLead.query.filter_by(gym_id=gym_id)
    if status_filter:
        query = query.filter_by(status=status_filter)

    pagination = (
        query.order_by(BotLead.created_at.desc())
        .paginate(page=page, per_page=20, error_out=False)
    )

    return render_template(
        "bot/leads.html",
        pagination=pagination,
        status_filter=status_filter,
    )


@bot_web_bp.route("/leads/<int:lead_id>/status", methods=["POST"])
@login_required
@active_gym_required
@roles_required("gym_owner", "staff")
def update_lead_status(lead_id: int):
    gym_id = current_user.gym_id
    lead = BotLead.query.filter_by(id=lead_id, gym_id=gym_id).first()
    if not lead:
        flash("Lead not found.", "warning")
        return redirect(url_for("bot_web.leads"))

    new_status = request.form.get("status", "").strip()
    notes = request.form.get("notes", "").strip()

    valid_statuses = {"new", "contacted", "trial_booked", "converted", "lost"}
    if new_status in valid_statuses:
        lead.status = new_status
    if notes:
        lead.notes = notes

    db.session.commit()
    audit(
        action="update_lead_status",
        resource_type="bot_lead",
        resource_id=lead.id,
        metadata={"status": lead.status},
    )
    flash("Lead status updated.", "success")
    return redirect(url_for("bot_web.leads"))


@bot_web_bp.route("/setup", methods=["GET", "POST"])
@login_required
@active_gym_required
@roles_required("gym_owner")
def setup():
    gym_id = current_user.gym_id
    config = GymBotConfig.query.filter_by(gym_id=gym_id).first()
    if not config:
        config = GymBotConfig(gym_id=gym_id)
        db.session.add(config)
        db.session.commit()

    faqs = BotFAQ.query.filter_by(gym_id=gym_id).order_by(BotFAQ.priority.desc(), BotFAQ.id.asc()).all()

    if request.method == "POST":
        action = request.form.get("action", "")
        if action == "update_config":
            config.greeting_message = request.form.get("greeting_message")
            config.opening_hours = request.form.get("opening_hours")
            config.map_link = request.form.get("map_link")
            config.trial_enabled = bool(request.form.get("trial_enabled"))
            trial_price = request.form.get("trial_price")
            config.trial_price = float(trial_price) if trial_price else None
            trial_days = request.form.get("trial_duration_days")
            config.trial_duration_days = int(trial_days) if trial_days else None
            config.handover_enabled = bool(request.form.get("handover_enabled"))
            db.session.commit()
            audit(action="update_bot_config", resource_type="gym_bot_config", resource_id=config.id)
            flash("AI Receptionist business profile updated.", "success")
        elif action == "add_faq":
            question = (request.form.get("question") or "").strip()
            answer = (request.form.get("answer") or "").strip()
            if question and answer:
                faq = BotFAQ(gym_id=gym_id, question=question, answer=answer, enabled=True)
                db.session.add(faq)
                db.session.commit()
                audit(action="create_bot_faq", resource_type="bot_faq", resource_id=faq.id)
                flash("New FAQ added to AI knowledge base.", "success")
        elif action == "delete_faq":
            faq_id = request.form.get("faq_id", type=int)
            faq = BotFAQ.query.filter_by(id=faq_id, gym_id=gym_id).first()
            if faq:
                db.session.delete(faq)
                db.session.commit()
                audit(action="delete_bot_faq", resource_type="bot_faq", resource_id=faq_id)
                flash("FAQ deleted.", "info")

        return redirect(url_for("bot_web.setup"))

    return render_template(
        "bot/setup.html",
        config=config,
        faqs=faqs,
    )
