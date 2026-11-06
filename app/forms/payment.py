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
    renewal_days = DecimalField(
        "Renewal days", places=0, validators=[DataRequired(), NumberRange(min=1, max=730)]
    )
    # V6-M4: owner override reason for off-plan renewal days, mirroring
    # the mobile create / direct-renew / bulk-renew rule. Staff cannot
    # override; the reason is stored on the payment and carried onto
    # the renewal row so Date Repair skips approved extra days.
    override_reason = StringField(
        "Override reason (owner only, when days differ from the plan)",
        validators=[Optional(), Length(max=500)],
    )
    notes = TextAreaField("Notes", validators=[Optional(), Length(max=2000)])
    submit = SubmitField("Save payment")
