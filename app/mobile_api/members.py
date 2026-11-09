"""Mobile API members endpoints."""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

_logger = logging.getLogger(__name__)

from flask import g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db, limiter
from app.mobile_api.date_rules import grid_error
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member, MembershipPlan, MobileIdempotencyKey, PaymentVerification, RenewalHistory
from app.models.member import SYNTHETIC_TEST_MEMBER_PHONE
from app.models.member_access_state import MemberAccessState
from app.models.mixins import utcnow
from app.services.analytics_service import invalidate_dashboard_cache
from app.services.audit_service import audit
from app.services.bridge_service import door_blocked_state, queue_membership_command
from app.services.document_scan_service import DocumentScanService
from app.services.idempotency_service import (
    begin_idempotency,
    file_upload_payload,
    find_replay,
    legacy_replay,
    record_idempotency,
    replay_after_conflict,
    request_fingerprint,
    valid_key,
)
from app.services.payment_service import PAYMENT_METHODS, canonical_payment_reference, verified_payment_with_reference
from app.services.reminder_service import auto_expire_members_for_gym, today_for_gym
from app.services.storage_service import (
    delete_member_profile_photo,
    member_profile_photo_url,
    save_member_profile_photo,
)
from app.services.mobile_member_import_service import validate_csv
from app.utils.helpers import normalize_phone_e164


