"""V6-M19: ``flask create-admin`` must be idempotent.

``preDeployCommand`` (railway.json) and the Procfile release line run
``flask create-admin`` on EVERY deploy. Before this fix, an existing
admin had its password unconditionally reset to
DEFAULT_ADMIN_PASSWORD, its role forced to super_admin, and its
lockout cleared — silently reverting any password rotation done
through the app at the next deploy.

Covered here:
- first run creates the admin;
- a second run (the deploy path) leaves a rotated password, a
  changed role, and lockout state completely untouched;
- ``--reset-password`` rotates the password intentionally and still
  leaves role / lockout state alone;
- a missing DEFAULT_ADMIN_PASSWORD refuses without creating anything.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.extensions import db
from app.models import User


def _invoke(app, *args, monkeypatch, password="EnvPass123!"):
    monkeypatch.setenv("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("DEFAULT_ADMIN_PASSWORD", password)
    runner = app.test_cli_runner()
    return runner.invoke(args=list(args))


def _admin():
    return User.query.filter_by(email="admin@example.com").first()


def test_create_admin_creates_when_missing(app, monkeypatch):
    result = _invoke(app, "create-admin", monkeypatch=monkeypatch)
    assert result.exit_code == 0, result.output
    assert "Created super admin" in result.output
    admin = _admin()
    assert admin is not None
    assert admin.role == "super_admin"
    assert admin.check_password("EnvPass123!")


def test_create_admin_second_run_leaves_existing_admin_untouched(app, monkeypatch):
    _invoke(app, "create-admin", monkeypatch=monkeypatch)
    admin = _admin()

    # Simulate a rotation done through the app, plus a role change and
    # a lockout — the exact state the old code silently destroyed.
    admin.set_password("RotatedPass456!")
    admin.role = "gym_owner"
    admin.failed_login_count = 3
    admin.locked_until = datetime.now(timezone.utc) + timedelta(hours=1)
    db.session.commit()

    result = _invoke(app, "create-admin", monkeypatch=monkeypatch)
    assert result.exit_code == 0, result.output
    assert "already exists" in result.output
    assert "leaving password, role and lock state unchanged" in result.output

    admin = _admin()
    assert admin.check_password("RotatedPass456!")
    assert not admin.check_password("EnvPass123!")
    assert admin.role == "gym_owner"
    assert admin.failed_login_count == 3
    assert admin.locked_until is not None


def test_create_admin_reset_password_flag_rotates_only_password(app, monkeypatch):
    _invoke(app, "create-admin", monkeypatch=monkeypatch)
    admin = _admin()
    admin.set_password("RotatedPass456!")
    admin.role = "gym_owner"
    admin.failed_login_count = 3
    admin.locked_until = datetime.now(timezone.utc) + timedelta(hours=1)
    db.session.commit()

    result = _invoke(
        app, "create-admin", "--reset-password", monkeypatch=monkeypatch
    )
    assert result.exit_code == 0, result.output
    assert "Reset super admin password" in result.output

    admin = _admin()
    assert admin.check_password("EnvPass123!")
    assert not admin.check_password("RotatedPass456!")
    # Even an intentional reset touches the password only.
    assert admin.role == "gym_owner"
    assert admin.failed_login_count == 3
    assert admin.locked_until is not None


def test_create_admin_without_password_env_refuses(app, monkeypatch):
    monkeypatch.delenv("DEFAULT_ADMIN_PASSWORD", raising=False)
    monkeypatch.setenv("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    runner = app.test_cli_runner()
    result = runner.invoke(args=["create-admin"])
    assert result.exit_code == 0, result.output
    assert "ERROR" in result.output
    assert _admin() is None
