from __future__ import annotations

import logging

from jinja2 import Undefined
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import Index

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


_JINJA_ENV = SandboxedEnvironment(undefined=Undefined, autoescape=False)
_logger = logging.getLogger(__name__)


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
        context = {
            "gym_name": gym_name,
            "member_name": member_name,
            "expiry_date": expiry_date,
        }
        try:
            return _JINJA_ENV.from_string(self.message_body).render(**context)
        except Exception as exc:
            _logger.error(
                "Template %s (gym %s) failed to render: %s",
                self.id,
                self.gym_id,
                exc,
            )
            try:
                import sentry_sdk

                sentry_sdk.capture_exception(exc)
            except Exception:
                pass
            return (
                f"Hi {member_name}, your {gym_name} membership expires on "
                f"{expiry_date}. Please renew to keep access active."
            )
