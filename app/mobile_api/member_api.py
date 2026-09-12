"""Member-facing authentication and API endpoints.

Provides:
- OTP-based login via WhatsApp (no app download required for reminders)
- HMAC-signed stateless OTP challenge verification across multi-worker deployments
- JWT access tokens (role="member") with cryptographic verification
- Member dashboard (membership status, next expiry, attendance)
- Detailed membership info with plan details
- Active plan listing for the member's gym
- Payment claim with plan selection (self-service renewal)
- Payment history
- Access/attendance history
- Profile endpoint
"""
from __future__ import annotations

from functools import wraps
import hashlib
import hmac
import logging
import random
import string
import time
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal, InvalidOperation

from flask import Blueprint, current_app, g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.token_service import create_access_token, decode_access_token
from app.models import (
    AccessEvent,
    AuditLog,
    Campaign,
    Gym,
    Member,
    MembershipPlan,
    PaymentVerification,
    QRSettings,
    RenewalHistory,
    User,
)
from app.services.timezone_service import today_for_gym

_logger = logging.getLogger(__name__)

member_bp = Blueprint("member_api", __name__, url_prefix="/api/member/v1")


def _token_secret() -> str:
    secret = current_app.config.get("MOBILE_API_TOKEN_SECRET", "")
    if not secret:
        secret = current_app.config.get("SECRET_KEY", "renewal-desk-member-secret-key")
    return secret


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def _normalize_phone(phone: str) -> str:
    """Strip whitespace and leading +, keep digits only."""
    return phone.strip().lstrip("+").replace(" ", "").replace("-", "")


