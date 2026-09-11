"""MemberAccessState model — tracks who is currently inside the gym.

Instead of scanning all access events to compute "currently inside", this table
maintains the latest access state for each member.  It is updated atomically
when a new ``AccessEvent`` is persisted, using event-timestamp ordering to
protect against out-of-order or delayed events.
"""
from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import utcnow


class MemberAccessState(db.Model):
    __tablename__ = "member_access_states"
    __table_args__ = (
        UniqueConstraint("gym_id", "member_id", name="uq_member_access_state_gym_member"),
        Index("ix_member_access_state_gym_state", "gym_id", "current_state"),
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
        db.ForeignKey("members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # INSIDE | OUTSIDE | UNKNOWN
    current_state = db.Column(db.String(16), nullable=False, default="UNKNOWN")

    last_event_id = db.Column(
        db.Integer,
        db.ForeignKey("access_events.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_event_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)
    last_entry_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_exit_at = db.Column(db.DateTime(timezone=True), nullable=True)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    # Relationships
    gym = db.relationship("Gym")
    member = db.relationship("Member")
    last_event = db.relationship("AccessEvent")
