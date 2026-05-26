from __future__ import annotations

from app.extensions import db
from app.models.mixins import TenantMixin, TimestampMixin


class QRSettings(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = "qr_settings"

    id = db.Column(db.Integer, primary_key=True)
    payment_label = db.Column(db.String(160), nullable=True)
    upi_id = db.Column(db.String(160), nullable=True)
    qr_image_path = db.Column(db.String(512), nullable=True)
    qr_public_url = db.Column(db.String(512), nullable=True)
    instructions = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    gym = db.relationship("Gym", back_populates="qr_settings")

    __table_args__ = (db.UniqueConstraint("gym_id", name="uq_qr_settings_gym"),)
