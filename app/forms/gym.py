from __future__ import annotations

from flask_wtf import FlaskForm
from flask_wtf.file import FileAllowed, FileField
from wtforms import BooleanField, IntegerField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Length, NumberRange, Optional, URL, ValidationError


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
        value = (field.data or "").strip()
        field.data = value
        if value and not value.lower().startswith("https://"):
            raise ValidationError("QR URL must use HTTPS.")


class NotificationTemplateForm(FlaskForm):
    name = StringField("Template name", validators=[DataRequired(), Length(max=160)])
    days_before = IntegerField("Days before expiry", validators=[DataRequired(), NumberRange(min=0)])
    message_body = TextAreaField("Message", validators=[DataRequired(), Length(max=2000)])
    is_active = BooleanField("Active")
    submit = SubmitField("Save template")
