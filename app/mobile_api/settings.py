"""Mobile API settings endpoint."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, MembershipPlan
from app.services.audit_service import audit


def _serialize_plan(p: MembershipPlan) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "duration_days": p.duration_days,
        "price": str(p.price),
    }


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
                "plans": [_serialize_plan(p) for p in plans],
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

    # ─── Plan Management ─────────────────────────────────────────────

    @bp.route("/plans", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def create_plan():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return error_response("VALIDATION_ERROR", "Plan name is required.", 400)
        if len(name) > 120:
            return error_response("VALIDATION_ERROR", "Plan name is too long (max 120 chars).", 400)

        try:
            duration_days = int(data.get("duration_days", 30))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid duration_days.", 400)
        if not 1 <= duration_days <= 730:
            return error_response("VALIDATION_ERROR", "duration_days must be between 1 and 730.", 400)

        try:
            price = Decimal(str(data.get("price", "0")).strip() or "0")
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid price.", 400)
        if price < 0:
            return error_response("VALIDATION_ERROR", "Price cannot be negative.", 400)

        existing = MembershipPlan.query.filter_by(gym_id=g.gym_id, name=name, is_active=True).first()
        if existing:
            return error_response("CONFLICT", f"A plan named '{name}' already exists.", 409)

        plan = MembershipPlan(
            gym_id=g.gym_id,
            name=name,
            duration_days=duration_days,
            price=price,
            is_active=True,
        )
        db.session.add(plan)
        db.session.flush()
        audit(
            action="create_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"name": name, "price": str(price), "duration_days": duration_days},
        )
        db.session.commit()
        return jsonify({"success": True, "data": _serialize_plan(plan)}), 201

    @bp.route("/plans/<int:plan_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner")
    def update_plan(plan_id: int):
        plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
        if plan is None:
            return error_response("NOT_FOUND", "Plan not found.", 404)

        data = request.get_json(silent=True) or {}

        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return error_response("VALIDATION_ERROR", "Plan name cannot be empty.", 400)
            dupe = MembershipPlan.query.filter(
                MembershipPlan.gym_id == g.gym_id,
                MembershipPlan.name == name,
                MembershipPlan.is_active == True,
                MembershipPlan.id != plan_id,
            ).first()
            if dupe:
                return error_response("CONFLICT", f"A plan named '{name}' already exists.", 409)
            plan.name = name

        if "duration_days" in data:
            try:
                duration_days = int(data["duration_days"])
            except (TypeError, ValueError):
                return error_response("VALIDATION_ERROR", "Invalid duration_days.", 400)
            if not 1 <= duration_days <= 730:
                return error_response("VALIDATION_ERROR", "duration_days must be between 1 and 730.", 400)
            plan.duration_days = duration_days

        if "price" in data:
            try:
                price = Decimal(str(data["price"]).strip() or "0")
            except (InvalidOperation, TypeError):
                return error_response("VALIDATION_ERROR", "Invalid price.", 400)
            if price < 0:
                return error_response("VALIDATION_ERROR", "Price cannot be negative.", 400)
            plan.price = price

        audit(
            action="update_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        db.session.commit()
        return jsonify({"success": True, "data": _serialize_plan(plan)})

    @bp.route("/plans/<int:plan_id>", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner")
    def delete_plan(plan_id: int):
        plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
        if plan is None:
            return error_response("NOT_FOUND", "Plan not found.", 404)

        # Soft-delete — members keep their plan reference.
        plan.is_active = False
        audit(
            action="delete_plan",
            resource_type="membership_plan",
            resource_id=plan.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Plan deleted."}})

