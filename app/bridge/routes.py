from __future__ import annotations

import hashlib
import hmac
import zoneinfo
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.models import BridgeAttendance, BridgeCommand, BridgeInstallation, Member
from app.models.bridge import hash_bridge_api_key
from app.models.mixins import utcnow
from app.services.audit_service import audit
from app.services.bridge_service import (
    acknowledge_command,
    canonical_enroll_number,
    lease_pending_commands,
    queue_membership_command,
    schedule_retry_after_failed_command,
)


bridge_bp = Blueprint("bridge", __name__, url_prefix="/api/bridge/v1")


def _json_error(status: int, code: str, message: str):
    return jsonify({"error": {"code": code, "message": message}}), status


def _payload_value(payload: dict, *names: str):
    for name in names:
        if name in payload:
            return payload[name]
    return None


def _require_json() -> dict | None:
    if not request.is_json:
        return None
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else None


def _parse_timestamp(value: object, gym_timezone: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("eventTime must be an ISO-8601 timestamp.")
    try:
        result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("eventTime must be an ISO-8601 timestamp.") from exc
    # The eSSL terminal reports its local wall-clock time. Older Windows bridge
    # builds serialize that DateTime without an offset, so interpret a naive
    # value in this gym's configured timezone rather than silently shifting it.
    if result.tzinfo is None:
        try:
            result = result.replace(tzinfo=zoneinfo.ZoneInfo(gym_timezone or "Asia/Kolkata"))
        except Exception:
            result = result.replace(tzinfo=zoneinfo.ZoneInfo("Asia/Kolkata"))
    return result.astimezone(timezone.utc)


def _authenticated_bridge() -> BridgeInstallation:
    installation = getattr(g, "bridge_installation", None)
    if installation is None:
        raise RuntimeError("Bridge authentication was not initialized.")
    return installation


def _bridge_rate_limit_key() -> str:
    installation = getattr(g, "bridge_installation", None)
    return f"bridge:{installation.id}" if installation is not None else request.remote_addr


def _ensure_bridge_id(payload: dict) -> tuple[BridgeInstallation | None, tuple | None]:
    installation = _authenticated_bridge()
    sent_id = _payload_value(payload, "gymId", "GymId")
    if not isinstance(sent_id, str) or not hmac.compare_digest(sent_id, installation.public_id):
        return None, _json_error(403, "bridge_id_mismatch", "gymId does not match this bridge.")
    return installation, None


@bridge_bp.before_request
def authenticate_bridge():
    raw_key = request.headers.get("X-Api-Key", "").strip()
    if not raw_key:
        return _json_error(401, "unauthorized", "Missing bridge API key.")

    key_hash = hash_bridge_api_key(raw_key)
    installation = BridgeInstallation.query.filter_by(api_key_hash=key_hash).first()
    if (
        installation is None
        or not hmac.compare_digest(installation.api_key_hash, key_hash)
        or not installation.is_active
    ):
        return _json_error(401, "unauthorized", "Invalid bridge API key.")
    protocol_version = request.headers.get("X-RenewalDesk-Bridge-Protocol", "").strip()
    if protocol_version != "2":
        return _json_error(
            426,
            "bridge_upgrade_required",
            "Install Renewal Desk Bridge protocol version 2 before connecting this gym.",
        )
    device_serial = request.headers.get("X-Device-Serial", "").strip()
    if not device_serial or not hmac.compare_digest(device_serial, installation.device_serial):
        return _json_error(
            403,
            "device_mismatch",
            "This bridge credential is not registered for the connected biometric terminal.",
        )
    g.bridge_installation = installation


@bridge_bp.errorhandler(404)
def bridge_not_found(_error):
    return _json_error(404, "not_found", "Bridge resource was not found.")


@bridge_bp.errorhandler(429)
def bridge_rate_limited(_error):
    return _json_error(429, "rate_limited", "Too many bridge requests.")


@bridge_bp.post("/heartbeat")
@limiter.limit("120 per minute", key_func=_bridge_rate_limit_key)
def heartbeat():
    payload = _require_json()
    if payload is None:
        return _json_error(415, "invalid_json", "Send a JSON request body.")
    installation, problem = _ensure_bridge_id(payload)
    if problem:
        return problem
    status = _payload_value(payload, "status", "Status")
    if not isinstance(status, str) or not status.strip():
        return _json_error(422, "invalid_status", "status is required.")
    installation.last_status = status.strip()[:32]
    installation.last_heartbeat_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True, "serverTime": utcnow().isoformat()})


