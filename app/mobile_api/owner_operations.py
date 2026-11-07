"""Daily owner operations: one truthful queue for running a gym.

This API joins data that already exists in the product (memberships, payment
verification, leads, attendance and integrations).  It intentionally avoids a
second ledger or a duplicate CRM.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import g, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import GymCashClose, Member, PaymentVerification, User
from app.models.bot import BotLead
from app.models.mixins import utcnow
from app.models.rrr import RRRAttendanceEvent, RRRIntegration
from app.services.audit_service import audit
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)
from app.services.rrr_service import dashboard_for_gym
from app.services.timezone_service import today_for_gym, utc_start_of_gym_day
from app.utils.helpers import normalize_phone_e164


LEAD_STATUSES = frozenset({
    "new", "contacted", "interested", "trial_requested", "booked",
    "converted", "lost", "closed",
})
LEAD_SOURCES = frozenset({"walk_in", "phone", "referral", "instagram", "google", "whatsapp", "other"})

_logger = logging.getLogger(__name__)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _parse_datetime(value, field: str) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO date/time or null.")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO date/time or null.") from exc
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _money(value, field: str) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field} must be a valid amount.") from exc
    if not amount.is_finite() or amount < 0 or amount > Decimal("99999999.99"):
        raise ValueError(f"{field} must be between 0 and 99999999.99.")
    if amount.as_tuple().exponent < -2:
        raise ValueError(f"{field} can contain at most two decimal places.")
    return amount


def _lead_payload(lead: BotLead) -> dict:
    return {
        "id": lead.id,
        "name": lead.name,
        "phone": lead.phone,
        "source": lead.source,
        "intent": lead.intent,
        "interested_plan": lead.interested_plan,
        "status": lead.status,
        "trial_requested": lead.trial_requested,
        "notes": lead.notes,
        "lost_reason": lead.lost_reason,
        "next_follow_up_at": lead.next_follow_up_at.isoformat() if lead.next_follow_up_at else None,
        "last_contacted_at": lead.last_contacted_at.isoformat() if lead.last_contacted_at else None,
        "trial_scheduled_for": lead.trial_scheduled_for.isoformat() if lead.trial_scheduled_for else None,
        "trial_attended_at": lead.trial_attended_at.isoformat() if lead.trial_attended_at else None,
        "converted_member_id": lead.converted_member_id,
        "assigned_staff_id": lead.assigned_staff_id,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
    }


def _payment_breakdown(gym_id: int, start_at: datetime, end_at: datetime | None = None) -> tuple[dict[str, Decimal], Decimal]:
    query = PaymentVerification.query.filter(
        PaymentVerification.gym_id == gym_id,
        PaymentVerification.status == "verified",
        PaymentVerification.is_test.is_(False),
        PaymentVerification.verified_at >= start_at,
    )
    if end_at is not None:
        query = query.filter(PaymentVerification.verified_at < end_at)
    totals: dict[str, Decimal] = {}
    for method, amount in query.with_entities(PaymentVerification.method, func.coalesce(func.sum(PaymentVerification.amount), 0)).group_by(PaymentVerification.method).all():
        totals[(method or "other").lower()] = Decimal(str(amount or 0))
    return totals, sum(totals.values(), Decimal("0"))


def _integration_health(gym_id: int, now: datetime) -> list[dict]:
    rows = RRRIntegration.query.filter_by(gym_id=gym_id).order_by(RRRIntegration.connector_type).all()
    health = []
    for row in rows:
        last_success = _as_utc(row.last_success_at)
        stale = bool(last_success and now - last_success > timedelta(hours=2))
        health.append({
            "id": row.id, "type": row.connector_type, "name": row.display_name,
            "status": row.status, "device_name": row.device_name, "device_serial": row.device_serial,
            "last_success_at": last_success.isoformat() if last_success else None,
            "records_synced": row.records_synced, "unmapped_records": row.unmapped_records,
            "stale": stale, "commands_enabled": row.commands_enabled,
        })
    return health


def register_owner_operation_routes(bp):
    @bp.get("/owner/today")
    @token_required
    @roles_required("gym_owner", "staff")
    def owner_today():
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        now = utcnow()
        today = today_for_gym(gym_timezone, now=now)
        start_at = utc_start_of_gym_day(gym_timezone, local_date=today)
        end_at = utc_start_of_gym_day(gym_timezone, local_date=today + timedelta(days=1))
        methods, total_collected = _payment_breakdown(g.gym_id, start_at, end_at)
        expected_cash = methods.get("cash", Decimal("0"))
        cash_close = GymCashClose.query.filter_by(gym_id=g.gym_id, close_date=today).first()
        pending_payments = PaymentVerification.query.filter_by(gym_id=g.gym_id, status="pending", is_test=False).order_by(PaymentVerification.created_at.asc()).limit(8).all()
        lead_query = BotLead.query.filter(
            BotLead.gym_id == g.gym_id,
            BotLead.status.notin_(("converted", "lost", "closed")),
        )
        followups = lead_query.filter(
            (BotLead.next_follow_up_at.is_(None)) | (BotLead.next_follow_up_at <= now)
        ).order_by(BotLead.next_follow_up_at.asc().nullsfirst(), BotLead.created_at.asc()).limit(12).all()
        trials_today = lead_query.filter(
            BotLead.trial_scheduled_for >= start_at,
            BotLead.trial_scheduled_for < end_at,
        ).order_by(BotLead.trial_scheduled_for.asc()).all()
        # V9-M1: the RRR dashboard embeds the integration payload,
        # which carries the legacy ADMS path token — staff reads get
        # presence only, never the token.
        rrr = dashboard_for_gym(
            g.gym_id,
            gym_timezone,
            include_terminal_token=(g.current_user.role == "gym_owner"),
        )
        # dashboard_for_gym refreshes calculated opportunities.  Persist that
        # deterministic refresh just as the RRR dashboard endpoint does.
        db.session.commit()
        integrations = _integration_health(g.gym_id, now)
        actions: list[dict] = []
        for item in integrations:
            if item["status"] != "connected" or item["stale"]:
                actions.append({"kind": "integration", "priority": "high", "title": f"Check {item['name']}", "detail": "Attendance connection needs attention.", "route": "rrr-integrations", "count": 1})
        if rrr["unmapped_count"]:
            actions.append({"kind": "mapping", "priority": "high", "title": "Resolve biometric identities", "detail": f"{rrr['unmapped_count']} punch(es) need a member match.", "route": "rrr-mappings", "count": rrr["unmapped_count"]})
        if pending_payments:
            actions.append({"kind": "payment", "priority": "high", "title": "Verify pending payments", "detail": f"{len(pending_payments)} payment(s) await approval.", "route": "payments", "count": len(pending_payments)})
        if followups:
            actions.append({"kind": "lead", "priority": "high", "title": "Follow up with leads", "detail": f"{len(followups)} lead(s) need contact today.", "route": "owner-leads", "count": len(followups)})
        if trials_today:
            actions.append({"kind": "trial", "priority": "medium", "title": "Welcome trial visitors", "detail": f"{len(trials_today)} trial visit(s) scheduled today.", "route": "owner-leads", "count": len(trials_today)})
        for pillar in ("revenue", "retain", "recover"):
            count = rrr["pillars"][pillar]["count"]
            if count:
                actions.append({"kind": pillar, "priority": "medium", "title": f"Work {pillar} opportunities", "detail": f"{count} member opportunity(ies) waiting.", "route": "rrr-list", "pillar": pillar, "count": count})
        actions.sort(key=lambda item: (0 if item["priority"] == "high" else 1, -item["count"]))
        return jsonify({"success": True, "data": {
            "date": today.isoformat(),
            "collections": {"total": str(total_collected), "by_method": {key: str(value) for key, value in methods.items()}, "expected_cash": str(expected_cash)},
            "cash_close": {"closed": cash_close is not None, "counted_cash": str(cash_close.counted_cash) if cash_close else None, "variance": str(cash_close.variance) if cash_close else None, "notes": cash_close.notes if cash_close else None},
            "pending_payment_count": len(pending_payments),
            "pending_payments": [{"id": item.id, "member_name": item.member.full_name, "amount": str(item.amount), "method": item.method, "created_at": item.created_at.isoformat()} for item in pending_payments],
            "follow_up_count": len(followups), "follow_ups": [_lead_payload(item) for item in followups],
            "trials_today": [_lead_payload(item) for item in trials_today],
            "integrations": integrations,
            "rrr": rrr,
            "actions": actions[:12],
        }})

    @bp.get("/owner/finance")
    @token_required
    @roles_required("gym_owner", "staff")
    def owner_finance():
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        now = utcnow()
        today = today_for_gym(gym_timezone, now=now)
        start_at = utc_start_of_gym_day(gym_timezone, local_date=today)
        end_at = utc_start_of_gym_day(gym_timezone, local_date=today + timedelta(days=1))
        week_at = utc_start_of_gym_day(gym_timezone, local_date=today - timedelta(days=6))
        today_methods, today_total = _payment_breakdown(g.gym_id, start_at, end_at)
        week_methods, week_total = _payment_breakdown(g.gym_id, week_at, end_at)
        close = GymCashClose.query.filter_by(gym_id=g.gym_id, close_date=today).first()
        pending = db.session.query(func.coalesce(func.sum(PaymentVerification.amount), 0)).filter_by(gym_id=g.gym_id, status="pending", is_test=False).scalar() or 0
        return jsonify({"success": True, "data": {
            "today": {"total": str(today_total), "by_method": {key: str(value) for key, value in today_methods.items()}, "expected_cash": str(today_methods.get("cash", Decimal("0")))},
            "last_7_days": {"total": str(week_total), "by_method": {key: str(value) for key, value in week_methods.items()}},
            "pending_verification": str(pending),
            "cash_close": {"closed": close is not None, "counted_cash": str(close.counted_cash) if close else None, "variance": str(close.variance) if close else None, "notes": close.notes if close else None},
        }})

    @bp.post("/owner/cash-close")
    @token_required
    @roles_required("gym_owner")
    def close_cash():
        payload = request.get_json(silent=True) or {}
        try:
            counted = _money(payload.get("counted_cash"), "counted_cash")
        except ValueError as exc:
            # V9-L3: _money's message is app-written, but the API
            # boundary returns one fixed message; detail is logged.
            _logger.warning("Cash close rejected: %s", exc)
            return error_response("VALIDATION_ERROR", "The counted cash amount is invalid.", 422)
        notes = str(payload.get("notes") or "").strip()[:1000] or None
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        now = utcnow()
        today = today_for_gym(gym_timezone, now=now)
        # A retry after a successful close must replay the stored
        # close instead of rewriting closed_at / closed_by. The close
        # is an upsert keyed by (gym, date), so the fingerprint binds
        # the key to today's date via the payload.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="owner_cash_close",
            headers=request.headers,
            payload={**payload, "close_date": today.isoformat()},
        )
        if replay is not None:
            return replay

        start_at = utc_start_of_gym_day(gym_timezone, local_date=today)
        end_at = utc_start_of_gym_day(gym_timezone, local_date=today + timedelta(days=1))
        methods, _ = _payment_breakdown(g.gym_id, start_at, end_at)
        expected = methods.get("cash", Decimal("0"))
        close = GymCashClose.query.filter_by(gym_id=g.gym_id, close_date=today).first()
        if close is None:
            close = GymCashClose(gym_id=g.gym_id, close_date=today)
            db.session.add(close)
            db.session.flush()
        close.expected_cash, close.counted_cash, close.variance = expected, counted, counted - expected
        close.notes, close.closed_by_id, close.closed_at = notes, g.user_id, now
        audit(action="owner_cash_close", resource_type="gym_cash_close", resource_id=close.id, gym_id=g.gym_id, actor_id=g.user_id, metadata={"date": today.isoformat(), "expected_cash": str(expected), "counted_cash": str(counted)})
        response_body = {"success": True, "data": {"date": today.isoformat(), "expected_cash": str(expected), "counted_cash": str(counted), "variance": str(close.variance)}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="owner_cash_close",
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
                scope="owner_cash_close",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.get("/owner/leads")
    @token_required
    @roles_required("gym_owner", "staff")
    def owner_leads():
        status = (request.args.get("status") or "").strip().lower()
        if status and status not in LEAD_STATUSES:
            return error_response("VALIDATION_ERROR", "Invalid lead status.", 422)
        query = BotLead.query.filter_by(gym_id=g.gym_id)
        if status:
            query = query.filter_by(status=status)
        rows = query.order_by(BotLead.next_follow_up_at.asc().nullsfirst(), BotLead.created_at.desc()).limit(200).all()
        return jsonify({"success": True, "data": {"leads": [_lead_payload(row) for row in rows]}})

    @bp.post("/owner/leads")
    @token_required
    @roles_required("gym_owner", "staff")
    def create_owner_lead():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name") or "").strip()[:160]
        phone = normalize_phone_e164(payload.get("phone") or "")
        source = str(payload.get("source") or "walk_in").strip().lower()
        if not name or not phone:
            return error_response("VALIDATION_ERROR", "Lead name and a valid phone are required.", 422)
        if source not in LEAD_SOURCES:
            return error_response("VALIDATION_ERROR", "Invalid lead source.", 422)
        try:
            follow_up = _parse_datetime(payload.get("next_follow_up_at"), "next_follow_up_at")
            trial_at = _parse_datetime(payload.get("trial_scheduled_for"), "trial_scheduled_for")
        except ValueError as exc:
            # V9-L3: fixed message at the API boundary; detail logged.
            _logger.warning("Lead create rejected: %s", exc)
            return error_response("VALIDATION_ERROR", "Dates must be valid ISO 8601 timestamps.", 422)
        # A retry after a successful create must replay the stored
        # lead instead of creating a duplicate row.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="create_owner_lead",
            headers=request.headers,
            payload=payload,
        )
        if replay is not None:
            return replay

        lead = BotLead(gym_id=g.gym_id, name=name, phone=phone, source=source, intent=str(payload.get("intent") or "membership").strip()[:128] or None, interested_plan=str(payload.get("interested_plan") or "").strip()[:160] or None, trial_requested=bool(payload.get("trial_requested")), status="trial_requested" if payload.get("trial_requested") else "new", notes=str(payload.get("notes") or "").strip()[:4000] or None, next_follow_up_at=follow_up, trial_scheduled_for=trial_at)
        db.session.add(lead)
        db.session.flush()
        audit(action="owner_lead_created", resource_type="bot_lead", resource_id=lead.id, gym_id=g.gym_id, actor_id=g.user_id, metadata={"source": source})
        response_body = {"success": True, "data": {"lead": _lead_payload(lead)}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="create_owner_lead",
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
                scope="create_owner_lead",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body), 201

    @bp.patch("/owner/leads/<int:lead_id>")
    @token_required
    @roles_required("gym_owner", "staff")
    def update_owner_lead(lead_id: int):
        lead = BotLead.query.filter_by(gym_id=g.gym_id, id=lead_id).first()
        if lead is None:
            return error_response("NOT_FOUND", "Lead was not found.", 404)
        payload = request.get_json(silent=True) or {}
        # A retry after a successful update must replay, not re-apply
        # (re-applying a "mark_trial_attended" would rewrite the
        # attended timestamp; a status flip retried after the owner
        # moved it on would flip it back).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_owner_lead",
            headers=request.headers,
            payload={**payload, "lead_id": lead_id},
        )
        if replay is not None:
            return replay

        try:
            if "status" in payload:
                status = str(payload["status"] or "").lower()
                if status not in LEAD_STATUSES:
                    raise ValueError("Invalid lead status.")
                lead.status = status
                if status == "contacted": lead.last_contacted_at = utcnow()
            for field in ("next_follow_up_at", "trial_scheduled_for"):
                if field in payload: setattr(lead, field, _parse_datetime(payload[field], field))
            if payload.get("mark_trial_attended") is True: lead.trial_attended_at = utcnow()
            if "notes" in payload: lead.notes = str(payload["notes"] or "").strip()[:4000] or None
            if "lost_reason" in payload: lead.lost_reason = str(payload["lost_reason"] or "").strip()[:255] or None
            if "trial_requested" in payload: lead.trial_requested = bool(payload["trial_requested"])
            if "converted_member_id" in payload and payload["converted_member_id"] is not None:
                member = Member.query.filter_by(gym_id=g.gym_id, id=int(payload["converted_member_id"])).first()
                if member is None: raise ValueError("Converted member does not belong to this gym.")
                lead.converted_member_id, lead.status = member.id, "converted"
            if "assigned_staff_id" in payload:
                staff_id = payload["assigned_staff_id"]
                if staff_id is not None and User.query.filter_by(gym_id=g.gym_id, id=int(staff_id), is_active=True).first() is None:
                    raise ValueError("Assigned staff member does not belong to this gym.")
                lead.assigned_staff_id = int(staff_id) if staff_id is not None else None
        except (ValueError, TypeError) as exc:
            # V9-L3: fixed message at the API boundary; detail logged.
            _logger.warning("Lead update rejected: %s", exc)
            return error_response("VALIDATION_ERROR", "One or more lead fields are invalid.", 422)
        audit(action="owner_lead_updated", resource_type="bot_lead", resource_id=lead.id, gym_id=g.gym_id, actor_id=g.user_id, metadata={"status": lead.status})
        response_body = {"success": True, "data": {"lead": _lead_payload(lead)}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_owner_lead",
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
                scope="update_owner_lead",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)
