from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow


class BridgeRelease(TimestampMixin, db.Model):
    """Catalog of versioned Windows Bridge releases for hardware turnstile distribution."""

    __tablename__ = "bridge_releases"
    __table_args__ = (
        UniqueConstraint("version", "build_number", name="uq_bridge_releases_version_build"),
        Index("ix_bridge_releases_channel_active", "release_channel", "is_active"),
        CheckConstraint(
            "release_channel IN ('testing', 'stable', 'deprecated')",
            name="ck_bridge_releases_channel",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.String(32), nullable=False, index=True)  # e.g. "1.0.0", "2.0.0"
    build_number = db.Column(db.Integer, nullable=False, default=1)
    release_channel = db.Column(db.String(32), nullable=False, default="testing", index=True)
    supported_os = db.Column(db.String(120), nullable=False, default="Windows 10/11 x64")
    min_supported_app_version = db.Column(db.String(32), nullable=False, default="v2.0")
    max_supported_app_version = db.Column(db.String(32), nullable=True)
    bridge_protocol_version = db.Column(db.Integer, nullable=False, default=2)

    filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(512), nullable=False)
    file_size_bytes = db.Column(BigInteger, nullable=False, default=0)
    sha256_checksum = db.Column(db.String(64), nullable=False)
    release_notes = db.Column(db.Text, nullable=True)

    created_by_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_current_stable = db.Column(db.Boolean, nullable=False, default=False, index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    downloads_count = db.Column(db.Integer, nullable=False, default=0)

    created_by = db.relationship("User")
    installations = db.relationship(
        "BridgeInstallation",
        back_populates="release",
        foreign_keys="BridgeInstallation.release_id",
    )

    @classmethod
    def compute_sha256(cls, file_data: bytes) -> str:
        return hashlib.sha256(file_data).hexdigest()

    @property
    def formatted_size(self) -> str:
        size = self.file_size_bytes or 0
        if size >= 1024 * 1024:
            return f"{size / (1024 * 1024):.2f} MB"
        elif size >= 1024:
            return f"{size / 1024:.1f} KB"
        return f"{size} B"

    @classmethod
    def get_latest_stable(cls) -> BridgeRelease | None:
        release = cls.query.filter_by(release_channel="stable", is_active=True, is_current_stable=True).first()
        if not release:
            release = (
                cls.query.filter_by(release_channel="stable", is_active=True)
                .order_by(cls.created_at.desc(), cls.id.desc())
                .first()
            )
        return release

    @classmethod
    def get_latest_available(cls) -> BridgeRelease | None:
        return (
            cls.query.filter(cls.release_channel.in_(["stable", "testing"]), cls.is_active == True)
            .order_by(cls.created_at.desc(), cls.id.desc())
            .first()
        )
