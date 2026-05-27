from __future__ import annotations

from decimal import Decimal

from sqlalchemy import CheckConstraint, Index

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class PaymentVerification(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "payment_verifications"
    __table_args__ = (
        Index("ix_payments_gym_status", "gym_id", "status"),
        Index("ix_payments_gym_member", "gym_id", "member_id"),
        CheckConstraint(
            "status IN ('pending', 'verified', 'rejected')",
            name="ck_payments_status",
        ),
        CheckConstraint(
            "renewal_days BETWEEN 1 AND 730",
            name="ck_payments_renewal_days",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    verified_by_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    amount = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    paid_on = db.Column(db.Date, nullable=True)
    method = db.Column(db.String(64), nullable=False, default="upi")
    reference = db.Column(db.String(160), nullable=True)
    status = db.Column(db.String(32), nullable=False, default="pending", index=True)
    renewal_days = db.Column(db.Integer, nullable=False, default=30)
    notes = db.Column(db.Text, nullable=True)
    verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    member = db.relationship("Member", back_populates="payments")
    renewal = db.relationship("RenewalHistory", back_populates="payment_verification", uselist=False)
    verified_by = db.relationship("User")
