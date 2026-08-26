from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Index

from app.extensions import db
from app.models.mixins import TimestampMixin, utcnow


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GymDeployment(TimestampMixin, db.Model):
    """Tracks onboarding wizard progress, checklist items, pairing codes, and deployment timelines."""

    __tablename__ = "gym_deployments"
    __table_args__ = (
        Index("ix_gym_deployments_gym", "gym_id"),
        Index("ix_gym_deployments_pairing_code", "pairing_code"),
    )

    id = db.Column(db.Integer, primary_key=True)
    gym_id = db.Column(
        db.Integer,
        db.ForeignKey("gyms.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    current_step = db.Column(db.Integer, nullable=False, default=1)  # 1 to 9
    wizard_state_json = db.Column(db.JSON, nullable=True, default=dict)
    checklist_json = db.Column(db.JSON, nullable=True, default=dict)
    pairing_code = db.Column(db.String(16), nullable=True)
    pairing_code_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    setup_duration_seconds = db.Column(db.Integer, nullable=True)
    last_test_run_at = db.Column(db.DateTime(timezone=True), nullable=True)
    test_results_json = db.Column(db.JSON, nullable=True, default=dict)
    deployment_timeline_json = db.Column(db.JSON, nullable=True, default=list)
    notes = db.Column(db.Text, nullable=True)

    gym = db.relationship("Gym", back_populates="deployment")

    def add_timeline_event(self, event: str, actor: str = "super_admin", details: str | None = None) -> None:
        timeline = list(self.deployment_timeline_json or [])
        timeline.append({
            "timestamp": _utcnow().isoformat(),
            "display_time": _utcnow().strftime("%d %b %H:%M"),
            "event": event,
            "actor": actor,
            "details": details or "",
        })
        self.deployment_timeline_json = timeline

    def update_checklist_item(
        self, key: str, status: str, label: str, required: bool = True, details: str | None = None
    ) -> None:
        """status: passed | skipped | failed | pending"""
        checklist = dict(self.checklist_json or {})
        checklist[key] = {
            "key": key,
            "label": label,
            "status": status,
            "required": required,
            "updated_at": _utcnow().isoformat(),
            "details": details or "",
        }
        self.checklist_json = checklist

    def get_checklist_stats(self) -> dict[str, int]:
        checklist = dict(self.checklist_json or {})
        passed = sum(1 for item in checklist.values() if item.get("status") == "passed")
        skipped = sum(1 for item in checklist.values() if item.get("status") == "skipped")
        failed = sum(1 for item in checklist.values() if item.get("status") == "failed")
        pending = sum(1 for item in checklist.values() if item.get("status") == "pending")
        total = len(checklist) or 12
        return {
            "passed": passed,
            "skipped": skipped,
            "failed": failed,
            "pending": pending,
            "total": total,
            "completed": passed + skipped,
        }

    def is_ready_for_golive(self) -> tuple[bool, list[str]]:
        checklist = dict(self.checklist_json or {})
        reasons = []
        for key, item in checklist.items():
            req = item.get("required", True)
            stat = item.get("status", "pending")
            if req and stat not in {"passed", "skipped"}:
                reasons.append(f"Required check '{item.get('label', key)}' is {stat}.")
            elif stat == "failed":
                reasons.append(f"Check '{item.get('label', key)}' failed: {item.get('details', '')}")
        return len(reasons) == 0, reasons
