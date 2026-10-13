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


class ConsumedHandshakeToken(db.Model):
    """Single-use record for handshake tokens (2026-10-13).

    Handshake tokens are short-lived (10 min) and purpose-scoped, but without
    server-side consumption tracking they are replayable for the whole window.
    Recording the token hash on first use (unique constraint) makes replay
    attempts fail atomically. Rows are tiny and purged after expiry.
    """

    __tablename__ = "consumed_handshake_tokens"

    id = db.Column(db.Integer, primary_key=True)
    token_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    purpose = db.Column(db.String(64), nullable=False)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    consumed_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)


class OtpAttempt(db.Model):
    """Server-side OTP guess counter (2026-10-13).

    The OTP challenge is stateless-HMAC, so without this table the 6-digit
    code could be brute-forced across many IPs (the 10/min/IP limiter is
    per-IP only). Keyed by challenge hash; each challenge gets a fixed
    attempt budget regardless of source IP. Rows expire with the challenge.
    """

    __tablename__ = "otp_attempts"

    id = db.Column(db.Integer, primary_key=True)
    challenge_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
