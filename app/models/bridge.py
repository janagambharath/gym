from __future__ import annotations

import hashlib
import secrets
import uuid

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow


def hash_bridge_api_key(api_key: str) -> str:
    """Return the stored representation of a high-entropy bridge API key."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def generate_bridge_api_key() -> str:
    """Generate a key shown once to the installer and never stored in plaintext."""
    return "rdb_live_" + secrets.token_urlsafe(32)


def generate_bridge_public_id() -> str:
    """Generate the non-secret identifier stored in the gym laptop config."""
    return "bridge_" + uuid.uuid4().hex


class BridgeInstallation(TimestampMixin, db.Model):
    """One outbound-polling Renewal Desk Bridge installation for a gym.

    The local Windows bridge sends its public ID as ``gymId`` for backward
    compatibility with the original client contract.  That value is *not* a
    database gym ID and is not a secret; the API key determines the tenant.
    """

    __tablename__ = "bridge_installations"

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer,
        db.ForeignKey("gyms.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    public_id = db.Column(db.String(64), nullable=False, unique=True, index=True)
    api_key_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)
    # Bound at provisioning time to prevent a copied laptop config from being
    # used against a different biometric terminal.
    device_serial = db.Column(db.String(120), nullable=False, unique=True, index=True)
    display_name = db.Column(db.String(120), nullable=False, default="Gym biometric bridge")
    is_active = db.Column(db.Boolean, nullable=False, default=True, index=True)
    last_heartbeat_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_status = db.Column(db.String(32), nullable=True)

    gym = db.relationship("Gym", back_populates="bridge_installation")
    commands = db.relationship(
        "BridgeCommand", back_populates="bridge", cascade="all, delete-orphan"
    )
    attendance_events = db.relationship(
        "BridgeAttendance", back_populates="bridge", cascade="all, delete-orphan"
    )

    @classmethod
    def create_for_gym(
        cls, gym_id: int, display_name: str, device_serial: str
    ) -> tuple["BridgeInstallation", str]:
        raw_key = generate_bridge_api_key()
        installation = cls(
            gym_id=gym_id,
            public_id=generate_bridge_public_id(),
            api_key_hash=hash_bridge_api_key(raw_key),
            device_serial=device_serial.strip(),
            display_name=(display_name or "Gym biometric bridge").strip()[:120],
        )
        return installation, raw_key

    def rotate_key(self) -> str:
        raw_key = generate_bridge_api_key()
        self.api_key_hash = hash_bridge_api_key(raw_key)
        return raw_key


class BridgeCommand(TimestampMixin, db.Model):
    """Durable access command leased to, then acknowledged by, one bridge."""

    __tablename__ = "bridge_commands"
    __table_args__ = (
        CheckConstraint(
            "command_type IN ('enable_user', 'disable_user')",
            name="ck_bridge_commands_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'leased', 'acked', 'failed')",
            name="ck_bridge_commands_status",
        ),
        Index(
            "ix_bridge_commands_ready",
            "bridge_id",
            "status",
            "not_before",
            "lease_expires_at",
            "created_at",
        ),
        Index("ix_bridge_commands_member", "gym_id", "member_id", "created_at"),
    )

    id = db.Column(db.String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    bridge_id = db.Column(
        db.Integer,
        db.ForeignKey("bridge_installations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True
    )
    command_type = db.Column(db.String(32), nullable=False)
    enroll_number = db.Column(db.String(32), nullable=False)
    member_name = db.Column(db.String(160), nullable=True)
    delay_seconds = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(16), nullable=False, default="pending", index=True)
    delivery_attempts = db.Column(db.Integer, nullable=False, default=0)
    retry_attempt = db.Column(db.Integer, nullable=False, default=0)
    not_before = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    lease_token = db.Column(db.String(64), nullable=True, index=True)
    lease_expires_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    acknowledged_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_error = db.Column(db.Text, nullable=True)

    bridge = db.relationship("BridgeInstallation", back_populates="commands")
    member = db.relationship("Member", back_populates="bridge_commands")

    def lease(self, lease_token: str, lease_expires_at) -> None:
        self.status = "leased"
        self.lease_token = lease_token
        self.lease_expires_at = lease_expires_at
        self.delivery_attempts += 1
        self.last_error = None

    def acknowledge(self, status: str, error_message: str | None = None) -> None:
        self.status = status
        self.acknowledged_at = utcnow()
        self.last_error = (error_message or "").strip()[:1000] or None
        self.lease_token = None
        self.lease_expires_at = None


class BridgeAttendance(db.Model):
    """An idempotent attendance event uploaded by an authenticated bridge."""

    __tablename__ = "bridge_attendance"
    __table_args__ = (
        UniqueConstraint("bridge_id", "event_id", name="uq_bridge_attendance_event"),
        Index("ix_bridge_attendance_gym_time", "gym_id", "event_time"),
    )

    id = db.Column(db.Integer, primary_key=True)
    bridge_id = db.Column(
        db.Integer,
        db.ForeignKey("bridge_installations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_id = db.Column(db.String(128), nullable=False)
    device_enroll_number = db.Column(db.String(32), nullable=False)
    event_time = db.Column(db.DateTime(timezone=True), nullable=False)
    verify_method = db.Column(db.Integer, nullable=False)
    is_invalid = db.Column(db.Boolean, nullable=False, default=False)
    received_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    bridge = db.relationship("BridgeInstallation", back_populates="attendance_events")
    member = db.relationship("Member", back_populates="bridge_attendance")
