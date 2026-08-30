"""Server-side record of a verified Google Play subscription.

Purchase tokens are never stored in clear text.  Google remains the payment
provider; this table associates a verified purchase with one Renewal Desk gym
and gives reconciliation a durable, tenant-scoped record to update.
"""
from __future__ import annotations

from app.extensions import db
from app.models.mixins import TimestampMixin


class GooglePlaySubscription(TimestampMixin, db.Model):
    __tablename__ = "google_play_subscriptions"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_id = db.Column(db.String(160), nullable=False, index=True)
    purchase_token_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)
    purchase_token_encrypted = db.Column(db.Text, nullable=True)
    order_id = db.Column(db.String(160), nullable=True, unique=True, index=True)
    state = db.Column(db.String(32), nullable=False, default="PENDING", index=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    renews_at = db.Column(db.DateTime(timezone=True), nullable=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    grace_period_end = db.Column(db.DateTime(timezone=True), nullable=True)
    last_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)
    external_account_id = db.Column(db.String(128), nullable=True, index=True)

    gym = db.relationship("Gym")
    owner = db.relationship("User")
