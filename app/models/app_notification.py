"""App notification inbox records for gym owners and staff."""
from __future__ import annotations

from app.extensions import db
from app.models.mixins import TimestampMixin


class AppNotification(TimestampMixin, db.Model):
    """In-app notification records visible in the notification inbox."""
    __tablename__ = "app_notifications"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )  # Null means all staff/owners of the gym
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text, nullable=False)
    # category: handover, lead, trial, payment, renewal, general
    category = db.Column(db.String(64), nullable=False, default="general", index=True)
    data = db.Column(db.JSON, nullable=True)  # Stores navigation info e.g. {"conversation_id": 1, "screen": "BotConversationDetail"}
    is_read = db.Column(db.Boolean, nullable=False, default=False, index=True)

    gym = db.relationship("Gym", backref=db.backref("app_notifications", cascade="all, delete-orphan"))
    user = db.relationship("User", backref=db.backref("app_notifications", cascade="all, delete-orphan"))
