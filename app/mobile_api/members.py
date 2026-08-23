"""Mobile API members endpoints."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, MembershipPlan
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.reminder_service import auto_expire_members_for_gym, today_for_gym


def _serialize_member(m: Member) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "phone": m.phone,
        "email": m.email,
        "gender": m.gender,
        "plan": {"id": m.plan.id, "name": m.plan.name, "duration_days": m.plan.duration_days, "price": str(m.plan.price)} if m.plan else None,
        "membership_start": m.membership_start.isoformat() if m.membership_start else None,
        "membership_end": m.membership_end.isoformat() if m.membership_end else None,
        "status": m.status,
        "days_until_expiry": m.days_until_expiry,
        "joined_on": m.joined_on.isoformat() if m.joined_on else None,
        "notes": m.notes,
        "whatsapp_opted_in": m.whatsapp_opted_in,
        "has_biometric": m.device_enroll_number is not None,
    }


def register_members_routes(bp):
    @bp.route("/members", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_members():
        gym = g.current_user.gym
        if auto_expire_members_for_gym(gym):
            db.session.commit()

        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status = request.args.get("status", "").strip()
        search = request.args.get("q", "").strip()

        query = Member.query.filter_by(gym_id=g.gym_id).filter(Member.deleted_at.is_(None))
        if status:
            query = query.filter(Member.status == status)
        if search:
            like = f"%{search}%"
            query = query.filter(or_(Member.full_name.ilike(like), Member.phone.ilike(like)))

        total = query.count()
        members = (
            query.options(joinedload(Member.plan))
            .order_by(Member.membership_end.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "members": [_serialize_member(m) for m in members],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": (total + page_size - 1) // page_size,
                },
            },
        })

    @bp.route("/members/<int:member_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_member(member_id: int):
        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .options(joinedload(Member.plan))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)
        return jsonify({"success": True, "data": _serialize_member(member)})

    @bp.route("/members", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def create_member():
        data = request.get_json(silent=True) or {}
        full_name = (data.get("full_name") or "").strip()
        phone = (data.get("phone") or "").strip()
        if not full_name or not phone:
            return error_response("VALIDATION_ERROR", "full_name and phone are required.", 400)

        # Check member limit.
        gym = db.session.execute(select(Gym).where(Gym.id == g.gym_id).with_for_update()).scalar_one()
        if gym.max_members is not None:
            current_count = (
                db.session.query(func.count(Member.id))
                .filter(Member.gym_id == g.gym_id, Member.deleted_at.is_(None))
                .scalar() or 0
            )
            if gym.members_at_limit(current_count):
                return error_response("MEMBER_LIMIT", f"Member limit ({gym.max_members}) reached.", 409)

        plan_id = data.get("plan_id")
        if plan_id:
            plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
            if plan is None:
                return error_response("VALIDATION_ERROR", "Invalid plan_id.", 400)

        membership_start = _parse_date(data.get("membership_start")) or date.today()
        membership_end = _parse_date(data.get("membership_end")) or date.today()

        member = Member(
            gym_id=g.gym_id,
            full_name=full_name,
            phone=phone,
            email=(data.get("email") or "").strip() or None,
            gender=(data.get("gender") or "").strip() or None,
            plan_id=plan_id if plan_id else None,
            membership_start=membership_start,
            membership_end=membership_end,
            status="active" if membership_end >= date.today() else "expired",
            notes=(data.get("notes") or "").strip() or None,
        )
        db.session.add(member)
        db.session.flush()
        queue_membership_command(member)
        audit(action="create_member", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id)
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()

        # Reload with plan relationship.
        db.session.refresh(member)
        member.plan  # trigger lazy load
        return jsonify({"success": True, "data": _serialize_member(member)}), 201

    @bp.route("/members/<int:member_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def update_member(member_id: int):
        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        data = request.get_json(silent=True) or {}
        if "full_name" in data:
            name = (data["full_name"] or "").strip()
            if not name:
                return error_response("VALIDATION_ERROR", "full_name cannot be empty.", 400)
            member.full_name = name
        if "phone" in data:
            phone = (data["phone"] or "").strip()
            if not phone:
                return error_response("VALIDATION_ERROR", "phone cannot be empty.", 400)
            member.phone = phone
        if "email" in data:
            member.email = (data["email"] or "").strip() or None
        if "gender" in data:
            member.gender = (data["gender"] or "").strip() or None
        if "notes" in data:
            member.notes = (data["notes"] or "").strip() or None
        if "plan_id" in data:
            if data["plan_id"]:
                plan = MembershipPlan.query.filter_by(id=data["plan_id"], gym_id=g.gym_id, is_active=True).first()
                if plan is None:
                    return error_response("VALIDATION_ERROR", "Invalid plan_id.", 400)
            member.plan_id = data["plan_id"] or None
        if "membership_start" in data:
            d = _parse_date(data["membership_start"])
            if d is None:
                return error_response("VALIDATION_ERROR", "Invalid membership_start date.", 400)
            member.membership_start = d
        if "membership_end" in data:
            d = _parse_date(data["membership_end"])
            if d is None:
                return error_response("VALIDATION_ERROR", "Invalid membership_end date.", 400)
            member.membership_end = d

        tz = g.current_user.gym.timezone or "Asia/Kolkata"
        if member.status == "active" and member.membership_end < today_for_gym(tz):
            member.status = "expired"
        elif member.status == "expired" and member.membership_end >= today_for_gym(tz):
            member.status = "active"

        queue_membership_command(member)
        audit(action="update_member", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id)
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        db.session.refresh(member)
        return jsonify({"success": True, "data": _serialize_member(member)})

    @bp.route("/members/<int:member_id>/deactivate", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def deactivate_member(member_id: int):
        from app.models.mixins import utcnow

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        member.deleted_at = utcnow()
        member.status = "deleted"
        queue_membership_command(member)
        audit(action="soft_delete_member", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id)
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"message": "Member deactivated."}})


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val))
    except (ValueError, TypeError):
        return None
