"""WhatsApp Bot models — tenant-scoped bot configuration, conversations, leads, and follow-ups."""
from __future__ import annotations

from datetime import datetime, timezone

from app.extensions import db
from app.models.mixins import TimestampMixin


def _utcnow():
    return datetime.now(timezone.utc)


# ─── Feature Entitlements ────────────────────────────────────────────

class FeatureEntitlement(TimestampMixin, db.Model):
    """Controls premium feature access per gym."""
    __tablename__ = "feature_entitlements"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature = db.Column(db.String(64), nullable=False, index=True)  # renewal_desk, whatsapp_bot, biometric, advanced_reports
    enabled = db.Column(db.Boolean, nullable=False, default=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.UniqueConstraint("gym_id", "feature", name="uq_entitlement_gym_feature"),
    )

    gym = db.relationship("Gym", backref=db.backref("entitlements", cascade="all, delete-orphan"))

    def is_active(self) -> bool:
        if not self.enabled:
            return False
        if self.expires_at and _utcnow() > self.expires_at:
            return False
        return True


# ─── Bot Configuration ───────────────────────────────────────────────

class GymBotConfig(TimestampMixin, db.Model):
    """Per-gym bot configuration — hours, trial settings, handover, etc."""
    __tablename__ = "gym_bot_configs"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # Business info (can override gym defaults)
    greeting_message = db.Column(db.Text, nullable=True)
    opening_hours = db.Column(db.Text, nullable=True)
    map_link = db.Column(db.String(512), nullable=True)
    # Trial
    trial_enabled = db.Column(db.Boolean, nullable=False, default=False)
    trial_price = db.Column(db.Numeric(10, 2), nullable=True)
    trial_duration_days = db.Column(db.Integer, nullable=True)
    # Registration / payment links
    registration_link = db.Column(db.String(512), nullable=True)
    payment_link = db.Column(db.String(512), nullable=True)
    # Follow-up
    followup_enabled = db.Column(db.Boolean, nullable=False, default=True)
    followup_delay_hours = db.Column(db.Integer, nullable=False, default=24)
    max_followups = db.Column(db.Integer, nullable=False, default=3)
    # Human handover
    handover_enabled = db.Column(db.Boolean, nullable=False, default=True)
    handover_staff_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    gym = db.relationship("Gym", backref=db.backref("bot_config", uselist=False, cascade="all, delete-orphan"))


# ─── FAQ ─────────────────────────────────────────────────────────────

class BotFAQ(TimestampMixin, db.Model):
    """Gym-specific FAQ pairs for bot knowledge base."""
    __tablename__ = "bot_faqs"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text, nullable=False)
    enabled = db.Column(db.Boolean, nullable=False, default=True)
    priority = db.Column(db.Integer, nullable=False, default=0)

    gym = db.relationship("Gym", backref=db.backref("bot_faqs", cascade="all, delete-orphan"))


# ─── Knowledge Items ─────────────────────────────────────────────────

class BotKnowledgeItem(TimestampMixin, db.Model):
    """Structured knowledge — facilities, trainers, services."""
    __tablename__ = "bot_knowledge_items"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category = db.Column(db.String(64), nullable=False)  # facility, trainer, service, class
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    enabled = db.Column(db.Boolean, nullable=False, default=True)

    gym = db.relationship("Gym", backref=db.backref("bot_knowledge", cascade="all, delete-orphan"))


# ─── Conversations ───────────────────────────────────────────────────

