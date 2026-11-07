from __future__ import annotations

import re

from flask_wtf import FlaskForm
from wtforms import BooleanField, EmailField, PasswordField, StringField, SubmitField
from wtforms.validators import DataRequired, Email, EqualTo, Length, ValidationError


class PasswordStrength:
    # V8-M3: this must mirror the shared 12-char + complexity rule in
    # app/utils/helpers.py::password_policy_error (upper, lower, digit,
    # symbol). It previously required no lowercase letter and the
    # forms paired it with Length(min=10), so web passwords drifted
    # below the mobile rule on every web path.
    def __call__(self, form, field) -> None:
        password = field.data or ""
        if not re.search(r"[a-z]", password):
            raise ValidationError("Password must contain at least one lowercase letter.")
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
        "Password", validators=[DataRequired(), Length(min=12), PasswordStrength()]
    )
    confirm_password = PasswordField(
        "Confirm password", validators=[DataRequired(), EqualTo("password")]
    )
    submit = SubmitField("Create account")


class ChangePasswordForm(FlaskForm):
    current_password = PasswordField("Current password", validators=[DataRequired()])
    new_password = PasswordField(
        "New password", validators=[DataRequired(), Length(min=12), PasswordStrength()]
    )
    confirm_new_password = PasswordField(
        "Confirm new password", validators=[DataRequired(), EqualTo("new_password")]
    )
    submit = SubmitField("Change password")


class ForgotPasswordForm(FlaskForm):
    email = EmailField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    submit = SubmitField("Send reset link")


class ResetPasswordForm(FlaskForm):
    new_password = PasswordField(
        "New password", validators=[DataRequired(), Length(min=12), PasswordStrength()]
    )
    confirm_password = PasswordField(
        "Confirm password", validators=[DataRequired(), EqualTo("new_password")]
    )
    submit = SubmitField("Reset password")
