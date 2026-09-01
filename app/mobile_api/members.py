"""Mobile API members endpoints."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, MembershipPlan
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.document_scan_service import DocumentScanService
from app.services.reminder_service import auto_expire_members_for_gym, today_for_gym
from app.services.mobile_member_import_service import validate_csv
from app.utils.helpers import normalize_phone_e164


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
    @bp.route("/members/scan", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def scan_member_records():
        """Process document images with OpenRouter Vision AI and return candidate member records for review."""
        data = request.get_json(silent=True) or {}
        images = data.get("images") or []
        if not images:
            return error_response("VALIDATION_ERROR", "Please provide at least one document image to scan.", 400)

        result = DocumentScanService.scan_member_documents(
            gym_id=g.gym_id,
            gym_timezone=g.current_user.gym.timezone,
            images=images,
        )

        if not result.get("ok"):
            return error_response(
                result.get("error_code", "AI_SCAN_FAILED"),
                result.get("message", "Document scanning failed. Please try CSV import or add members manually."),
                400,
            )

        return jsonify({"success": True, "data": result["data"]})

    @bp.route("/members/batch-create", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def batch_create_members():
        """Atomically import reviewed candidate members and discover upcoming renewals."""
        data = request.get_json(silent=True) or {}
        candidates = data.get("members") or []
        if not candidates:
            return error_response("VALIDATION_ERROR", "No members provided for import.", 400)

        if len(candidates) > 2000:
            return error_response("VALIDATION_ERROR", "Cannot import more than 2,000 members at once.", 400)

        gym = db.session.execute(select(Gym).where(Gym.id == g.gym_id).with_for_update()).scalar_one()
        current_count = db.session.query(func.count(Member.id)).filter(
            Member.gym_id == g.gym_id, Member.deleted_at.is_(None)
        ).scalar() or 0

        if gym.max_members is not None and current_count + len(candidates) > gym.max_members:
            return error_response(
                "MEMBER_LIMIT",
                f"Importing {len(candidates)} members would exceed your plan limit of {gym.max_members}. Current count: {current_count}.",
                409,
            )

        gym_today = today_for_gym(gym.timezone)
        active_plans = {p.id: p for p in MembershipPlan.query.filter_by(gym_id=g.gym_id, is_active=True).all()}
        existing_phones = {
            phone for (phone,) in Member.query.with_entities(Member.phone).filter_by(gym_id=g.gym_id).filter(Member.deleted_at.is_(None))
        }

        created_members: list[Member] = []
        seen_phones: set[str] = set()
        validation_errors: list[dict[str, Any]] = []

        for idx, item in enumerate(candidates, start=1):
            name = (item.get("name") or item.get("full_name") or "").strip()
            phone = normalize_phone_e164(item.get("phone") or "")
            raw_start = item.get("membership_start") or item.get("start_date")
            raw_end = item.get("membership_end") or item.get("expiry_date")
            plan_id = item.get("plan_id")
            email = (item.get("email") or "").strip() or None
            gender = (item.get("gender") or "").strip().lower() or None
            notes = (item.get("notes") or "").strip() or None
            status = (item.get("status") or "active").strip().lower()

            item_errors = []
            if not name:
                item_errors.append("Name is required")
            if not phone:
                item_errors.append("Valid E.164 phone number is required")
            elif phone in existing_phones:
                item_errors.append(f"Phone {phone} already belongs to an existing member")
            elif phone in seen_phones:
                item_errors.append(f"Duplicate phone {phone} in import payload")
            seen_phones.add(phone)

            start_d = None
            end_d = None
            if raw_start:
                try:
                    start_d = date.fromisoformat(str(raw_start).strip())
                except ValueError:
                    item_errors.append("membership_start must be YYYY-MM-DD")
            if raw_end:
                try:
                    end_d = date.fromisoformat(str(raw_end).strip())
                except ValueError:
                    item_errors.append("membership_end must be YYYY-MM-DD")

            if start_d and end_d and end_d < start_d:
                item_errors.append("membership_end must be on or after membership_start")

            if plan_id and plan_id not in active_plans:
                item_errors.append(f"Plan ID {plan_id} is not valid for this gym")

            if status not in {"active", "expired", "paused"}:
                status = "active"

            if end_d and status == "active" and end_d < gym_today:
                status = "expired"

            if gender and gender not in {"male", "female", "other"}:
                gender = None

            if item_errors:
                validation_errors.append({"index": idx, "name": name, "phone": phone, "errors": item_errors})
                continue

            member = Member(
                gym_id=g.gym_id,
                full_name=name,
                phone=phone,
                email=email,
                gender=gender,
                plan_id=plan_id,
                membership_start=start_d or gym_today,
                membership_end=end_d or gym_today,
                status=status,
                notes=notes,
                joined_on=start_d or gym_today,
            )
            created_members.append(member)
            db.session.add(member)

        if validation_errors:
            db.session.rollback()
            return error_response(
                "BATCH_VALIDATION_FAILED",
                f"{len(validation_errors)} member records failed validation. Please correct errors and retry.",
                422,
                {"errors": validation_errors},
            )

        db.session.flush()

        # Compute immediate post-import metrics (upcoming renewals & revenue at risk)
        from datetime import timedelta
        soon_end = gym_today + timedelta(days=7)
        upcoming_count = 0
        revenue_at_risk = Decimal("0.00")

        for m in created_members:
            if m.status == "active" and gym_today <= m.membership_end <= soon_end:
                upcoming_count += 1
                if m.plan_id and m.plan_id in active_plans:
                    revenue_at_risk += active_plans[m.plan_id].price or Decimal("0.00")

        audit(
            action="mobile_ai_scan_import_members",
            resource_type="member",
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={
                "created": len(created_members),
                "upcoming_renewals": upcoming_count,
                "revenue_at_risk": str(revenue_at_risk),
            },
        )

        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "imported": len(created_members),
                "upcoming_renewals_count": upcoming_count,
                "revenue_at_risk": str(revenue_at_risk),
                "message": f"Successfully imported {len(created_members)} members.",
            },
        }), 201

    @bp.route("/members/import/preview", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def preview_member_import():
        data = request.get_json(silent=True) or {}
        preview = validate_csv(g.gym_id, g.current_user.gym.timezone, data.get("csv_text", ""))
        return jsonify({"success": True, "data": preview})

    @bp.route("/members/import", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def import_members():
        data = request.get_json(silent=True) or {}
        preview = validate_csv(g.gym_id, g.current_user.gym.timezone, data.get("csv_text", ""))
        if preview["file_errors"] or preview["summary"]["invalid"] or preview["summary"]["duplicates"]:
            return error_response(
                "IMPORT_VALIDATION_FAILED",
                "Fix every invalid or duplicate row before importing. No members were imported.",
                422,
                {"preview": preview},
            )
        rows = preview["rows"]
        if not rows:
            return error_response("VALIDATION_ERROR", "CSV has no member rows.", 400)
        gym = db.session.execute(select(Gym).where(Gym.id == g.gym_id).with_for_update()).scalar_one()
        current_count = db.session.query(func.count(Member.id)).filter(
            Member.gym_id == g.gym_id, Member.deleted_at.is_(None)
        ).scalar() or 0
        if gym.max_members is not None and current_count + len(rows) > gym.max_members:
            return error_response("MEMBER_LIMIT", "Import would exceed the member limit. No members were imported.", 409)
        for row in rows:
            normalized = dict(row["normalized"])
            normalized["membership_start"] = date.fromisoformat(normalized["membership_start"])
            normalized["membership_end"] = date.fromisoformat(normalized["membership_end"])
            db.session.add(Member(gym_id=g.gym_id, joined_on=today_for_gym(gym.timezone), **normalized))
        audit(
            action="mobile_bulk_import_members",
            resource_type="member",
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"created": len(rows)},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"imported": len(rows), "skipped": 0}}), 201

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
        phone = normalize_phone_e164((data.get("phone") or "").strip())
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

        local_today = today_for_gym(gym.timezone or "Asia/Kolkata")
        membership_start = _parse_date(data.get("membership_start")) or local_today
        membership_end = _parse_date(data.get("membership_end")) or local_today

        member = Member(
            gym_id=g.gym_id,
            full_name=full_name,
            phone=phone,
            email=(data.get("email") or "").strip() or None,
            gender=(data.get("gender") or "").strip() or None,
            plan_id=plan_id if plan_id else None,
            joined_on=local_today,
            membership_start=membership_start,
            membership_end=membership_end,
            status="active" if membership_end >= local_today else "expired",
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
            phone = normalize_phone_e164((data["phone"] or "").strip())
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
