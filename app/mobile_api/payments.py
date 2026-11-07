"""Mobile API payments endpoints."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import current_app, g, jsonify, request
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

import urllib.parse

from app.extensions import db
from app.mobile_api.date_rules import plan_days_error
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, MembershipPlan, MobileIdempotencyKey, PaymentVerification, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.idempotency_service import (
    begin_idempotency,
    find_replay,
    legacy_replay,
    record_idempotency,
    replay_after_conflict,
    request_fingerprint,
    valid_key,
)
from app.services.payment_service import (
    cancel_payment,
    canonical_payment_reference,
    delete_payment,
    refund_payment,
    reject_payment,
    verify_payment,
    verified_payment_with_reference,
)
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day


def _generate_receipt(p: PaymentVerification) -> dict:
    gym = getattr(g, "current_user", None) and getattr(g.current_user, "gym", None)
    if not gym and p.gym_id:
        gym = Gym.query.get(p.gym_id)
    gym_name = gym.name if gym else "Gym"

    member = p.member
    member_name = member.full_name if member else "Member"
    member_phone = (member.phone if member else "") or ""
    plan_name = p.plan.name if p.plan else (member.plan.name if member and member.plan else "Gym Membership")
    paid_on_str = p.paid_on.strftime("%d %b %Y") if p.paid_on else (p.created_at.strftime("%d %b %Y") if p.created_at else "")
    amount_val = p.amount if p.amount is not None else 0
    amount_str = f"₹{amount_val:,.2f}"
    method_str = (p.method or "CASH").upper()
    ref_str = p.reference or f"REC-{p.id:06d}"
    valid_till_str = member.membership_end.strftime("%d %b %Y") if member and member.membership_end else "N/A"

    receipt_text = (
        f"🧾 *PAYMENT RECEIPT*\n"
        f"*{gym_name}*\n"
        f"────────────────────────\n"
        f"👤 *Member:* {member_name}\n"
        f"📋 *Plan:* {plan_name}\n"
        f"💰 *Amount Paid:* {amount_str}\n"
        f"💳 *Mode:* {method_str}\n"
        f"📅 *Date:* {paid_on_str}\n"
        f"🔖 *Receipt #:* {ref_str}\n"
        f"⏳ *Valid Till:* {valid_till_str}\n"
        f"────────────────────────\n"
        f"Thank you for training with us! Stay fit & healthy! 💪"
    )

    clean_phone = "".join(ch for ch in member_phone if ch.isdigit())
    if len(clean_phone) == 10:
        clean_phone = f"91{clean_phone}"

    encoded_text = urllib.parse.quote(receipt_text)
    whatsapp_url = f"https://wa.me/{clean_phone}?text={encoded_text}" if clean_phone else f"https://wa.me/?text={encoded_text}"

    return {
        "payment_id": p.id,
        "receipt_number": ref_str,
        "member_name": member_name,
        "member_phone": member_phone,
        "gym_name": gym_name,
        "amount": str(p.amount),
        "plan_name": plan_name,
        "paid_on": paid_on_str,
        "valid_until": valid_till_str,
        "receipt_text": receipt_text,
        "whatsapp_url": whatsapp_url,
    }


def _serialize_payment(p: PaymentVerification) -> dict:
    receipt = _generate_receipt(p)
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
        "renewal_start_date": p.renewal_start_date.isoformat() if p.renewal_start_date else None,
        "method": p.method,
        "channel": p.channel or "offline",
        "reference": p.reference,
        "status": p.status,
        "renewal_days": p.renewal_days,
        "notes": p.notes,
        "created_by": p.created_by.full_name if p.created_by else None,
        "verified_by": p.verified_by.full_name if p.verified_by else None,
        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None,
        "refunded_by": p.refunded_by.full_name if getattr(p, "refunded_by", None) else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "receipt": receipt,
        "whatsapp_url": receipt["whatsapp_url"],
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
        member_id = request.args.get("member_id", type=int)

        query = PaymentVerification.query.filter_by(gym_id=g.gym_id)
        if member_id:
            query = query.filter_by(member_id=member_id)
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

        # Method breakdown (V3-L16): buckets are built from the single
        # PAYMENT_METHODS enum in payment_service — every validated method
        # (upi, cash, card, bank_transfer, bank, other) gets its own
        # bucket, so a bank transfer no longer lands in "other". Server-set
        # methods outside the enum (member_claim/member_request) fall back
        # to "other".
        from app.services.payment_service import PAYMENT_METHODS

        methods = {m: Decimal("0.00") for m in sorted(PAYMENT_METHODS)}
        channels = {"online": Decimal("0.00"), "offline": Decimal("0.00")}

        for p in today_payments:
            m = (p.method or "other").lower()
            methods[m if m in methods else "other"] += p.amount

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

    @bp.route("/payments/<int:payment_id>/receipt", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_payment_receipt(payment_id: int):
        payment = (
            PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id)
            .options(
                joinedload(PaymentVerification.member),
                joinedload(PaymentVerification.plan),
                joinedload(PaymentVerification.created_by),
            )
            .first()
        )
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        return jsonify({"success": True, "data": _generate_receipt(payment)})

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
                # V8-L5: replay through the decrypting helper, not the
                # raw stored body — a credential stored as enc1:
                # ciphertext must decrypt on replay (or the row is
                # dropped and the request executes fresh), never be
                # returned as ciphertext.
                replay = legacy_replay(existing, matches_request)
                if replay is not None:
                    return replay

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
        # V8-L14: no upper bound (fat-finger risk) — a typo'd ₹1,50,000
        # payment verified and inflated payment_backed_amount until
        # noticed and refunded. Same ₹99,999,999.99 cap direct renew
        # uses (renewals.py), so the two creation paths agree.
        if not amount.is_finite() or amount > Decimal("99999999.99"):
            return error_response("VALIDATION_ERROR", "Amount must be at most 99999999.99.", 400)

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

        # V6-L2: standard_price / discount are money, not free text —
        # a negative discount inflates the total_discount sum and a
        # discount above standard_price makes the stored triple
        # arithmetically impossible; a negative standard_price shrinks
        # recovery_rate's expected-value denominator.
        if standard_price is not None and standard_price < 0:
            return error_response("VALIDATION_ERROR", "standard_price cannot be negative.", 400)
        if discount < 0:
            return error_response("VALIDATION_ERROR", "discount cannot be negative.", 400)
        if standard_price is not None and discount > standard_price:
            return error_response("VALIDATION_ERROR", "discount cannot exceed standard_price.", 400)

        channel = str(data.get("channel", "offline")).strip().lower()
        # B-L1: channel is an enum, not free text.
        from app.services.payment_service import PAYMENT_CHANNELS, PAYMENT_METHODS

        if channel not in PAYMENT_CHANNELS:
            return error_response(
                "VALIDATION_ERROR",
                f"channel must be one of: {', '.join(sorted(PAYMENT_CHANNELS))}.",
                400,
            )

        # B-L1: method is an enum, not free text.
        method = str(data.get("method", "upi") or "upi").strip().lower()
        if method not in PAYMENT_METHODS:
            return error_response(
                "VALIDATION_ERROR",
                f"method must be one of: {', '.join(sorted(PAYMENT_METHODS))}.",
                400,
            )

        # M9: the same UPI reference pasted twice must not double-count
        # collections — reject when this gym already has a VERIFIED
        # payment with the same reference.
        # V4-M19: canonicalised — "UTR123", "utr123" and "UTR 123"
        # are the same reference.
        reference = canonical_payment_reference(data.get("reference") or "")
        if reference is not None:
            if verified_payment_with_reference(g.gym_id, reference) is not None:
                return error_response(
                    "DUPLICATE_REFERENCE",
                    "A verified payment with this reference already exists for this gym.",
                    409,
                )

        auto_verify = bool(data.get("auto_verify", False))
        # V8-M2: a ₹0 auto-verified payment is a free membership with
        # no owner gate and no payment evidence. Staff cash collection
        # stays possible (auto_verify for a real amount), but an
        # auto-verify with no money behind it is rejected outright.
        # The verify endpoint below applies the same rule to the
        # two-step path (create ₹0 pending, then verify it).
        if auto_verify and amount <= 0:
            return error_response(
                "VALIDATION_ERROR",
                "Auto-verified payments must have an amount greater than zero.",
                400,
            )

        try:
            renewal_days = int(data.get("renewal_days", plan.duration_days if plan else 30))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid renewal_days.", 400)
        if not 1 <= renewal_days <= 730:
            return error_response("VALIDATION_ERROR", "renewal_days must be between 1 and 730.", 400)
        # Strict: free-typed renewal days were the original date bug.
        # Days must equal the plan duration unless the gym owner
        # supplies an override reason (audited below).
        _override_reason = (data.get("override_reason") or "").strip() or None
        _plan_err = plan_days_error(
            renewal_days,
            plan.duration_days if plan else None,
            override_reason=_override_reason,
            is_owner=(g.current_user is not None and g.current_user.role == "gym_owner"),
        )
        if _plan_err is not None:
            return error_response("VALIDATION_ERROR", _plan_err, 400)

        paid_on_str = data.get("paid_on")
        try:
            paid_on = (
                date.fromisoformat(paid_on_str)
                if paid_on_str
                else today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
            )
        except (ValueError, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid paid_on date.", 400)

        raw_start_date = data.get("renewal_start_date")
        try:
            renewal_start_date = (
                date.fromisoformat(raw_start_date.strip())
                if isinstance(raw_start_date, str) and raw_start_date.strip()
                else None
            )
        except ValueError:
            return error_response("VALIDATION_ERROR", "Invalid renewal_start_date; use YYYY-MM-DD.", 400)
        if raw_start_date is not None and not isinstance(raw_start_date, str):
            return error_response("VALIDATION_ERROR", "renewal_start_date must use YYYY-MM-DD.", 400)

        # V3-L17: validate at create time (chosen over an edit-the-
        # pending-payment flow): a start so far back the period is
        # already over could never verify — verify_payment 409s
        # forever and the owner could never accept the claim.
        # Mirrors verify_payment's rule exactly.
        _today = today_for_gym(g.current_user.gym.timezone or "Asia/Kolkata")
        # V8-L15: paid_on was accepted unvalidated — a future or
        # far-past date was stored, and for legacy unflagged first
        # rows the creation heuristic reads paid_on vs the row's own
        # new_start, so a typo'd paid_on flipped signup↔recovery
        # classification. Sane window: never in the future, never
        # more than 5 years back. Default (no paid_on supplied) is
        # still today, set at parse time above.
        if paid_on > _today:
            return error_response("VALIDATION_ERROR", "paid_on cannot be in the future.", 400)
        if paid_on < _today - timedelta(days=5 * 365):
            return error_response("VALIDATION_ERROR", "paid_on is implausibly old.", 400)
        _earliest_start = (
            member.membership_end + timedelta(days=1)
            if member.membership_end and member.membership_end >= _today
            else _today
        )
        _new_start = renewal_start_date or _earliest_start
        _new_end = _new_start + timedelta(days=renewal_days - 1)
        if _new_start <= _today and _new_end < _today:
            return error_response(
                "VALIDATION_ERROR",
                "This renewal would already be expired. Choose a later start date.",
                400,
            )
        # V8-L6: apply the V7-M4 floor at create time too — the start
        # may not overlap the previous paid period (previous_end + 1),
        # even for an expired member. Until now the floor was only
        # enforced at verify_payment, so a pending payment could sit
        # overlapping and then fail verification with a 400. This runs
        # after the already-expired check above so that check keeps
        # its pinned message for a start that is both overlapping and
        # already over; either way the payment is rejected here.
        if (
            renewal_start_date is not None
            and member.membership_end
            and renewal_start_date < member.membership_end + timedelta(days=1)
        ):
            return error_response(
                "VALIDATION_ERROR",
                f"Renewal start date must be {(member.membership_end + timedelta(days=1)).isoformat()} or later so it does not overlap the previous paid period.",
                400,
            )

        payment = PaymentVerification(
            gym_id=g.gym_id,
            member_id=member.id,
            plan_id=plan.id if plan else None,
            created_by_id=g.current_user.id,
            standard_price=standard_price,
            discount=discount,
            amount=amount,
            paid_on=paid_on,
            renewal_start_date=renewal_start_date,
            method=method,
            channel=channel,
            reference=reference,
            status="pending",
            renewal_days=renewal_days,
            notes=(data.get("notes") or "").strip() or None,
            # V5-L16/V5-L17: carry the owner-approved override through
            # verify time so the renewal row is flagged, not stripped.
            override_reason=_override_reason,
        )
        db.session.add(payment)
        db.session.flush()

        if auto_verify:
            try:
                verify_payment(payment, verified_by_id=g.current_user.id, renewal_days=renewal_days)
            except IntegrityError as exc:
                # V4-L1: two concurrent auto_verify creates with the
                # same UTR both pass the re-check, then the second
                # commit/flush hits the partial unique index — that
                # used to surface as a 500. V5-L3: map it to
                # DUPLICATE_REFERENCE only when the constraint in the
                # error IS the UTR index; any other integrity failure
                # still re-raises.
                from app.services.payment_service import is_duplicate_reference_error

                db.session.rollback()
                if is_duplicate_reference_error(exc) or (
                    reference is not None
                    and verified_payment_with_reference(g.gym_id, reference) is not None
                ):
                    return error_response(
                        "DUPLICATE_REFERENCE",
                        "A verified payment with this reference already exists for this gym.",
                        409,
                    )
                raise
            except ValueError as exc:
                db.session.rollback()
                if str(exc).startswith("DUPLICATE_REFERENCE"):
                    return error_response("DUPLICATE_REFERENCE", str(exc), 409)
                return error_response("VALIDATION_ERROR", str(exc), 400)

        audit(
            action="create_payment",
            resource_type="payment_verification",
            resource_id=payment.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"amount": str(amount), "channel": channel, "auto_verify": auto_verify, "renewal_days": renewal_days, "override_reason": _override_reason},
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
        except IntegrityError as exc:
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
                if existing:
                    # V8-L5: replay through the decrypting helper, not the
                    # raw stored body — a credential stored as enc1:
                    # ciphertext must decrypt on replay (or the row is
                    # dropped and the request executes fresh), never be
                    # returned as ciphertext.
                    replay = legacy_replay(existing, matches_request)
                    if replay is not None:
                        return replay
            # V4-L1: the commit-time UTR race (two concurrent creates
            # with the same reference, second one hitting the partial
            # unique index) is a DUPLICATE_REFERENCE 409, not a 500.
            # V5-L3: only when the constraint in the error IS the UTR
            # index (or the clash check finds a verified payment) —
            # any other integrity failure still re-raises.
            from app.services.payment_service import is_duplicate_reference_error

            if is_duplicate_reference_error(exc) or (
                reference is not None
                and verified_payment_with_reference(g.gym_id, reference) is not None
            ):
                return error_response(
                    "DUPLICATE_REFERENCE",
                    "A verified payment with this reference already exists for this gym.",
                    409,
                )
            raise

        try:
            from app.services.push_notification_service import notify_new_payment
            notify_new_payment(g.current_user.gym, payment)
        except Exception:
            # Never swallow: a broken push pipeline must be visible.
            current_app.logger.exception("Push notification failed for new payment")

        return jsonify(response_body), 201

    @bp.route("/payments/<int:payment_id>/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def verify_payment_endpoint(payment_id: int):
        # A timeout retry after a successful verify must replay the
        # stored success, not 409 "already verified" (the client cannot
        # tell a lost success from a failure). The fingerprint binds
        # the key to THIS payment — the body is empty.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="verify_payment",
            headers=request.headers,
            payload={"payment_id": payment_id},
        )
        if replay is not None:
            return replay

        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        if payment.status == "verified":
            return error_response("CONFLICT", "Payment is already verified.", 409)
        if payment.status not in ("pending", "processing"):
            return error_response("CONFLICT", f"Payment is {payment.status}.", 409)
        # V8-M2: the two-step version of the ₹0 free-membership hole —
        # create a ₹0 payment pending, then verify it. Staff may not
        # verify a zero-amount payment; the owner still can (a genuine
        # complimentary renewal is an owner decision, audited).
        if payment.amount is not None and payment.amount <= 0 and g.current_user.role != "gym_owner":
            return error_response(
                "FORBIDDEN",
                "Only the gym owner can verify a zero-amount payment.",
                403,
            )

        renewal_days = payment.renewal_days or (payment.member.plan.duration_days if payment.member.plan else 30)
        try:
            renewal = verify_payment(payment, verified_by_id=g.current_user.id, renewal_days=renewal_days)
            audit(
                action="verify_payment", resource_type="payment_verification", resource_id=payment.id,
                gym_id=g.gym_id, actor_id=g.current_user.id,
                metadata={"new_end": str(payment.member.membership_end), "renewal_days": renewal_days},
            )
            response_body = {"success": True, "data": {
                "message": "Payment verified and renewal scheduled." if renewal.new_start > today_for_gym(payment.member.gym.timezone or "Asia/Kolkata") else "Payment verified and membership renewed.",
                "renewal_start_date": renewal.new_start.isoformat(),
                "membership_end": renewal.new_end.isoformat(),
            }}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="verify_payment",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
            db.session.commit()
        except IntegrityError as exc:
            # V3-M3 backstop: the partial unique index refused a second
            # verified payment with the same reference (concurrent verifies
            # racing past the re-check). V5-L3: only map it when the
            # constraint in the error IS the UTR index — a non-UTR
            # integrity failure re-raises (500) instead of being
            # misreported as a duplicate reference.
            from app.services.payment_service import is_duplicate_reference_error

            db.session.rollback()
            # A concurrent retry with the same key may have won the
            # unique-key race — replay its stored response instead of
            # reporting a duplicate reference.
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="verify_payment",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            if not is_duplicate_reference_error(exc):
                raise
            return error_response(
                "DUPLICATE_REFERENCE",
                "A verified payment with this reference already exists for this gym.",
                409,
            )
        except ValueError as exc:
            db.session.rollback()
            # V3-M3: the verify-time duplicate-UTR rejection surfaces as
            # its own code so clients never mistake it for an idempotent
            # already-verified success.
            if str(exc).startswith("DUPLICATE_REFERENCE"):
                return error_response("DUPLICATE_REFERENCE", str(exc), 409)
            return error_response("CONFLICT", str(exc), 409)

        return jsonify(response_body)

    @bp.route("/payments/<int:payment_id>/reject", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reject_payment_endpoint(payment_id: int):
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="reject_payment",
            headers=request.headers,
            payload={"payment_id": payment_id},
        )
        if replay is not None:
            return replay

        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        try:
            reject_payment(payment, verified_by_id=g.current_user.id)
            audit(action="reject_payment", resource_type="payment_verification", resource_id=payment.id,
                  gym_id=g.gym_id, actor_id=g.current_user.id)
            response_body = {"success": True, "data": {"message": "Payment rejected."}}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="reject_payment",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                replayed = replay_after_conflict(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="reject_payment",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)

        return jsonify(response_body)

    @bp.route("/payments/<int:payment_id>/cancel", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def cancel_payment_endpoint(payment_id: int):
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="cancel_payment",
            headers=request.headers,
            payload={"payment_id": payment_id},
        )
        if replay is not None:
            return replay

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
            response_body = {"success": True, "data": {"message": "Payment cancelled successfully."}}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="cancel_payment",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                replayed = replay_after_conflict(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="cancel_payment",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)

        return jsonify(response_body)

    @bp.route("/payments/<int:payment_id>", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner")
    def delete_payment_endpoint(payment_id: int):

        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="delete_payment",
            headers=request.headers,
            payload={"payment_id": payment_id},
        )
        if replay is not None:
            return replay

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
            response_body = {"success": True, "data": {"message": "Payment deleted successfully."}}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="delete_payment",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                replayed = replay_after_conflict(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="delete_payment",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception("Failed to delete payment %s: %s", payment_id, exc)
            return error_response("DB_ERROR", "Failed to delete payment.", 500)

        return jsonify(response_body)

    @bp.route("/payments/<int:payment_id>/refund", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def refund_payment_endpoint(payment_id: int):
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="refund_payment",
            headers=request.headers,
            payload={"payment_id": payment_id},
        )
        if replay is not None:
            return replay

        payment = PaymentVerification.query.filter_by(id=payment_id, gym_id=g.gym_id).first()
        if payment is None:
            return error_response("NOT_FOUND", "Payment not found.", 404)
        try:
            refund_payment(payment, refunded_by_id=g.current_user.id)
            audit(
                action="refund_payment",
                resource_type="payment_verification",
                resource_id=payment_id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
            )
            response_body = {"success": True, "data": {"message": "Payment refunded successfully."}}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="refund_payment",
                key=idempotency_key,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                replayed = replay_after_conflict(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="refund_payment",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
        except ValueError as exc:
            db.session.rollback()
            return error_response("CONFLICT", str(exc), 409)
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception("Failed to refund payment %s: %s", payment_id, exc)
            return error_response("DB_ERROR", "Failed to refund payment.", 500)

        return jsonify(response_body)

