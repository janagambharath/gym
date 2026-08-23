"""Mobile API settings endpoint."""
from __future__ import annotations

from flask import g, jsonify, request
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, MembershipPlan
from app.services.audit_service import audit


def register_settings_routes(bp):
    @bp.route("/settings", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_settings():
        gym = g.current_user.gym
        plans = (
            MembershipPlan.query.filter_by(gym_id=g.gym_id, is_active=True)
            .order_by(MembershipPlan.name.asc())
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "gym": {
                    "id": gym.id,
                    "name": gym.name,
                    "slug": gym.slug,
                    "email": gym.email,
                    "phone": gym.phone,
                    "address": gym.address,
                    "timezone": gym.timezone,
                    "whatsapp_enabled": gym.whatsapp_enabled,
                    "max_members": gym.max_members,
                    "subscription_status": gym.subscription_status,
                },
                "plans": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "duration_days": p.duration_days,
                        "price": str(p.price),
                    }
                    for p in plans
                ],
            },
        })

    @bp.route("/settings", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    def update_settings():
        data = request.get_json(silent=True) or {}
        gym = g.current_user.gym

        # Only owner can update; only safe fields allowed.
        allowed = {"name", "email", "phone", "address", "timezone"}
        updates = {}
        for key in allowed:
            if key in data:
                val = (data[key] or "").strip() if isinstance(data.get(key), str) else data[key]
                setattr(gym, key, val or None if key != "name" else val)
                updates[key] = val

        if "name" in updates and not updates["name"]:
            return error_response("VALIDATION_ERROR", "Gym name cannot be empty.", 400)

        audit(
            action="update_gym_settings",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"updated_fields": list(updates.keys())},
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Settings updated."}})
