"""Real-data Revenue / Retain / Recover calculations and attendance normalization."""
from __future__ import annotations

import hashlib
import secrets
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models import Gym, Member, MembershipPlan, PaymentVerification, QRSettings
from app.models.mixins import utcnow
from app.models.rrr import (
    RRRAttendanceEvent,
    RRRIdentityMapping,
    RRRIntegration,
    RRROpportunity,
    RRRRule,
)
from app.services.timezone_service import today_for_gym


DEFAULT_RULES = {
    "expiry_days": 30,
    "no_visit_days": 14,
    "attendance_drop_percent": 50,
    "recent_expiry_days": 30,
}


def rules_for_gym(gym_id: int) -> dict[str, int]:
    values = dict(DEFAULT_RULES)
    for rule in RRRRule.query.filter_by(gym_id=gym_id, is_enabled=True).all():
        values[rule.rule_key] = rule.value
    return values


def ensure_default_rules(gym_id: int) -> list[RRRRule]:
    existing = {rule.rule_key for rule in RRRRule.query.filter_by(gym_id=gym_id).all()}
    created = []
    for key, value in DEFAULT_RULES.items():
        if key not in existing:
            item = RRRRule(gym_id=gym_id, rule_key=key, value=value)
            db.session.add(item)
            created.append(item)
    return created


def _dedupe_key(source: str, device_serial: str | None, external_event_id: str | None,
                biometric_user_id: str, punch_time, raw_payload: str = "") -> str:
    # The same physical punch may arrive through eBioServer and a direct SDK
    # connector. Source IDs differ, so deduplicate by physical device/user/time.
    stable = "|".join((
        device_serial or "", biometric_user_id, punch_time.isoformat(),
    ))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def _mapped_member(gym_id: int, biometric_user_id: str) -> Member | None:
    mapping = RRRIdentityMapping.query.filter_by(
        gym_id=gym_id, external_id=biometric_user_id, status="confirmed"
    ).first()
    if mapping and mapping.member_id:
        return mapping.member
    return Member.query.filter_by(gym_id=gym_id, device_enroll_number=biometric_user_id).first()


def normalize_attendance(*, gym_id: int, source: str, biometric_user_id: str, punch_time,
                         external_event_id: str | None = None, device_serial: str | None = None,
                         direction: str | None = None, verify_method: str | None = None,
                         integration_id: int | None = None, raw_payload: str = "") -> tuple[RRRAttendanceEvent, bool]:
    """Store a source-neutral attendance event once and retain unmapped events."""
    key = _dedupe_key(source, device_serial, external_event_id, biometric_user_id, punch_time, raw_payload)
    existing = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
    if existing:
        return existing, False
    member = _mapped_member(gym_id, biometric_user_id)
    event = RRRAttendanceEvent(
        gym_id=gym_id,
        integration_id=integration_id,
        member_id=member.id if member else None,
        source=source,
        device_serial=device_serial,
        external_event_id=external_event_id,
        biometric_user_id=biometric_user_id,
        punch_time=punch_time,
        direction=direction,
        verify_method=verify_method,
        dedupe_key=key,
        raw_payload_hash=hashlib.sha256(raw_payload.encode("utf-8")).hexdigest() if raw_payload else None,
        processing_status="processed" if member else "unmapped",
    )
    # Insert in a savepoint: two concurrent ingestions of the same punch
    # both pass the check above; the loser hits the unique constraint and
    # must return the winner's row instead of 500ing the whole batch.
    try:
        with db.session.begin_nested():
            db.session.add(event)
            db.session.flush()
    except IntegrityError:
        existing = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
        if existing is not None:
            return existing, False
        raise
    return event, True


