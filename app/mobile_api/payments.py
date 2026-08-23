"""Mobile API payments endpoints."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, PaymentVerification
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.payment_service import reject_payment, verify_payment


def _serialize_payment(p: PaymentVerification) -> dict:
    return {
        "id": p.id,
        "member_id": p.member_id,
        "member_name": p.member.full_name if p.member else None,
        "amount": str(p.amount),
        "paid_on": p.paid_on.isoformat() if p.paid_on else None,
        "method": p.method,
        "reference": p.reference,
        "status": p.status,
        "renewal_days": p.renewal_days,
        "notes": p.notes,
        "verified_by": p.verified_by.full_name if p.verified_by else None,
        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def register_payments_routes(bp):
    @bp.route("/payments", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_payments():
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 100)
        status = request.args.get("status", "").strip()

        query = PaymentVerification.query.filter_by(gym_id=g.gym_id)
        if status:
            query = query.filter_by(status=status)
        total = query.count()
        payments = (
            query.options(joinedload(PaymentVerification.member), joinedload(PaymentVerification.verified_by))
            .order_by(PaymentVerification.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return jsonify({
            "success": True,
            "data": {
                "payments": [_serialize_payment(p) for p in payments],
                "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": (total + page_size - 1) // page_size},
            },
        })

    @bp.route("/payments/<int:payment_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_payment(payment_id: int):
        payment = (
            PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id)
            .options(joinedload(PaymentVerification.member), joinedload(PaymentVerification.verified_by))
            .first()
        )
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        return jsonify({"success": True, "data": _serialize_payment(payment)})

    @bp.route("/payments", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def create_payment():
        data = request.get_json(silent=True) or {}
        member_id = data.get("member_id")
        if not member_id:
            return error_response("VALIDATION_ERROR", "member_id is required.", 400)

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        try:
            amount = Decimal(str(data.get("amount", "0")).strip() or "0")
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid amount.", 400)
        if amount < 0:
            return error_response("VALIDATION_ERROR", "Amount cannot be negative.", 400)

        try:
            renewal_days = int(data.get("renewal_days", 30))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid renewal_days.", 400)
        if not 1 <= renewal_days <= 730:
            return error_response("VALIDATION_ERROR", "renewal_days must be between 1 and 730.", 400)

        paid_on_str = data.get("paid_on")
        try:
            paid_on = date.fromisoformat(paid_on_str) if paid_on_str else date.today()
        except (ValueError, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid paid_on date.", 400)

        payment = PaymentVerification(
            gym_id=g.gym_id,
            member_id=member.id,
            amount=amount,
            paid_on=paid_on,
            method=data.get("method", "upi"),
            reference=(data.get("reference") or "").strip() or None,
            status="pending",
            renewal_days=renewal_days,
            notes=(data.get("notes") or "").strip() or None,
        )
        db.session.add(payment)
        db.session.flush()
        audit(action="create_payment", resource_type="payment_verification", resource_id=payment.id,
              gym_id=g.gym_id, actor_id=g.current_user.id)
        invalidate_dashboard_cache(g.gym_id)
        db.session.commit()

        db.session.refresh(payment)
        return jsonify({"success": True, "data": _serialize_payment(payment)}), 201

    @bp.route("/payments/<int:payment_id>/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def verify_payment_endpoint(payment_id: int):
        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        if payment.status == "verified":
            return error_response("CONFLICT", "Payment is already verified.", 409)
        if payment.status != "pending":
            return error_response("CONFLICT", f"Payment is {payment.status}.", 409)

        renewal_days = payment.renewal_days or (payment.member.plan.duration_days if payment.member.plan else 30)
        try:
            renewal = verify_payment(payment, verified_by_id=g.current_user.id, renewal_days=renewal_days)
            audit(
                action="verify_payment", resource_type="payment_verification", resource_id=payment.id,
                gym_id=g.gym_id, actor_id=g.current_user.id,
                metadata={"new_end": str(payment.member.membership_end), "renewal_days": renewal_days},
            )
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)

        return jsonify({"success": True, "data": {"message": "Payment verified and membership extended."}})

    @bp.route("/payments/<int:payment_id>/reject", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reject_payment_endpoint(payment_id: int):
        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        try:
            reject_payment(payment, verified_by_id=g.current_user.id)
            audit(action="reject_payment", resource_type="payment_verification", resource_id=payment.id,
                  gym_id=g.gym_id, actor_id=g.current_user.id)
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)

        return jsonify({"success": True, "data": {"message": "Payment rejected."}})
