from __future__ import annotations

import re

from flask_wtf import FlaskForm
from flask_wtf.file import FileAllowed, FileField
from wtforms import BooleanField, IntegerField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Length, NumberRange, Optional, URL, ValidationError

from app.services.whatsapp_template_service import validate_message_template
from app.utils.helpers import normalize_public_media_url


E164_RE = re.compile(r"^\+\d{7,15}$")


class QRSettingsForm(FlaskForm):
    payment_label = StringField("Payment label", validators=[Optional(), Length(max=160)])
    upi_id = StringField("UPI ID", validators=[Optional(), Length(max=160)])
    qr_public_url = StringField(
        "Public QR URL",
        validators=[
            Optional(),
            Length(max=512),
            URL(require_tld=True, message="Must be a valid https:// URL"),
        ],
    )
    qr_image = FileField(
        "QR image",
        validators=[FileAllowed(["png", "jpg", "jpeg", "webp"], "Images only")],
    )
    instructions = TextAreaField("Instructions", validators=[Optional(), Length(max=2000)])
    is_active = BooleanField("Attach QR to reminders")
    submit = SubmitField("Save QR settings")

    def validate_qr_public_url(self, field) -> None:
        value = normalize_public_media_url(field.data)
        field.data = value
        if value and not value.lower().startswith("https://"):
            raise ValidationError("QR URL must use HTTPS.")


class NotificationTemplateForm(FlaskForm):
    name = StringField("Template name", validators=[DataRequired(), Length(max=160)])
    days_before = IntegerField("Days before expiry", validators=[DataRequired(), NumberRange(min=0)])
    message_body = TextAreaField("Message", validators=[DataRequired(), Length(max=2000)])
    is_active = BooleanField("Active")
    submit = SubmitField("Save template")


class WhatsAppSettingsForm(FlaskForm):
    whatsapp_business_account_id = StringField(
        "Meta WhatsApp Business Account ID",
        validators=[Optional(), Length(max=255)],
    )
    phone_number_id = StringField(
        "Meta phone number ID",
        validators=[Optional(), Length(max=255)],
    )
    business_phone_number = StringField(
        "WhatsApp Business number",
        validators=[Optional(), Length(max=40)],
    )
    whatsapp_enabled = BooleanField("Enable WhatsApp for this gym")
    welcome_message_template = TextAreaField(
        "Welcome message",
        validators=[DataRequired(), Length(max=4000)],
    )
    renewal_reminder_template = TextAreaField(
        "Renewal reminder message",
        validators=[DataRequired(), Length(max=4000)],
    )
    submit = SubmitField("Save WhatsApp settings")

    def validate_whatsapp_business_account_id(self, field) -> None:
        field.data = (field.data or "").strip() or None
        if field.data and not field.data.isdigit():
            raise ValidationError("Meta WhatsApp Business Account ID must contain digits only.")
        if self.whatsapp_enabled.data and not field.data:
            raise ValidationError(
                "Meta WhatsApp Business Account ID is required when WhatsApp is enabled."
            )

    def validate_phone_number_id(self, field) -> None:
        field.data = (field.data or "").strip() or None
        if field.data and not field.data.isdigit():
            raise ValidationError("Meta phone number ID must contain digits only.")
        if self.whatsapp_enabled.data and not field.data:
            raise ValidationError("Meta phone number ID is required when WhatsApp is enabled.")

    def validate_business_phone_number(self, field) -> None:
        cleaned = re.sub(r"\s", "", (field.data or "").strip())
        field.data = cleaned or None
        if cleaned and not E164_RE.match(cleaned):
            raise ValidationError(
                "Enter the business number in E.164 format, e.g. +919876543210."
            )
        if self.whatsapp_enabled.data and not field.data:
            raise ValidationError("Business phone number is required when WhatsApp is enabled.")

    def validate_welcome_message_template(self, field) -> None:
        self._validate_template(field)

    def validate_renewal_reminder_template(self, field) -> None:
        self._validate_template(field)

    @staticmethod
    def _validate_template(field) -> None:
        try:
            validate_message_template(field.data)
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