def remap_unresolved(gym_id: int, external_id: str, member: Member, user_id: int | None,
                   source: str | None = None) -> int:
    mapping = RRRIdentityMapping.query.filter_by(gym_id=gym_id, external_id=external_id).first()
    if mapping is None:
        mapping = RRRIdentityMapping(
            gym_id=gym_id, external_id=external_id, member_id=member.id,
            source=source or "ebioserver", status="confirmed", confirmed_by_id=user_id,
        )
        db.session.add(mapping)
    else:
        mapping.member_id = member.id
        mapping.status = "confirmed"
        mapping.confirmed_by_id = user_id
    member.device_enroll_number = external_id
    events = RRRAttendanceEvent.query.filter_by(
        gym_id=gym_id, biometric_user_id=external_id, processing_status="unmapped"
    ).all()
    for event in events:
        event.member_id = member.id
        event.processing_status = "processed"
    return len(events)


def _upsert_opportunity(*, gym_id: int, member: Member, pillar: str, reason_code: str,
                        reason_text: str, priority: str, potential_revenue: Decimal,
                        existing: dict | None = None) -> RRROpportunity:
    key = f"{pillar}:{reason_code}:{member.id}"
    row = (existing or {}).get(key)
    if row is None and existing is None:
        row = RRROpportunity.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
    if row is None:
        row = RRROpportunity(
            gym_id=gym_id, member_id=member.id, pillar=pillar, reason_code=reason_code,
            reason_text=reason_text, priority=priority, potential_revenue=potential_revenue,
            dedupe_key=key,
        )
        db.session.add(row)
        if existing is not None:
            existing[key] = row
    elif row.status in {"open", "actioned"}:
        row.reason_text = reason_text
        row.priority = priority
        row.potential_revenue = potential_revenue
    return row