class BotConversation(TimestampMixin, db.Model):
    """Tracks each WhatsApp conversation with an unknown sender."""
    __tablename__ = "bot_conversations"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    phone = db.Column(db.String(40), nullable=False, index=True)
    customer_name = db.Column(db.String(160), nullable=True)
    # State: new, faq, plan_discovery, trial_interest, lead_capture, human_requested, human_active, bot_resumed, closed
    state = db.Column(db.String(32), nullable=False, default="new")
    # bot_active, human_requested, human_active, bot_resumed, closed
    handover_status = db.Column(db.String(32), nullable=False, default="bot_active")
    active_staff_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    last_message_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.UniqueConstraint("gym_id", "phone", name="uq_conversation_gym_phone"),
    )

    gym = db.relationship("Gym", backref=db.backref("bot_conversations", cascade="all, delete-orphan"))
    messages = db.relationship("BotMessage", back_populates="conversation", cascade="all, delete-orphan", order_by="BotMessage.created_at")
    lead = db.relationship("BotLead", back_populates="conversation", uselist=False, cascade="all, delete-orphan")


# ─── Messages ────────────────────────────────────────────────────────

class BotMessage(TimestampMixin, db.Model):
    """Individual messages in a bot conversation."""
    __tablename__ = "bot_messages"

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("bot_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # sender: customer, bot, staff, system
    sender = db.Column(db.String(16), nullable=False)
    body = db.Column(db.Text, nullable=False)
    # Meta provider message ID for deduplication
    provider_message_id = db.Column(db.String(128), nullable=True, unique=True)

    conversation = db.relationship("BotConversation", back_populates="messages")


# ─── Leads ───────────────────────────────────────────────────────────

class BotLead(TimestampMixin, db.Model):
    """Captured leads from bot conversations."""
    __tablename__ = "bot_leads"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("bot_conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name = db.Column(db.String(160), nullable=True)
    phone = db.Column(db.String(40), nullable=False, index=True)
    source = db.Column(db.String(64), nullable=False, default="whatsapp")
    intent = db.Column(db.String(128), nullable=True)  # membership, trial, enquiry
    interested_plan = db.Column(db.String(160), nullable=True)
    trial_requested = db.Column(db.Boolean, nullable=False, default=False)
    # Status: new, contacted, interested, trial_requested, booked, converted, lost, closed
    status = db.Column(db.String(32), nullable=False, default="new", index=True)
    assigned_staff_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    gym = db.relationship("Gym", backref=db.backref("bot_leads", cascade="all, delete-orphan"))
    conversation = db.relationship("BotConversation", back_populates="lead")


# ─── Follow-ups ──────────────────────────────────────────────────────

class BotFollowUp(TimestampMixin, db.Model):
    """Scheduled follow-up messages for leads."""
    __tablename__ = "bot_followups"

    id = db.Column(db.Integer, primary_key=True)
    lead_id = db.Column(
        db.Integer, db.ForeignKey("bot_leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_number = db.Column(db.Integer, nullable=False, default=1)
    scheduled_at = db.Column(db.DateTime(timezone=True), nullable=False)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # Status: pending, sent, cancelled, failed
    status = db.Column(db.String(32), nullable=False, default="pending")
    message = db.Column(db.Text, nullable=True)

    lead = db.relationship("BotLead", backref=db.backref("followups", cascade="all, delete-orphan"))


# ─── Booking Requests ────────────────────────────────────────────────

class BotBookingRequest(TimestampMixin, db.Model):
    """Trial/visit booking requests from bot conversations."""
    __tablename__ = "bot_booking_requests"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lead_id = db.Column(
        db.Integer, db.ForeignKey("bot_leads.id", ondelete="SET NULL"), nullable=True
    )
    name = db.Column(db.String(160), nullable=True)
    phone = db.Column(db.String(40), nullable=False)
    preferred_date = db.Column(db.Date, nullable=True)
    preferred_time = db.Column(db.String(64), nullable=True)
    intent = db.Column(db.String(128), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    # Status: pending, confirmed, cancelled
    status = db.Column(db.String(32), nullable=False, default="pending")

    gym = db.relationship("Gym", backref=db.backref("bot_bookings", cascade="all, delete-orphan"))
    lead = db.relationship("BotLead", backref=db.backref("booking_requests", cascade="all, delete-orphan"))
