from __future__ import annotations

import string

from sqlalchemy import Index

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class NotificationTemplate(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "notification_templates"
    __table_args__ = (
        Index("ix_templates_gym_trigger", "gym_id", "trigger", "is_active"),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    channel = db.Column(db.String(32), nullable=False, default="whatsapp")
    trigger = db.Column(db.String(64), nullable=False, default="expiry_reminder")
    days_before = db.Column(db.Integer, nullable=False, default=3)
    message_body = db.Column(db.Text, nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    reminder_logs = db.relationship("ReminderLog", back_populates="template")

    def render(self, *, gym_name: str, member_name: str, expiry_date: str) -> str:
        values = {
            "gym_name": gym_name.replace("$", ""),
            "member_name": member_name.replace("$", ""),
            "expiry_date": expiry_date.replace("$", ""),
        }
        normalized = (
            self.message_body.replace("{{ gym_name }}", "${gym_name}")
            .replace("{{ member_name }}", "${member_name}")
            .replace("{{ expiry_date }}", "${expiry_date}")
        )
        try:
            return string.Template(normalized).safe_substitute(values)
        except Exception:
            return (
                self.message_body.replace("{{ gym_name }}", gym_name)
                .replace("{{ member_name }}", member_name)
                .replace("{{ expiry_date }}", expiry_date)
            )
