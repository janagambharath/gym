from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class ReminderLog(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "reminder_logs"
    __table_args__ = (
        UniqueConstraint(
            "gym_id",
            "member_id",
            "cycle_end_date",
            "reminder_stage",
            "channel",
            name="uq_reminder_member_cycle_stage_channel",
        ),
        Index("ix_reminders_gym_status", "gym_id", "status"),
        Index("ix_reminders_gym_scheduled", "gym_id", "scheduled_for"),
        Index("ix_reminders_member_cycle", "member_id", "cycle_end_date"),
        Index("ix_reminders_provider_message", "provider_message_id"),
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')",
            name="ck_reminders_status",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    template_id = db.Column(
        db.Integer, db.ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True
    )
    channel = db.Column(db.String(32), nullable=False, default="whatsapp")
    reminder_stage = db.Column(db.String(64), nullable=False)
    cycle_end_date = db.Column(db.Date, nullable=False)
    scheduled_for = db.Column(db.Date, nullable=False)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)
    status = db.Column(db.String(32), nullable=False, default="pending", index=True)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    phone_snapshot = db.Column(db.String(40), nullable=False)
    message_snapshot = db.Column(db.Text, nullable=True)
    provider_message_id = db.Column(db.String(255), nullable=True)
    error_message = db.Column(db.Text, nullable=True)

    member = db.relationship("Member", back_populates="reminders")
    template = db.relationship("NotificationTemplate", back_populates="reminder_logs")
