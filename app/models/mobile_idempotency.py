"""Persistence for safe retries of mutating mobile API requests."""
from __future__ import annotations

from app.extensions import db
from app.models.mixins import utcnow


class MobileIdempotencyKey(db.Model):
    """Stores the completed response for one tenant-scoped mobile request.

    Keys are scoped to the authenticated user, gym, and operation so a retry
    cannot replay an unrelated endpoint or cross a tenant boundary.
    """

    __tablename__ = "mobile_idempotency_keys"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope = db.Column(db.String(96), nullable=False)
    key = db.Column(db.String(128), nullable=False)
    request_hash = db.Column(db.String(64), nullable=False)
    status_code = db.Column(db.Integer, nullable=False)
    response_body = db.Column(db.JSON, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint(
            "gym_id", "user_id", "scope", "key", name="uq_mobile_idempotency_scope_key"
        ),
    )

    gym = db.relationship("Gym")
    user = db.relationship("User")
