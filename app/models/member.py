from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Index, UniqueConstraint

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class MembershipPlan(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "membership_plans"
    __table_args__ = (
        UniqueConstraint("gym_id", "name", name="uq_plan_gym_name"),
        Index("ix_plan_gym_active", "gym_id", "is_active"),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    duration_days = db.Column(db.Integer, nullable=False, default=30)
    price = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    gym = db.relationship("Gym", back_populates="plans")
    members = db.relationship("Member", back_populates="plan")


class Member(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "members"
    __table_args__ = (
        Index("ix_members_gym_status", "gym_id", "status"),
        Index("ix_members_gym_expiry", "gym_id", "membership_end"),
        Index("ix_members_gym_phone", "gym_id", "phone"),
    )

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(
        db.Integer, db.ForeignKey("membership_plans.id", ondelete="SET NULL"), nullable=True
    )
    full_name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(40), nullable=False)
    email = db.Column(db.String(255), nullable=True)
    gender = db.Column(db.String(32), nullable=True)
    joined_on = db.Column(db.Date, nullable=False, default=date.today)
    membership_start = db.Column(db.Date, nullable=False, default=date.today)
    membership_end = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(32), nullable=False, default="active", index=True)
    notes = db.Column(db.Text, nullable=True)
    external_ref = db.Column(db.String(120), nullable=True)

    gym = db.relationship("Gym", back_populates="members")
    plan = db.relationship("MembershipPlan", back_populates="members")
    renewals = db.relationship(
        "RenewalHistory", back_populates="member", cascade="all, delete-orphan"
    )
    reminders = db.relationship(
        "ReminderLog", back_populates="member", cascade="all, delete-orphan"
    )
    payments = db.relationship(
        "PaymentVerification", back_populates="member", cascade="all, delete-orphan"
    )

    @property
    def days_until_expiry(self) -> int:
        return (self.membership_end - date.today()).days

    @property
    def is_expired(self) -> bool:
        return self.membership_end < date.today()

    def refresh_status(self) -> None:
        self.status = "expired" if self.is_expired else "active"