def _serialize_member(m: Member) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "phone": m.phone,
        "email": m.email,
        "gender": m.gender,
        "address": m.address,
        "plan": {"id": m.plan.id, "name": m.plan.name, "duration_days": m.plan.duration_days, "price": str(m.plan.price)} if m.plan else None,
        "membership_start": m.membership_start.isoformat() if m.membership_start else None,
        "membership_end": m.membership_end.isoformat() if m.membership_end else None,
        "status": m.status,
        "days_until_expiry": m.days_until_expiry,
        "joined_on": m.joined_on.isoformat() if m.joined_on else None,
        "notes": m.notes,
        "whatsapp_opted_in": bool(m.whatsapp_opted_in),
        "has_biometric": m.device_enroll_number is not None,
        "device_enroll_number": m.device_enroll_number,
        # 2026-11-09 (owner photo slice): signed URL, resolved per
        # request — never persisted. None when the member has no photo.
        "profile_photo_url": member_profile_photo_url(m),
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

        # V8-L29 — a retry after a successful scan must replay the
        # stored candidates instead of paying for a second OpenRouter
        # vision call. The fingerprint is the full request payload
        # (the base64 images are the identity — re-encoding the same
        # page differently is a new scan, which is safe, just not
        # free). Only the success response is recorded, so a failed
        # scan never stores a key. NOTE: /members/import already
        # honours keys (scope "import_members"); /members/import/preview
        # is read-only validation with no mutation or external call,
        # so it takes no key.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="scan_member_records",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

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

        response_body = {"success": True, "data": result["data"]}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="scan_member_records",
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
                scope="scan_member_records",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.route("/members/batch-create", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def batch_create_members():
        """Atomically import reviewed candidate members and discover upcoming renewals."""
        data = request.get_json(silent=True) or {}
        # A retry after a 2,000-row import must replay instead of
        # creating the members twice (the phone-duplicate guard would
        # otherwise 422 the whole retry as "already belongs").
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="batch_create_members",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

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
            elif phone == SYNTHETIC_TEST_MEMBER_PHONE:
                # V7-L3: reserved for the admin test-payment synthetic
                # member — a real member must never carry it, or the
                # test flow could mutate them.
                item_errors.append("This phone number is reserved for internal testing")
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

            # M1: an explicitly supplied end date must sit on the plan
            # grid, like single create_member. No plan (or no explicit
            # end — it defaults to today) means nothing to check.
            if raw_end and start_d and end_d and plan_id in active_plans:
                _grid_err = grid_error(
                    start_d, end_d, active_plans[plan_id].duration_days
                )
                if _grid_err is not None:
                    item_errors.append(_grid_err)

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
        response_body = {
            "success": True,
            "data": {
                "imported": len(created_members),
                "upcoming_renewals_count": upcoming_count,
                "revenue_at_risk": str(revenue_at_risk),
                "message": f"Successfully imported {len(created_members)} members.",
            },
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="batch_create_members",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=201,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="batch_create_members",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body), 201

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
        # Same retry hazard as batch-create: the CSV re-import would
        # duplicate every row (the duplicate guard 422s the retry).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="import_members",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

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
            normalized["price"] = Decimal(normalized["price"])
            db.session.add(Member(gym_id=g.gym_id, joined_on=today_for_gym(gym.timezone), **normalized))
        audit(
            action="mobile_bulk_import_members",
            resource_type="member",
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"created": len(rows)},
        )
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": {"imported": len(rows), "skipped": 0}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="import_members",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=201,
            response_body=response_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="import_members",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body), 201

    @bp.route("/members", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_members():
        # NOTE: membership expiry is owned by the scheduler (reminder job) and
        # the run-reminders CLI. It must not run here: it is a mutating,
        # lock-holding write that does not belong in a GET.
        page = request.args.get("page", 1, type=int)
        page_size = min(request.args.get("page_size", 20, type=int), 500)  # M7: linking screens request 500
        status = request.args.get("status", "").strip()
        search = request.args.get("q", "").strip()
        biometric = request.args.get("biometric", "").strip()

        query = Member.query.filter_by(gym_id=g.gym_id).filter(Member.deleted_at.is_(None))
        if status:
            query = query.filter(Member.status == status)
        if biometric == "not_enrolled":
            query = query.filter(Member.device_enroll_number.is_(None))
            # Sort active first in Python (SQL boolean ordering was unreliable)
            # Fetch all matching, sort by status priority, then paginate manually
            all_members = (
                query.options(joinedload(Member.plan))
                .order_by(Member.membership_end.asc())
                .all()
            )
            status_priority = {"active": 0, "expiring": 1}
            all_members.sort(key=lambda m: (status_priority.get(m.status, 2), m.full_name or ""))
            total = len(all_members)
            start = (page - 1) * page_size
            members = all_members[start:start + page_size]
            return jsonify({
                "success": True,
                "data": {
                    "members": [_serialize_member(m) for m in members],
                    "pagination": {
                        "page": page,
                        "page_size": page_size,
                        "total": total,
                    },
                },
            })
        elif biometric == "enrolled":
            query = query.filter(Member.device_enroll_number.isnot(None))
        expiring_within_days = request.args.get("expiring_within_days", type=int)
        if expiring_within_days is not None and expiring_within_days >= 0:
            gym_tz = g.current_user.gym.timezone or "Asia/Kolkata"
            today = today_for_gym(gym_tz)
            soon = today + timedelta(days=expiring_within_days)
            query = query.filter(
                Member.status == "active",
                Member.membership_end.isnot(None),
                Member.membership_end >= today,
                Member.membership_end <= soon,
            )
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
        data = _serialize_member(member)
        access_state = MemberAccessState.query.filter_by(gym_id=g.gym_id, member_id=member.id).first()
        data["is_inside"] = (access_state.current_state == "INSIDE") if access_state else False
        data["last_entry_at"] = access_state.last_entry_at.isoformat() if (access_state and access_state.last_entry_at) else None
        # Include the newest access request even while it awaits a terminal
        # acknowledgement. The profile toggle must keep the selected action
        # visible across refreshes, and unrelated sync commands must not make
        # an acknowledged block appear to be an unblock.
        access = door_blocked_state(member)
        data["door_blocked"] = access["blocked"]
        data["door_access_pending"] = access["pending"]
        data["door_access_pending_action"] = access["pending_action"]
        data["door_access_connector"] = access["connector"]
        data["door_access_error"] = access["detail"]
        # V6-M8: a failure newer than the latest candidate is a distinct
        # state — the UI shows "failed — tap to retry" (re-tapping the
        # toggle queues a fresh command) instead of the stale previous
        # state. V6-M9: a queued command the terminal never picked up is
        # stale — the UI shows "queued — terminal hasn't checked in since
        # <terminal_last_seen_at>" and must not present blocked as fact.
        data["door_access_failed"] = access["failed"]
        data["door_access_failed_action"] = access["failed_action"]
        data["door_access_failed_at"] = access["failed_at"]
        data["door_access_stale_queued"] = access["stale_queued"]
        data["door_access_queued_since"] = access["queued_since"]
        data["door_access_terminal_last_seen_at"] = access["terminal_last_seen_at"]

        # Security: never disclose a member's live OTP to staff clients.
        # Revealing it lets any staff credential impersonate the member and
        # defeats OTP as an authentication factor.

        return jsonify({"success": True, "data": data})

    @bp.route("/members", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def create_member():
        data = request.get_json(silent=True) or {}
        # V3-M23: honour Idempotency-Key like create_payment does — the
        # Android client retries after a 15s timeout believing the retry
        # is safe, and without this the retry double-creates the member
        # (plus a second creation ledger row and payment).
        idempotency_key = valid_key(request.headers.get("Idempotency-Key"))
        if idempotency_key == "":
            return error_response("VALIDATION_ERROR", "Idempotency-Key is too long.", 400)
        request_hash = request_fingerprint(data)
        if idempotency_key:
            existing, matches_request = find_replay(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="create_member",
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

        full_name = (data.get("full_name") or data.get("name") or "").strip()
        phone = normalize_phone_e164((data.get("phone") or "").strip())
        if not full_name or not phone:
            return error_response("VALIDATION_ERROR", "full_name and phone are required.", 400)
        if phone == SYNTHETIC_TEST_MEMBER_PHONE:
            # V7-L3: reserved for the admin test-payment synthetic
            # member — a real member must never carry it.
            return error_response(
                "VALIDATION_ERROR",
                "This phone number is reserved for internal testing.",
                400,
            )

        try:
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

            plan = None
            plan_id = data.get("plan_id")
            if plan_id:
                plan = MembershipPlan.query.filter_by(id=plan_id, gym_id=g.gym_id, is_active=True).first()
                if plan is None:
                    return error_response("VALIDATION_ERROR", "Invalid plan_id.", 400)

            local_today = today_for_gym(gym.timezone or "Asia/Kolkata")
            membership_start = _parse_date(data.get("membership_start")) or local_today
            membership_end = _parse_date(data.get("membership_end")) or local_today
            # Strict date repair: an explicitly supplied off-grid end
            # is rejected, not silently clamped. The no-date case
            # (start == end == today, a same-day quick add) is an
            # existing API behaviour and is left alone — the risk is
            # a hand-typed end date, not the default.
            if data.get("membership_end"):
                strict_err = grid_error(
                    membership_start,
                    membership_end,
                    plan.duration_days if plan else None,
                )
                if strict_err is not None:
                    return error_response("VALIDATION_ERROR", strict_err, 400)
            if membership_end < membership_start:
                return error_response(
                    "VALIDATION_ERROR",
                    "membership_end must be on or after membership_start.",
                    400,
                )

            # V3-L1: an unknown signup payment method is a 400, matching
            # create_payment — never silently coerced to "cash". Validated
            # up front (before the member row exists) so a rejection
            # leaves nothing behind.
            _initial_method = None
            _raw_amount = data.get("amount")
            # V5-M3: a negative initial amount is a 400 up front, same
            # as create_payment — the old code silently dropped the
            # payment (``if amt >= 0``) and created a payment-less
            # member with no creation ledger row.
            _initial_amt = None
            if _raw_amount is not None and str(_raw_amount).strip() != "" and data.get("paid", True):
                try:
                    _initial_amt = Decimal(str(_raw_amount).strip())
                except InvalidOperation:
                    return error_response("VALIDATION_ERROR", "Invalid amount.", 400)
                # V10-L2: finite FIRST — "NaN" < 0 raises
                # InvalidOperation, outside the parse try/except and
                # outside the creation try, so the 500 was unhandled.
                if not _initial_amt.is_finite():
                    return error_response("VALIDATION_ERROR", "Amount must be a finite number.", 400)
                if _initial_amt < 0:
                    return error_response("VALIDATION_ERROR", "Amount cannot be negative.", 400)
            if _raw_amount is not None and str(_raw_amount).strip() != "" and data.get("paid", True):
                _initial_method = str(data.get("payment_method") or data.get("method") or "cash").strip().lower()
                if _initial_method not in PAYMENT_METHODS:
                    return error_response(
                        "VALIDATION_ERROR",
                        f"payment_method must be one of: {', '.join(sorted(PAYMENT_METHODS))}.",
                        400,
                    )

            notes_val = (data.get("notes") or "").strip() or None
            address_val = (data.get("address") or "").strip() or None
            member = Member(
                gym_id=g.gym_id,
                full_name=full_name,
                phone=phone,
                email=(data.get("email") or "").strip() or None,
                gender=(data.get("gender") or "").strip() or None,
                address=address_val,
                plan_id=plan_id if plan_id else None,
                joined_on=local_today,
                membership_start=membership_start,
                membership_end=membership_end,
                status="active" if membership_end >= local_today else "expired",
                notes=notes_val,
            )
            # Pin the expected renewal value for reporting.
            member.price = plan.price if plan else Decimal("0.00")
            db.session.add(member)
            db.session.flush()

            # Record initial payment / customizable money if provided
            raw_amount = data.get("amount")
            is_paid = data.get("paid", True)
            if raw_amount is not None and str(raw_amount).strip() != "" and is_paid:
                # V4-M19: canonicalise the UTR before anything is
                # written, and run the duplicate-reference check
                # BEFORE inserting the initial payment — the other
                # create paths check, this one never did, so a
                # case-variant duplicate sailed through and
                # double-counted collections.
                _initial_ref = canonical_payment_reference(
                    data.get("payment_reference") or data.get("reference") or ""
                )
                if _initial_ref is not None and verified_payment_with_reference(
                    g.gym_id, _initial_ref
                ) is not None:
                    db.session.rollback()
                    return error_response(
                        "DUPLICATE_REFERENCE",
                        "A verified payment with this reference already exists for this gym.",
                        409,
                    )
                try:
                    # V5-M3: _initial_amt was parsed + validated up
                    # front; a negative amount never reaches here.
                    amt = _initial_amt if _initial_amt is not None else Decimal(str(raw_amount).strip())
                    if amt >= 0:
                        method = _initial_method or "cash"
                        standard_price = plan.price if plan else amt
                        discount = max(Decimal("0.00"), standard_price - amt) if standard_price is not None else Decimal("0.00")
                        # Strict: the initial ledger row records the
                        # plan duration, never a days count derived
                        # from a hand-typed end date.
                        renewal_days = (
                            plan.duration_days
                            if plan
                            else max(
                                1,
                                min(
                                    730,
                                    (membership_end - membership_start).days + 1
                                    if membership_end and membership_start
                                    else 30,
                                ),
                            )
                        )
                        payment = PaymentVerification(
                            gym_id=g.gym_id,
                            member_id=member.id,
                            plan_id=plan.id if plan else None,
                            created_by_id=g.current_user.id,
                            standard_price=standard_price,
                            discount=discount,
                            amount=amt,
                            paid_on=membership_start,
                            method=method,
                            channel="offline",
                            reference=_initial_ref,
                            status="verified",
                            verified_by_id=g.current_user.id,
                            verified_at=utcnow(),
                            renewal_days=renewal_days,
                            notes=(data.get("payment_notes") or notes_val or "Initial membership fee"),
                        )
                        db.session.add(payment)
                        db.session.flush()

                        # V6-L3: pin the amount actually paid as the
                        # member's expected value — every other money
                        # path pins the paid amount (verify_payment,
                        # direct/bulk renew, scheduled activation).
                        # A discounted signup otherwise overstates
                        # revenue-at-risk at the full plan price until
                        # its first renewal re-pins it.
                        member.price = amt

                        renewal = RenewalHistory(
                            gym_id=g.gym_id,
                            member_id=member.id,
                            plan_id=member.plan_id,
                            payment_verification_id=payment.id,
                            renewed_by_id=g.current_user.id,
                            # V3-M18: previous_start records the
                            # pre-signup state (== start: no membership
                            # before this row), so refunding the signup
                            # reverts to "expired" instead of a 1-day
                            # active stub. No prior plan/price exists.
                            previous_start=membership_start,
                            previous_end=membership_start,
                            previous_plan_id=None,
                            previous_price=None,
                            # V4-M13: snapshot the plan duration in
                            # force at signup (creation rows are
                            # oversized-checked too).
                            duration_days=(
                                plan.duration_days if plan else renewal_days
                            ),
                            new_start=membership_start,
                            new_end=membership_end,
                            # V3-M5: mark the signup row explicitly so
                            # money reports can tell it from a genuine
                            # first renewal of an imported member.
                            is_creation=True,
                            standard_price=standard_price,
                            discount=discount,
                            amount=amt,
                            channel="offline",
                            notes=payment.notes,
                        )
                        db.session.add(renewal)
                except IntegrityError as exc:
                    # V4-M1: a payment-insert failure must fail the
                    # WHOLE create_member — the old code swallowed it
                    # and left a payment-less member with no creation
                    # ledger row, so a paid signup vanished from the
                    # money trail. V5-L3: a duplicate UTR racing past
                    # the pre-check surfaces as its own 409 — decided
                    # from the constraint in the IntegrityError, not
                    # from a re-check that can miss a winner that has
                    # not committed yet. Anything else re-raises to
                    # the outer handler (rollback + 400).
                    from app.services.payment_service import is_duplicate_reference_error

                    db.session.rollback()
                    if is_duplicate_reference_error(exc):
                        return error_response(
                            "DUPLICATE_REFERENCE",
                            "A verified payment with this reference already exists for this gym.",
                            409,
                        )
                    if _initial_ref is not None and verified_payment_with_reference(
                        g.gym_id, _initial_ref
                    ) is not None:
                        return error_response(
                            "DUPLICATE_REFERENCE",
                            "A verified payment with this reference already exists for this gym.",
                            409,
                        )
                    raise

            queue_membership_command(member)
            audit(action="create_member", resource_type="member", resource_id=member.id,
                  gym_id=g.gym_id, actor_id=g.current_user.id)
            invalidate_dashboard_cache(g.gym_id)
            response_body = {"success": True, "data": _serialize_member(member)}
            if idempotency_key:
                db.session.add(
                    MobileIdempotencyKey(
                        gym_id=g.gym_id,
                        user_id=g.user_id,
                        scope="create_member",
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
                # A concurrent retry may have won the unique-key race.
                # Replay its stored response instead of a second member.
                if idempotency_key:
                    existing, matches_request = find_replay(
                        gym_id=g.gym_id,
                        user_id=g.user_id,
                        scope="create_member",
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

            # Reload with plan relationship.
            db.session.refresh(member)
            member.plan  # trigger lazy load
            return jsonify(response_body), 201
        except Exception as exc:
            db.session.rollback()
            _logger.exception("create_member failed: %s", exc)
            # V9-L3: never echo raw exception text to the client — an
            # unexpected type can carry DB/ORM detail (constraint
            # names, column values). One fixed message; detail is in
            # the server log above.
            return error_response("CREATE_FAILED", "Could not add member. Please try again.", 400)

    @bp.route("/members/<int:member_id>", methods=["PATCH"])
    @token_required
    @roles_required("gym_owner", "staff")
    def update_member(member_id: int):
        data = request.get_json(silent=True) or {}
        # The replay check runs BEFORE the lookup (like deactivate):
        # a retry after a successful edit must replay even if the
        # member was since deleted, and the key is bound to this
        # member so it cannot replay another member's edit.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_member",
            headers=request.headers,
            payload={**data, "member_id": member_id},
        )
        if replay is not None:
            return replay

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        # Strict date repair: membership dates (and the plan that
        # defines them) are owner-only. Staff may still edit name,
        # phone and other non-date fields below, but a staff date
        # edit is rejected before anything is applied.
        date_fields = {"membership_start", "membership_end", "plan_id"}
        if date_fields.intersection(data.keys()) and (
            g.current_user is None or g.current_user.role != "gym_owner"
        ):
            return error_response(
                "FORBIDDEN",
                "Only the gym owner can change membership dates or plan.",
                403,
            )
        _old_start = member.membership_start
        _old_end = member.membership_end
        _old_plan_id = member.plan_id
        if "full_name" in data or "name" in data:
            name = (data.get("full_name") or data.get("name") or "").strip()
            if not name:
                return error_response("VALIDATION_ERROR", "full_name cannot be empty.", 400)
            member.full_name = name
        if "phone" in data:
            phone = normalize_phone_e164((data["phone"] or "").strip())
            if not phone:
                return error_response("VALIDATION_ERROR", "phone cannot be empty.", 400)
            if phone == SYNTHETIC_TEST_MEMBER_PHONE:
                # V7-L3: reserved for the admin test-payment synthetic member.
                return error_response(
                    "VALIDATION_ERROR",
                    "This phone number is reserved for internal testing.",
                    400,
                )
            member.phone = phone

        if "email" in data:
            member.email = (data["email"] or "").strip() or None
        if "gender" in data:
            member.gender = (data["gender"] or "").strip() or None
        if "notes" in data:
            member.notes = (data["notes"] or "").strip() or None
        if "address" in data:
            member.address = (data["address"] or "").strip() or None
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

        # Strict: when the caller explicitly changed a date, the
        # resulting pair must sit on the plan's grid, or nothing is
        # saved. A plan-only change leaves existing dates untouched
        # (a mid-period plan change is legitimate, not a date edit).
        if {"membership_start", "membership_end"}.intersection(data.keys()):
            _result_plan = (
                MembershipPlan.query.filter_by(id=member.plan_id, gym_id=g.gym_id).first()
                if member.plan_id
                else None
            )
            _grid_err = grid_error(
                member.membership_start,
                member.membership_end,
                _result_plan.duration_days if _result_plan else None,
            )
        else:
            _grid_err = None
        if _grid_err is not None:
            db.session.rollback()
            return error_response("VALIDATION_ERROR", _grid_err, 400)
        if member.membership_end is not None and member.membership_start is not None and member.membership_end < member.membership_start:
            db.session.rollback()
            return error_response(
                "VALIDATION_ERROR",
                "membership_end must be on or after membership_start.",
                400,
            )

        tz = g.current_user.gym.timezone or "Asia/Kolkata"
        if member.status == "active" and member.membership_end < today_for_gym(tz):
            member.status = "expired"
        elif member.status == "expired" and member.membership_end >= today_for_gym(tz):
            member.status = "active"

        # V5-M9: a legitimate manual date edit moves the end a live
        # scheduled renewal was chained to — re-chain it at the new
        # end so the paid future period can still activate, instead
        # of silently orphaning it.
        if _old_end is not None and member.membership_end != _old_end:
            from app.services.payment_service import rechain_scheduled_renewals

            rechain_scheduled_renewals(
                member,
                old_end=_old_end,
                today=today_for_gym(tz),
                actor_id=g.current_user.id,
            )

        queue_membership_command(member)
        audit(action="update_member", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={
                  "old_start": _old_start.isoformat() if _old_start else None,
                  "new_start": member.membership_start.isoformat() if member.membership_start else None,
                  "old_end": _old_end.isoformat() if _old_end else None,
                  "new_end": member.membership_end.isoformat() if member.membership_end else None,
                  "old_plan_id": _old_plan_id,
                  "new_plan_id": member.plan_id,
              })
        invalidate_dashboard_cache(g.gym_id)
        # Serialize from the flushed in-memory state (identical to the
        # post-commit refresh the old code did) so the replay record
        # can commit atomically with the edit.
        db.session.flush()
        response_body = {"success": True, "data": _serialize_member(member)}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_member",
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
                scope="update_member",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/photo", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    @limiter.limit("10 per minute")
    def set_member_profile_photo(member_id: int):
        """Owner/staff-set profile photo for a member of this gym.

        Same storage + idempotency pattern as the member's own upload
        (member_api, V9-L4): multipart field ``photo``; the fingerprint
        is the SHA-256 of the file bytes + size, so a retried upload
        replays the stored URL instead of minting a second file, and
        the same key with different bytes 409s. The real capture
        moment is front-desk staff photographing a member at signup,
        so staff may set photos too (same role pair as PATCH).
        """
        upload = request.files.get("photo")
        if not upload or not upload.filename:
            return error_response("VALIDATION_ERROR", "Choose a profile photo to upload.", 400)

        raw_bytes = upload.stream.read()
        upload.stream.seek(0)
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="owner_member_photo_upload",
            headers=request.headers,
            payload=file_upload_payload(
                f"members/{member_id}/photo",
                sha256_hex=hashlib.sha256(raw_bytes).hexdigest(),
                size_bytes=len(raw_bytes),
            ),
        )
        if replay is not None:
            return replay

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)
        old_path = member.profile_photo_path

        try:
            new_path = save_member_profile_photo(upload, g.gym_id, member.id)
        except ValueError as exc:
            # Fixed message (never echo raw exception text), same as the
            # member endpoint.
            _logger.warning("Owner profile photo rejected for member %s: %s", member.id, exc)
            return error_response(
                "VALIDATION_ERROR",
                "The photo could not be saved. Please choose a JPEG, PNG, or WebP image under 3 MB and try again.",
                400,
            )
        except Exception:
            _logger.exception("Could not save owner-set profile photo for member %s", member.id)
            return error_response(
                "PHOTO_SAVE_FAILED", "The photo could not be saved. Please try again.", 500
            )

        member.profile_photo_path = new_path
        audit(action="member_profile_photo_set", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={"previous_photo_path": old_path})
        response_body = {"success": True, "data": {"profile_photo_url": member_profile_photo_url(member)}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="owner_member_photo_upload",
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
                scope="owner_member_photo_upload",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        except Exception:
            db.session.rollback()
            try:
                delete_member_profile_photo(new_path)
            except Exception:
                _logger.exception("Could not clean up failed owner profile photo upload for member %s", member.id)
            raise

        if old_path and old_path != new_path:
            try:
                delete_member_profile_photo(old_path)
            except Exception:
                _logger.exception("Could not delete replaced profile photo for member %s", member.id)
        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/photo", methods=["DELETE"])
    @token_required
    @roles_required("gym_owner", "staff")
    def remove_member_profile_photo(member_id: int):
        """Remove a member's profile photo (owner/staff).

        Naturally idempotent — no Idempotency-Key needed, like the
        member DELETE. The file is deleted best-effort after commit.
        """
        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)
        old_path = member.profile_photo_path
        member.profile_photo_path = None
        audit(action="member_profile_photo_removed", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={"previous_photo_path": old_path})
        db.session.commit()
        if old_path:
            try:
                delete_member_profile_photo(old_path)
            except Exception:
                _logger.exception("Could not delete removed profile photo for member %s", member.id)
        return jsonify({"success": True, "data": {"profile_photo_url": None}})

    @bp.route("/members/<int:member_id>/deactivate", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def deactivate_member(member_id: int):
        from app.models.mixins import utcnow

        data = request.get_json(silent=True) or {}
        # V5-L34: honour Idempotency-Key like create_member — the
        # Android BulkDeactivate screen sends a stable per-member key
        # (bulk-deactivate-<ts>-<memberId>) and retries on timeout.
        # Without replay a retry 404s (the member is already
        # soft-deleted) and the client cannot tell success from
        # failure. The replay check runs BEFORE the member lookup so
        # an already-deleted member replays its stored 200.
        idempotency_key = valid_key(request.headers.get("Idempotency-Key"))
        if idempotency_key == "":
            return error_response("VALIDATION_ERROR", "Idempotency-Key is too long.", 400)
        # The body is empty for this endpoint, so bind the key to THIS
        # member in the fingerprint — otherwise a key accidentally
        # reused for another member would replay the wrong success.
        request_hash = request_fingerprint({**data, "member_id": member_id})
        if idempotency_key:
            existing, matches_request = find_replay(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="deactivate_member",
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

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        member.deleted_at = utcnow()
        # V3-M4: record the pre-delete status — restore must bring a
        # frozen (paused) member back as paused, not active with the
        # door opened. The status is overwritten below, so capture it
        # here and store it on the audit entry.
        prev_status = member.status
        member.status = "deleted"
        # H9: free the terminal ID — delete the identity mapping rows so
        # the enroll number can be reused. The member's own
        # device_enroll_number is intentionally KEPT: Guard 2 still
        # reports it as held by a deleted member (explicit error), and
        # clearing it would defeat the hard-delete fingerprint tombstone
        # guard. Mapping-only members are fully freed by this.
        from app.services.rrr_service import delete_identity_mappings

        # V5-M6: queue the delete-time block BEFORE the mappings are
        # deleted — a mapping-only member (confirmed mapping, no
        # device_enroll_number) has no other terminal identity, so
        # deleting the mappings first leaves nothing to address the
        # block to and it silently never queues.
        queue_membership_command(member)
        delete_identity_mappings(g.gym_id, member.id)
        # V4-M10: expire the Live Access state row — a member deleted
        # while INSIDE must stop showing as currently inside immediately,
        # not only when the nightly stale-inside sweep ages them out.
        from app.models.member_access_state import MemberAccessState

        _inside_state = MemberAccessState.query.filter_by(
            gym_id=g.gym_id, member_id=member.id
        ).first()
        if _inside_state is not None and _inside_state.current_state == "INSIDE":
            _inside_state.current_state = "OUTSIDE"
            _inside_state.last_exit_at = utcnow()
        audit(action="soft_delete_member", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={"previous_status": prev_status})
        invalidate_dashboard_cache(g.gym_id)
        response_body = {"success": True, "data": {"message": "Member deactivated."}}
        if idempotency_key:
            db.session.add(
                MobileIdempotencyKey(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="deactivate_member",
                    key=idempotency_key,
                    request_hash=request_hash,
                    status_code=200,
                    response_body=response_body,
                )
            )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            # A concurrent retry may have won the unique-key race.
            # Replay its stored response instead of a second delete.
            if idempotency_key:
                existing, matches_request = find_replay(
                    gym_id=g.gym_id,
                    user_id=g.user_id,
                    scope="deactivate_member",
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
        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/freeze", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def freeze_member(member_id: int):
        data = request.get_json(silent=True) or {}
        # Pre-check BEFORE the already-paused guard: a retry after a
        # successful freeze must replay the stored success, not 400
        # ALREADY_PAUSED — and without it the retry would extend the
        # end a second time. Key is bound to this member.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="freeze_member",
            headers=request.headers,
            payload={**data, "member_id": member_id},
        )
        if replay is not None:
            return replay

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        if member.status == "paused":
            return error_response("ALREADY_PAUSED", "Member is already paused.", 400)

        try:
            days = int(data.get("days") or data.get("freeze_days") or 14)
            if days < 1 or days > 365:
                return error_response("VALIDATION_ERROR", "Pause duration must be between 1 and 365 days.", 400)
        except (ValueError, TypeError):
            return error_response("VALIDATION_ERROR", "Invalid days parameter.", 400)

        reason = (data.get("reason") or "").strip()

        tz = g.current_user.gym.timezone or "Asia/Kolkata"
        today = today_for_gym(tz)

        # V6-L18: freezing an already-expired member extends a past
        # end (buys nothing) yet plants a freeze marker that shields
        # the member from Date Repair Apply. Refuse outright.
        if not member.membership_end or member.membership_end < today:
            return error_response(
                "VALIDATION_ERROR",
                "Cannot pause a membership that has already ended.",
                400,
            )

        # V5-M9: a freeze moves membership_end, which orphans a live
        # scheduled renewal (its previous_end no longer matches, so
        # the paid future period never activates). Refuse with a clear
        # error, like bulk renew's guard — the owner can let the
        # scheduled renewal run first.
        from app.services.payment_service import active_scheduled_renewals

        if active_scheduled_renewals(member, today):
            return error_response(
                "CONFLICT",
                "This member has a future renewal scheduled. Let that "
                "renewal run (or cancel it) before pausing the membership.",
                409,
            )

        # Extend membership end date by the paused days. V7-L6:
        # this is an up-front grant of the PLANNED days; unfreeze
        # claws back whatever was not actually used (pause-the-clock).
        if member.membership_end:
            member.membership_end = member.membership_end + timedelta(days=days)

        member.status = "paused"
        log_note = f"\n[Paused on {today.isoformat()} for {days} days" + (f": {reason}]" if reason else "]")
        member.notes = (member.notes or "") + log_note

        # Biometric gate turns to disable_user
        queue_membership_command(member)

        audit(
            action="freeze_member",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"freeze_days": days, "reason": reason, "new_membership_end": member.membership_end.isoformat() if member.membership_end else None},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.flush()
        response_body = {
            "success": True,
            "data": _serialize_member(member),
            "message": f"{member.full_name}'s membership is paused for {days} days. Gate access disabled.",
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="freeze_member",
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
                scope="freeze_member",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/unfreeze", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def unfreeze_member(member_id: int):
        # Pre-check BEFORE the not-paused guard, mirroring freeze: a
        # retry after a successful resume must replay, not 400.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="unfreeze_member",
            headers=request.headers,
            payload={"member_id": member_id},
        )
        if replay is not None:
            return replay

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        if member.status != "paused":
            return error_response("NOT_PAUSED", "Member is not currently paused.", 400)

        tz = g.current_user.gym.timezone or "Asia/Kolkata"
        today = today_for_gym(tz)

        # V7-L6 (pause-the-clock semantics, pinned here): freeze
        # extends the end by the PLANNED days up front, and unfreeze
        # claws back the UNUSED days (planned - actually paused), so
        # resuming early does not gift the member days they neither
        # paid for nor spent frozen. Parsed from the freeze marker
        # freeze wrote; if the marker is missing/unparseable, or a
        # renewal was recorded on/after the pause date (the end may
        # belong to a new paid period), the end is left alone rather
        # than risk shortening paid time. Runs BEFORE the status
        # derivation below so the status follows the adjusted end.
        _clawed_back_days = 0
        _paused_match = None
        for _m in re.finditer(
            r"\[Paused on (\d{4}-\d{2}-\d{2}) for (\d+) days",
            member.notes or "",
        ):
            _paused_match = _m
        if _paused_match is not None and member.membership_end:
            try:
                _paused_on = date.fromisoformat(_paused_match.group(1))
                _planned_days = int(_paused_match.group(2))
            except ValueError:
                _paused_on, _planned_days = None, 0
            if _paused_on is not None and _planned_days > 0:
                # V8-L7(a): the renewal-since-pause boundary is
                # gym-local midnight on the pause date, not UTC
                # midnight — a renewal 00:00–05:30 IST on the pause
                # date used to slip past the guard and get clawed
                # back. V8-L7(b): a manual date edit after the pause
                # that extends the end is guarded too, not just
                # RenewalHistory rows — the freeze audit records the
                # end as frozen, so any end beyond it means the paid
                # period moved after the pause (renewal or hand edit).
                from app.services.timezone_service import utc_start_of_gym_day

                _pause_boundary = utc_start_of_gym_day(tz, local_date=_paused_on)
                _renewed_since_pause = (
                    RenewalHistory.query.filter(
                        RenewalHistory.member_id == member.id,
                        RenewalHistory.created_at >= _pause_boundary,
                    ).first()
                    is not None
                )
                if not _renewed_since_pause:
                    from app.models import AuditLog

                    _freeze_audit = (
                        AuditLog.query.filter(
                            AuditLog.action == "freeze_member",
                            AuditLog.resource_type == "member",
                            AuditLog.resource_id == str(member.id),
                            AuditLog.created_at >= _pause_boundary,
                        )
                        .order_by(AuditLog.created_at.desc())
                        .first()
                    )
                    _frozen_end = None
                    if _freeze_audit is not None:
                        _raw_frozen_end = (_freeze_audit.metadata_json or {}).get(
                            "new_membership_end"
                        )
                        try:
                            _frozen_end = (
                                date.fromisoformat(_raw_frozen_end)
                                if _raw_frozen_end
                                else None
                            )
                        except ValueError:
                            _frozen_end = None
                    if (
                        _frozen_end is not None
                        and member.membership_end is not None
                        and member.membership_end > _frozen_end
                    ):
                        _renewed_since_pause = True
                    else:
                        # Legacy freeze with no audit row: fall back
                        # to update_member audits since the pause —
                        # a hand edit that raised the end also blocks
                        # the clawback.
                        for _edit in AuditLog.query.filter(
                            AuditLog.action == "update_member",
                            AuditLog.resource_type == "member",
                            AuditLog.resource_id == str(member.id),
                            AuditLog.created_at >= _pause_boundary,
                        ).all():
                            _meta = _edit.metadata_json or {}
                            try:
                                _old = date.fromisoformat(_meta["old_end"]) if _meta.get("old_end") else None
                                _new = date.fromisoformat(_meta["new_end"]) if _meta.get("new_end") else None
                            except (ValueError, TypeError):
                                continue
                            if _old is not None and _new is not None and _new > _old:
                                _renewed_since_pause = True
                                break
                _actually_paused = max(0, (today - _paused_on).days)
                _unused_days = _planned_days - _actually_paused
                if _unused_days > 0 and not _renewed_since_pause:
                    member.membership_end = member.membership_end - timedelta(
                        days=_unused_days
                    )
                    _clawed_back_days = _unused_days

        if member.membership_end and member.membership_end >= today:
            member.status = "active"
        else:
            member.status = "expired"

        log_note = f"\n[Resumed on {today.isoformat()}]"
        member.notes = (member.notes or "") + log_note

        queue_membership_command(member)

        audit(
            action="unfreeze_member",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"status": member.status, "clawed_back_days": _clawed_back_days},
        )
        invalidate_dashboard_cache(g.gym_id)
        db.session.flush()
        response_body = {
            "success": True,
            "data": _serialize_member(member),
            "message": f"{member.full_name}'s membership resumed ({member.status}). Gate access updated.",
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="unfreeze_member",
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
                scope="unfreeze_member",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/enroll", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_member_biometric(member_id: int):
        """Set the biometric device enrollment number for a member."""
        from app.services.bridge_service import canonical_enroll_number

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        data = request.get_json(silent=True) or {}
        # A retry after a successful enroll must replay instead of
        # re-running the backfill / stale-command displacement.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="enroll_member",
            headers=request.headers,
            payload={**data, "member_id": member_id},
        )
        if replay is not None:
            return replay

        raw_enroll = data.get("enroll_number") or data.get("device_enroll_number")
        if not raw_enroll:
            return error_response("VALIDATION_ERROR", "enroll_number is required.", 400)

        try:
            enroll_number = canonical_enroll_number(raw_enroll)
        except ValueError as ve:
            return error_response("VALIDATION_ERROR", str(ve), 400)

        # Check no other member has this enroll number in this gym.
        # NOTE: the unique constraint covers soft-deleted rows too, so
        # this check must NOT filter them out — otherwise the commit
        # throws UniqueViolation and the app shows "An unexpected error
        # occurred" instead of a clear message.
        # V3-H3: canonical-aware lookup — an exact query misses a stored
        # zero-padded holder ("042"), letting a second member take "42".
        from app.services.bridge_service import (
            clear_deleted_enroll_holder,
            find_confirmed_mapping,
            find_member_by_enroll_number,
        )

        existing = find_member_by_enroll_number(
            g.gym_id, enroll_number, exclude_id=member_id
        )
        if existing:
            if existing.deleted_at is not None:
                # V4-M21: the ID-101 class — the only holder is a deleted
                # member WITH device_enroll_number set. The explicit owner
                # enroll is the decision to reuse the ID: free the deleted
                # holder's enroll + mappings in one step and proceed.
                # (Terminal fingerprint purge is still the owner's job.)
                clear_deleted_enroll_holder(
                    g.gym_id, enroll_number, exclude_id=member_id
                )
            else:
                return error_response(
                    "DUPLICATE_ENROLL",
                    f"Enroll #{enroll_number} is already assigned to {existing.full_name}.",
                    409,
                )

        # V3-M7 (Guard 3): a confirmed identity mapping is authoritative
        # for punch/serve resolution even when device_enroll_number is
        # not set, so the duplicate check above is not enough. If this ID
        # is already mapped to a different member, enrolling it here
        # would make both members resolve to one terminal ID (the mapped
        # member wins in resolve_adms_member/_mapped_member, so the new
        # holder's punches and blocks would land on the wrong person).
        from app.models.rrr import RRRIdentityMapping

        # V4-M6/M21: canonical-aware mapping lookup — a stored pre-fix
        # mapping "042" is invisible to an exact "42" lookup; a stale
        # mapping to a deleted member is freed (with the holder's enroll)
        # instead of bricking the ID.
        existing_mapping = find_confirmed_mapping(g.gym_id, enroll_number)
        if existing_mapping is not None and existing_mapping.member_id != member.id:
            _mapped = (
                db.session.get(Member, existing_mapping.member_id)
                if existing_mapping.member_id is not None
                else None
            )
            if _mapped is not None and _mapped.deleted_at is not None:
                db.session.delete(existing_mapping)
                clear_deleted_enroll_holder(
                    g.gym_id, enroll_number, exclude_id=member_id
                )
            else:
                return error_response(
                    "DUPLICATE_ENROLL",
                    f"Enroll #{enroll_number} is already linked to another member.",
                    409,
                )

        # V3-M7: when this member's terminal ID changes, mappings that
        # still point at this member under a DIFFERENT id are stale —
        # leaving them would keep the old ID resolving to this member
        # after it is handed to someone else. Delete them; the mapping
        # for the new ID (if any) already points at this member and is
        # kept. Canonical comparison so a stored "0103" is recognised as
        # the same ID as "103".
        stale_mappings = RRRIdentityMapping.query.filter_by(
            gym_id=g.gym_id, member_id=member.id
        ).all()
        for row in stale_mappings:
            try:
                row_canonical = canonical_enroll_number(row.external_id)
            except ValueError:
                row_canonical = str(row.external_id or "").strip()
            if row_canonical != enroll_number:
                db.session.delete(row)

        member.device_enroll_number = enroll_number
        from app.services.bridge_service import invalidate_adms_enroll_index

        invalidate_adms_enroll_index(g.gym_id)
        # V6-M12: this link path used to bypass remap_unresolved, so
        # punches that arrived before the link stayed unmapped forever.
        # Backfill them (RRR rows + BridgeAttendance + AccessEvent
        # identity) the same way remap does.
        from app.services.rrr_service import backfill_unmapped_punches

        backfill_unmapped_punches(g.gym_id, enroll_number, member)
        # V4-M3: the enroll just changed hands — cancel any queued/delivered
        # commands for this ID intended for a previous holder before the
        # new holder's command is queued (dedup alone cannot displace a
        # delivered row, or a bridge row keyed by the old member).
        from app.services.bridge_service import displace_stale_enroll_commands

        displace_stale_enroll_commands(g.gym_id, enroll_number, new_member_id=member.id)
        queue_membership_command(member)
        audit(action="biometric_enroll", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={"enroll_number": enroll_number})
        db.session.flush()
        response_body = {"success": True, "data": _serialize_member(member),
                         "message": f"{member.full_name} enrolled as #{enroll_number}."}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="enroll_member",
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
                scope="enroll_member",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/members/<int:member_id>/unenroll", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def unenroll_member_biometric(member_id: int):
        """Remove the biometric device enrollment number from a member."""
        # Pre-check BEFORE the not-enrolled guard: a retry after a
        # successful unenroll must replay, not 400 NOT_ENROLLED.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="unenroll_member",
            headers=request.headers,
            payload={"member_id": member_id},
        )
        if replay is not None:
            return replay

        member = (
            Member.query.filter_by(id=member_id, gym_id=g.gym_id)
            .filter(Member.deleted_at.is_(None))
            .first()
        )
        if member is None:
            return error_response("NOT_FOUND", "Member not found.", 404)

        old_enroll = member.device_enroll_number
        if not old_enroll:
            return error_response("NOT_ENROLLED", "Member is not enrolled on any device.", 400)

        # V7-M2: queue the terminal block BEFORE clearing the identity.
        # Both clients promise unenroll "will block terminal access", but
        # no command was ever queued: the terminal user kept Grp=1 and its
        # fingerprint, and the freed ID could then be re-assigned while the
        # old finger still punched in as the new holder. This is a manual
        # (owner) block — the same branch the member-page access toggle
        # uses — because the owner is explicitly removing access. Bridge
        # note: bridge gyms have no owner-override branch, so the lease
        # guard still cancels this block for a live ACTIVE member (the
        # fail-closed invariant); it serves for paused/expired members.
        # That bridge gap needs a B-H1-style decision, not a silent bypass.
        from app.services.bridge_service import queue_manual_member_block

        queue_manual_member_block(member, g.current_user.id)
        member.device_enroll_number = None
        # H9: free the terminal ID — delete the identity mapping rows so
        # the enroll number can be reused for another member.
        from app.services.rrr_service import delete_identity_mappings

        delete_identity_mappings(g.gym_id, member.id)
        from app.services.bridge_service import invalidate_adms_enroll_index

        invalidate_adms_enroll_index(g.gym_id)
        audit(action="biometric_unenroll", resource_type="member", resource_id=member.id,
              gym_id=g.gym_id, actor_id=g.current_user.id,
              metadata={"old_enroll_number": old_enroll})
        db.session.flush()
        response_body = {"success": True, "data": _serialize_member(member),
                         "message": f"{member.full_name} removed from biometric device."}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="unenroll_member",
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
                scope="unenroll_member",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        pass
    from datetime import datetime
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except (ValueError, TypeError):
            pass
    return None
