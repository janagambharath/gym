from __future__ import annotations

import hashlib
import hmac
import zoneinfo
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.models import (
    BridgeAttendance,
    BridgeCommand,
    BridgeInstallation,
    BridgeRelease,
    GymDeployment,
    Member,
)
from app.models.bridge import (
    generate_bridge_api_key,
    generate_bridge_public_id,
    hash_bridge_api_key,
)
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
bridge_v2_bp = Blueprint("bridge_v2", __name__, url_prefix="/api/bridge/v2")



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
    
    clean_status = status.strip()[:32]
    installation.last_status = clean_status
    installation.status = "online" if clean_status.lower() in ("online", "ok", "healthy") else clean_status.lower()
    installation.last_heartbeat_at = utcnow()

    # Capture optional client telemetry (V2 clients)
    version = _payload_value(payload, "version", "bridgeVersion", "installed_version")
    if version and isinstance(version, str):
        installation.installed_version = version.strip()[:32]
    build = _payload_value(payload, "buildNumber", "build_number", "build")
    if build and str(build).isdigit():
        installation.installed_build = int(build)
    os_info = _payload_value(payload, "osInfo", "os_info", "os")
    if os_info and isinstance(os_info, str):
        installation.os_info = os_info.strip()[:120]
    pc_name = _payload_value(payload, "pcName", "pc_name")
    if pc_name and isinstance(pc_name, str):
        installation.pc_name = pc_name.strip()[:120]

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


# ─── Bridge V2 Pairing Endpoint ──────────────────────────────────────────────

@bridge_v2_bp.post("/pair")
@limiter.limit("20 per minute")
def pair_bridge():
    """Exchange a 6-digit one-time pairing code for permanent bridge credentials."""
    payload = _require_json()
    if payload is None:
        return _json_error(415, "invalid_json", "Send a JSON request body.")

    pairing_code = str(_payload_value(payload, "pairingCode", "pairing_code", "code") or "").strip()
    device_serial = str(_payload_value(payload, "deviceSerial", "device_serial", "serial") or "").strip()
    version = str(_payload_value(payload, "version", "bridgeVersion", "installed_version") or "2.0.0").strip()
    build_num = _payload_value(payload, "buildNumber", "build_number", "build")
    os_info = str(_payload_value(payload, "osInfo", "os_info", "os") or "").strip()
    pc_name = str(_payload_value(payload, "pcName", "pc_name") or "").strip()

    if not pairing_code or len(pairing_code) < 6:
        return _json_error(422, "invalid_pairing_code", "A 6-digit pairing code is required.")
    if not device_serial:
        return _json_error(422, "invalid_device_serial", "Biometric device serial is required.")

    # Find deployment with active pairing code
    dep = GymDeployment.query.filter_by(pairing_code=pairing_code).first()
    if not dep or not dep.pairing_code_expires_at:
        return _json_error(401, "pairing_code_invalid", "Invalid or expired pairing code.")

    expires_at = dep.pairing_code_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < utcnow():
        return _json_error(401, "pairing_code_expired", "Pairing code has expired. Generate a new code from admin dashboard.")

    gym = dep.gym
    if not gym or gym.status != "active":
        return _json_error(403, "gym_inactive", "Gym is not active for bridge pairing.")

    # Check if another gym has this device serial bound
    existing_serial = BridgeInstallation.query.filter(
        BridgeInstallation.device_serial == device_serial,
        BridgeInstallation.gym_id != gym.id,
        BridgeInstallation.is_active == True,
    ).first()
    if existing_serial:
        return _json_error(409, "device_already_bound", "This biometric terminal is already registered to another active gym.")

    # Create or update BridgeInstallation for this gym
    installation = BridgeInstallation.query.filter_by(gym_id=gym.id).first()
    raw_api_key = generate_bridge_api_key()
    api_key_hash = hash_bridge_api_key(raw_api_key)

    if installation is None:
        installation = BridgeInstallation(
            gym_id=gym.id,
            public_id=generate_bridge_public_id(),
            api_key_hash=api_key_hash,
            device_serial=device_serial,
            display_name=f"{gym.name} Biometric Bridge",
            installed_version=version[:32] if version else "2.0.0",
            installed_build=int(build_num) if build_num and str(build_num).isdigit() else None,
            os_info=os_info[:120] if os_info else None,
            pc_name=pc_name[:120] if pc_name else None,
            first_paired_at=utcnow(),
            last_heartbeat_at=utcnow(),
            status="paired",
            is_active=True,
        )
        db.session.add(installation)
    else:
        # Re-pairing / Updating existing installation
        installation.api_key_hash = api_key_hash
        installation.device_serial = device_serial
        installation.installed_version = version[:32] if version else "2.0.0"
        if build_num and str(build_num).isdigit():
            installation.installed_build = int(build_num)
        if os_info:
            installation.os_info = os_info[:120]
        if pc_name:
            installation.pc_name = pc_name[:120]
        if not installation.first_paired_at:
            installation.first_paired_at = utcnow()
        installation.last_heartbeat_at = utcnow()
        installation.status = "paired"
        installation.is_active = True

    # Associate with latest release if matched
    matched_release = BridgeRelease.query.filter_by(version=version).first()
    if matched_release:
        installation.release_id = matched_release.id
        installation.release_channel = matched_release.release_channel

    # Burn / invalidate pairing code
    dep.pairing_code = None
    dep.pairing_code_expires_at = None
    if "bridge_connected" in dep.checklist_json:
        dep.checklist_json["bridge_connected"]["status"] = "passed"
        dep.checklist_json["bridge_connected"]["details"] = f"Paired {device_serial} (v{version})"

    dep.add_timeline_event(
        event=f"Biometric Bridge V2 Paired ({device_serial})",
        actor=pc_name or "Bridge Client",
        details=f"Version: {version}, OS: {os_info}, ID: {installation.public_id}",
    )


    audit(
        action="bridge_v2_paired",
        resource_type="bridge",
        resource_id=installation.id,
        gym_id=gym.id,
        metadata={"device_serial": device_serial, "version": version},
    )
    db.session.commit()


    return jsonify({
        "ok": True,
        "gymId": installation.public_id,
        "gymName": gym.name,
        "apiKey": raw_api_key,
        "deviceSerial": device_serial,
        "protocolVersion": 2,
        "pollIntervalSeconds": 5,
        "serverTime": utcnow().isoformat(),
    }), 201