@bridge_bp.post("/attendance")
@limiter.limit("300 per minute", key_func=_bridge_rate_limit_key)
def attendance():
    payload = _require_json()
    if payload is None:
        return _json_error(415, "invalid_json", "Send a JSON request body.")
    installation, problem = _ensure_bridge_id(payload)
    if problem:
        return problem
    try:
        enroll_number = canonical_enroll_number(
            _payload_value(payload, "deviceEnrollNumber", "DeviceEnrollNumber")
        )
        event_time = _parse_timestamp(
            _payload_value(payload, "eventTime", "EventTime"), installation.gym.timezone
        )
        verify_method = int(_payload_value(payload, "verifyMethod", "VerifyMethod"))
    except (TypeError, ValueError) as exc:
        return _json_error(422, "invalid_attendance", str(exc))

    raw_invalid = _payload_value(payload, "isInvalid", "IsInvalid")
    if not isinstance(raw_invalid, bool):
        return _json_error(422, "invalid_attendance", "isInvalid must be true or false.")

    event_id = _payload_value(payload, "eventId", "EventId")
    if not isinstance(event_id, str) or not event_id.strip():
        # Compatibility with the first bridge build.  The upgraded bridge
        # always persists and sends a UUID, which is preferred for retries.
        legacy = f"{enroll_number}|{event_time.isoformat()}|{verify_method}|{raw_invalid}"
        event_id = "legacy-" + hashlib.sha256(legacy.encode("utf-8")).hexdigest()
    event_id = event_id.strip()
    if len(event_id) > 128:
        return _json_error(422, "invalid_attendance", "eventId is too long.")

    member = Member.query.filter_by(
        gym_id=installation.gym_id, device_enroll_number=enroll_number
    ).first()
    existing = BridgeAttendance.query.filter_by(
        bridge_id=installation.id, event_id=event_id
    ).first()
    if existing is not None:
        return jsonify({"ok": True, "duplicate": True})

    db.session.add(
        BridgeAttendance(
            bridge_id=installation.id,
            gym_id=installation.gym_id,
            member_id=member.id if member else None,
            event_id=event_id,
            device_enroll_number=enroll_number,
            event_time=event_time,
            verify_method=verify_method,
            is_invalid=raw_invalid,
        )
    )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": True, "duplicate": True})
    return jsonify({"ok": True, "knownMember": member is not None}), 201


@bridge_bp.get("/commands/pending")
@limiter.limit("120 per minute", key_func=_bridge_rate_limit_key)
def pending_commands():
    installation = _authenticated_bridge()
    sent_id = request.args.get("gymId", "")
    if not hmac.compare_digest(sent_id, installation.public_id):
        return _json_error(403, "bridge_id_mismatch", "gymId does not match this bridge.")
    commands = lease_pending_commands(installation)
    db.session.commit()
    return jsonify(
        [
            {
                "id": command.id,
                "commandType": command.command_type,
                "enrollNumber": command.enroll_number,
                "memberName": command.member_name,
                "delaySeconds": command.delay_seconds,
                "leaseToken": command.lease_token,
            }
            for command in commands
        ]
    )


