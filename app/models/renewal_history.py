from __future__ import annotations

from decimal import Decimal

from sqlalchemy import CheckConstraint, Index

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class RenewalHistory(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "renewal_history"
    __table_args__ = (
        Index("ix_renewals_gym_member", "gym_id", "member_id"),
        Index("ix_renewals_gym_prev_end", "gym_id", "previous_end"),
        CheckConstraint("new_end >= new_start", name="ck_renewal_dates"),
    )

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(
        db.Integer, db.ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id = db.Column(
        db.Integer, db.ForeignKey("membership_plans.id", ondelete="SET NULL"), nullable=True
    )
    payment_verification_id = db.Column(
        db.Integer,
        db.ForeignKey("payment_verifications.id", ondelete="SET NULL"),
        nullable=True,
    )
    renewed_by_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    previous_end = db.Column(db.Date, nullable=False)
    new_start = db.Column(db.Date, nullable=False)
    new_end = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    notes = db.Column(db.Text, nullable=True)

    member = db.relationship("Member", back_populates="renewals")
    plan = db.relationship("MembershipPlan")
    payment_verification = db.relationship(
        "PaymentVerification", back_populates="renewal", foreign_keys=[payment_verification_id]
    )
    renewed_by = db.relationship("User")
