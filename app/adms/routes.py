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


def _parse_adms_fields(line: str) -> dict[str, str]:
    """Parse known ADMS fields separated by tabs or spaces, preserving names."""
    import re

    field_re = re.compile(
        r"(?:^|[\\t ]+)(PIN|NAME|PRI|PASSWD|CARD|GRP|TZ|VERIFY|FID|FINGERID|SIZE|VALID|TMP|TEMPLATE)\\s*=",
        re.IGNORECASE,
    )
    matches = list(field_re.finditer(line.strip()))
    fields: dict[str, str] = {}
    for index, match in enumerate(matches):
        value_start = match.end()
        value_end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        fields[match.group(1).upper()] = line[value_start:value_end].strip(" \\t")
    return fields


def _parse_userinfo_line(line: str) -> dict | None:
    """Parse a USERINFO/USER row while preserving spaces in the user's name."""
    line = line.strip()
    if line.upper().startswith("USER "):
        line = line[5:]
    elif not line.upper().startswith("PIN="):
        return None
    fields = _parse_adms_fields(line)
    pin = fields.get("PIN", "").strip()
    if not pin:
        return None
    return {"enroll_number": pin, "name": fields.get("NAME", "").strip()}


def _parse_operlog_enrollment(line: str) -> dict | None:
    """Parse a user enrollment record from OPERLOG (tab or space-delimited)."""
    line = line.strip()
    upper = line.upper()
    if not all(field in upper for field in ("PIN=", "NAME=", "PRI=")):
        return None
    fields = _parse_adms_fields(line)
    pin = fields.get("PIN", "").strip()
    name = fields.get("NAME", "").strip()
    if not pin or not name:
        return None
    return {"enroll_number": pin, "name": name}


def _ingest_operlog(integration) -> int:
    """Parse OPERLOG uploads for user enrollment records.

    The X2008 never uploads USERINFO via query, but it DOES push OPERLOG
    on every enrollment -- and those records include PIN + Name. This gives
    automatic name capture for all future enrollments with zero terminal
    interaction.

    For each enrollment found, upserts the terminal name snapshot and
    triggers high-confidence auto-link against members.
    Returns the number of enrollment records found.
    """
    import logging
    log = logging.getLogger(__name__)
    lines = _attlog_lines()
    found = 0
    for line in lines:
        parsed = _parse_operlog_enrollment(line)
        if not parsed:
            continue
        found += 1
        enroll_number = parsed["enroll_number"]
        name = parsed["name"]
        try:
            from app.services.enroll_match_service import upsert_terminal_snapshot
            upsert_terminal_snapshot(
                integration.gym_id, enroll_number, name, source="operlog",
            )
        except Exception as e:
            log.warning(
                "OPERLOG snapshot upsert failed (integration_id=%s, error_type=%s)",
                integration.id, type(e).__name__,
            )
    if found:
        # Enrollment uploads can contain names and PINs; log only aggregate counts.
        log.info(
            "ADMS OPERLOG enrollment records processed (integration_id=%s, count=%s)",
            integration.id, found,
        )
        try:
            from app.services.enroll_match_service import auto_link_high_confidence
            # M4: the terminal just enrolled these users, so for active
            # members the terminal already holds the correct state — skip
            # the redundant UPDATE. Only queue when the desired state
            # differs (e.g. expired member -> block).
            auto_link_high_confidence(gym_id=integration.gym_id, skip_command_for_active=True)
        except Exception as e:
            log.warning("OPERLOG auto-link failed: %s", e)
    return found


