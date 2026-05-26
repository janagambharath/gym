from __future__ import annotations

import re

from flask_wtf import FlaskForm
from wtforms import BooleanField, EmailField, PasswordField, StringField, SubmitField
from wtforms.validators import DataRequired, Email, EqualTo, Length, ValidationError


class PasswordStrength:
    def __call__(self, form, field) -> None:
        password = field.data or ""
        if not re.search(r"[A-Z]", password):
            raise ValidationError("Password must contain at least one uppercase letter.")
        if not re.search(r"[0-9]", password):
            raise ValidationError("Password must contain at least one digit.")
        if not re.search(r"[^A-Za-z0-9]", password):
            raise ValidationError("Password must contain at least one special character.")


class LoginForm(FlaskForm):
    email = EmailField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired()])
    remember = BooleanField("Remember me")
    submit = SubmitField("Sign in")


class RegisterGymForm(FlaskForm):
    gym_name = StringField("Gym name", validators=[DataRequired(), Length(max=160)])
    owner_name = StringField("Owner name", validators=[DataRequired(), Length(max=160)])
    email = EmailField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    phone = StringField("Phone", validators=[DataRequired(), Length(max=40)])
    password = PasswordField(
        "Password", validators=[DataRequired(), Length(min=10), PasswordStrength()]
    )
    confirm_password = PasswordField(
        "Confirm password", validators=[DataRequired(), EqualTo("password")]
    )
    submit = SubmitField("Create account")
