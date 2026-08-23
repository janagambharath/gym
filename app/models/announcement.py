from __future__ import annotations

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class Announcement(TenantMixin, TimestampMixin, db.Model):
    """A gym-owned WhatsApp announcement with persisted delivery results.

    An announcement is intentionally a separate record from a renewal reminder:
    a festival or operational message is an explicit owner action, must be
    auditable, and can have many independently retriable deliveries.
    """

    __tablename__ = "announcements"
    __table_args__ = (
        db.CheckConstraint(
            "delivery_mode IN ('session_message', 'approved_template')",
            name="ck_announcements_delivery_mode",
        ),
        db.CheckConstraint(
            "status IN ('queued', 'sending', 'completed', 'completed_with_failures')",
            name="ck_announcements_status",
        ),
        db.Index("ix_announcements_gym_created", "gym_id", "created_at"),
        db.Index("ix_announcements_status_lease", "status", "dispatch_lease_expires_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    created_by_user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title = db.Column(db.String(120), nullable=False)
    # Used only for session_message mode. Template mode saves an internal note
    # here so activity history still tells the owner why it was sent.
    message_body = db.Column(db.Text, nullable=False)
    delivery_mode = db.Column(db.String(32), nullable=False)
    template_name = db.Column(db.String(512), nullable=True)
    template_language = db.Column(db.String(32), nullable=True)
    # JSON list of supported variable names, for example ["member_name", "gym_name"].
    template_body_parameters = db.Column(db.Text, nullable=True)
    is_test = db.Column(db.Boolean, nullable=False, default=False)
    status = db.Column(db.String(40), nullable=False, default="queued", index=True)
    total_recipients = db.Column(db.Integer, nullable=False, default=0)
    sent_count = db.Column(db.Integer, nullable=False, default=0)
    failed_count = db.Column(db.Integer, nullable=False, default=0)
    skipped_count = db.Column(db.Integer, nullable=False, default=0)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    dispatch_lease_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    deliveries = db.relationship(
        "AnnouncementDelivery", back_populates="announcement", cascade="all, delete-orphan"
    )


class AnnouncementDelivery(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "announcement_deliveries"
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')",
            name="ck_announcement_deliveries_status",
        ),
        db.UniqueConstraint(
            "announcement_id", "member_id", name="uq_announcement_delivery_member"
        ),
        db.Index("ix_announcement_deliveries_announcement_status", "announcement_id", "status"),
        db.Index("ix_announcement_deliveries_gym_created", "gym_id", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    announcement_id = db.Column(
        db.Integer, db.ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    phone_snapshot = db.Column(db.String(40), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="pending", index=True)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    attempted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    provider_message_id = db.Column(db.String(255), nullable=True)
    error_message = db.Column(db.Text, nullable=True)

    announcement = db.relationship("Announcement", back_populates="deliveries")
    member = db.relationship("Member", back_populates="announcement_deliveries")
