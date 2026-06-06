from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from flask import has_request_context, request
from flask_login import current_user

from app.extensions import db
from app.models import AuditLog


def audit(
    *,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    gym_id: int | None = None,
    actor_id: int | None = None,
    metadata: dict | None = None,
) -> None:
    resolved_actor_id = actor_id
    resolved_gym_id = gym_id
    ip_address = None

    if has_request_context():
        if resolved_actor_id is None and current_user.is_authenticated:
            resolved_actor_id = current_user.id
        if resolved_gym_id is None and current_user.is_authenticated:
            resolved_gym_id = current_user.gym_id
        ip_address = request.remote_addr

    db.session.add(
        AuditLog(
            gym_id=resolved_gym_id,
            actor_user_id=resolved_actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            metadata_json=metadata or {},
            ip_address=ip_address,
        )
    )


def purge_old_audit_logs(retention_days: int = 90) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result = db.session.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    db.session.commit()
    return result.rowcount or 0