def refresh_opportunities(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> list[RRROpportunity]:
    """Calculate explainable opportunities from persisted operational data.

    Bulk-fetches everything up front: one members query (plan joined), one
    pending-payments query, one grouped attendance query, one opportunities
    query. No per-member queries — this runs on the dashboard request path.
    """
    rules = rules_for_gym(gym_id)
    today = today_for_gym(gym_timezone)
    now = utcnow()
    members = (
        Member.query.filter_by(gym_id=gym_id)
        .filter(Member.deleted_at.is_(None))
        .options(joinedload(Member.plan))
        .all()
    )
    member_ids = [m.id for m in members]
    if not member_ids:
        return []

    last_visit = dict(
        db.session.query(RRRAttendanceEvent.member_id, func.max(RRRAttendanceEvent.punch_time))
        .filter(RRRAttendanceEvent.gym_id == gym_id, RRRAttendanceEvent.member_id.isnot(None))
        .group_by(RRRAttendanceEvent.member_id).all()
    )

    # Oldest pending payment per member (bulk).
    pending_sub = (
        db.session.query(
            PaymentVerification.member_id,
            func.min(PaymentVerification.created_at).label("first_created"),
        )
        .filter(
            PaymentVerification.gym_id == gym_id,
            PaymentVerification.member_id.in_(member_ids),
            PaymentVerification.status == "pending",
            PaymentVerification.is_test.is_(False),
        )
        .group_by(PaymentVerification.member_id)
        .subquery()
    )
    pending_rows = (
        db.session.query(PaymentVerification)
        .join(pending_sub, (PaymentVerification.member_id == pending_sub.c.member_id)
              & (PaymentVerification.created_at == pending_sub.c.first_created))
        .filter(PaymentVerification.gym_id == gym_id)
        .all()
    )
    pending_by_member = {p.member_id: p for p in pending_rows}

    # Attendance counts per member in one grouped query (recent 14d vs prior 14d).
    recent_start = now - timedelta(days=14)
    baseline_start = now - timedelta(days=28)
    count_rows = (
        db.session.query(
            RRRAttendanceEvent.member_id,
            func.sum(case((RRRAttendanceEvent.punch_time >= recent_start, 1), else_=0)).label("recent"),
            func.sum(case(((RRRAttendanceEvent.punch_time >= baseline_start)
                           & (RRRAttendanceEvent.punch_time < recent_start), 1), else_=0)).label("baseline"),
        )
        .filter(
            RRRAttendanceEvent.gym_id == gym_id,
            RRRAttendanceEvent.member_id.in_(member_ids),
            RRRAttendanceEvent.punch_time >= baseline_start,
        )
        .group_by(RRRAttendanceEvent.member_id)
        .all()
    )
    counts_by_member = {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in count_rows}

    # Existing open/actioned opportunities keyed by dedupe_key (bulk).
    existing = {
        row.dedupe_key: row
        for row in RRROpportunity.query.filter_by(gym_id=gym_id).all()
    }

    created = []
    for member in members:
        value = member.plan.price if member.plan else Decimal("0")
        if member.membership_end:
            days = (member.membership_end - today).days
            if member.status == "active" and 0 <= days <= rules["expiry_days"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="revenue", reason_code="expiry_approaching",
                    reason_text=f"Membership expires in {days} day(s) on {member.membership_end.isoformat()}.",
                    priority="high" if days <= 7 else "medium", potential_revenue=value,
                    existing=existing,
                ))
            if days < 0 and abs(days) <= rules["recent_expiry_days"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="recover", reason_code="recently_expired",
                    reason_text=f"Membership expired {abs(days)} day(s) ago on {member.membership_end.isoformat()}.",
                    priority="high", potential_revenue=value,
                    existing=existing,
                ))
        pending_payment = pending_by_member.get(member.id)
        if pending_payment and pending_payment.created_at and (now - pending_payment.created_at).days >= 1:
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="payment_friction",
                reason_text=f"A payment of \u20b9{pending_payment.amount} has been awaiting verification since {pending_payment.created_at.date().isoformat()}.",
                priority="high", potential_revenue=Decimal(str(pending_payment.amount or 0)),
                existing=existing,
            ))
        visit = last_visit.get(member.id)
        if member.status == "active" and (visit is None or (now - visit).days >= rules["no_visit_days"]):
            no_visit_days = rules["no_visit_days"] if visit is None else max(0, (now - visit).days)
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="no_recent_visit",
                reason_text=f"No attendance recorded for {no_visit_days} day(s).",
                priority="high" if no_visit_days >= 30 else "medium", potential_revenue=value,
                existing=existing,
            ))
        # Explainable attendance decline: most recent 14-day window vs the
        # preceding 14-day baseline. Skip sparse histories.
        recent_count, baseline_count = counts_by_member.get(member.id, (0, 0))
        if member.status == "active" and baseline_count >= 2:
            decline = round((baseline_count - recent_count) / baseline_count * 100)
            if decline >= rules["attendance_drop_percent"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="retain", reason_code="attendance_decline",
                    reason_text=f"Attendance is down {decline}%: {recent_count} visits in the last 14 days versus {baseline_count} in the prior 14 days.",
                    priority="high" if decline >= 75 else "medium", potential_revenue=value,
                    existing=existing,
                ))
    return created


def _opportunity_payload(row: RRROpportunity) -> dict:
    return {
        "id": row.id, "pillar": row.pillar, "status": row.status, "priority": row.priority,
        "reason_code": row.reason_code, "reason": row.reason_text,
        "potential_revenue": str(row.potential_revenue), "outcome_revenue": str(row.outcome_revenue),
        "member": {"id": row.member.id, "name": row.member.full_name, "phone": row.member.phone,
                   "membership_end": row.member.membership_end.isoformat() if row.member.membership_end else None},
    }


