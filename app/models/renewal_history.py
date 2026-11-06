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
    campaign_id = db.Column(
        db.Integer,
        db.ForeignKey("campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    previous_start = db.Column(db.Date, nullable=True)
    previous_end = db.Column(db.Date, nullable=True)
    # V3-M18: pre-renewal plan/price snapshot, so _revert_renewal can
    # restore them on refund/delete instead of leaving the member on
    # the renewed plan at the refunded price. NULL on creation rows
    # (no prior plan/price to restore).
    previous_plan_id = db.Column(
        db.Integer, db.ForeignKey("membership_plans.id", ondelete="SET NULL"), nullable=True
    )
    previous_price = db.Column(db.Numeric(10, 2), nullable=True)
    new_start = db.Column(db.Date, nullable=False)
    new_end = db.Column(db.Date, nullable=False)
    # V3-M5: explicit signup marker, set at write time by create_member.
    # The old heuristic (first row + previous_end == new_start) misfires
    # on genuine first renewals of imported members backdated onto
    # previous_end; the flag disambiguates them. Legacy rows are backfilled
    # by migration (heuristic match) and the heuristic stays as a fallback
    # for rows that predate the flag.
    is_creation = db.Column(db.Boolean, nullable=False, default=False)
    # V4-M13: snapshot of the plan duration (days) in force when this
    # row was written. The Date Repair oversized check compares the
    # applied span against this, not the plan's LIVE duration — an
    # owner editing a plan's duration must not rewrite history.
    # NULL on legacy rows (backfilled by migration where the plan is
    # known); the scan falls back to the live plan duration then.
    duration_days = db.Column(db.Integer, nullable=True)
    standard_price = db.Column(db.Numeric(10, 2), nullable=True)
    discount = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    amount = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    channel = db.Column(db.String(32), nullable=False, default="offline")
    notes = db.Column(db.Text, nullable=True)
    # V5-L16: owner-approved extra-days override reason. Rows carrying
    # one are deliberately oversized and must be skipped by the Date
    # Repair oversized check/corrector, not stripped by Apply.
    override_reason = db.Column(db.String(500), nullable=True)
    is_test = db.Column(db.Boolean, nullable=False, default=False, index=True)

    member = db.relationship("Member", back_populates="renewals")
    # Two FKs now point at membership_plans (plan_id + previous_plan_id,
    # the latter added for V3-M18); pin the relationship to plan_id or
    # SQLAlchemy refuses to configure the mapper (AmbiguousForeignKeys).
    plan = db.relationship("MembershipPlan", foreign_keys=[plan_id])
    payment_verification = db.relationship(
        "PaymentVerification", back_populates="renewal", foreign_keys=[payment_verification_id]
    )
    renewed_by = db.relationship("User")
    campaign = db.relationship("Campaign")

