from __future__ import annotations

from datetime import date

from sqlalchemy import CheckConstraint

from app.extensions import db
from app.models.mixins import TimestampMixin


DEFAULT_WHATSAPP_WELCOME_TEMPLATE = (
    "Hi {{ member_name }}, welcome to {{ gym_name }}. "
    "You are now opted in for WhatsApp membership updates."
)
DEFAULT_WHATSAPP_RENEWAL_REMINDER_TEMPLATE = (
    "Hi {{ member_name }}, your {{ gym_name }} membership expires on "
    "{{ expiry_date }}. You have {{ days_left }} day(s) left. "
    "Please complete payment using the attached QR image."
)


class Gym(TimestampMixin, db.Model):
    __tablename__ = "gyms"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'suspended')", name="ck_gyms_status"),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    slug = db.Column(db.String(120), nullable=False, unique=True, index=True)
    email = db.Column(db.String(255), nullable=True)
    phone = db.Column(db.String(40), nullable=True)
    timezone = db.Column(db.String(64), nullable=False, default="Asia/Kolkata")
    status = db.Column(db.String(32), nullable=False, default="active", index=True)
    subscription_status = db.Column(
        db.String(32), nullable=False, default="trial", index=True
    )
    trial_ends_at = db.Column(db.Date, nullable=True)
    max_members = db.Column(db.Integer, nullable=True)
    address = db.Column(db.Text, nullable=True)
    whatsapp_business_account_id = db.Column(db.String(255), nullable=True, index=True)
    phone_number_id = db.Column(db.String(255), nullable=True, unique=True, index=True)
    business_phone_number = db.Column(db.String(40), nullable=True, unique=True, index=True)
    whatsapp_enabled = db.Column(db.Boolean, nullable=False, default=False)
    welcome_message_template = db.Column(
        db.Text,
        nullable=False,
        default=DEFAULT_WHATSAPP_WELCOME_TEMPLATE,
    )
    renewal_reminder_template = db.Column(
        db.Text,
        nullable=False,
        default=DEFAULT_WHATSAPP_RENEWAL_REMINDER_TEMPLATE,
    )

    users = db.relationship("User", back_populates="gym", cascade="all, delete-orphan")
    plans = db.relationship(
        "MembershipPlan", back_populates="gym", cascade="all, delete-orphan"
    )
    members = db.relationship("Member", back_populates="gym", cascade="all, delete-orphan")
    qr_settings = db.relationship(
        "QRSettings", back_populates="gym", cascade="all, delete-orphan", uselist=False
    )

    def is_operational(self) -> bool:
        if self.status != "active":
            return False
        if self.subscription_status == "trial" and self.trial_ends_at:
            return date.today() <= self.trial_ends_at
        return True

    def members_at_limit(self, current_count: int) -> bool:
        if self.max_members is None:
            return False
        return current_count >= self.max_members