def dashboard_for_gym(gym_id: int, gym_timezone: str) -> dict:
    refresh_opportunities(gym_id, gym_timezone)
    db.session.flush()
    opportunities = RRROpportunity.query.filter_by(gym_id=gym_id).filter(
        RRROpportunity.status.in_(("open", "actioned"))
    ).order_by(RRROpportunity.priority.desc(), RRROpportunity.created_at.desc()).all()
    by_pillar: dict[str, list[RRROpportunity]] = defaultdict(list)
    for item in opportunities:
        by_pillar[item.pillar].append(item)
    active_members = Member.query.filter_by(gym_id=gym_id, status="active").filter(Member.deleted_at.is_(None)).count()
    total_members = Member.query.filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None)).count()
    month_start = utcnow() - timedelta(days=30)
    active_visitors = db.session.query(func.count(func.distinct(RRRAttendanceEvent.member_id))).filter(
        RRRAttendanceEvent.gym_id == gym_id, RRRAttendanceEvent.member_id.isnot(None),
        RRRAttendanceEvent.punch_time >= month_start,
    ).scalar() or 0
    # Direct ADMS is the preferred no-PC integration. Keep existing eBioServer
    # installations visible as a fallback so those gyms are not disrupted.
    integrations = RRRIntegration.query.filter_by(gym_id=gym_id).all()
    integration = next((row for row in integrations if row.connector_type == "adms_direct" and row.status == "connected"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "ebioserver" and row.status == "connected"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "adms_direct"), None)
    integration = integration or next((row for row in integrations if row.connector_type == "ebioserver"), None)
    return {
        "members": {"total": total_members, "active": active_members,
                    "attendance_rate": round((active_visitors / active_members * 100), 1) if active_members else 0},
        "integration": integration_payload(integration) if integration else None,
        "pillars": {
            name: {"count": len(by_pillar[name]),
                   "potential_revenue": str(sum((x.potential_revenue for x in by_pillar[name]), Decimal("0"))),
                   "items": [_opportunity_payload(x) for x in by_pillar[name][:5]]}
            for name in ("revenue", "retain", "recover")
        },
        "unmapped_count": RRRAttendanceEvent.query.filter_by(gym_id=gym_id, processing_status="unmapped").count(),
        "opportunities": [_opportunity_payload(x) for x in opportunities[:12]],
        # Setup-checklist signals for new gyms (PWA dashboard).
        "plans_count": MembershipPlan.query.filter_by(gym_id=gym_id, is_active=True).count(),
        "whatsapp_connected": bool((gym := db.session.get(Gym, gym_id)) and gym.whatsapp_enabled and gym.whatsapp_connection_status == "CONNECTED"),
        "payment_setup_done": bool(QRSettings.query.filter_by(gym_id=gym_id).first()),
    }


def adms_terminal_settings(host_url: str | None = None, path_token: str | None = None) -> dict:
    """Authoritative values the owner types into the terminal's ADMS menu.

    Computed from ADMS_PUBLIC_URL (falling back to PUBLIC_BASE_URL, then the
    current request host) so the app never shows a different address than the
    backend listens on. Set ADMS_PUBLIC_URL to a plain-HTTP reverse proxy
    address when terminals cannot do HTTPS.
    """
    from urllib.parse import urlparse

    from flask import current_app, has_request_context, request

    fallback = host_url
    if fallback is None and has_request_context():
        fallback = request.host_url
    parsed = urlparse(fallback or "")
    configured_base = urlparse(str(current_app.config.get("ADMS_PUBLIC_URL") or current_app.config.get("PUBLIC_BASE_URL") or fallback or ""))
    host = configured_base.hostname or parsed.hostname
    port = configured_base.port or (443 if configured_base.scheme == "https" else 80)
    return {
        "server_mode": "ADMS",
        "server_address": host,
        "server_port": port,
        "https": configured_base.scheme == "https",
        # The per-integration path token makes the ADMS URL unguessable;
        # without it the terminal falls back to serial-only auth.
        "path": f"/iclock/{path_token}" if path_token else "/iclock",
    }


def integration_payload(row: RRRIntegration) -> dict:
    payload = {
        "id": row.id, "type": row.connector_type, "name": row.display_name, "status": row.status,
        "primary": row.is_primary, "device_serial": row.device_serial, "device_name": row.device_name,
        "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
        "last_error": row.last_error, "records_synced": row.records_synced,
        "unmapped_records": row.unmapped_records, "commissioning_status": row.commissioning_status,
        "commands_enabled": row.commands_enabled,
    }
    if row.connector_type == "adms_direct":
        # Backfill the token for integrations provisioned before it existed.
        if not row.adms_path_token:
            row.adms_path_token = secrets.token_urlsafe(32)
        payload["terminal_settings"] = adms_terminal_settings(path_token=row.adms_path_token)
    return payload
