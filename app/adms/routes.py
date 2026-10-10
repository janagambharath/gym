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
    # Token-first: the per-integration path secret is unguessable, so a
    # token-path request authenticates the integration directly.
    if path_token:
        row = RRRIntegration.query.filter_by(
            connector_type="adms_direct", adms_path_token=path_token
        ).first()
        if row is None:
            return None
        serial = _serial()
        if serial and row.device_serial and serial != row.device_serial:
            return None
        return row
    serial = _serial()
    if not serial:
        return None
    return RRRIntegration.query.filter_by(
        connector_type="adms_direct", device_serial=serial
    ).first()


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
