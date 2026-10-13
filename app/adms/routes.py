"""Minimal, tenant-bound receiver for eSSL ADMS/iClock attendance pushes.

The public ADMS wire protocol is terminal-firmware specific.  This receiver
handles the safe subset common to eSSL/ZK-style terminals: registration,
configuration polling, ATTLOG upload, and an owner-triggered commissioning
queue.  The queue uses the documented PUSH SDK command envelope and records
the terminal acknowledgement.  It is deliberately limited to a test identity;
automatic access control is not enabled by this receiver.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import unquote_plus

from flask import Blueprint, Response, current_app, request

from app.extensions import db, limiter
from app.models.gym import Gym
from app.models.mixins import utcnow
from app.models.rrr import RRRAdmsCommand, RRRDevice, RRRIntegration
from app.services.rrr_service import normalize_attendance


adms_bp = Blueprint("adms", __name__)


def _plain(text: str = "OK", status: int = 200) -> Response:
    return Response(text, status=status, mimetype="text/plain")


def _serial() -> str:
    # Most iClock terminals use SN; accept common firmware spelling only.
    return str(request.args.get("SN") or request.values.get("SN") or "").strip()[:120]


def _device(path_token: str | None = None) -> RRRIntegration | None:
    # Token-only (2026-10-13): the per-integration path secret is unguessable,
    # so a token-path request authenticates the integration directly.
    # Serial fallback (2026-10-13): eSSL X2008 firmware cannot send a custom
    # path — it always posts to /iclock/cdata. For terminals whose serial
    # exactly matches a registered integration, allow serial-based matching.
    # This is safe because the serial must match an existing registration;
    # unknown serials still get the indistinguishable "OK".
    if not path_token:
        serial = _serial()
        if not serial:
            return None
        row = RRRIntegration.query.filter_by(
            connector_type="adms_direct", device_serial=serial
        ).first()
        return row
    row = RRRIntegration.query.filter_by(
        connector_type="adms_direct", adms_path_token=path_token
    ).first()
    if row is None:
        return None
    serial = _serial()
    if serial and row.device_serial and serial != row.device_serial:
        return None
    return row


def _unknown() -> Response:
    # Deliberately indistinguishable from a healthy empty response: the
    # previous 404 "Unknown device" let anyone enumerate registered serials.
    return _plain("OK")


def _touch(integration: RRRIntegration) -> None:
    integration.status = "connected"
    integration.last_success_at = utcnow()
    integration.last_error = None
    device = RRRDevice.query.filter_by(
        gym_id=integration.gym_id, serial_number=integration.device_serial
    ).first()
    if device is None:
        device = RRRDevice(
            gym_id=integration.gym_id,
            integration_id=integration.id,
            serial_number=integration.device_serial,
            device_name=integration.device_name or "eSSL ADMS terminal",
            is_selected=True,
        )
        db.session.add(device)
    device.integration_id = integration.id
    device.device_name = integration.device_name or device.device_name
    device.status = "online"
    device.last_seen_at = utcnow()
    device.is_selected = True


def _parse_device_time(value: str, gym_timezone: str) -> datetime | None:
    value = value.strip()
    for format_string in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            local = datetime.strptime(value, format_string)
            try:
                from zoneinfo import ZoneInfo
                return local.replace(tzinfo=ZoneInfo(gym_timezone or "Asia/Kolkata")).astimezone(timezone.utc)
            except Exception:
                return local.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def _attlog_lines() -> list[str]:
    # Firmware varies: data may be raw body or an application/x-www-form-urlencoded
    # value named data. Limit the request body before splitting to bound memory use.
    raw = request.get_data(cache=True, as_text=True)[:262144]
    form_data = request.form.get("data")
    if form_data:
        raw = form_data[:262144]
    elif raw.startswith("data="):
        raw = unquote_plus(raw[5:])
    return [line.strip("\r") for line in raw.splitlines() if line.strip()]


def _parse_userinfo_line(line: str) -> dict | None:
    """Parse one USERINFO line from a terminal table upload.

    Format: ``USER PIN=12345\\tName=Alice Smith\\tPri=0\\tPasswd=\\tCard=0...``
    Fields are TAB-separated; values (like names) may contain spaces, so we
    must split on tabs, never on whitespace.
    Returns {"enroll_number": ..., "name": ...} or None.
    """
    line = line.strip()
    if not line.upper().startswith("USER "):
        return None
    fields: dict[str, str] = {}
    for part in line[5:].split("\t"):
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            fields[key.strip().upper()] = value.strip()
    pin = fields.get("PIN", "").strip()
    if not pin:
        return None
    return {"enroll_number": pin, "name": fields.get("NAME", "").strip()}


def _ingest_userinfo(integration: RRRIntegration) -> int:
    """Store a USERINFO table upload as the latest sync_users snapshot.

    The terminal uploads its user list in response to our ``DATA QUERY
    USERINFO`` command.  We attach the parsed list to the most recent
    sync_users command so smart enroll matching can use it.
    """
    import json
    import logging

    log = logging.getLogger(__name__)
    raw_lines = _attlog_lines()
    # TEMPORARY DEBUG: log raw upload format to reverse-engineer fingerprint
    # template encoding. Remove after backup/restore is implemented.
    for i, line in enumerate(raw_lines[:5]):
        # Log first 200 chars of first 5 lines to see format without flooding
        log.warning("USERINFO_RAW line %d: %s", i, line[:200])
    log.warning("USERINFO_RAW total lines: %d", len(raw_lines))

    users = []
    for line in raw_lines:
        parsed = _parse_userinfo_line(line)
        if parsed:
            users.append(parsed)
    if not users:
        return 0
    cmd = (
        RRRAdmsCommand.query.filter_by(integration_id=integration.id, action="sync_users")
        .order_by(RRRAdmsCommand.id.desc())
        .first()
    )
    if cmd is None:
        return 0
    # Cap at ~256KB (a 3k-user terminal is ~150KB JSON).
    cmd.result_data = json.dumps({"users": users, "count": len(users)})[:262144]
    cmd.status = "acked"
    cmd.acknowledged_at = utcnow()
    return len(users)


def _ingest_attlog(integration: RRRIntegration) -> int:
    created = 0
    gym = db.session.get(Gym, integration.gym_id)
    gym_timezone = gym.timezone if gym is not None else "Asia/Kolkata"
    for line in _attlog_lines():
        cells = line.split("\t")
        # Standard ATTLOG: PIN, timestamp, status, verification, workcode...
        if len(cells) < 2:
            continue
        person_id = cells[0].strip()[:120]
        punch_time = _parse_device_time(cells[1], gym_timezone)
        if not person_id or punch_time is None:
            continue
        direction = cells[2].strip()[:16] if len(cells) > 2 else None
        verify = cells[3].strip()[:32] if len(cells) > 3 else None
        event, was_created = normalize_attendance(
            gym_id=integration.gym_id,
            integration_id=integration.id,
            source="adms_direct",
            device_serial=integration.device_serial,
            biometric_user_id=person_id,
            punch_time=punch_time,
            external_event_id=None,
            direction=direction or None,
            verify_method=verify or None,
            raw_payload=line,
        )
        if was_created:
            created += 1
            integration.records_synced += 1
            if event.processing_status == "unmapped":
                integration.unmapped_records += 1
    return created


@adms_bp.before_request
def direct_adms_enabled():
    if not current_app.config.get("DIRECT_ADMS_ENABLED", False):
        return _plain("Not Found", 404)


@adms_bp.route("/iclock/cdata", methods=["GET", "POST"])
@adms_bp.route("/iclock/cdata.aspx", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/cdata", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/cdata.aspx", methods=["GET", "POST"])
@limiter.limit("180 per minute")
def cdata(path_token: str | None = None):
    integration = _device(path_token)
    if integration is None:
        return _unknown()
    _touch(integration)
    table = str(request.args.get("table") or request.form.get("table") or "").upper()
    if request.method == "POST" and table == "ATTLOG":
        _ingest_attlog(integration)
    elif request.method == "POST" and table in {"USERINFO", "USER"}:
        _ingest_userinfo(integration)
    db.session.commit()
    # Common ADMS clients expect a plain acknowledgement after a push and an
    # option payload on their initial GET.  Never put secrets in this response.
    if request.method == "GET":
        return _plain("~SerialNumber={0}\n~DeviceName=RRR\n".format(integration.device_serial))
    return _plain("OK")


@adms_bp.route("/iclock/registry", methods=["GET", "POST"])
@adms_bp.route("/iclock/registry.aspx", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/registry", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/registry.aspx", methods=["GET", "POST"])
@limiter.limit("60 per minute")
def registry(path_token: str | None = None):
    integration = _device(path_token)
    if integration is None:
        return _unknown()
    _touch(integration)
    db.session.commit()
    return _plain("OK")


@adms_bp.get("/iclock/getrequest")
@adms_bp.get("/iclock/getrequest.aspx")
@adms_bp.get("/iclock/<path_token>/getrequest")
@adms_bp.get("/iclock/<path_token>/getrequest.aspx")
@limiter.limit("180 per minute")
def getrequest(path_token: str | None = None):
    integration = _device(path_token)
    if integration is None:
        return _unknown()
    _touch(integration)
    # Re-send a delivered command until the terminal posts its result.  DATA
    # UPDATE is idempotent and this prevents a short mobile/Wi-Fi outage from
    # silently dropping a physical-access request.
    command = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, status="delivered"
    ).order_by(RRRAdmsCommand.id.asc()).first()
    if command is None:
        command = RRRAdmsCommand.query.filter_by(
            integration_id=integration.id, status="queued"
        ).order_by(RRRAdmsCommand.id.asc()).first()
        if command is None:
            db.session.commit()
            return _plain("OK")
        command.status = "delivered"
        command.delivered_at = utcnow()
    db.session.commit()
    # PUSH SDK command IDs must be simple positive integers. The database ID
    # is monotonic and is retained as the audit correlation ID.
    return _plain(f"C:{command.id}:{command.command_text}\n")


@adms_bp.route("/iclock/devicecmd", methods=["GET", "POST"])
@adms_bp.route("/iclock/devicecmd.aspx", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/devicecmd", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/devicecmd.aspx", methods=["GET", "POST"])
@limiter.limit("180 per minute")
def devicecmd(path_token: str | None = None):
    """Record the terminal's execution result for a queued test command."""
    integration = _device(path_token)
    if integration is None:
        return _unknown()
    _touch(integration)
    raw_id = str(request.args.get("ID") or request.form.get("ID") or "").strip()
    try:
        command_id = int(raw_id)
    except (TypeError, ValueError):
        db.session.commit()
        return _plain("OK")
    command = RRRAdmsCommand.query.filter_by(
        id=command_id, integration_id=integration.id
    ).first()
    if command is None:
        db.session.commit()
        return _plain("OK")
    result = str(request.args.get("Return") or request.form.get("Return") or "").strip()[:32]
    detail = str(
        request.args.get("Content") or request.form.get("Content") or request.args.get("CMD") or request.form.get("CMD") or ""
    ).strip()[:500]
    command.result_code = result or None
    command.result_message = detail or None
    command.acknowledged_at = utcnow()
    command.status = "acked" if result == "0" else "failed"
    db.session.commit()
    return _plain("OK")
