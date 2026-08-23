from __future__ import annotations

from app.extensions import db
from app.models.mixins import utcnow


class MobileRefreshToken(db.Model):
    """Server-side record for mobile refresh-token rotation and replay detection."""

    __tablename__ = "mobile_refresh_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    family_id = db.Column(db.String(64), nullable=False, index=True)
    is_used = db.Column(db.Boolean, nullable=False, default=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    user = db.relationship("User")
    gym = db.relationship("Gym")
