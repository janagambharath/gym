"""Mobile API renewals endpoints."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.date_rules import plan_days_error
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member, MobileIdempotencyKey, RenewalHistory
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import queue_membership_command
from app.services.idempotency_service import (
    begin_idempotency,
    find_replay,
    legacy_replay,
    record_idempotency,
    replay_after_conflict,
    request_fingerprint,
    valid_key,
)
from app.services.timezone_service import today_for_gym


def _serialize_renewal(r: RenewalHistory) -> dict:
    return {
        "id": r.id,
        "member_id": r.member_id,
        "member_name": r.member.full_name if r.member else None,
        "plan_id": r.plan_id,
        "plan_name": r.plan.name if r.plan else None,
        "previous_end": r.previous_end.isoformat() if r.previous_end else None,
        "new_start": r.new_start.isoformat() if r.new_start else None,
        "new_end": r.new_end.isoformat() if r.new_end else None,
        "standard_price": str(r.standard_price) if r.standard_price is not None else None,
        "discount": str(r.discount) if r.discount is not None else "0.00",
        "amount": str(r.amount),
        "channel": r.channel or "offline",
        "notes": r.notes,
        "renewed_by": r.renewed_by.full_name if r.renewed_by else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _serialize_member_for_gym(member: Member, today: date) -> dict:
    """Use the gym-local date for a renewal list's days-remaining field."""
    from app.mobile_api.members import _serialize_member

    payload = _serialize_member(member)
    payload["days_until_expiry"] = (member.membership_end - today).days if member.membership_end else 0
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
    @limiter.limit("30 per minute")
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
                # V8-L5: replay through the decrypting helper, not the
                # raw stored body — a credential stored as enc1:
                # ciphertext must decrypt on replay (or the row is
                # dropped and the request executes fresh), never be
                # returned as ciphertext.
                replay = legacy_replay(existing, matches_request)
                if replay is not None:
                    return replay

        # Validate renewal_days.
        try:
            renewal_days = int(data.get("renewal_days", 0))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid renewal_days.", 400)
        if not 1 <= renewal_days <= 730:
            return error_response("VALIDATION_ERROR", "renewal_days must be between 1 and 730.", 400)

        # A manual renewal may intentionally be complimentary, so an explicit
        # zero remains valid. Do not silently coerce omitted/blank input to
        # zero, however, and reject values the Numeric(10, 2) column cannot
        # safely represent.
        raw_amount = data.get("amount")
        if raw_amount is None or isinstance(raw_amount, bool):
            return error_response(
                "VALIDATION_ERROR",
                "Amount is required and must be a non-negative amount with up to two decimal places.",
                400,
            )
        if isinstance(raw_amount, str) and not raw_amount.strip():
            return error_response(
                "VALIDATION_ERROR",
                "Amount is required and must be a non-negative amount with up to two decimal places.",
                400,
            )
        try:
            amount = Decimal(str(raw_amount).strip())
        except (InvalidOperation, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid amount.", 400)
        if (
            not amount.is_finite()
            or amount < 0
            or amount > Decimal("99999999.99")
            or amount.as_tuple().exponent < -2
        ):
            return error_response(
                "VALIDATION_ERROR",
                "Amount must be a non-negative amount with up to two decimal places.",
                400,
            )

        # V11-H2: mirror the V8-M2 verify gate — a ₹0 direct renew is
        # a complimentary membership, an owner decision, audited. Staff
        # could otherwise hand out free memberships with no payment
        # record at all (this path creates no PaymentVerification row).
        if amount <= 0 and (g.current_user is None or g.current_user.role != "gym_owner"):
            return error_response(
                "FORBIDDEN",
                "Only the gym owner can grant a zero-amount (complimentary) renewal.",
                403,
            )

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

        from app.models import MembershipPlan

        plan_id = data.get("plan_id")
        plan = None
        if plan_id:
            plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id).first()
        elif member.plan:
            plan = member.plan

        # Strict: renewal days must equal the (possibly new) plan
        # duration unless the gym owner supplies an override reason.
        # Checked here, after the plan is known and before any date
        # is written, so a rejected renewal leaves nothing behind.
        _override_reason = (data.get("override_reason") or "").strip() or None
        _plan_err = plan_days_error(
            renewal_days,
            plan.duration_days if plan else None,
            override_reason=_override_reason,
            is_owner=(g.current_user is not None and g.current_user.role == "gym_owner"),
        )
        if _plan_err is not None:
            db.session.rollback()
            return error_response("VALIDATION_ERROR", _plan_err, 400)

        # V11-L1: copy the create_payment pattern verbatim for both
        # fields — finite + 2dp checks immediately after parsing,
        # BEFORE any comparison. The old code parsed inside a try and
        # silently defaulted on failure, so "NaN" 500'd at the first
        # comparison outside the try and "100.999" was silently
        # rounded by Numeric(10,2) on store.
        raw_standard = data.get("standard_price")
        standard_price: Decimal | None = None
        if raw_standard is not None and str(raw_standard).strip():
            try:
                standard_price = Decimal(str(raw_standard).strip())
            except (InvalidOperation, TypeError):
                return error_response("VALIDATION_ERROR", "Invalid standard_price.", 400)
            if not standard_price.is_finite():
                return error_response("VALIDATION_ERROR", "standard_price must be a finite number.", 400)
            if standard_price.as_tuple().exponent < -2:
                return error_response("VALIDATION_ERROR", "standard_price must have at most two decimal places.", 400)
        if standard_price is None and plan:
            standard_price = plan.price

        raw_discount = data.get("discount")
        if raw_discount is not None and str(raw_discount).strip():
            try:
                discount = Decimal(str(raw_discount).strip())
            except (InvalidOperation, TypeError):
                return error_response("VALIDATION_ERROR", "Invalid discount.", 400)
            if not discount.is_finite():
                return error_response("VALIDATION_ERROR", "discount must be a finite number.", 400)
            if discount.as_tuple().exponent < -2:
                return error_response("VALIDATION_ERROR", "discount must have at most two decimal places.", 400)
        elif standard_price is not None and standard_price >= amount:
            discount = standard_price - amount
        else:
            discount = Decimal("0.00")

        # V6-L2: same range check as create_payment — a negative
        # discount or a discount above standard_price makes the stored
        # (standard, discount, amount) triple arithmetically
        # impossible, and a negative standard_price shrinks
        # recovery_rate's expected-value denominator.
        if standard_price is not None and standard_price < 0:
            return error_response("VALIDATION_ERROR", "standard_price cannot be negative.", 400)
        if discount < 0:
            return error_response("VALIDATION_ERROR", "discount cannot be negative.", 400)
        if standard_price is not None and discount > standard_price:
            return error_response("VALIDATION_ERROR", "discount cannot exceed standard_price.", 400)

        channel = str(data.get("channel", "offline")).strip().lower()
        # B-L1: channel is an enum, not free text — a typo would land in
        # reports as an unknown channel. (Payments validate the same set.)
        from app.services.payment_service import PAYMENT_CHANNELS

        if channel not in PAYMENT_CHANNELS:
            db.session.rollback()
            return error_response(
                "VALIDATION_ERROR",
                f"channel must be one of: {', '.join(sorted(PAYMENT_CHANNELS))}.",
                400,
            )

        previous_start = member.membership_start
        previous_end = member.membership_end
        # V3-M18: snapshot plan/price BEFORE the mutation below so a
        # refund/delete can restore them.
        previous_plan_id = member.plan_id
        previous_price = member.price
        gym_timezone = (
            g.current_user.gym.timezone
            if g.current_user and g.current_user.gym and g.current_user.gym.timezone
            else "Asia/Kolkata"
        )
        today = today_for_gym(gym_timezone)
        raw_start_date = data.get("renewal_start_date")
        try:
            requested_start = (
                date.fromisoformat(raw_start_date.strip())
                if isinstance(raw_start_date, str) and raw_start_date.strip()
                else None
            )
        except ValueError:
            db.session.rollback()
            return error_response("VALIDATION_ERROR", "Invalid renewal_start_date; use YYYY-MM-DD.", 400)
        if raw_start_date is not None and not isinstance(raw_start_date, str):
            db.session.rollback()
            return error_response("VALIDATION_ERROR", "renewal_start_date must use YYYY-MM-DD.", 400)

        earliest_start = previous_end + timedelta(days=1) if previous_end and previous_end >= today else today
        new_start = requested_start or earliest_start
        # V7-M4: floor the start at previous_end + 1 whenever a
        # previous period exists — for an EXPIRED member too, so a
        # backdated renewal cannot overlap (or precede) the previous
        # paid period. The default (no explicit start) never
        # violates the floor (active: previous_end + 1; expired:
        # today, past previous_end).
        if previous_end and new_start < previous_end + timedelta(days=1):
            db.session.rollback()
            return error_response(
                "VALIDATION_ERROR",
                f"Renewal start date must be {(previous_end + timedelta(days=1)).isoformat()} or later so it does not overlap the previous paid period.",
                400,
            )
        new_end = new_start + timedelta(days=renewal_days - 1)
        if new_end < today:
            db.session.rollback()
            return error_response("VALIDATION_ERROR", "This renewal would already be expired. Choose a later start date.", 400)

        scheduled = new_start > today
        target_plan_id = plan.id if plan else member.plan_id
        # V6-M3: the live-scheduled check is NOT gated on this renewal
        # being scheduled. When the current period already expired and
        # a live scheduled renewal waits in the future, an immediate
        # renewal used to rewrite membership_end and orphan the paid
        # future period. Bulk renew checks unconditionally — direct
        # renew must too.
        from app.services.payment_service import active_scheduled_renewals

        if active_scheduled_renewals(member, today):
            db.session.rollback()
            return error_response(
                "CONFLICT",
                "This member already has a future renewal scheduled.",
                409,
            )
        if not scheduled:
            member.membership_start = new_start
            member.membership_end = new_end
            # M3: a paused member stays paused through a renewal — only
            # the explicit unfreeze flow clears paused.
            if member.status != "paused":
                member.status = "active"
            member.plan_id = target_plan_id
            # Pin the renewal amount as the expected value for reporting.
            member.price = amount
            queue_membership_command(member)

        renewal = RenewalHistory(
            gym_id=g.gym_id,
            member_id=member.id,
            plan_id=target_plan_id,
            renewed_by_id=g.current_user.id,
            previous_start=previous_start,
            previous_end=previous_end,
            # V3-M18: snapshot plan/price before mutation for revert.
            previous_plan_id=previous_plan_id,
            previous_price=previous_price,
            # V4-M13: snapshot the plan duration in force NOW (the
            # plan's duration, not renewal_days — an owner override
            # that applies extra days IS oversized by definition).
            duration_days=plan.duration_days if plan else renewal_days,
            new_start=new_start,
            new_end=new_end,
            standard_price=standard_price,
            discount=discount,
            amount=amount,
            channel=channel,
            notes=notes or f"Renewed for {renewal_days} days via mobile.",
            # V5-L16: carry the owner-approved override onto the row so
            # Date Repair skips it instead of stripping approved days.
            override_reason=_override_reason,
        )
        db.session.add(renewal)
        db.session.flush()

        # Campaign attribution
        try:
            from app.services.campaign_service import attribute_renewal_to_campaign
            campaign_id = attribute_renewal_to_campaign(
                member_id=member.id,
                gym_id=g.gym_id,
                renewal_id=renewal.id,
                renewal_amount=amount,
            )
            if campaign_id:
                renewal.campaign_id = campaign_id
        except Exception:
            pass

        audit(
            action="renew_member",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"renewal_days": renewal_days, "new_end": new_end.isoformat(),
                      "scheduled": scheduled, "override_reason": _override_reason,
                      "amount": str(amount)},
        )
        invalidate_dashboard_cache(g.gym_id)
        response_body = {
            "success": True,
            "data": {
                **_serialize_renewal(renewal),
                "scheduled": scheduled,
                "message": "Renewal scheduled." if scheduled else "Membership renewed.",
            },
        }
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
                if existing:
                    # V8-L5: replay through the decrypting helper, not the
                    # raw stored body — a credential stored as enc1:
                    # ciphertext must decrypt on replay (or the row is
                    # dropped and the request executes fresh), never be
                    # returned as ciphertext.
                    replay = legacy_replay(existing, matches_request)
                    if replay is not None:
                        return replay
            raise

        return jsonify(response_body), 201

    @bp.route("/renewals/scheduled/<int:renewal_id>/activate", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def force_activate_scheduled_renewal_endpoint(renewal_id: int):
        """Manually activate one due scheduled renewal (V6-L20).

        The scheduler and CLI are the only automatic callers of
        ``apply_due_scheduled_renewals``; when a window was missed
        (gym suspended, outage) the row otherwise just dies via the
        V5-M10 expired drop. This is the owner's lever to activate it
        — including a row whose end already passed, which lands the
        member ``expired`` with the paid period on record instead of
        leaving the money with no service. Audited.
        """
        from app.services.payment_service import force_activate_scheduled_renewal

        # A timeout retry after activation must replay the stored
        # outcome, not re-activate (and re-charge the ledger) — the
        # body is empty, so the fingerprint binds the key to this row.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="activate_scheduled_renewal",
            headers=request.headers,
            payload={"renewal_id": renewal_id},
        )
        if replay is not None:
            return replay

        renewal = RenewalHistory.query.filter_by(id=renewal_id, gym_id=g.gym_id).first()
        if renewal is None:
            return error_response("NOT_FOUND", "Scheduled renewal not found.", 404)
        try:
            outcome = force_activate_scheduled_renewal(
                renewal, actor_id=g.current_user.id
            )
            response_body = {
                "success": True,
                "data": {
                    "renewal_id": renewal.id,
                    "member_id": renewal.member_id,
                    "outcome": outcome,
                    "new_start": renewal.new_start.isoformat() if renewal.new_start else None,
                    "new_end": renewal.new_end.isoformat() if renewal.new_end else None,
                },
            }
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="activate_scheduled_renewal",
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
                    scope="activate_scheduled_renewal",
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
