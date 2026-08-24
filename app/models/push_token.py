"""Push notification tokens for mobile devices."""
from __future__ import annotations

from app.extensions import db
from app.models.mixins import TimestampMixin


class UserPushToken(TimestampMixin, db.Model):
    """Stores Expo Push Tokens registered by mobile devices per user and gym."""
    __tablename__ = "user_push_tokens"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    push_token = db.Column(db.String(255), nullable=False, index=True)
    device_name = db.Column(db.String(128), nullable=True)
    platform = db.Column(db.String(32), nullable=False, default="android")  # android, ios, web
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    __table_args__ = (
        db.UniqueConstraint("gym_id", "user_id", "push_token", name="uq_user_push_token"),
    )

    gym = db.relationship("Gym", backref=db.backref("push_tokens", cascade="all, delete-orphan"))
    user = db.relationship("User", backref=db.backref("push_tokens", cascade="all, delete-orphan"))
