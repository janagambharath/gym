"""Member-facing authentication and API endpoints.

Provides:
- OTP-based login via WhatsApp (no app download required for reminders)
- HMAC-signed stateless OTP challenge verification across multi-worker deployments
- JWT access tokens (role="member") with cryptographic verification
- Member dashboard (membership status, next expiry, attendance)
- Payment history
- Self-service renewal request
"""
from __future__ import annotations

from functools import wraps
import hashlib
import hmac
import logging
import random
import string
import time
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, g, jsonify, request

from app.extensions import db
from app.mobile_api.token_service import create_access_token, decode_access_token
from app.models import Gym, Member, PaymentVerification, RenewalHistory
from app.services.timezone_service import today_for_gym

_logger = logging.getLogger(__name__)

member_bp = Blueprint("member_api", __name__, url_prefix="/api/member/v1")

# In-memory OTP store kept as fallback
_otp_store: dict[str, dict] = {}


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


@member_bp.route("/auth/request-otp", methods=["POST"])
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
        return jsonify({"success": False, "error": "No membership found for this number."}), 404

    otp = _generate_otp()
    expires_at_ts = int(time.time()) + 600  # 10 minutes
    challenge = _sign_otp_challenge(phone, member.id, member.gym_id, otp, expires_at_ts)

    # In-memory store fallback for older clients
    _otp_store[phone] = {
        "otp": otp,
        "member_id": member.id,
        "gym_id": member.gym_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    }

    # Send OTP via WhatsApp
    try:
        gym = db.session.get(Gym, member.gym_id)
        if gym and gym.whatsapp_enabled:
            from app.services.whatsapp_service import WhatsAppService
            from app.utils.helpers import phone_to_whatsapp

            wa = WhatsAppService(gym)
            wa_phone = phone_to_whatsapp(member.phone)
            if wa_phone:
                wa.send_text(
                    to=wa_phone,
                    body=f"Your Renewal Desk verification code is: {otp}\n\nValid for 10 minutes.",
                )
    except Exception:
        _logger.exception("Failed to send OTP via WhatsApp for phone %s", phone[-4:])

    return jsonify({
        "success": True,
        "message": "OTP sent to your WhatsApp number.",
        "challenge": challenge,
        "gym_name": member.gym.name if member.gym else None,
    })


@member_bp.route("/auth/verify-otp", methods=["POST"])
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

    # Verify challenge if supplied
    if challenge:
        verified = _verify_otp_challenge(phone, otp, challenge)
        if verified:
            member_id, gym_id = verified

    # Fallback to in-memory store
    if member_id is None:
        stored = _otp_store.get(phone)
        if stored:
            if datetime.now(timezone.utc) <= stored["expires_at"] and stored["otp"] == otp:
                member_id = stored["member_id"]
                gym_id = stored["gym_id"]
                del _otp_store[phone]

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


# ── Member Dashboard ──────────────────────────────────────────────────


@member_bp.route("/dashboard", methods=["GET"])
@member_token_required
def member_dashboard():
    """Return authenticated member's membership status, attendance, and payment summary."""
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
            },
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


# ── Payment History ───────────────────────────────────────────────────


@member_bp.route("/payments", methods=["GET"])
@member_token_required
def member_payments():
    """Return authenticated member's payment history."""
    payments = (
        PaymentVerification.query.filter_by(member_id=g.member_id, gym_id=g.gym_id)
        .order_by(PaymentVerification.created_at.desc())
        .limit(20)
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
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "verified_at": p.verified_at.isoformat() if p.verified_at else None,
                }
                for p in payments
            ],
        },
    })


# ── Renewal Request ──────────────────────────────────────────────────


@member_bp.route("/renew/request", methods=["POST"])
@member_token_required
def request_renewal():
    """Member requests a renewal — creates a payment claim for the gym owner to verify."""
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
    )
    db.session.add(payment)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Renewal request submitted! The gym will verify your payment.",
        "data": {"payment_id": payment.id},
    }), 201
