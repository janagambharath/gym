"""AccessEvent model — normalised access events for the Live Access feature.

Each ``BridgeAttendance`` record is processed into exactly one ``AccessEvent``
with enriched semantics (event type, direction, member state snapshot).  The
``source_event_id`` column links back to the raw attendance record for audit
and guarantees idempotent processing.
"""
from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow


class AccessEvent(TimestampMixin, db.Model):
    __tablename__ = "access_events"
    __table_args__ = (
        UniqueConstraint("gym_id", "source_event_id", name="uq_access_events_source"),
        Index("ix_access_events_gym_time", "gym_id", "event_timestamp"),
        Index("ix_access_events_gym_member_time", "gym_id", "member_id", "event_timestamp"),
        Index("ix_access_events_gym_type_time", "gym_id", "event_type", "event_timestamp"),
    )

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer,
        db.ForeignKey("gyms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    member_id = db.Column(
        db.Integer,
        db.ForeignKey("members.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    bridge_id = db.Column(
        db.Integer,
        db.ForeignKey("bridge_installations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Semantic classification
    event_type = db.Column(db.String(32), nullable=False, index=True)
    # ENTRY | EXIT | ACCESS_DENIED | ATTENDANCE | UNKNOWN
    direction = db.Column(db.String(16), nullable=False, default="UNKNOWN")
    # IN | OUT | UNKNOWN

    # Timestamps
    event_timestamp = db.Column(db.DateTime(timezone=True), nullable=False)
    received_timestamp = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    # Device identifiers
    device_enroll_number = db.Column(db.String(32), nullable=False)
    source_event_id = db.Column(db.String(128), nullable=False)

    # Raw device fields (retained for diagnostics, not used for logic)
    att_state = db.Column(db.Integer, nullable=True)
    verify_method = db.Column(db.Integer, nullable=True)
    is_invalid = db.Column(db.Boolean, nullable=False, default=False)

    # Denormalised snapshots for display (avoids JOINs in feed queries)
    member_name = db.Column(db.String(160), nullable=True)
    membership_status = db.Column(db.String(32), nullable=True)
    device_name = db.Column(db.String(120), nullable=True)

    # Relationships
    gym = db.relationship("Gym")
    member = db.relationship("Member")
    bridge = db.relationship("BridgeInstallation")
