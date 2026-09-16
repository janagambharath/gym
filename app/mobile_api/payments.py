"""Mobile API payments endpoints."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from flask import current_app, g, jsonify, request
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, MembershipPlan, MobileIdempotencyKey, PaymentVerification, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.idempotency_service import find_replay, request_fingerprint, valid_key
from app.services.payment_service import cancel_payment, delete_payment, reject_payment, verify_payment
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


def _serialize_payment(p: PaymentVerification) -> dict:
    return {
        "id": p.id,
        "member_id": p.member_id,
        "member_name": p.member.full_name if p.member else None,
        "member_phone": p.member.phone if p.member else None,
        "plan_id": p.plan_id,
        "plan_name": p.plan.name if p.plan else (p.member.plan.name if p.member and p.member.plan else None),
        "standard_price": str(p.standard_price) if p.standard_price is not None else None,
        "discount": str(p.discount) if p.discount is not None else "0.00",
        "final_payable": str(p.amount),
        "amount": str(p.amount),
        "paid_on": p.paid_on.isoformat() if p.paid_on else None,
        "method": p.method,
        "channel": p.channel or "offline",
        "reference": p.reference,
        "status": p.status,
        "renewal_days": p.renewal_days,
        "notes": p.notes,
        "created_by": p.created_by.full_name if p.created_by else None,
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
        channel = request.args.get("channel", "").strip()
        method = request.args.get("method", "").strip()
        query_str = request.args.get("q", "").strip()

        query = PaymentVerification.query.filter_by(gym_id=g.gym_id)
        if status and status != "all":
            query = query.filter_by(status=status)
        if channel and channel != "all":
            query = query.filter_by(channel=channel)
        if method and method != "all":
            query = query.filter(PaymentVerification.method.ilike(f"%{method}%"))
        if query_str:
            query = query.join(PaymentVerification.member).filter(
                (Member.full_name.ilike(f"%{query_str}%"))
                | (Member.phone.ilike(f"%{query_str}%"))
                | (PaymentVerification.reference.ilike(f"%{query_str}%"))
            )

        total = query.count()
        payments = (
            query.options(
                joinedload(PaymentVerification.member),
                joinedload(PaymentVerification.plan),
                joinedload(PaymentVerification.verified_by),
                joinedload(PaymentVerification.created_by),
            )
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

    @bp.route("/payments/summary", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def payments_summary():
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        today = today_for_gym(gym_timezone)
        start_at = utc_start_of_gym_day(gym_timezone, local_date=today)

        # Today's verified payments
        today_payments = (
            PaymentVerification.query.filter(
                PaymentVerification.gym_id == g.gym_id,
                PaymentVerification.status.in_(["verified", "paid"]),
                PaymentVerification.verified_at >= start_at,
                PaymentVerification.is_test.is_(False),
            ).all()
        )

        total_collected = sum((p.amount for p in today_payments), Decimal("0.00"))
        total_discount = sum((p.discount for p in today_payments if p.discount), Decimal("0.00"))
        count_payments = len(today_payments)

        # Method breakdown
        methods = {"upi": Decimal("0.00"), "cash": Decimal("0.00"), "card": Decimal("0.00"), "other": Decimal("0.00")}
        channels = {"online": Decimal("0.00"), "offline": Decimal("0.00")}

        for p in today_payments:
            m = (p.method or "other").lower()
            if "upi" in m:
                methods["upi"] += p.amount
            elif "cash" in m:
                methods["cash"] += p.amount
            elif "card" in m:
                methods["card"] += p.amount
            else:
                methods["other"] += p.amount

            ch = (p.channel or "offline").lower()
            if ch == "online":
                channels["online"] += p.amount
            else:
                channels["offline"] += p.amount

        # Pending payments
        pending_query = PaymentVerification.query.filter(
            PaymentVerification.gym_id == g.gym_id,
            PaymentVerification.status.in_(["pending", "processing"]),
            PaymentVerification.is_test.is_(False),
        )
        pending_count = pending_query.count()
        pending_amount = sum((p.amount for p in pending_query.all()), Decimal("0.00"))

        # Failed payments today
        failed_count = PaymentVerification.query.filter(
            PaymentVerification.gym_id == g.gym_id,
            PaymentVerification.status == "failed",
            PaymentVerification.created_at >= start_at,
            PaymentVerification.is_test.is_(False),
        ).count()

        return jsonify({
            "success": True,
            "data": {
                "today": {
                    "total_collected": str(total_collected),
                    "total_discount": str(total_discount),
                    "payment_count": count_payments,
                    "methods": {k: str(v) for k, v in methods.items()},
                    "channels": {k: str(v) for k, v in channels.items()},
                },
                "pending": {
                    "count": pending_count,
                    "amount": str(pending_amount),
                },
                "failed": {
                    "count": failed_count,
                },
            },
        })

    @bp.route("/payments/<int:payment_id>", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_payment(payment_id: int):
        payment = (
            PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id)
            .options(
                joinedload(PaymentVerification.member),
                joinedload(PaymentVerification.plan),
                joinedload(PaymentVerification.verified_by),
                joinedload(PaymentVerification.created_by),
            )
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
        idempotency_key = valid_key(request.headers.get("Idempotency-Key"))
        if idempotency_key == "":
            return error_response("VALIDATION_ERROR", "Idempotency-Key is too long.", 400)

        request_hash = request_fingerprint(data)
        if idempotency_key:
            existing, matches_request = find_replay(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="create_payment",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if existing:
                if not matches_request:
                    return error_response(
                        "IDEMPOTENCY_KEY_REUSED",
                        "This idempotency key was already used for a different payment request.",
                        409,
                    )
                return jsonify(existing.response_body), existing.status_code

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

        plan_id = data.get("plan_id")
        plan = None
        if plan_id:
            plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id).first()
        elif member.plan:
            plan = member.plan

        raw_standard = data.get("standard_price")
        standard_price: Decimal | None = None
        if raw_standard is not None and str(raw_standard).strip():
            try:
                standard_price = Decimal(str(raw_standard).strip())
            except (InvalidOperation, TypeError):
                standard_price = None
        if standard_price is None and plan:
            standard_price = plan.price

        try:
            amount = Decimal(str(data.get("amount", data.get("final_payable", "0"))).strip() or "0")
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid amount.", 400)
        if amount < 0:
            return error_response("VALIDATION_ERROR", "Amount cannot be negative.", 400)

        # Discount calculation
        raw_discount = data.get("discount")
        if raw_discount is not None and str(raw_discount).strip():
            try:
                discount = Decimal(str(raw_discount).strip())
            except (InvalidOperation, TypeError):
                discount = Decimal("0.00")
        elif standard_price is not None and standard_price >= amount:
            discount = standard_price - amount
        else:
            discount = Decimal("0.00")

        channel = str(data.get("channel", "offline")).strip().lower()
        if channel not in ("online", "offline"):
            channel = "offline"

        auto_verify = bool(data.get("auto_verify", False))

        try:
            renewal_days = int(data.get("renewal_days", plan.duration_days if plan else 30))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid renewal_days.", 400)
        if not 1 <= renewal_days <= 730:
            return error_response("VALIDATION_ERROR", "renewal_days must be between 1 and 730.", 400)

        paid_on_str = data.get("paid_on")
        try:
            paid_on = (
                date.fromisoformat(paid_on_str)
                if paid_on_str
                else today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
            )
        except (ValueError, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid paid_on date.", 400)

        payment = PaymentVerification(
            gym_id=g.gym_id,
            member_id=member.id,
            plan_id=plan.id if plan else None,
            created_by_id=g.current_user.id,
            standard_price=standard_price,
            discount=discount,
            amount=amount,
            paid_on=paid_on,
            method=data.get("method", "upi"),
            channel=channel,
            reference=(data.get("reference") or "").strip() or None,
            status="pending",
            renewal_days=renewal_days,
            notes=(data.get("notes") or "").strip() or None,
        )
        db.session.add(payment)
        db.session.flush()

        if auto_verify:
            verify_payment(payment, verified_by_id=g.current_user.id, renewal_days=renewal_days)

        audit(
            action="create_payment",
            resource_type="payment_verification",
            resource_id=payment.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"amount": str(amount), "channel": channel, "auto_verify": auto_verify},
        )
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": _serialize_payment(payment)}
        if idempotency_key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="create_payment",
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
            # A concurrent retry may have won the unique-key race. Its entire
            # transaction includes the payment, so replay its stored response
            # instead of creating a second financial record.
            if idempotency_key:
                existing, matches_request = find_replay(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="create_payment",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if existing and matches_request:
                    return jsonify(existing.response_body), existing.status_code
            raise

        try:
            from app.services.push_notification_service import notify_new_payment
            notify_new_payment(g.current_user.gym, payment)
        except Exception:
            pass

        return jsonify(response_body), 201

    @bp.route("/payments/<int:payment_id>/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def verify_payment_endpoint(payment_id: int):
        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        if payment.status == "verified":
            return error_response("CONFLICT", "Payment is already verified.", 409)
        if payment.status not in ("pending", "processing"):
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

    @bp.route("/payments/<int:payment_id>/cancel", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def cancel_payment_endpoint(payment_id: int):
        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        try:
            cancel_payment(payment, cancelled_by_id=g.current_user.id)
            audit(
                action="cancel_payment",
                resource_type="payment_verification",
                resource_id=payment.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
            )
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)

        return jsonify({"success": True, "data": {"message": "Payment cancelled successfully."}})

    @bp.route("/payments/<int:payment_id>", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner")
    def delete_payment_endpoint(payment_id: int):

        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        try:
            delete_payment(payment)
            audit(
                action="delete_payment",
                resource_type="payment_verification",
                resource_id=payment_id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
            )
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception("Failed to delete payment %s: %s", payment_id, exc)
            return error_response("DB_ERROR", "Failed to delete payment.", 500)

        return jsonify({"success": True, "data": {"message": "Payment deleted successfully."}})

