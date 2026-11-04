from __future__ import annotations

from unittest.mock import Mock

from app.services.reminder_scheduler import _scheduled_reminder_job


def test_scheduled_job_reaches_renewal_and_retention_sends(app, seed_gym, monkeypatch):
    gym = seed_gym["gym"]
    gym.whatsapp_enabled = True
    monkeypatch.setattr(
        "app.services.reminder_scheduler._iter_active_gyms",
        lambda: iter([gym]),
    )
    monkeypatch.setattr("app.services.reminder_scheduler._refresh_redis_lock", Mock())
    monkeypatch.setattr("app.services.reminder_scheduler.auto_expire_members_for_gym", Mock(return_value=0))
    monkeypatch.setattr("app.services.reminder_scheduler.apply_due_scheduled_renewals", Mock(return_value=0))
    renewals = Mock(return_value={"queued": 1, "sent": 1, "failed": 0, "skipped": 0})
    retention = Mock(return_value={"no_visit": 1, "attendance_drop": 0, "winback": 0, "skipped": 0})
    monkeypatch.setattr("app.services.reminder_scheduler.run_due_reminders_for_gym", renewals)
    monkeypatch.setattr("app.services.retention_service.run_retention_nudges_for_gym", retention)

    _scheduled_reminder_job(app)

    renewals.assert_called_once_with(gym.id, app.config["REMINDER_DAYS_BEFORE"], gym.timezone)
    retention.assert_called_once_with(gym.id, gym.timezone)