def _ingest_userinfo(integration: RRRIntegration) -> int:
    """Store a USERINFO table upload as the latest sync_users snapshot.

    The terminal uploads its user list in response to our ``DATA QUERY
    USERINFO`` command.  We attach the parsed list to the most recent
    sync_users command so smart enroll matching can use it.
    Also captures fingerprint templates for backup/restore.
    """
    import json
    import logging

    from app.models.rrr import RRRBiometricTemplate

    log = logging.getLogger(__name__)
    raw_lines = _attlog_lines()
    # Do not log uploaded lines: USERINFO may contain member PII or biometric
    # templates. Keep diagnostics to counts and internal IDs only.
    log.info(
        "ADMS USERINFO upload received (integration_id=%s, line_count=%s)",
        integration.id, len(raw_lines),
    )

    users = []
    templates_captured = 0
    for line in raw_lines:
        parsed = _parse_userinfo_line(line)
        if parsed:
            users.append(parsed)
        # Look for fingerprint template data in the upload.
        # Format TBD from logs; this is a placeholder for common patterns.
        upper_line = line.upper()
        if "TMP=" in upper_line or "FINGERTMP" in upper_line:
            # Parse template: try to extract PIN, FID, and template data
            try:
                fields = {}
                # Handle both USERINFO-embedded and standalone template lines
                content = line.strip()
                if content.upper().startswith("USER "):
                    content = content[5:]
                for part in content.split("\t"):
                    if "=" in part:
                        k, _, v = part.partition("=")
                        fields[k.strip().upper()] = v.strip()
                pin = fields.get("PIN", "")
                fid = int(fields.get("FID", fields.get("FINGERID", "0")) or "0")
                tmp = fields.get("TMP", fields.get("TEMPLATE", ""))
                if pin and tmp:
                    # Upsert the template
                    existing = RRRBiometricTemplate.query.filter_by(
                        gym_id=integration.gym_id,
                        integration_id=integration.id,
                        enroll_number=pin,
                        finger_id=fid,
                    ).first()
                    if existing:
                        existing.template_data = tmp
                        existing.template_format = "push_tmp"
                    else:
                        db.session.add(RRRBiometricTemplate(
                            gym_id=integration.gym_id,
                            integration_id=integration.id,
                            enroll_number=pin,
                            finger_id=fid,
                            template_data=tmp,
                            template_format="push_tmp",
                        ))
                    templates_captured += 1
            except Exception as e:
                log.warning(
                    "Template parse failed (integration_id=%s, error_type=%s)",
                    integration.id, type(e).__name__,
                )
    if templates_captured:
        log.warning("Captured %d fingerprint templates", templates_captured)
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
    elif request.method == "POST" and table == "OPERLOG":
        _ingest_operlog(integration)
    db.session.commit()
    # Common ADMS clients expect a plain acknowledgement after a push and an
    # option payload on their initial GET.  Never put secrets in this response.
    if request.method == "GET":
        # ZAM180_TFT/X2008 PUSH handshake: respond with the plain-text
        # GET OPTION FROM block, not a tilde-prefixed status payload.
        gym = db.session.get(Gym, integration.gym_id)
        timezone_name = getattr(gym, "timezone", None) or "Asia/Kolkata"
        try:
            from zoneinfo import ZoneInfo
            offset = datetime.now(ZoneInfo(timezone_name)).utcoffset()
            timezone_hours = f"{offset.total_seconds() / 3600:g}" if offset else "5.5"
        except Exception:
            timezone_hours = "5.5"

        options = [
            f"GET OPTION FROM: {integration.device_serial or _serial()}",
            "ATTLOGStamp=None",
            "OPERLOGStamp=9999",
            "ATTPHOTOStamp=None",
            "ErrorDelay=30",
            "Delay=10",
            "TransTimes=00:00;14:05",
            "TransInterval=1",
            "TransFlag=TransData AttLog OpLog EnrollUser",
            f"TimeZone={timezone_hours}",
            "Realtime=1",
            "Encrypt=None",
            "ServerVer=2.2.14",
            "TableNameStamp=None",
        ]
        return _plain("\\n".join(options) + "\\n")
    return _plain("OK")


@adms_bp.route("/iclock/ping", methods=["GET", "POST"])
@adms_bp.route("/iclock/ping.aspx", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/ping", methods=["GET", "POST"])
@adms_bp.route("/iclock/<path_token>/ping.aspx", methods=["GET", "POST"])
@limiter.limit("180 per minute")
def ping(path_token: str | None = None):
    """Compatibility heartbeat endpoint used by some PUSH firmware variants."""
    integration = _device(path_token)
    if integration is None:
        return _unknown()
    _touch(integration)
    db.session.commit()
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
    # Timeout stuck delivered commands: if a command was delivered >10 min ago
    # without ack, the terminal likely missed it. Mark failed so the queue moves on.
    from datetime import timedelta
    from app.models.mixins import utcnow
    stuck_cutoff = utcnow() - timedelta(minutes=10)
    stuck = RRRAdmsCommand.query.filter(
        RRRAdmsCommand.integration_id == integration.id,
        RRRAdmsCommand.status == "delivered",
        RRRAdmsCommand.delivered_at < stuck_cutoff,
    ).all()
    for s in stuck:
        s.status = "failed"
        s.result_message = "Timeout: no ack within 10 min"
    if stuck:
        db.session.commit()
    # Re-send a delivered command until the terminal posts its result.  DATA
    # UPDATE is idempotent and this prevents a short mobile/Wi-Fi outage from
    # silently dropping a physical-access request.
    from app.services.bridge_service import (
        ADMS_DISABLE_ACTIONS,
        cancel_adms_command,
        disable_must_be_cancelled,
        resolve_adms_member,
    )

    delivered = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, status="delivered"
    ).order_by(RRRAdmsCommand.id.asc()).all()
    queued = RRRAdmsCommand.query.filter_by(
        integration_id=integration.id, status="queued"
    ).order_by(RRRAdmsCommand.id.asc()).all()

    command = None
    for candidate in [*delivered, *queued]:
        # Final guard at the point of no return (fail-safe): a block/delete
        # is served only when the resolved member is proven blockable —
        # paused, or expired with a past end date.  Active members, future
        # or NULL end dates, and unresolvable identities all cancel the
        # command; serving continues with the next command.  Enable-type
        # commands always serve unchanged.
        if candidate.action in ADMS_DISABLE_ACTIONS:
            member = resolve_adms_member(integration.gym_id, candidate.test_enroll_number)
            if disable_must_be_cancelled(member):
                cancel_adms_command(candidate)
                continue
        command = candidate
        break

    if command is None:
        db.session.commit()
        return _plain("OK")
    if command.status == "queued":
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
    # PUSH firmware varies between ID and CmdID in command acknowledgements.
    raw_id = str(
        request.args.get("ID") or request.args.get("CmdID") or
        request.form.get("ID") or request.form.get("CmdID") or ""
    ).strip()
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
    # M5: for DELETE-type commands the desired end state is "user not on
    # terminal". Return=-1/-2 from the X2008 means the user/template was
    # already absent — treat as achieved, not failed, so the C1 retry
    # reconciliation doesn't re-queue forever.
    _delete_actions = {"block", "block_test", "delete_user", "delete_biodata_test", "delete_fingertmp_test"}
    if result == "0":
        command.status = "acked"
    elif command.action in _delete_actions and result in ("-1", "-2"):
        command.status = "acked"
        command.result_message = (detail or "") + " [treated as success: already absent]"
    else:
        command.status = "failed"
    db.session.commit()
    return _plain("OK")
