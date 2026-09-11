"""Campaign models — segment-based renewal campaigns with attribution tracking.

A ``Campaign`` represents a targeted outreach effort to a specific member
segment (e.g. expiring in 7 days, inactive 30+ days).  Each member who
receives the campaign message gets a ``CampaignRecipient`` row that tracks
the full lifecycle: sent → delivered → read → replied → renewed.

Campaign attribution connects renewals back to the campaign that prompted
them, enabling the "Revenue Recovered" metric.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


# Valid segment types for campaign targeting
SEGMENT_TYPES = (
    "expiring_today",
    "expiring_3d",
    "expiring_7d",
    "expiring_14d",
    "expiring_30d",
    "recently_expired",
    "inactive_30d",
    "inactive_60d",
    "inactive_90d",
    "all_active",
    "all_expired",
    "all_customers",
    "custom_import",
)

CAMPAIGN_STATUSES = ("draft", "sending", "sent", "completed", "failed")


class Campaign(TenantMixin, TimestampMixin, db.Model):
    """A targeted outreach campaign to a segment of gym members."""

    __tablename__ = "campaigns"
    __table_args__ = (
        Index("ix_campaigns_gym_status", "gym_id", "status"),
        Index("ix_campaigns_gym_segment", "gym_id", "segment_type"),
        Index("ix_campaigns_gym_type", "gym_id", "campaign_type"),
        Index("ix_campaigns_gym_created", "gym_id", "created_at"),
        CheckConstraint(
            "status IN ('draft', 'sending', 'sent', 'completed', 'failed')",
            name="ck_campaigns_status",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    campaign_type = db.Column(db.String(32), nullable=False, default="recovery", server_default="recovery", index=True)
    promo_preset = db.Column(db.String(64), nullable=True)
    segment_type = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="draft", index=True)

    # Message content
    message_template = db.Column(db.Text, nullable=True)
    whatsapp_template_name = db.Column(db.String(120), nullable=True)

    # Attribution
    attribution_window_days = db.Column(db.Integer, nullable=False, default=7)

    # Execution tracking
    created_by_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Aggregate counters (denormalized for fast dashboard reads)
    total_recipients = db.Column(db.Integer, nullable=False, default=0)
    total_sent = db.Column(db.Integer, nullable=False, default=0)
    total_delivered = db.Column(db.Integer, nullable=False, default=0)
    total_read = db.Column(db.Integer, nullable=False, default=0)
    total_replied = db.Column(db.Integer, nullable=False, default=0)
    total_renewed = db.Column(db.Integer, nullable=False, default=0)
    total_revenue_recovered = db.Column(
        db.Numeric(12, 2), nullable=False, default=Decimal("0.00")
    )

    # Error tracking
    error_message = db.Column(db.Text, nullable=True)

    # Relationships
    gym = db.relationship("Gym")
    created_by = db.relationship("User")
    recipients = db.relationship(
        "CampaignRecipient",
        back_populates="campaign",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )


class CampaignRecipient(TimestampMixin, db.Model):
    """Per-member tracking for a campaign — the full delivery lifecycle."""

    __tablename__ = "campaign_recipients"
    __table_args__ = (
        UniqueConstraint("campaign_id", "member_id", name="uq_campaign_recipient"),
        Index("ix_campaign_recipients_campaign", "campaign_id"),
        Index("ix_campaign_recipients_member", "member_id"),
        Index("ix_campaign_recipients_message_id", "provider_message_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    campaign_id = db.Column(
        db.Integer,
        db.ForeignKey("campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    member_id = db.Column(
        db.Integer,
        db.ForeignKey("members.id", ondelete="CASCADE"),
        nullable=False,
    )
    gym_id = db.Column(
        db.Integer,
        db.ForeignKey("gyms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # WhatsApp message tracking
    provider_message_id = db.Column(db.String(255), nullable=True)
    phone_snapshot = db.Column(db.String(40), nullable=True)

    # Delivery lifecycle timestamps
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    delivered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    read_at = db.Column(db.DateTime(timezone=True), nullable=True)
    reply_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Renewal attribution
    payment_claimed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    renewed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    renewal_amount = db.Column(db.Numeric(10, 2), nullable=True)
    renewal_id = db.Column(
        db.Integer,
        db.ForeignKey("renewal_history.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Status for quick filtering
    status = db.Column(db.String(32), nullable=False, default="pending")
    # pending, sent, delivered, read, replied, renewed, failed
    error_message = db.Column(db.Text, nullable=True)

    # Relationships
    campaign = db.relationship("Campaign", back_populates="recipients")
    member = db.relationship("Member")
    gym = db.relationship("Gym")
    renewal = db.relationship("RenewalHistory")
