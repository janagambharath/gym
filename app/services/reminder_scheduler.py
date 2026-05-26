from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Flask

from app.extensions import scheduler
from app.models import Gym
from app.services.reminder_service import run_due_reminders_for_gym


def configure_scheduler(app: Flask) -> None:
    lock_path = Path(
        os.getenv(
            "SCHEDULER_LOCK_PATH",
            str(Path(tempfile.gettempdir()) / "renewaldesk_scheduler.lock"),
        )
    )
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path.open("x").close()
    except FileExistsError:
        app.logger.info("Scheduler lock exists; skipping scheduler in this worker.")
        return
    except OSError:
        app.logger.exception("Could not create scheduler lock at %s", lock_path)
        return

    job_id = "membership-renewal-reminders"
    if scheduler.get_job(job_id):
        return

    scheduler.add_job(
        id=job_id,
        func=_scheduled_reminder_job,
        trigger="interval",
        minutes=app.config["REMINDER_JOB_MINUTES"],
        kwargs={"app": app},
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
        replace_existing=True,
    )


def _scheduled_reminder_job(app: Flask) -> None:
    with app.app_context():
        app.logger.info("Running scheduled reminder scan")
        active_gyms = Gym.query.filter_by(status="active").all()
        for gym in active_gyms:
            try:
                result = run_due_reminders_for_gym(
                    gym.id, app.config["REMINDER_DAYS_BEFORE"]
                )
                app.logger.info("Reminder scan for gym %s: %s", gym.id, result)
            except Exception:
                from app.extensions import db

                db.session.rollback()
                app.logger.exception("Reminder scan failed for gym %s", gym.id)
