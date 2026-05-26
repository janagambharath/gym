from __future__ import annotations

from flask_wtf import FlaskForm
from wtforms import DateField, DecimalField, SelectField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Email, Length, NumberRange, Optional, ValidationError


class MembershipPlanForm(FlaskForm):
    name = StringField("Plan name", validators=[DataRequired(), Length(max=120)])
    duration_days = DecimalField(
        "Duration days", places=0, validators=[DataRequired(), NumberRange(min=1)]
    )
    price = DecimalField("Price", places=2, validators=[DataRequired(), NumberRange(min=0)])
    submit = SubmitField("Save plan")


class MemberForm(FlaskForm):
    full_name = StringField("Full name", validators=[DataRequired(), Length(max=160)])
    phone = StringField("WhatsApp phone", validators=[DataRequired(), Length(max=40)])
    email = StringField("Email", validators=[Optional(), Email(), Length(max=255)])
    gender = SelectField(
        "Gender",
        choices=[("", "Not specified"), ("female", "Female"), ("male", "Male"), ("other", "Other")],
        validators=[Optional()],
    )
    plan_id = SelectField("Membership plan", coerce=int, validators=[Optional()])
    membership_start = DateField("Start date", validators=[DataRequired()])
    membership_end = DateField("End date", validators=[DataRequired()])
    status = SelectField(
        "Status",
        choices=[("active", "Active"), ("expired", "Expired"), ("paused", "Paused")],
        validators=[DataRequired()],
    )
    notes = TextAreaField("Notes", validators=[Optional(), Length(max=2000)])
    submit = SubmitField("Save member")

    def validate_membership_end(self, field) -> None:
        if field.data and self.membership_start.data and field.data < self.membership_start.data:
            raise ValidationError("End date must be on or after start date.")
