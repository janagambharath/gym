"""Owner-facing audit-log read API (gaps G1–G5, G2).

The V10-M1 trail persists; this is the read surface over it so owners can
prove who verified, refunded, retried, or cleared what. Owner-only and
gym-scoped to the session gym — another gym's rows can never leak, even
with a guessed actor id or action filter.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone

from flask import g, jsonify, request

from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models.audit_log import AuditLog
from app.models.user import User


def _parse_bound(raw: str | None, *, end_of_day: bool):
    """Parse an ISO date or datetime bound; returns None / datetime / 'invalid'."""
    if raw is None or not str(raw).strip():
        return None
    text = str(raw).strip()
    try:
        if "T" in text or " " in text:
            parsed = datetime.fromisoformat(text)
        else:
            day = date.fromisoformat(text)
            parsed = datetime.combine(day, time.max if end_of_day else time.min)
    except ValueError:
        return "invalid"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def register_audit_log_routes(bp):
    @bp.get("/audit-logs")
    @token_required
    @roles_required("gym_owner")
    def list_audit_logs():
        page = max(request.args.get("page", 1, type=int) or 1, 1)
        per_page = min(max(request.args.get("per_page", 20, type=int) or 20, 1), 100)
        query = AuditLog.query.filter_by(gym_id=g.gym_id)

        action = (request.args.get("action") or "").strip()
        if action:
            query = query.filter_by(action=action)
        actor_id = request.args.get("actor_id", type=int)
        if actor_id is not None:
            query = query.filter_by(actor_user_id=actor_id)
        from_dt = _parse_bound(request.args.get("from"), end_of_day=False)
        to_dt = _parse_bound(request.args.get("to"), end_of_day=True)
        if from_dt == "invalid" or to_dt == "invalid":
            return error_response(
                "VALIDATION_ERROR",
                "from/to must be ISO dates (YYYY-MM-DD) or datetimes.",
                422,
            )
        if from_dt is not None:
            query = query.filter(AuditLog.created_at >= from_dt)
        if to_dt is not None:
            query = query.filter(AuditLog.created_at <= to_dt)

        total = query.count()
        rows = (
            query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        # Batch the actor lookup (one query for the page, not one per row).
        actor_ids = {row.actor_user_id for row in rows if row.actor_user_id}
        actors = {}
        if actor_ids:
            actors = {
                user.id: user.full_name
                for user in User.query.filter(User.id.in_(actor_ids)).all()
            }
        items = [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "actor_name": (
                    actors.get(row.actor_user_id, "System")
                    if row.actor_user_id
                    else "System"
                ),
                "action": row.action,
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "metadata": row.metadata_json or {},
            }
            for row in rows
        ]
        return jsonify({"success": True, "data": {
            "items": items,
            "page": page,
            "per_page": per_page,
            "total": total,
        }})
