"""Mobile API renewals endpoints."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, MobileIdempotencyKey, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.idempotency_service import find_replay, request_fingerprint, valid_key
from app.services.timezone_service import today_for_gym


def _serialize_renewal(r: RenewalHistory) -> dict:
    return {
        "id": r.id,
        "member_id": r.member_id,
        "member_name": r.member.full_name if r.member else None,
        "plan_name": r.plan.name if r.plan else None,
        "previous_end": r.previous_end.isoformat() if r.previous_end else None,
        "new_start": r.new_start.isoformat() if r.new_start else None,
        "new_end": r.new_end.isoformat() if r.new_end else None,
        "amount": str(r.amount),
        "notes": r.notes,
        "renewed_by": r.renewed_by.full_name if r.renewed_by else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _serialize_member_for_gym(member: Member, today: date) -> dict:
    """Use the gym-local date for a renewal list's days-remaining field."""
    from app.mobile_api.members import _serialize_member

    payload = _serialize_member(member)
    payload["days_until_expiry"] = (member.membership_end - today).days
    return payload


def register_renewals_routes(bp):
    @bp.route("/renewals", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_renewals():
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        member_id = request.args.get("member_id", type=int)

        query = RenewalHistory.query.filter_by(gym_id=g.gym_id)
        if member_id:
            query = query.filter_by(member_id=member_id)
        total = query.count()
        renewals = (
            query.options(joinedload(RenewalHistory.member), joinedload(RenewalHistory.plan), joinedload(RenewalHistory.renewed_by))
            .order_by(RenewalHistory.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "renewals": [_serialize_renewal(r) for r in renewals],
                "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": (total + page_size - 1) // page_size},
            },
        })

    @bp.route("/renewals/upcoming", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def upcoming_renewals():
        today = today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
        soon = today + timedelta(days=7)
        members = (
            Member.query.filter_by(gym_id=g.gym_id, status="active")
            .filter(Member.deleted_at.is_(None))
            .filter(Member.membership_end >= today, Member.membership_end <= soon)
            .options(joinedload(Member.plan))
            .order_by(Member.membership_end.asc())
            .limit(100)
            .all()
        )
        return jsonify({"success": True, "data": {"members": [_serialize_member_for_gym(m, today) for m in members]}})

    @bp.route("/renewals/expired", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def expired_renewals():
        today = today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
        members = (
            Member.query.filter_by(gym_id=g.gym_id, status="expired")
            .filter(Member.deleted_at.is_(None))
            .filter(Member.membership_end < today)
            .options(joinedload(Member.plan))
            .order_by(Member.membership_end.desc())
            .limit(100)
            .all()
        )
        return jsonify({"success": True, "data": {"members": [_serialize_member_for_gym(m, today) for m in members]}})

    @bp.route("/renewals/<int:member_id>", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def renew_member(member_id: int):
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return error_response("VALIDATION_ERROR", "Renewal must be a JSON object.", 400)

        idempotency_key = valid_key(request.headers.get("Idempotency-Key"))
        if idempotency_key == "":
            return error_response("VALIDATION_ERROR", "Idempotency-Key is too long.", 400)

        request_hash = request_fingerprint({"member_id": member_id, **data})
        if idempotency_key:
            existing, matches_request = find_replay(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="direct_renewal",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if existing:
                if not matches_request:
                    return error_response(
                        "IDEMPOTENCY_KEY_REUSED",
                        "This idempotency key was already used for a different renewal request.",
                        409,
                    )
                return jsonify(existing.response_body), existing.status_code

        # Validate renewal_days.
        try:
            renewal_days = int(data.get("renewal_days", 0))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid renewal_days.", 400)
        if not 1 <= renewal_days <= 730:
            return error_response("VALIDATION_ERROR", "renewal_days must be between 1 and 730.", 400)

        # Validate amount.
        try:
            amount = Decimal(str(data.get("amount", "0")).strip() or "0")
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid amount.", 400)
        if amount < 0:
            return error_response("VALIDATION_ERROR", "Amount cannot be negative.", 400)

        notes = (data.get("notes") or "").strip()

        # Load member with lock to prevent concurrent renewal.
        member = (
            db.session.execute(
                select(Member)
                .where(Member.id == member_id, Member.gym_id == g.gym_id, Member.deleted_at.is_(None))
                .with_for_update()
            )
            .scalar_one_or_none()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        previous_end = member.membership_end
        today = today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
        new_start = max(today, previous_end + timedelta(days=1))
        new_end = new_start + timedelta(days=renewal_days - 1)

        member.membership_start = new_start
        member.membership_end = new_end
        member.status = "active"
        queue_membership_command(member)

        renewal = RenewalHistory(
            gym_id=g.gym_id,
            member_id=member.id,
            plan_id=member.plan_id,
            renewed_by_id=g.current_user.id,
            previous_end=previous_end,
            new_start=new_start,
            new_end=new_end,
            amount=amount,
            notes=notes or f"Renewed for {renewal_days} days via mobile.",
        )
        db.session.add(renewal)
        db.session.flush()
        audit(
            action="renew_member",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"renewal_days": renewal_days, "new_end": new_end.isoformat()},
        )
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": _serialize_renewal(renewal)}
        if idempotency_key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="direct_renewal",
                    key=idempotency_key,
                    request_hash=request_hash,
                    status_code=201,
                    response_body=response_body,
                )
            )

        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            if idempotency_key:
                existing, matches_request = find_replay(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="direct_renewal",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if existing and matches_request:
                    return jsonify(existing.response_body), existing.status_code
            raise

        return jsonify(response_body), 201
