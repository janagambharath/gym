from __future__ import annotations

from flask import request
from flask_login import current_user

from app.extensions import db
from app.models import AuditLog


def audit(
    *,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    gym_id: int | None = None,
    metadata: dict | None = None,
) -> None:
    actor_id = current_user.id if current_user.is_authenticated else None
    inferred_gym_id = gym_id
    if inferred_gym_id is None and current_user.is_authenticated:
        inferred_gym_id = current_user.gym_id

    db.session.add(
        AuditLog(
            gym_id=inferred_gym_id,
            actor_user_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            metadata_json=metadata or {},
            ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        )
    )
