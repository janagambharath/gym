from __future__ import annotations

from sqlalchemy import Index

from app.extensions import db
from app.models.mixins import TimestampMixin


class AuditLog(TimestampMixin, db.Model):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_gym_created", "gym_id", "created_at"),
        Index("ix_audit_actor", "actor_user_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer, db.ForeignKey("gyms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    actor_user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action = db.Column(db.String(120), nullable=False)
    resource_type = db.Column(db.String(120), nullable=False)
    resource_id = db.Column(db.String(120), nullable=True)
    metadata_json = db.Column(db.JSON, nullable=True)
    ip_address = db.Column(db.String(64), nullable=True)

    gym = db.relationship("Gym")
    actor = db.relationship("User")
