from __future__ import annotations

from app.extensions import db
from app.models.mixins import TimestampMixin


class Gym(TimestampMixin, db.Model):
    __tablename__ = "gyms"

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
    address = db.Column(db.Text, nullable=True)

    users = db.relationship("User", back_populates="gym", cascade="all, delete-orphan")
    plans = db.relationship(
        "MembershipPlan", back_populates="gym", cascade="all, delete-orphan"
    )
    members = db.relationship("Member", back_populates="gym", cascade="all, delete-orphan")
    qr_settings = db.relationship(
        "QRSettings", back_populates="gym", cascade="all, delete-orphan", uselist=False
    )

    def is_operational(self) -> bool:
        return self.status == "active"
