"""Real-data Revenue / Retain / Recover calculations and attendance normalization."""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func

from app.extensions import db
from app.models import Member, MembershipPlan, PaymentVerification
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
    db.session.add(event)
    return event, True


def remap_unresolved(gym_id: int, external_id: str, member: Member, user_id: int | None) -> int:
    mapping = RRRIdentityMapping.query.filter_by(gym_id=gym_id, external_id=external_id).first()
    if mapping is None:
        mapping = RRRIdentityMapping(
            gym_id=gym_id, external_id=external_id, member_id=member.id,
            source="ebioserver", status="confirmed", confirmed_by_id=user_id,
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
                        reason_text: str, priority: str, potential_revenue: Decimal) -> RRROpportunity:
    key = f"{pillar}:{reason_code}:{member.id}"
    row = RRROpportunity.query.filter_by(gym_id=gym_id, dedupe_key=key).first()
    if row is None:
        row = RRROpportunity(
            gym_id=gym_id, member_id=member.id, pillar=pillar, reason_code=reason_code,
            reason_text=reason_text, priority=priority, potential_revenue=potential_revenue,
            dedupe_key=key,
        )
        db.session.add(row)
    elif row.status in {"open", "actioned"}:
        row.reason_text = reason_text
        row.priority = priority
        row.potential_revenue = potential_revenue
    return row


def refresh_opportunities(gym_id: int, gym_timezone: str = "Asia/Kolkata") -> list[RRROpportunity]:
    """Calculate explainable opportunities from persisted operational data."""
    rules = rules_for_gym(gym_id)
    today = today_for_gym(gym_timezone)
    now = utcnow()
    members = Member.query.filter_by(gym_id=gym_id).filter(Member.deleted_at.is_(None)).all()
    last_visit = dict(
        db.session.query(RRRAttendanceEvent.member_id, func.max(RRRAttendanceEvent.punch_time))
        .filter(RRRAttendanceEvent.gym_id == gym_id, RRRAttendanceEvent.member_id.isnot(None))
        .group_by(RRRAttendanceEvent.member_id).all()
    )
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
                ))
            if days < 0 and abs(days) <= rules["recent_expiry_days"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="recover", reason_code="recently_expired",
                    reason_text=f"Membership expired {abs(days)} day(s) ago on {member.membership_end.isoformat()}.",
                    priority="high", potential_revenue=value,
                ))
        pending_payment = PaymentVerification.query.filter_by(
            gym_id=gym_id, member_id=member.id, status="pending", is_test=False
        ).order_by(PaymentVerification.created_at.asc()).first()
        if pending_payment and pending_payment.created_at and (now - pending_payment.created_at).days >= 1:
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="payment_friction",
                reason_text=f"A payment of ₹{pending_payment.amount} has been awaiting verification since {pending_payment.created_at.date().isoformat()}.",
                priority="high", potential_revenue=Decimal(str(pending_payment.amount or 0)),
            ))
        visit = last_visit.get(member.id)
        if member.status == "active" and (visit is None or (now - visit).days >= rules["no_visit_days"]):
            no_visit_days = rules["no_visit_days"] if visit is None else max(0, (now - visit).days)
            created.append(_upsert_opportunity(
                gym_id=gym_id, member=member, pillar="retain", reason_code="no_recent_visit",
                reason_text=f"No attendance recorded for {no_visit_days} day(s).",
                priority="high" if no_visit_days >= 30 else "medium", potential_revenue=value,
            ))
        # Explainable attendance decline: compare the most recent 14-day
        # window against the preceding 14-day baseline. Skip sparse histories.
        recent_start = now - timedelta(days=14)
        baseline_start = now - timedelta(days=28)
        recent_count = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, member_id=member.id).filter(
            RRRAttendanceEvent.punch_time >= recent_start
        ).count()
        baseline_count = RRRAttendanceEvent.query.filter_by(gym_id=gym_id, member_id=member.id).filter(
            RRRAttendanceEvent.punch_time >= baseline_start,
            RRRAttendanceEvent.punch_time < recent_start,
        ).count()
        if member.status == "active" and baseline_count >= 2:
            decline = round((baseline_count - recent_count) / baseline_count * 100)
            if decline >= rules["attendance_drop_percent"]:
                created.append(_upsert_opportunity(
                    gym_id=gym_id, member=member, pillar="retain", reason_code="attendance_decline",
                    reason_text=f"Attendance is down {decline}%: {recent_count} visits in the last 14 days versus {baseline_count} in the prior 14 days.",
                    priority="high" if decline >= 75 else "medium", potential_revenue=value,
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
    integration = RRRIntegration.query.filter_by(gym_id=gym_id, connector_type="ebioserver").first()
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
    }


def integration_payload(row: RRRIntegration) -> dict:
    return {
        "id": row.id, "type": row.connector_type, "name": row.display_name, "status": row.status,
        "primary": row.is_primary, "device_serial": row.device_serial, "device_name": row.device_name,
        "last_success_at": row.last_success_at.isoformat() if row.last_success_at else None,
        "last_error": row.last_error, "records_synced": row.records_synced,
        "unmapped_records": row.unmapped_records, "commissioning_status": row.commissioning_status,
        "commands_enabled": row.commands_enabled,
    }
