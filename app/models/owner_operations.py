"""Owner-operating records that sit on top of memberships and payments.

The application already stores verified payments and source-aware leads.  This
small model adds the missing auditable daily cash-close record; it deliberately
does not become a second payment ledger.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class GymCashClose(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "gym_cash_closes"
    __table_args__ = (
        UniqueConstraint("gym_id", "close_date", name="uq_cash_close_gym_date"),
        Index("ix_cash_close_gym_date", "gym_id", "close_date"),
    )

    id = db.Column(db.Integer, primary_key=True)
    close_date = db.Column(db.Date, nullable=False, index=True)
    expected_cash = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    counted_cash = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    variance = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    notes = db.Column(db.Text, nullable=True)
    closed_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    closed_by = db.relationship("User", foreign_keys=[closed_by_id])
