from __future__ import annotations

from flask_wtf import FlaskForm
from wtforms import DateField, DecimalField, SelectField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Length, NumberRange, Optional


class PaymentVerificationForm(FlaskForm):
    member_id = SelectField("Member", coerce=int, validators=[DataRequired()])
    amount = DecimalField("Amount", places=2, validators=[DataRequired(), NumberRange(min=0)])
    paid_on = DateField("Paid on", validators=[DataRequired()])
    method = SelectField(
        "Method",
        choices=[("upi", "UPI"), ("cash", "Cash"), ("card", "Card"), ("bank", "Bank transfer")],
        validators=[DataRequired()],
    )
    reference = StringField("Reference", validators=[Optional(), Length(max=160)])
    status = SelectField(
        "Status",
        choices=[("pending", "Pending"), ("verified", "Verified"), ("rejected", "Rejected")],
        validators=[DataRequired()],
    )
    renewal_days = DecimalField(
        "Renewal days", places=0, validators=[DataRequired(), NumberRange(min=1)]
    )
    notes = TextAreaField("Notes", validators=[Optional(), Length(max=2000)])
    submit = SubmitField("Save payment")
