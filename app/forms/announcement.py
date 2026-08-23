from __future__ import annotations

import re

from flask_wtf import FlaskForm
from wtforms import BooleanField, SelectField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Length, Optional, ValidationError


_META_TEMPLATE_NAME_RE = re.compile(r"^[a-z0-9_]{1,512}$")
_META_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:_[A-Z]{2})?$")
_SUPPORTED_TEMPLATE_PARAMETERS = {"member_name", "gym_name", "announcement_title"}


class AnnouncementForm(FlaskForm):
    """Owner-only festival and operational WhatsApp announcement form."""

    title = StringField("Announcement title", validators=[DataRequired(), Length(max=120)])
    delivery_mode = SelectField(
        "Delivery method",
        choices=[
            (
                "session_message",
                "Normal WhatsApp message — only members with an open 24-hour chat",
            ),
            (
                "approved_template",
                "Meta-approved template — consented members, including closed chats",
            ),
        ],
        validators=[DataRequired()],
    )
    message_body = TextAreaField(
        "Normal-message text",
        validators=[Optional(), Length(max=1000)],
        description="Used only for Normal WhatsApp message. Do not paste an unapproved campaign into template mode.",
    )
    template_name = StringField(
        "Approved Meta template name",
        validators=[Optional(), Length(max=512)],
        description="Create and wait for approval in Meta first; use the exact approved template name.",
    )
    template_language = StringField(
        "Template language",
        validators=[Optional(), Length(max=32)],
        default="en_US",
    )
    template_body_parameters = StringField(
        "Template variables (comma separated)",
        validators=[Optional(), Length(max=120)],
        description="Allowed: member_name, gym_name, announcement_title. Leave empty if the Meta template has no body variables.",
    )
    test_member_id = SelectField("Send a test to", coerce=int, validators=[Optional()])
    confirm_broadcast = BooleanField(
        "I confirm that every recipient has agreed to receive WhatsApp updates from this gym."
    )
    send_test = SubmitField("Send one test")
    send_broadcast = SubmitField("Send to all eligible members")

    def validate(self, extra_validators=None) -> bool:
        valid = super().validate(extra_validators=extra_validators)
        mode = self.delivery_mode.data

        if mode == "session_message":
            if not (self.message_body.data or "").strip():
                self.message_body.errors.append("Enter the message to send.")
                valid = False
        elif mode == "approved_template":
            template_name = (self.template_name.data or "").strip()
            language = (self.template_language.data or "").strip()
            if not _META_TEMPLATE_NAME_RE.fullmatch(template_name):
                self.template_name.errors.append(
                    "Use the exact Meta template name: lowercase letters, numbers, and underscores only."
                )
                valid = False
            if not _META_LANGUAGE_RE.fullmatch(language):
                self.template_language.errors.append(
                    "Use a Meta language code such as en_US or hi."
                )
                valid = False
            try:
                self.parsed_template_parameters()
            except ValueError as exc:
                self.template_body_parameters.errors.append(str(exc))
                valid = False
        else:
            self.delivery_mode.errors.append("Choose a delivery method.")
            valid = False

        if self.send_test.data and not self.test_member_id.data:
            self.test_member_id.errors.append("Choose one consented member for the test.")
            valid = False
        if self.send_broadcast.data and not self.confirm_broadcast.data:
            self.confirm_broadcast.errors.append("Confirm recipient consent before sending a broadcast.")
            valid = False
        return valid

    def parsed_template_parameters(self) -> list[str]:
        values = [
            value.strip()
            for value in (self.template_body_parameters.data or "").split(",")
            if value.strip()
        ]
        unknown = sorted(set(values) - _SUPPORTED_TEMPLATE_PARAMETERS)
        if unknown:
            raise ValueError(
                "Unsupported template variable(s): "
                + ", ".join(unknown)
                + ". Allowed: member_name, gym_name, announcement_title."
            )
        if len(values) != len(set(values)):
            raise ValueError("Each template variable can be used only once.")
        return values