def _sign_otp_challenge(phone: str, member_id: int, gym_id: int, otp: str, expires_at_ts: int) -> str:
    """Create an HMAC signature for a stateless OTP challenge."""
    payload = f"{phone}:{member_id}:{gym_id}:{otp}:{expires_at_ts}"
    sig = hmac.new(_token_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{member_id}.{gym_id}.{expires_at_ts}.{sig}"


def _verify_otp_challenge(phone: str, otp: str, challenge: str) -> tuple[int, int] | None:
    """Verify an HMAC-signed OTP challenge. Returns (member_id, gym_id) on success, or None."""
    try:
        parts = challenge.split(".")
        if len(parts) != 4:
            return None
        member_id_str, gym_id_str, expires_at_str, expected_sig = parts
        member_id = int(member_id_str)
        gym_id = int(gym_id_str)
        expires_at_ts = int(expires_at_str)
        if time.time() > expires_at_ts:
            return None
        payload = f"{phone}:{member_id}:{gym_id}:{otp}:{expires_at_ts}"
        actual_sig = hmac.new(_token_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        return member_id, gym_id
    except Exception:
        return None


def member_token_required(view):
    """Decorator that verifies the Bearer access token for member endpoints."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"success": False, "error": "Missing or invalid Authorization header."}), 401

        token = auth_header[7:]
        payload = decode_access_token(token)
        if payload is None or payload.get("role") != "member":
            return jsonify({"success": False, "error": "Access token is invalid or expired."}), 401

        member = db.session.get(Member, payload.get("sub"))
        if member is None or member.deleted_at is not None:
            return jsonify({"success": False, "error": "Member not found."}), 401
        if member.gym is None or not member.gym.is_operational():
            return jsonify({"success": False, "error": "Gym account is not active."}), 403

        g.current_member = member
        g.member_id = member.id
        g.gym_id = member.gym_id
        return view(*args, **kwargs)

    return wrapped


# ── Auth ──────────────────────────────────────────────────────────────


def _get_gym_branding(gym: Gym | None) -> dict:
    """Return dynamic gym branding, contact details, real announcements, and offers."""
    if not gym:
        return {
            "gym_name": "VYNLA Gym",
            "logo_url": None,
            "primary_color": "#2563EB",
            "secondary_color": "#1D4ED8",
            "accent_color": "#EFF6FF",
            "tagline": "Personalized Member Experience",
            "address": None,
            "phone": None,
            "whatsapp_number": None,
            "website": None,
            "opening_hours": "Mon-Sat: 6:00 AM - 10:00 PM · Sun: 7:00 AM - 1:00 PM",
            "powered_by": "VYNLA",
            "announcements": [],
            "offers": [],
        }

    # Real announcements from broadcast audit logs
    announcements = []
    recent_broadcasts = (
        AuditLog.query.filter_by(
            gym_id=gym.id,
            action="whatsapp_broadcast_announcement",
        )
        .order_by(AuditLog.created_at.desc())
        .limit(5)
        .all()
    )
    for b in recent_broadcasts:
        det = b.details or {}
        preview = det.get("preview") or b.target_name or "Gym Announcement"
        announcements.append({
            "id": b.id,
            "title": "Gym Announcement",
            "message": preview,
            "date": b.created_at.isoformat() if b.created_at else None,
        })

    # Real offers from promotional campaigns
    offers = []
    active_promos = (
        Campaign.query.filter_by(gym_id=gym.id)
        .filter(Campaign.status.in_(["draft", "sending", "sent", "completed"]))
        .order_by(Campaign.created_at.desc())
        .limit(3)
        .all()
    )
    for c in active_promos:
        if c.campaign_type == "promo" or c.promo_preset:
            offers.append({
                "id": c.id,
                "title": c.name,
                "description": c.message_template or "Special renewal discount for members.",
                "promo_preset": c.promo_preset,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            })

    # QR Settings / payment logo
    qr = gym.qr_settings

    return {
        "gym_name": gym.name,
        "logo_url": qr.qr_public_url if (qr and qr.qr_public_url) else None,
        "primary_color": "#2563EB",
        "secondary_color": "#1D4ED8",
        "accent_color": "#EFF6FF",
        "tagline": "Personalized Member Experience",
        "address": gym.address,
        "phone": gym.business_phone_number or gym.phone,
        "whatsapp_number": gym.business_phone_number or gym.phone,
        "website": None,
        "opening_hours": "Mon-Sat: 6:00 AM - 10:00 PM · Sun: 7:00 AM - 1:00 PM",
        "powered_by": "VYNLA",
        "announcements": announcements,
        "offers": offers,
    }


@member_bp.route("/auth/request-otp", methods=["POST"])
@limiter.limit("5 per minute")
def request_otp():
    """Send OTP to a member's WhatsApp number and return a stateless challenge."""
    data = request.get_json(silent=True) or {}
    phone = _normalize_phone(data.get("phone", ""))

    if not phone or len(phone) < 10:
        return jsonify({"success": False, "error": "Valid phone number is required."}), 400

    member = (
        Member.query.filter(Member.phone.endswith(phone[-10:]))
        .filter(Member.deleted_at.is_(None))
        .first()
    )

    if not member:
        # Check if phone belongs to gym owner or staff (registered gym phone or business phone)
        gym_staff = Gym.query.filter(
            (Gym.phone.endswith(phone[-10:])) | (Gym.business_phone_number.endswith(phone[-10:]))
        ).first()
        if gym_staff:
            return jsonify({
                "success": False,
                "is_staff": True,
                "error": "This phone number is registered as gym staff. Please use the Renewal Desk owner app to manage your gym.",
            }), 403

        return jsonify({
            "success": False,
            "error": "We couldn't find a member account for this number. Please contact your gym.",
        }), 404

    otp = _generate_otp()
    expires_at_ts = int(time.time()) + 600  # 10 minutes
    challenge = _sign_otp_challenge(phone, member.id, member.gym_id, otp, expires_at_ts)

    # Send OTP via WhatsApp
    try:
        gym = db.session.get(Gym, member.gym_id)
        if gym and gym.whatsapp_enabled:
            from app.services.whatsapp_service import WhatsAppService
            from app.utils.helpers import phone_to_whatsapp

            wa = WhatsAppService(gym)
            wa_phone = phone_to_whatsapp(member.phone)
            if wa_phone:
                otp_template = current_app.config.get("WHATSAPP_OTP_TEMPLATE_NAME", "")
                template_sent = False
                if otp_template:
                    template_res = wa.send_template(
                        to=wa_phone,
                        template_name=otp_template,
                        language_code=current_app.config.get("WHATSAPP_OTP_TEMPLATE_LANGUAGE", "en"),
                        body_parameters=[otp],
                    )
                    template_sent = template_res.ok
                    if not template_sent:
                        _logger.warning("WhatsApp OTP template '%s' failed: %s", otp_template, template_res.error)

                if not template_sent:
                    text_res = wa.send_text(
                        to=wa_phone,
                        body=f"Your VYNLA verification code is: {otp}\n\nValid for 10 minutes.",
                    )
                    if not text_res.ok:
                        _logger.warning("WhatsApp OTP text message failed: %s", text_res.error)
    except Exception:
        _logger.exception("Failed to send OTP via WhatsApp for phone %s", phone[-4:])

    resp_payload = {
        "success": True,
        "message": "OTP sent to your WhatsApp number.",
        "challenge": challenge,
        "gym_name": member.gym.name if member.gym else None,
        "powered_by": "VYNLA",
    }
    if current_app.config.get("TESTING"):
        resp_payload["test_otp"] = otp

    return jsonify(resp_payload)


@member_bp.route("/auth/verify-otp", methods=["POST"])
@limiter.limit("10 per minute")
def verify_otp():
    """Verify OTP and return signed member session token."""
    data = request.get_json(silent=True) or {}
    phone = _normalize_phone(data.get("phone", ""))
    otp = (data.get("otp") or "").strip()
    challenge = data.get("challenge")

    if not phone or not otp:
        return jsonify({"success": False, "error": "Phone and OTP are required."}), 400

    member_id: int | None = None
    gym_id: int | None = None

    # Verify challenge (HMAC-based, stateless, multi-worker safe)
    if challenge:
        verified = _verify_otp_challenge(phone, otp, challenge)
        if verified:
            member_id, gym_id = verified

    if member_id is None:
        return jsonify({"success": False, "error": "Invalid or expired verification code."}), 400

    member = db.session.get(Member, member_id)
    if not member or member.deleted_at is not None:
        return jsonify({"success": False, "error": "Member not found."}), 404

    # Generate cryptographically signed member JWT
    token = create_access_token(user_id=member.id, gym_id=gym_id or member.gym_id, role="member")

    return jsonify({
        "success": True,
        "data": {
            "token": token,
            "member": {
                "id": member.id,
                "full_name": member.full_name,
                "phone": member.phone,
                "gym_name": member.gym.name if member.gym else None,
                "membership_status": member.status,
                "membership_end": member.membership_end.isoformat() if member.membership_end else None,
                "plan_name": member.plan.name if member.plan else None,
            },
        },
    })


# ── Gym Branding ─────────────────────────────────────────────────────


@member_bp.route("/gym-branding", methods=["GET"])
@member_token_required
def member_gym_branding():
    """Return authenticated member's gym dynamic branding, announcements, and offers."""
    member = g.current_member
    branding = _get_gym_branding(member.gym)
    return jsonify({
        "success": True,
        "data": {
            "branding": branding,
        },
    })


# ── Member Dashboard ──────────────────────────────────────────────────


@member_bp.route("/dashboard", methods=["GET"])
@member_token_required
def member_dashboard():
    """Return authenticated member's membership status, attendance, payment summary, and branding."""
    member = g.current_member
    gym = member.gym
    gym_timezone = gym.timezone if gym else "Asia/Kolkata"
    today = today_for_gym(gym_timezone)

    days_left = (member.membership_end - today).days if member.membership_end else None
    is_expired = member.membership_end and member.membership_end < today

    # Recent renewals for this member
    renewals = (
        RenewalHistory.query.filter_by(member_id=member.id, gym_id=g.gym_id)
        .order_by(RenewalHistory.created_at.desc())
        .limit(5)
        .all()
    )

    # Pending payments for this member
    pending = (
        PaymentVerification.query.filter_by(member_id=member.id, gym_id=g.gym_id, status="pending")
        .order_by(PaymentVerification.created_at.desc())
        .first()
    )

    return jsonify({
        "success": True,
        "data": {
            "member": {
                "id": member.id,
                "full_name": member.full_name,
                "phone": member.phone,
                "status": member.status,
                "membership_start": member.membership_start.isoformat() if member.membership_start else None,
                "membership_end": member.membership_end.isoformat() if member.membership_end else None,
                "days_left": days_left,
                "is_expired": is_expired,
                "plan_name": member.plan.name if member.plan else None,
                "plan_price": str(member.plan.price) if member.plan else None,
            },
            "gym": {
                "name": gym.name if gym else None,
                "phone": gym.business_phone_number if gym else None,
                "address": gym.address if gym else None,
            },
            "branding": _get_gym_branding(gym),
            "recent_renewals": [
                {
                    "id": r.id,
                    "new_start": r.new_start.isoformat(),
                    "new_end": r.new_end.isoformat(),
                    "amount": str(r.amount),
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in renewals
            ],
            "pending_payment": {
                "id": pending.id,
                "amount": str(pending.amount),
                "status": pending.status,
                "created_at": pending.created_at.isoformat() if pending.created_at else None,
            } if pending else None,
        },
    })


# ── Membership Detail ────────────────────────────────────────────────


@member_bp.route("/membership", methods=["GET"])
@member_token_required
def member_membership():
    """Return full membership details for the authenticated member."""
    member = g.current_member
    gym = member.gym
    gym_timezone = gym.timezone if gym else "Asia/Kolkata"
    today = today_for_gym(gym_timezone)

    days_left = (member.membership_end - today).days if member.membership_end else None
    is_expired = member.membership_end and member.membership_end < today

    # Renewal history
    renewals = (
        RenewalHistory.query.filter_by(member_id=member.id, gym_id=g.gym_id)
        .order_by(RenewalHistory.created_at.desc())
        .limit(20)
        .all()
    )

    return jsonify({
        "success": True,
        "data": {
            "membership": {
                "status": member.status,
                "plan_name": member.plan.name if member.plan else None,
                "plan_price": str(member.plan.price) if member.plan else None,
                "plan_duration_days": member.plan.duration_days if member.plan else None,
                "membership_start": member.membership_start.isoformat() if member.membership_start else None,
                "membership_end": member.membership_end.isoformat() if member.membership_end else None,
                "days_left": days_left,
                "is_expired": is_expired,
                "joined_on": member.joined_on.isoformat() if member.joined_on else None,
            },
            "gym": {
                "name": gym.name if gym else None,
                "phone": gym.business_phone_number if gym else None,
            },
            "renewal_history": [
                {
                    "id": r.id,
                    "plan_name": r.plan.name if r.plan else None,
                    "previous_end": r.previous_end.isoformat() if r.previous_end else None,
                    "new_start": r.new_start.isoformat(),
                    "new_end": r.new_end.isoformat(),
                    "amount": str(r.amount),
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in renewals
            ],
        },
    })


# ── Active Plans ──────────────────────────────────────────────────────


@member_bp.route("/plans", methods=["GET"])
@member_token_required
def member_plans():
    """Return active membership plans for the member's gym."""
    plans = (
        MembershipPlan.query.filter_by(gym_id=g.gym_id, is_active=True)
        .order_by(MembershipPlan.price.asc())
        .all()
    )

    return jsonify({
        "success": True,
        "data": {
            "plans": [
                {
                    "id": p.id,
                    "name": p.name,
                    "duration_days": p.duration_days,
                    "price": str(p.price),
                }
                for p in plans
            ],
        },
    })


# ── Payment Claim (Self-Service Renewal) ─────────────────────────────


@member_bp.route("/renew/claim", methods=["POST"])
@member_token_required
def claim_payment():
    """Member claims they have paid — creates a payment verification for the gym owner.

    This is the V1 renewal flow:
    1. Member chooses a plan
    2. Member pays the gym directly (UPI / bank transfer / etc.)
    3. Member taps "I've Paid" and optionally enters a reference ID
    4. A PAYMENT_CLAIMED (pending) record is created
    5. Gym owner verifies and confirms the renewal
    """
    member = g.current_member
    data = request.get_json(silent=True) or {}

    # Check for existing pending payment to prevent duplicates
    existing = PaymentVerification.query.filter_by(
        member_id=member.id, gym_id=g.gym_id, status="pending"
    ).first()
    if existing:
        return jsonify({
            "success": True,
            "message": "You already have a pending payment. The gym will confirm it soon.",
            "data": {"payment_id": existing.id, "already_pending": True},
        })

    # Plan selection
    plan_id = data.get("plan_id")
    plan = None
    if plan_id:
        plan = MembershipPlan.query.filter_by(
            id=plan_id, gym_id=g.gym_id, is_active=True
        ).first()
        if not plan:
            return jsonify({"success": False, "error": "Selected plan is not available."}), 400
    else:
        # Default to current plan
        plan = member.plan

    amount = plan.price if plan else Decimal("0")

    # Optional reference ID from member
    reference = (data.get("reference") or "").strip() or None
    notes_parts = [f"Self-service payment claim from {member.full_name}"]
    if plan:
        notes_parts.append(f"Plan: {plan.name}")
    if reference:
        notes_parts.append(f"Ref: {reference}")

    payment = PaymentVerification(
        gym_id=member.gym_id,
        member_id=member.id,
        amount=amount,
        method="member_claim",
        reference=reference,
        notes=" · ".join(notes_parts),
        status="pending",
        renewal_days=plan.duration_days if plan else 30,
    )
    db.session.add(payment)
    db.session.commit()

    # Notify gym owner
    try:
        from app.services.push_notification_service import notify_new_payment
        gym = member.gym
        if gym:
            notify_new_payment(gym, payment)
    except Exception:
        _logger.exception("Failed to send payment claim notification")

    return jsonify({
        "success": True,
        "message": "Payment submitted! The gym will verify your payment and renew your membership.",
        "data": {
            "payment_id": payment.id,
            "amount": str(payment.amount),
            "plan_name": plan.name if plan else None,
            "status": payment.status,
        },
    }), 201


# ── Legacy Renewal Request (backward compatibility) ──────────────────


@member_bp.route("/renew/request", methods=["POST"])
@member_token_required
def request_renewal():
    """Member requests a renewal — creates a payment claim for the gym owner to verify.

    This is the legacy endpoint. New clients should use /renew/claim instead.
    """
    member = g.current_member

    # Check if there's already a pending payment
    existing = PaymentVerification.query.filter_by(
        member_id=member.id, gym_id=g.gym_id, status="pending"
    ).first()
    if existing:
        return jsonify({
            "success": True,
            "message": "You already have a pending renewal request. The gym will confirm it soon.",
            "data": {"payment_id": existing.id},
        })

    plan = member.plan
    amount = plan.price if plan else 0

    payment = PaymentVerification(
        gym_id=member.gym_id,
        member_id=member.id,
        amount=amount,
        method="member_request",
        notes=f"Self-service renewal request from {member.full_name}",
        status="pending",
        renewal_days=plan.duration_days if plan else 30,
    )
    db.session.add(payment)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Renewal request submitted! The gym will verify your payment.",
        "data": {"payment_id": payment.id},
    }), 201


# ── Payment History ───────────────────────────────────────────────────


@member_bp.route("/payments", methods=["GET"])
@member_token_required
def member_payments():
    """Return authenticated member's payment history."""
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 20, type=int), 50)

    query = PaymentVerification.query.filter_by(
        member_id=g.member_id, gym_id=g.gym_id
    )
    total = query.count()
    payments = (
        query.order_by(PaymentVerification.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return jsonify({
        "success": True,
        "data": {
            "payments": [
                {
                    "id": p.id,
                    "amount": str(p.amount),
                    "status": p.status,
                    "method": p.method,
                    "reference": p.reference,
                    "notes": p.notes,
                    "paid_on": p.paid_on.isoformat() if p.paid_on else None,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "verified_at": p.verified_at.isoformat() if p.verified_at else None,
                }
                for p in payments
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": (total + per_page - 1) // per_page,
            },
        },
    })


# ── Access / Attendance History ───────────────────────────────────────


@member_bp.route("/access", methods=["GET"])
@member_token_required
def member_access():
    """Return authenticated member's access/attendance history."""
    member = g.current_member
    gym = member.gym
    gym_timezone = gym.timezone if gym else "Asia/Kolkata"

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 20, type=int), 50)

    query = AccessEvent.query.filter_by(
        member_id=g.member_id, gym_id=g.gym_id
    )
    total = query.count()
    events = (
        query.order_by(AccessEvent.event_timestamp.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    # Last visit
    last_entry = (
        AccessEvent.query.filter_by(
            member_id=g.member_id, gym_id=g.gym_id, event_type="ENTRY"
        )
        .order_by(AccessEvent.event_timestamp.desc())
        .first()
    )

    # Today's entries and exits
    from app.services.timezone_service import utc_start_of_gym_day
    today_start = utc_start_of_gym_day(gym_timezone)
    today_entries = AccessEvent.query.filter(
        AccessEvent.member_id == g.member_id,
        AccessEvent.gym_id == g.gym_id,
        AccessEvent.event_type == "ENTRY",
        AccessEvent.event_timestamp >= today_start,
    ).count()
    today_exits = AccessEvent.query.filter(
        AccessEvent.member_id == g.member_id,
        AccessEvent.gym_id == g.gym_id,
        AccessEvent.event_type == "EXIT",
        AccessEvent.event_timestamp >= today_start,
    ).count()

    # Current inside state
    from app.models.member_access_state import MemberAccessState
    access_state = MemberAccessState.query.filter_by(
        member_id=g.member_id, gym_id=g.gym_id
    ).first()

    return jsonify({
        "success": True,
        "data": {
            "summary": {
                "last_visit": last_entry.event_timestamp.isoformat() if last_entry else None,
                "today_entries": today_entries,
                "today_exits": today_exits,
                "is_inside": access_state.is_inside if access_state else False,
                "access_active": member.status == "active" and not member.is_expired,
            },
            "events": [
                {
                    "id": e.id,
                    "event_type": e.event_type,
                    "direction": e.direction,
                    "timestamp": e.event_timestamp.isoformat(),
                    "device_name": e.device_name,
                }
                for e in events
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": (total + per_page - 1) // per_page,
            },
        },
    })


# ── Profile ───────────────────────────────────────────────────────────


@member_bp.route("/profile", methods=["GET"])
@member_token_required
def member_profile():
    """Return authenticated member's profile information."""
    member = g.current_member
    gym = member.gym

    # Payment info for the gym
    qr_settings = QRSettings.query.filter_by(gym_id=g.gym_id).first() if gym else None

    return jsonify({
        "success": True,
        "data": {
            "member": {
                "id": member.id,
                "full_name": member.full_name,
                "phone": member.phone,
                "email": member.email,
                "joined_on": member.joined_on.isoformat() if member.joined_on else None,
                "status": member.status,
            },
            "gym": {
                "name": gym.name if gym else None,
                "phone": gym.business_phone_number if gym else None,
                "address": gym.address if gym else None,
            },
            "payment_info": {
                "upi_id": qr_settings.upi_id if qr_settings else None,
                "payment_label": qr_settings.payment_label if qr_settings else None,
                "instructions": qr_settings.instructions if qr_settings else None,
            } if qr_settings else None,
        },
    })


# ── Payment Info (for renewal flow) ──────────────────────────────────


@member_bp.route("/payment-info", methods=["GET"])
@member_token_required
def member_payment_info():
    """Return gym's payment details for the member to make a payment."""
    gym = g.current_member.gym
    qr_settings = QRSettings.query.filter_by(gym_id=g.gym_id).first() if gym else None

    return jsonify({
        "success": True,
        "data": {
            "gym_name": gym.name if gym else None,
            "gym_phone": gym.business_phone_number if gym else None,
            "upi_id": qr_settings.upi_id if qr_settings else None,
            "payment_label": qr_settings.payment_label if qr_settings else None,
            "instructions": qr_settings.instructions if qr_settings else None,
            "qr_public_url": qr_settings.qr_public_url if qr_settings else None,
        },
    })