@bridge_bp.post("/commands/<string:command_id>/ack")
@limiter.limit("120 per minute", key_func=_bridge_rate_limit_key)
def command_ack(command_id: str):
    payload = _require_json()
    if payload is None:
        return _json_error(415, "invalid_json", "Send a JSON request body.")
    installation = _authenticated_bridge()
    command = db.session.execute(
        select(BridgeCommand)
        .where(BridgeCommand.id == command_id, BridgeCommand.bridge_id == installation.id)
        .with_for_update()
    ).scalar_one_or_none()
    if command is None:
        return _json_error(404, "not_found", "Command was not found.")

    status = _payload_value(payload, "status", "Status")
    lease_token = _payload_value(payload, "leaseToken", "LeaseToken")
    error_message = _payload_value(payload, "errorMessage", "ErrorMessage")
    if not isinstance(status, str) or not isinstance(lease_token, str):
        return _json_error(422, "invalid_ack", "status and leaseToken are required.")
    if error_message is not None and not isinstance(error_message, str):
        return _json_error(422, "invalid_ack", "errorMessage must be text when supplied.")

    accepted, error_code = acknowledge_command(
        command,
        status=status,
        lease_token=lease_token,
        error_message=error_message,
    )
    if not accepted:
        return _json_error(409, error_code or "ack_conflict", "Command ACK was not accepted.")
    retry = schedule_retry_after_failed_command(command) if status == "failed" else None
    db.session.commit()
    return jsonify({"ok": True, "retryScheduled": retry is not None})


@bridge_bp.post("/enrollment/confirm")
@limiter.limit("60 per minute", key_func=_bridge_rate_limit_key)
def confirm_enrollment():
    payload = _require_json()
    if payload is None:
        return _json_error(415, "invalid_json", "Send a JSON request body.")
    installation, problem = _ensure_bridge_id(payload)
    if problem:
        return problem
    raw_member_id = _payload_value(payload, "memberId", "MemberId")
    terminal_user_name = _payload_value(payload, "terminalUserName", "TerminalUserName")
    try:
        member_id = int(raw_member_id)
        enroll_number = canonical_enroll_number(
            _payload_value(payload, "deviceEnrollNumber", "DeviceEnrollNumber")
        )
    except (TypeError, ValueError) as exc:
        return _json_error(422, "invalid_enrollment", str(exc))
    if terminal_user_name is not None and not isinstance(terminal_user_name, str):
        return _json_error(422, "invalid_enrollment", "terminalUserName must be text when supplied.")
    member = db.session.execute(
        select(Member)
        .where(Member.id == member_id, Member.gym_id == installation.gym_id)
        .with_for_update()
    ).scalar_one_or_none()
    if member is None or member.deleted_at is not None:
        return _json_error(404, "member_not_found", "Member was not found for this bridge.")
    if member.device_enroll_number and member.device_enroll_number != enroll_number:
        return _json_error(
            409,
            "enroll_number_change_requires_review",
            "This member already has a biometric Enroll Number. Disable the old terminal user "
            "before assigning a replacement.",
        )
    duplicate = db.session.execute(
        select(Member)
        .where(
            Member.gym_id == installation.gym_id,
            Member.device_enroll_number == enroll_number,
            Member.id != member.id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if duplicate is not None:
        return _json_error(
            409,
            "enroll_number_in_use",
            "That biometric Enroll Number belongs to another member.",
        )

    member.device_enroll_number = enroll_number
    command = queue_membership_command(member)
    audit(
        action="bridge_enrollment_confirmed",
        resource_type="member",
        resource_id=member.id,
        gym_id=installation.gym_id,
        metadata={
            "bridge_id": installation.public_id,
            "enroll_number": enroll_number,
            "terminal_user_name": (terminal_user_name or "").strip()[:160],
        },
    )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return _json_error(
            409,
            "enroll_number_in_use",
            "That biometric Enroll Number was assigned by another request.",
        )
    return jsonify(
        {
            "ok": True,
            "memberId": member.id,
            "deviceEnrollNumber": enroll_number,
            "commandQueued": command is not None,
        }
    )
