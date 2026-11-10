"""Owner-facing RRR Growth System API."""
from __future__ import annotations
import secrets

from decimal import Decimal
import re
from urllib.parse import urlparse

from flask import current_app, g, jsonify, request
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Gym, Member
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)
from app.models.rrr import RRRAttendanceEvent, RRRAdmsCommand, RRRDevice, RRRIdentityMapping, RRRIntegration, RRROpportunity, RRRRule
from app.services.audit_service import audit
from app.services.bridge_service import (
    ADMS_GROUP_BLOCK_NOTE,
    ADMS_DELIVERED_TIMEOUT_MINUTES,
    adms_command_text,
    disable_must_be_cancelled,
    find_blocked_active_members,
    member_is_proven_enableable,
    queue_fingerprint_restore_commands,
    queue_manual_adms_member_command,
    queue_manual_bridge_member_command,
    resolve_adms_member,
    sanitize_terminal_name,
)
from app.services.rrr_service import (
    DEFAULT_RULES,
    adms_terminal_settings,
    dashboard_for_gym,
    direct_adms_terminal_is_online,
    ensure_default_rules,
    integration_payload,
    remap_unresolved,
    rules_for_gym,
)


def _direct_adms_command_text(
    action: str,
    enroll_number: str | None,
    *,
    member_name: str | None = None,
) -> str:
    """Return server-generated PUSH commands for the owner-only test route.

    The wire format is shared with the automatic membership commands in
    ``app.services.bridge_service.adms_command_text``. The eSSL group actions
    are a separate candidate copied from eBioServer's public implementation;
    their effect on a specific terminal must be checked in person.
    """

    return adms_command_text(action, enroll_number, member_name=member_name)


def _adms_command_payload(row: RRRAdmsCommand) -> dict:
    return {
        "id": row.id,
        "action": row.action,
        "status": row.status,
        "test_enroll_number": row.test_enroll_number,
        "result_code": row.result_code,
        "result_message": row.result_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "delivered_at": row.delivered_at.isoformat() if row.delivered_at else None,
        "acknowledged_at": row.acknowledged_at.isoformat() if row.acknowledged_at else None,
    }


def register_rrr_routes(bp):
    @bp.get("/rrr/dashboard")
    @token_required
    @roles_required("gym_owner", "staff")
    def rrr_dashboard():
        # V9-M1: the dashboard embeds the integration payload, which
        # carries the legacy ADMS path token — staff reads get presence
        # only, never the token.
        data = dashboard_for_gym(
            g.gym_id,
            g.current_user.gym.timezone or "Asia/Kolkata",
            include_terminal_token=(g.current_user.role == "gym_owner"),
        )
        db.session.commit()
        return jsonify({"success": True, "data": data})

    @bp.get("/rrr/opportunities")
    @token_required
    @roles_required("gym_owner", "staff")
    def rrr_opportunities():
        pillar = (request.args.get("pillar") or "").strip().lower()
        status = (request.args.get("status") or "open").strip().lower()
        query = RRROpportunity.query.filter_by(gym_id=g.gym_id).join(
            Member, RRROpportunity.member_id == Member.id
        ).filter(Member.deleted_at.is_(None))
        if pillar in {"revenue", "retain", "recover"}:
            query = query.filter_by(pillar=pillar)
        if status:
            query = query.filter_by(status=status)
        rows = query.order_by(RRROpportunity.created_at.desc()).all()
        return jsonify({"success": True, "data": {"opportunities": [
            {
                "id": x.id, "pillar": x.pillar, "status": x.status, "priority": x.priority,
                "reason": x.reason_text, "reason_code": x.reason_code,
                "potential_revenue": str(x.potential_revenue), "outcome_revenue": str(x.outcome_revenue),
                "member": {"id": x.member.id, "name": x.member.full_name, "phone": x.member.phone},
            } for x in rows
        ]}})

    @bp.patch("/rrr/opportunities/<int:opportunity_id>")
    @token_required
    @roles_required("gym_owner", "staff")
    def update_rrr_opportunity(opportunity_id: int):
        row = RRROpportunity.query.filter_by(id=opportunity_id, gym_id=g.gym_id).first()
        if row is None:
            return error_response("NOT_FOUND", "Opportunity was not found.", 404)
        payload = request.get_json(silent=True) or {}
        # A retry after a close-with-revenue must replay the stored
        # outcome, not re-apply it (a second close would rewrite
        # closed_at / outcome_revenue). Key is bound to this row.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_rrr_opportunity",
            headers=request.headers,
            payload={**payload, "opportunity_id": opportunity_id},
        )
        if replay is not None:
            return replay

        status = str(payload.get("status") or "").lower()
        if status not in {"open", "actioned", "closed", "dismissed"}:
            return error_response("VALIDATION_ERROR", "Invalid opportunity status.", 422)
        amount = None
        if status == "closed":
            try:
                amount = Decimal(str(payload.get("outcome_revenue", "0")))
            except Exception:
                return error_response("VALIDATION_ERROR", "outcome_revenue must be a number.", 422)
            if not amount.is_finite() or amount < 0:
                return error_response("VALIDATION_ERROR", "outcome_revenue must be a finite, non-negative amount.", 422)

        row.status = status
        if status == "actioned":
            from app.models.mixins import utcnow
            row.actioned_at = utcnow()
            row.closed_at = None
        if status == "closed":
            from app.models.mixins import utcnow
            row.closed_at = utcnow()
            row.outcome_revenue = amount
        if status == "open":
            row.actioned_at = None
            row.closed_at = None
            row.outcome_revenue = Decimal("0")
        if status == "dismissed":
            row.closed_at = None
        audit(action="rrr_opportunity_updated", resource_type="rrr_opportunity", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"status": status})
        response_body = {"success": True, "data": {"id": row.id, "status": row.status}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="update_rrr_opportunity",
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
                scope="update_rrr_opportunity",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.get("/rrr/rules")
    @token_required
    @roles_required("gym_owner", "staff")
    def rrr_rules():
        ensure_default_rules(g.gym_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"defaults": DEFAULT_RULES, "rules": rules_for_gym(g.gym_id)}})

    @bp.put("/rrr/rules")
    @token_required
    @roles_required("gym_owner")
    def update_rrr_rules():
        payload = request.get_json(silent=True) or {}
        requested = payload.get("rules")
        if not isinstance(requested, dict):
            return error_response("VALIDATION_ERROR", "rules must be an object.", 422)
        ensure_default_rules(g.gym_id)
        for key, default in DEFAULT_RULES.items():
            if key not in requested:
                continue
            try:
                value = int(requested[key])
            except (TypeError, ValueError):
                return error_response("VALIDATION_ERROR", f"{key} must be a whole number.", 422)
            maximum = 100 if key == "attendance_drop_percent" else 365
            if value < 1 or value > maximum:
                return error_response("VALIDATION_ERROR", f"{key} must be between 1 and {maximum}.", 422)
            RRRRule.query.filter_by(gym_id=g.gym_id, rule_key=key).first().value = value
        audit(action="rrr_rules_updated", resource_type="rrr_rule", gym_id=g.gym_id, actor_id=g.user_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"rules": rules_for_gym(g.gym_id)}})

    @bp.get("/rrr/integrations")
    @token_required
    @roles_required("gym_owner", "staff")
    def rrr_integrations():
        rows = RRRIntegration.query.filter_by(gym_id=g.gym_id).order_by(RRRIntegration.connector_type).all()
        devices = RRRDevice.query.filter_by(gym_id=g.gym_id).order_by(RRRDevice.device_name).all()
        # V9-M1: the legacy ADMS path token is an owner-level credential.
        # Staff reads get token presence only, never the token itself.
        include_token = g.current_user.role == "gym_owner"
        return jsonify({"success": True, "data": {
            "integrations": [integration_payload(x, include_terminal_token=include_token) for x in rows],
            "devices": [{"id": d.id, "integration_id": d.integration_id, "serial_number": d.serial_number,
                         "name": d.device_name, "status": d.status, "selected": d.is_selected,
                         "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None}
                        for d in devices],
        }})

    @bp.post("/rrr/integrations/<int:integration_id>/device")
    @token_required
    @roles_required("gym_owner")
    def select_rrr_device(integration_id: int):
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="ebioserver"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "eBioServer integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        try:
            device_id = int(payload.get("device_id"))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "device_id is required.", 422)
        device = RRRDevice.query.filter_by(id=device_id, gym_id=g.gym_id, integration_id=integration.id).first()
        if device is None:
            return error_response("NOT_FOUND", "Device was not reported by the paired connector.", 404)
        for known in RRRDevice.query.filter_by(gym_id=g.gym_id, integration_id=integration.id).all():
            known.is_selected = known.id == device.id
        integration.device_serial = device.serial_number
        integration.device_name = device.device_name
        integration.commands_enabled = False
        integration.commissioning_status = "not_started"
        audit(action="rrr_device_selected", resource_type="rrr_integration", resource_id=integration.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"serial": device.serial_number})
        db.session.commit()
        return jsonify({"success": True, "data": {"integration": integration_payload(integration)}})

    @bp.post("/rrr/integrations/ebioserver/pairing")
    @limiter.limit("10 per hour")
    @token_required
    @roles_required("gym_owner")
    def start_ebio_pairing():
        integration, code = RRRIntegration.issue_pairing_code(g.gym_id)
        audit(action="ebioserver_pairing_started", resource_type="rrr_integration", resource_id=integration.id,
              gym_id=g.gym_id, actor_id=g.user_id)
        db.session.commit()
        return jsonify({"success": True, "data": {
            "integration": integration_payload(integration), "pairing_code": code,
            "expires_at": integration.pairing_code_expires_at.isoformat(),
            "instructions": "Enter this code in the eBioServer Bridge on the approved Windows connector host. Do not share it.",
        }})

    @bp.post("/rrr/integrations/adms/provision")
    @limiter.limit("10 per hour")
    @token_required
    @roles_required("gym_owner")
    def provision_direct_adms():
        """Register one terminal serial for direct, cloud ADMS attendance.

        Access-control automation is deliberately not enabled by this route.
        Owners can later run a narrowly scoped, acknowledged test command.

        V10-M2: re-provisioning a commissioned gym never silently
        demotes it — the same serial re-provisions idempotently with
        its flags preserved, and a different serial on a commissioned
        gym is a 409 (a new terminal needs its own supervised
        commissioning). Rate-limited and idempotency-keyed so a stray
        double-tap cannot re-demote a live gym either.
        """
        payload = request.get_json(silent=True) or {}
        # V10-M2: a same-key retry replays the stored response instead
        # of re-running provision (the one-time token is redacted from
        # the stored body — see below).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="adms_provision",
            headers=request.headers,
            payload=payload,
        )
        if replay is not None:
            return replay
        serial = str(payload.get("device_serial") or "").strip()[:120]
        # V12-P8: never save another gym's name as this gym's device
        # identity. Default to the gym's own name; fall back to a
        # neutral label when the gym has no name stored.
        _gym = Gym.query.get(g.gym_id)
        _default_name = (
            f"{_gym.name} eSSL terminal" if _gym and _gym.name else "eSSL terminal"
        )
        name = str(payload.get("device_name") or _default_name).strip()[:160]
        if not serial:
            return error_response("VALIDATION_ERROR", "device_serial is required.", 422)
        owned_elsewhere = RRRIntegration.query.filter(
            RRRIntegration.connector_type == "adms_direct",
            RRRIntegration.device_serial == serial,
            RRRIntegration.gym_id != g.gym_id,
        ).first()
        if owned_elsewhere is not None:
            return error_response("CONFLICT", "That device serial is already registered to another gym.", 409)
        row = RRRIntegration.query.filter_by(gym_id=g.gym_id, connector_type="adms_direct").first()
        if row is None:
            # NEW integrations default to serial-fallback OFF (C1): only
            # token-path requests authenticate. Existing rows keep
            # whatever flag they already carry (legacy rows are
            # backfilled ON by the hardening migration).
            row = RRRIntegration(
                gym_id=g.gym_id, connector_type="adms_direct", display_name="Direct eSSL ADMS",
                allow_serial_fallback=False,
            )
            db.session.add(row)
        # V10-M2: an already-commissioned gym keeps its flags on a
        # same-serial re-provision (re-fetch settings / stray
        # double-tap). A different serial is refused: the new terminal
        # has not passed the supervised physical test, and silently
        # demoting the live gym would switch off automatic block/unblock
        # until the test repeats. Terminal replacement is self-serve via
        # POST /rrr/integrations/<id>/replace (G1) — it decommissions
        # the old terminal and resets commissioning on purpose, with an
        # explicit confirm.
        already_commissioned = bool(
            row.commands_enabled or row.commissioning_status == "physical_test_passed"
        )
        if already_commissioned and row.device_serial != serial:
            return error_response(
                "ALREADY_COMMISSIONED",
                f"This gym is already commissioned with terminal {row.device_serial}. "
                "Re-provisioning a different terminal needs a fresh supervised commissioning — "
                "contact support to replace the commissioned terminal.",
                409,
            )
        row.device_serial = serial
        row.device_name = name
        # Token issuance, hash-only (C1/H7): a fresh row gets a new
        # token (returned once below); a legacy row keeps its existing
        # plaintext token until the owner rotates; a hash-only row is
        # NOT re-issued here (its token is unrecoverable by design —
        # rotate to re-provision).
        token_for_response = None
        if not row.adms_path_token and not row.adms_token_hash:
            token_for_response = row.issue_adms_token()
        elif row.adms_path_token:
            token_for_response = row.adms_path_token
        # V10-M2: only a not-yet-commissioned row is (re)set to
        # not_configured here. A commissioned same-serial re-provision
        # preserves status / commands_enabled / commissioning_status.
        if not already_commissioned:
            row.status = "not_configured"
            row.commands_enabled = False
            row.commissioning_status = "not_started"
        audit(action="direct_adms_provisioned", resource_type="rrr_integration", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"serial": serial, "already_commissioned": already_commissioned})
        db.session.commit()
        if token_for_response is not None:
            settings = adms_terminal_settings(request.host_url, path_token=token_for_response)
        else:
            settings = adms_terminal_settings(request.host_url, path_token=None)
            settings["path"] = None
            settings["token_present"] = True
            settings["token_note"] = (
                "Token is stored as a hash and cannot be shown again. "
                "Rotate the token to re-provision this terminal."
            )
        if already_commissioned:
            settings["warning"] = (
                "This terminal is already commissioned; automatic block/unblock stays enabled."
            )
        else:
            settings["warning"] = (
                "Attendance works immediately. Automatic block/unblock unlocks after "
                "the supervised commissioning test on the integrations screen."
            )
        response_body = {"success": True, "data": {
            "integration": integration_payload(row),
            "terminal_settings": settings,
        }}
        # V10-M2: record the idempotency replay row — with the one-time
        # token redacted. settings["path"] embeds the token
        # ("/iclock/<token>") and the token is hash-only by design
        # (C1/H7), so it must never be persisted in clear in the
        # idempotency table. A same-key retry replays the redacted body;
        # the caller already received the token in the first response.
        record_body = {"success": True, "data": {
            "integration": response_body["data"]["integration"],
            "terminal_settings": dict(settings),
        }}
        if token_for_response is not None:
            record_body["data"]["terminal_settings"]["path"] = "/iclock"
            record_body["data"]["terminal_settings"]["token_note"] = (
                "Token was issued with the original response and is not stored. "
                "Rotate the token to re-provision this terminal."
            )
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="adms_provision",
            key=idempotency_key,
            request_hash=request_hash,
            status_code=200,
            response_body=record_body,
        )
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            replayed = replay_after_conflict(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="adms_provision",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.post("/rrr/integrations/<int:integration_id>/replace")
    @limiter.limit("10 per hour")
    @token_required
    @roles_required("gym_owner")
    def replace_adms_terminal(integration_id: int):
        """Self-serve terminal replacement (gaps G1–G5, G1).

        Decommissions the old terminal (its token is revoked immediately
        by issuing a fresh one, commands disable, commissioning resets)
        and provisions the new serial with a fresh token. The supervised
        physical test must pass again before any command enables — this
        is self-serve initiation, not skipping the test. Never replaces
        with a serial owned by another gym (409, same rule as provision).
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        if payload.get("confirm") is not True:
            return error_response(
                "CONFIRMATION_REQUIRED",
                "Replacing the commissioned terminal requires confirm=true.",
                422,
            )
        serial = str(payload.get("device_serial") or "").strip()[:120]
        name = str(payload.get("device_name") or "").strip()[:160]
        if not serial:
            return error_response("VALIDATION_ERROR", "device_serial is required.", 422)
        if integration.device_serial == serial:
            return error_response(
                "VALIDATION_ERROR",
                "device_serial is already the commissioned terminal.",
                422,
            )
        owned_elsewhere = RRRIntegration.query.filter(
            RRRIntegration.connector_type == "adms_direct",
            RRRIntegration.device_serial == serial,
            RRRIntegration.gym_id != g.gym_id,
        ).first()
        if owned_elsewhere is not None:
            return error_response("CONFLICT", "That device serial is already registered to another gym.", 409)
        old_serial = integration.device_serial
        integration.device_serial = serial
        integration.device_name = name or integration.device_name or "eSSL terminal"
        # Fresh token, no grace: the decommissioned terminal must stop
        # authenticating at once. (Rotate keeps a grace window; replace
        # must not.)
        new_token = integration.issue_adms_token()
        integration.commands_enabled = False
        integration.commissioning_status = "not_started"
        integration.status = "not_configured"
        integration.last_success_at = None
        integration.last_error = None
        audit(action="adms_terminal_replaced", resource_type="rrr_integration", resource_id=integration.id,
              gym_id=g.gym_id, actor_id=g.user_id,
              metadata={"old_serial": old_serial, "new_serial": serial})
        db.session.commit()
        settings = adms_terminal_settings(request.host_url, path_token=new_token)
        return jsonify({"success": True, "data": {
            "integration": integration_payload(integration),
            "terminal_settings": settings,
            "warning": (
                "Attendance works once the new terminal checks in. "
                "Automatic block/unblock unlocks after the supervised "
                "commissioning test on the integrations screen."
            ),
        }})

    @bp.post("/rrr/integrations/<int:integration_id>/decommission")
    @token_required
    @roles_required("gym_owner")
    def decommission_adms_terminal(integration_id: int):
        """Self-serve terminal decommission (gaps G1–G5, G1).

        Disables commands and resets commissioning so the terminal can
        no longer open/close doors automatically; attendance punches
        already received are untouched. The serial and token stay on the
        row, so re-commissioning the same terminal later is a normal
        commissioning flow, not a re-provision.
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        if payload.get("confirm") is not True:
            return error_response(
                "CONFIRMATION_REQUIRED",
                "Decommissioning the terminal requires confirm=true.",
                422,
            )
        integration.commands_enabled = False
        integration.commissioning_status = "not_started"
        integration.status = "disconnected"
        audit(action="adms_terminal_decommissioned", resource_type="rrr_integration", resource_id=integration.id,
              gym_id=g.gym_id, actor_id=g.user_id,
              metadata={"serial": integration.device_serial})
        db.session.commit()
        return jsonify({"success": True, "data": {
            "integration": integration_payload(integration),
        }})

    @bp.post("/rrr/integrations/<int:integration_id>/restore-fingerprints")
    @token_required
    @roles_required("gym_owner")
    def restore_adms_fingerprints(integration_id: int):
        """Queue fingerprint-template restores (gaps G1–G5, G4).

        Re-pushes stored templates (captured from USERINFO uploads) to
        the terminal after a reset/replacement, so members can punch
        without in-person re-enrollment. Only same-member templates
        queue — see queue_fingerprint_restore_commands for the
        V6-L9 guards (member anchor, current-holder match, enableable
        only, dedupe). Requires a commissioned terminal.
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        if not integration.commands_enabled:
            return error_response(
                "NOT_COMMISSIONED",
                "Complete supervised commissioning before restoring fingerprints.",
                403,
            )
        result = queue_fingerprint_restore_commands(integration, g.user_id)
        audit(action="adms_fingerprints_restore_requested", resource_type="rrr_integration",
              resource_id=integration.id, gym_id=g.gym_id, actor_id=g.user_id,
              metadata={"queued": len(result["queued"]), "deduped": len(result["deduped"]),
                        "skipped": len(result["skipped"])})
        db.session.commit()
        return jsonify({"success": True, "data": result}), 201

    @bp.get("/rrr/blocked-active")
    @token_required
    @roles_required("gym_owner", "staff")
    def blocked_active_members():
        """Gaps G1–G5 (G5): active members whose door reads blocked.

        Detection only — the response never blocks or unblocks anyone.
        Staff can see it at the door; owners see it on the dashboard.
        """
        members = find_blocked_active_members(g.gym_id)
        return jsonify({"success": True, "data": {"members": members}})

    @bp.post("/rrr/integrations/<int:integration_id>/adms/rotate-token")
    @limiter.limit("20 per hour")
    @token_required
    @roles_required("gym_owner")
    def rotate_adms_token(integration_id: int):
        """Rotate an ADMS path token (H7).

        The new token is returned exactly once — store it in the
        terminal's ADMS server URL and keep it out of screenshots and
        support packages. The previous token keeps working until
        ``grace_until`` (default 7 days, 0 = revoked immediately) so
        the terminal can be re-provisioned without a flag day; after
        the grace window it is rejected outright. The URL-token
        mechanism itself is unchanged — terminals that cannot send a
        custom path cannot use it, which is why rotation + the
        serial-fallback gate (not removal) is the fix.
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        try:
            grace_days = int(payload.get("grace_days", 7))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "grace_days must be an integer.", 422)
        grace_days = max(0, min(30, grace_days))
        new_token = integration.rotate_adms_token(grace_days=grace_days)
        audit(action="adms_token_rotated", resource_type="rrr_integration", resource_id=integration.id,
              gym_id=g.gym_id, actor_id=g.user_id,
              metadata={"token_version": integration.adms_token_version,
                        "grace_days": grace_days})
        db.session.commit()
        settings = adms_terminal_settings(request.host_url, path_token=new_token)
        return jsonify({"success": True, "data": {
            "integration": integration_payload(integration),
            "terminal_settings": settings,
            "token": new_token,
            "token_version": integration.adms_token_version,
            "previous_token_grace_until": (
                integration.adms_token_grace_until.isoformat()
                if integration.adms_token_grace_until else None
            ),
            "warning": (
                "This token is shown exactly once. Update the terminal's "
                "ADMS server URL to the path above before the grace window "
                "ends; after that the previous token stops working."
            ),
        }})

    @bp.post("/rrr/integrations/<int:integration_id>/adms/serial-fallback")
    @token_required
    @roles_required("gym_owner")
    def set_adms_serial_fallback(integration_id: int):
        """Explicitly enable/disable bare-serial ADMS auth for one gym (C1).

        Disabling is the re-commission step: once the terminal is
        provisioned onto the token path, turn this off and serial-only
        requests stop changing anything. Enabling it again re-opens
        the legacy behaviour (warning-logged, never error-clearing)
        for terminals that cannot send a custom path.
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        if "enabled" not in payload or not isinstance(payload.get("enabled"), bool):
            return error_response("VALIDATION_ERROR", "enabled (true/false) is required.", 422)
        integration.allow_serial_fallback = payload["enabled"]
        audit(action="adms_serial_fallback_changed", resource_type="rrr_integration",
              resource_id=integration.id, gym_id=g.gym_id, actor_id=g.user_id,
              metadata={"allow_serial_fallback": payload["enabled"]})
        db.session.commit()
        return jsonify({"success": True, "data": {
            "integration": integration_payload(integration),
        }})

    @bp.get("/rrr/integrations/<int:integration_id>/adms/commands")
    @token_required
    @roles_required("gym_owner", "staff")
    def direct_adms_commands(integration_id: int):
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        rows = RRRAdmsCommand.query.filter_by(integration_id=integration.id).order_by(
            RRRAdmsCommand.id.desc()
        ).limit(20).all()
        return jsonify({"success": True, "data": {"commands": [_adms_command_payload(row) for row in rows]}})

    @bp.post("/rrr/integrations/<int:integration_id>/adms/commands")
    @limiter.limit("20 per hour")
    @token_required
    @roles_required("gym_owner")
    def queue_direct_adms_test_command(integration_id: int):
        """Queue a narrow, auditable live-terminal commissioning command.

        These commands are not automatic membership actions. They exist solely
        to prove the installed terminal's PUSH command/acknowledgement path
        while the device contains no real gym member identities.
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        if not direct_adms_terminal_is_online(integration):
            return error_response("DEVICE_OFFLINE", "Wait until the terminal is connected before queuing a test.", 409)
        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        allowed_actions = {
            "probe_info",
            "essl_group_block_test",
            "essl_group_unblock_test",
            "sync_users",
        }
        if action not in allowed_actions:
            return error_response(
                "VALIDATION_ERROR",
                "action must be probe_info, essl_group_block_test, essl_group_unblock_test, or sync_users.",
                422,
            )
        enroll_number = None
        if action not in {"probe_info", "sync_users"}:
            enroll_number = str(payload.get("test_enroll_number") or "").strip()
            if not re.fullmatch(r"[1-9][0-9]{0,8}", enroll_number):
                return error_response("VALIDATION_ERROR", "test_enroll_number must be a 1–9 digit number.", 422)
        test_user_name = None
        if action in {"essl_group_block_test", "essl_group_unblock_test"}:
            test_user_name = sanitize_terminal_name(payload.get("test_user_name"))
            if not test_user_name:
                return error_response(
                    "VALIDATION_ERROR",
                    "test_user_name is required for the eSSL group test; enter the current device name.",
                    422,
                )
            if payload.get("test_member_confirmed") is not True:
                return error_response(
                    "CONFIRMATION_REQUIRED",
                    "Confirm that this is the dedicated fake test account before sending the eSSL group test.",
                    422,
                )
        test_member_id = None
        if action in {"essl_group_block_test", "essl_group_unblock_test"}:
            matched_member = resolve_adms_member(g.gym_id, enroll_number)
            if matched_member is not None:
                # V3-M9: refuse at queue time instead of 201-then-cancel.
                # The serve guard used to cancel this as "belongs to a
                # member" after a success response, which read as a broken
                # terminal during commissioning and invited retries. Any
                # enroll that resolves to a member is a real member's ID,
                # whatever name was typed. The serve guard stays untouched
                # as a backstop for commands queued before this fix.
                return error_response(
                    "TEST_MEMBER_IS_REAL",
                    "That ID belongs to a Renewal Desk member. Group tests must use the dedicated fake test account, never a real member's ID.",
                    409,
                )
        existing = RRRAdmsCommand.query.filter(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.status.in_(("queued", "delivered")),
        ).first()
        if existing is not None:
            # Stuck-command timeout (L5, aligned with the getrequest
            # reaper): if a command has been delivered for longer than
            # ADMS_DELIVERED_TIMEOUT_MINUTES without ack, the terminal
            # likely already executed it but the ack was lost. Mark it
            # timed out so testing isn't blocked forever. Previously 5
            # min here vs 10 min in getrequest — a command could be
            # failed by this endpoint while the terminal still held it.
            try:
                from datetime import timedelta, timezone as tz
                from app.models.mixins import utcnow
                stuck_cutoff = utcnow() - timedelta(minutes=ADMS_DELIVERED_TIMEOUT_MINUTES)
                delivered_at = existing.delivered_at or existing.created_at
                if delivered_at is not None and delivered_at.tzinfo is None:
                    delivered_at = delivered_at.replace(tzinfo=tz.utc)
                if existing.status == "delivered" and delivered_at and delivered_at < stuck_cutoff:
                    existing.status = "failed"
                    # V12-A3: the row used to keep whatever stale reason
                    # it had (usually none) and leave no audit row.
                    # Stamp the timeout distinctly and audit it BEFORE
                    # the commit (V10-M1), like the getrequest reaper.
                    existing.result_code = "TIMEOUT"
                    existing.result_message = "Timeout: no ack within 10 min"
                    audit(
                        action="adms_command_ack_timeout",
                        resource_type="rrr_adms_command",
                        resource_id=existing.id,
                        gym_id=g.gym_id,
                        actor_id=g.user_id,
                        metadata={
                            "action": existing.action,
                            "test_enroll_number": existing.test_enroll_number,
                            "timeout_minutes": ADMS_DELIVERED_TIMEOUT_MINUTES,
                        },
                    )
                    db.session.commit()
                    existing = None
            except Exception:
                db.session.rollback()
                # Don't let the timeout check break the endpoint; fall through
                # to the normal pending-command guard.
                pass
        if existing is not None:
            return error_response("COMMAND_PENDING", "Wait for the current terminal command acknowledgement before sending another test.", 409)
        command_text = _direct_adms_command_text(
            action, enroll_number, member_name=test_user_name
        )
        row = RRRAdmsCommand(
            gym_id=g.gym_id, integration_id=integration.id, action=action,
            test_enroll_number=enroll_number, test_member_id=test_member_id,
            command_text=command_text,
            requested_by_id=g.user_id,
        )
        db.session.add(row)
        db.session.flush()
        audit(action="direct_adms_test_command_queued", resource_type="rrr_adms_command", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"action": action, "test_enroll_number": enroll_number})
        db.session.commit()
        return jsonify({"success": True, "data": {"command": _adms_command_payload(row)}}), 201

    @bp.post("/rrr/integrations/<int:integration_id>/adms/device-command")
    @limiter.limit("60 per hour")
    @token_required
    @roles_required("gym_owner")
    def queue_advanced_adms_command(integration_id: int):
        """Queue an advanced device command through the ADMS PUSH channel.

        These commands go through the same /iclock/getrequest pipe the terminal
        already polls.  No port forwarding or gym-side laptop required.

        Supported actions:
          - create_user: Create/update a user on the terminal
          - unlock_door: Remotely unlock the door relay
          - reboot:      Reboot the terminal
          - check:       Request device status check
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        if not direct_adms_terminal_is_online(integration):
            return error_response("DEVICE_OFFLINE", "The terminal is not connected.", 409)
        if not integration.commands_enabled:
            return error_response(
                "NOT_COMMISSIONED",
                "Complete supervised commissioning before sending device commands.",
                403,
            )

        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        allowed = {"create_user", "unlock_door", "reboot", "check"}
        if action not in allowed:
            return error_response("VALIDATION_ERROR", f"action must be one of: {', '.join(sorted(allowed))}.", 422)
        # Door-control and reboot commands require an explicit confirmation.
        if action in {"unlock_door", "reboot"} and not (
            payload.get("confirm") is True or payload.get("confirmed") is True
        ):
            return error_response(
                "CONFIRMATION_REQUIRED",
                f"action '{action}' requires an explicit confirmation: send confirm=true.",
                422,
            )

        enroll_number = None
        member_name = None
        delay_seconds = 5

        if action == "create_user":
            enroll_number = str(payload.get("enroll_number") or payload.get("test_enroll_number") or "").strip()
            if not re.fullmatch(r"[1-9][0-9]{0,8}", enroll_number):
                return error_response("VALIDATION_ERROR", "enroll_number must be a 1–9 digit number.", 422)
        if action == "create_user":
            member_name = str(payload.get("member_name") or payload.get("name") or "Member").strip()[:24]
        if action == "create_user":
            # V3-M6: a create_user carries no Grp field, so the new
            # terminal user gets firmware-default access — and no
            # follow-up block is queued. If this enroll belongs to a
            # member who is not proven enableable (expired, paused,
            # deleted, NULL end), creating them would open the door for
            # that member. Refuse at queue time (409) rather than
            # create-then-block or Grp=100 wire text: a refusal has no
            # access window and no reliance on a second command acking.
            # Unmapped enrolls and proven-enableable members are
            # unaffected. The serve-time create_user exemption (B-H2)
            # is untouched.
            mapped_member = resolve_adms_member(g.gym_id, enroll_number)
            if mapped_member is not None and not member_is_proven_enableable(mapped_member):
                return error_response(
                    "MEMBER_NOT_ENABLEABLE",
                    "That enroll number belongs to a member whose membership is not currently active. Create a terminal user only for active members or unmapped IDs.",
                    409,
                )
        if action == "unlock_door":
            raw_delay = payload.get("delay_seconds")
            if raw_delay is not None:
                try:
                    delay_seconds = max(1, min(30, int(raw_delay)))
                except (TypeError, ValueError):
                    delay_seconds = 5

        # Don't allow queuing over an in-flight command
        existing = RRRAdmsCommand.query.filter(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.status.in_(("queued", "delivered")),
        ).first()
        if existing is not None:
            return error_response("COMMAND_PENDING", "A command is already in flight. Wait for acknowledgement.", 409)

        command_text = adms_command_text(
            action, enroll_number, member_name=member_name, delay_seconds=delay_seconds
        )
        row = RRRAdmsCommand(
            gym_id=g.gym_id, integration_id=integration.id, action=action,
            test_enroll_number=enroll_number, command_text=command_text,
            requested_by_id=g.user_id,
        )
        db.session.add(row)
        db.session.flush()
        audit(
            action=f"adms_advanced_{action}_queued",
            resource_type="rrr_adms_command",
            resource_id=row.id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={
                "action": action,
                "enroll_number": enroll_number,
                "member_name": member_name,
                "delay_seconds": delay_seconds,
            },
        )
        db.session.commit()
        payload_out = {"command": _adms_command_payload(row)}
        return jsonify({"success": True, "data": payload_out}), 201

    @bp.post("/rrr/integrations/<int:integration_id>/commission")
    @token_required
    @roles_required("gym_owner")
    def commission_integration(integration_id: int):
        row = RRRIntegration.query.filter(
            RRRIntegration.id == integration_id,
            RRRIntegration.gym_id == g.gym_id,
            RRRIntegration.connector_type.in_(("ebioserver", "adms_direct")),
        ).first()
        if row is None:
            return error_response("NOT_FOUND", "RRR integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        if payload.get("physical_test_passed") is not True:
            return error_response("VALIDATION_ERROR", "physical_test_passed must be true after a supervised door test.", 422)
        attendance_query = RRRAttendanceEvent.query.filter_by(
            gym_id=g.gym_id, integration_id=row.id, processing_status="processed"
        )
        if row.device_serial:
            attendance_query = attendance_query.filter_by(device_serial=row.device_serial)
        if row.connector_type == "adms_direct" and not row.allow_serial_fallback:
            # H1: for integrations with serial fallback OFF, a punch
            # whose provenance is "serial" never satisfies the gate —
            # a forged serial-only punch cannot commission the device.
            # Token-authenticated punches ("token"/"token_prev") do.
            # Provenance NULL means the punch was recorded before this
            # column existed: post-hardening ingest always stamps a
            # method, so NULL cannot be manufactured through the device
            # API, and pre-hardening punches keep satisfying the gate
            # (backward compatibility for already-commissioned gyms).
            attendance_query = attendance_query.filter(
                or_(
                    RRRAttendanceEvent.auth_method.is_(None),
                    RRRAttendanceEvent.auth_method.in_(("token", "token_prev")),
                )
            )
        attendance_exists = attendance_query.first()
        if attendance_exists is None:
            return error_response("COMMISSIONING_REQUIRED", "A mapped real attendance event from the selected device is required before commands can be enabled.", 409)
        if row.connector_type == "adms_direct":
            # Require acknowledgements for both tested Group transitions;
            # legacy DELETE/recreate tests do not prove this automatic path.
            acked_group_tests = {
                action
                for (action,) in db.session.query(RRRAdmsCommand.action).filter(
                    RRRAdmsCommand.integration_id == row.id,
                    RRRAdmsCommand.action.in_(("essl_group_block_test", "essl_group_unblock_test")),
                    RRRAdmsCommand.status == "acked",
                ).distinct().all()
            }
            required_group_tests = {"essl_group_block_test", "essl_group_unblock_test"}
            if not required_group_tests.issubset(acked_group_tests):
                return error_response(
                    "COMMISSIONING_REQUIRED",
                    "Run both eSSL Group tests and wait for Grp=100 and Grp=1 acknowledgements before enabling automatic commands.",
                    409,
                )
        row.commissioning_status = "physical_test_passed"
        row.commands_enabled = True
        audit(action=f"{row.connector_type}_commands_enabled", resource_type="rrr_integration", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id)
        db.session.commit()
        return jsonify({"success": True, "data": integration_payload(row)})

    @bp.get("/rrr/mappings/unresolved")
    @token_required
    @roles_required("gym_owner", "staff")
    def unresolved_mappings():
        """Unmapped biometric IDs, grouped by distinct terminal ID.

        Paginated form — pass ``?page=N&per_page=M`` (default per_page
        50). Response ``data``::

            {"groups": [{"biometric_user_id": "42",
                         "punch_count": 5,
                         "latest_punch_time": "2026-11-05T10:00:00",
                         "first_punch_time": "2026-11-01T09:00:00",
                         "latest_event_id": 123,
                         "source": "adms_direct",
                         "device_serial": "CUB7262300144"}, ...],
             "pagination": {"page": 1, "per_page": 50,
                            "total": <distinct IDs>, "total_pages": 1}}

        ``total`` counts distinct terminal IDs, not punches. Legacy
        form — no ``page``/``per_page`` params: the previous shape is
        preserved (``{"events": [...], "total": <unmapped events>}``)
        but capped at 500 events so the response stays bounded.
        """
        from sqlalchemy import func as _func

        page_param_given = (
            request.args.get("page") is not None
            or request.args.get("per_page") is not None
        )
        if not page_param_given:
            total_events = RRRAttendanceEvent.query.filter_by(
                gym_id=g.gym_id, processing_status="unmapped"
            ).count()
            rows = (
                RRRAttendanceEvent.query.filter_by(
                    gym_id=g.gym_id, processing_status="unmapped"
                )
                .order_by(RRRAttendanceEvent.punch_time.desc())
                .limit(500)
                .all()
            )
            return jsonify({"success": True, "data": {"events": [
                {"id": x.id, "biometric_user_id": x.biometric_user_id, "punch_time": x.punch_time.isoformat(),
                 "source": x.source, "device_serial": x.device_serial} for x in rows
            ], "total": total_events}})

        page = max(request.args.get("page", 1, type=int), 1)
        per_page = min(max(request.args.get("per_page", 50, type=int), 1), 100)
        grouped = (
            db.session.query(
                RRRAttendanceEvent.biometric_user_id,
                _func.count(RRRAttendanceEvent.id).label("punch_count"),
                _func.max(RRRAttendanceEvent.punch_time).label("latest_punch_time"),
                _func.min(RRRAttendanceEvent.punch_time).label("first_punch_time"),
            )
            .filter_by(gym_id=g.gym_id, processing_status="unmapped")
            .group_by(RRRAttendanceEvent.biometric_user_id)
            .order_by(_func.max(RRRAttendanceEvent.punch_time).desc())
        )
        total = grouped.count()
        total_pages = (total + per_page - 1) // per_page if total else 0
        page_groups = grouped.offset((page - 1) * per_page).limit(per_page).all()
        # V3-L11: batch the latest-event lookup — one query for all groups
        # on the page instead of one per group (N+1 at Yodha scale).
        # (The review describes this as batched member lookups; the
        # endpoint actually does no member lookup — the per-group query
        # is the latest RRRAttendanceEvent, batched here the same way.)
        from sqlalchemy import tuple_ as _tuple_

        bio_ids = [bio_id for bio_id, _, _, _ in page_groups]
        latest_by_bio: dict[str, object] = {}
        if bio_ids:
            max_times = dict(
                db.session.query(
                    RRRAttendanceEvent.biometric_user_id,
                    _func.max(RRRAttendanceEvent.punch_time),
                )
                .filter(
                    RRRAttendanceEvent.gym_id == g.gym_id,
                    RRRAttendanceEvent.biometric_user_id.in_(bio_ids),
                    RRRAttendanceEvent.processing_status == "unmapped",
                )
                .group_by(RRRAttendanceEvent.biometric_user_id)
                .all()
            )
            pairs = [
                (bio_id, max_times[bio_id])
                for bio_id in bio_ids
                if bio_id in max_times
            ]
            if pairs:
                candidates = (
                    RRRAttendanceEvent.query.filter(
                        RRRAttendanceEvent.gym_id == g.gym_id,
                        RRRAttendanceEvent.processing_status == "unmapped",
                        _tuple_(
                            RRRAttendanceEvent.biometric_user_id,
                            RRRAttendanceEvent.punch_time,
                        ).in_(pairs),
                    )
                    .order_by(
                        RRRAttendanceEvent.punch_time.desc(),
                        RRRAttendanceEvent.id.desc(),
                    )
                    .all()
                )
                for evt in candidates:
                    latest_by_bio.setdefault(evt.biometric_user_id, evt)
        groups = []
        for bio_id, punch_count, latest_punch, first_punch in page_groups:
            latest = latest_by_bio.get(bio_id)
            groups.append({
                "biometric_user_id": bio_id,
                "punch_count": punch_count,
                "latest_punch_time": latest_punch.isoformat() if latest_punch else None,
                "first_punch_time": first_punch.isoformat() if first_punch else None,
                "latest_event_id": latest.id if latest else None,
                "source": latest.source if latest else None,
                "device_serial": latest.device_serial if latest else None,
            })
        return jsonify({"success": True, "data": {
            "groups": groups,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": total_pages,
            },
        }})

    @bp.post("/rrr/mappings/bulk-resolve")
    @token_required
    @roles_required("gym_owner", "staff")
    def bulk_resolve_mappings():
        """Link multiple biometric IDs to members in one call.
        
        Body: {"mappings": [{"external_id": "23", "member_id": 123}, ...]}
        Returns per-item results; partial success is OK.
        """
        payload = request.get_json(silent=True) or {}
        mappings = payload.get("mappings") or []
        if not isinstance(mappings, list) or not mappings:
            return error_response("VALIDATION_ERROR", "mappings list is required.", 422)
        if len(mappings) > 100:
            return error_response("VALIDATION_ERROR", "Max 100 mappings per call.", 422)
        # A retry after a bulk link must replay the stored per-item
        # results: re-running would report the already-linked items
        # as conflicts instead of the original outcome.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="bulk_resolve_mappings",
            headers=request.headers,
            payload=payload,
        )
        if replay is not None:
            return replay

        results = []
        for item in mappings:
            external_id = str(item.get("external_id") or "").strip()
            # V3-H3: the event_source lookup below matches stored
            # biometric_user_id values, which ingest canonicalizes —
            # canonicalize the requested ID first ("042" -> "42") or
            # the source defaults to ebioserver for ADMS gyms.
            try:
                from app.services.bridge_service import canonical_enroll_number

                external_id = canonical_enroll_number(external_id)
            except ValueError:
                pass
            try:
                member_id = int(item.get("member_id"))
            except (TypeError, ValueError):
                results.append({"external_id": external_id, "ok": False, "error": "member_id required"})
                continue
            if not external_id:
                results.append({"external_id": external_id, "ok": False, "error": "external_id required"})
                continue
            member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
            if member is None or member.deleted_at is not None:
                # V3-M10: never link a biometric ID to a soft-deleted
                # member — report it as not found, per item.
                results.append({"external_id": external_id, "ok": False, "error": "Member not found"})
                continue
            # Per-item savepoint: a failure rolls back only this item,
            # not the previously succeeded ones.
            savepoint = db.session.begin_nested()
            try:
                event_source = (
                    RRRAttendanceEvent.query.filter_by(gym_id=g.gym_id, biometric_user_id=external_id)
                    .order_by(RRRAttendanceEvent.id.desc())
                    .first()
                )
                resolved = remap_unresolved(
                    g.gym_id, external_id, member, g.user_id,
                    source=event_source.source if event_source else None,
                )
                audit(action="rrr_identity_mapped", resource_type="member", resource_id=member.id, gym_id=g.gym_id,
                      actor_id=g.user_id, metadata={"external_id": external_id, "events_replayed": resolved, "bulk": True})
                savepoint.commit()
                results.append({"external_id": external_id, "ok": True, "member_id": member.id, "events_resolved": resolved})
            except Exception as e:
                savepoint.rollback()
                results.append({"external_id": external_id, "ok": False, "error": str(e)[:100]})
        ok_count = sum(1 for r in results if r["ok"])
        response_body = {"success": True, "data": {"linked": ok_count, "total": len(results), "results": results}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="bulk_resolve_mappings",
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
                scope="bulk_resolve_mappings",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.post("/rrr/mappings/<string:external_id>")
    @token_required
    @roles_required("gym_owner", "staff")
    def resolve_mapping(external_id: str):
        payload = request.get_json(silent=True) or {}
        try:
            member_id = int(payload.get("member_id"))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "member_id is required.", 422)
        # A retry after a successful link must replay instead of
        # re-running remap (which would re-replay punches / re-queue
        # the membership command). Key is bound to this terminal ID.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="resolve_mapping",
            headers=request.headers,
            payload={**payload, "external_id": external_id},
        )
        if replay is not None:
            return replay

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if member is None or member.deleted_at is not None:
            # V3-M10: never link a biometric ID to a soft-deleted member.
            return error_response("NOT_FOUND", "Member was not found.", 404)
        external_id = external_id.strip()
        # V3-H3: canonicalize before the event_source lookup (see bulk).
        try:
            from app.services.bridge_service import canonical_enroll_number

            external_id = canonical_enroll_number(external_id)
        except ValueError:
            pass
        event_source = (
            RRRAttendanceEvent.query.filter_by(gym_id=g.gym_id, biometric_user_id=external_id)
            .order_by(RRRAttendanceEvent.id.desc())
            .first()
        )
        try:
            resolved = remap_unresolved(
                g.gym_id, external_id, member, g.user_id,
                source=event_source.source if event_source else None,
            )
        except ValueError as ve:
            return error_response("CONFLICT", str(ve), 409)
        audit(action="rrr_identity_mapped", resource_type="member", resource_id=member.id, gym_id=g.gym_id,
              actor_id=g.user_id, metadata={"external_id": external_id, "events_replayed": resolved})
        response_body = {"success": True, "data": {"member_id": member.id, "events_resolved": resolved}}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="resolve_mapping",
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
                scope="resolve_mapping",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.post("/rrr/members/<int:member_id>/access")
    @limiter.limit("30 per hour")
    @token_required
    @roles_required("gym_owner")
    def manual_member_access(member_id: int):
        """Owner-initiated block/unblock of one member's biometric access.

        Queues a ``block``/``unblock`` command for the member's terminal
        identity. If the gym has a direct-ADMS integration, this endpoint
        uses that path exclusively and refuses when it is not commissioned.
        Bridge-only gyms use their configured connector. Gated on the member
        having a bound enroll number — same safety bar as the automatic path.

        For ``unblock`` on the bridge path, the member must be proven
        enableable (active, end date today or later) — otherwise the
        serve-side guard would cancel it anyway, so this returns a clear
        409 up front: fix the dates in Date Repair first, then unblock.
        """
        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"block", "unblock"}:
            return error_response("VALIDATION_ERROR", "action must be 'block' or 'unblock'.", 422)
        # A retry after a queued block/unblock must replay instead of
        # queueing a second terminal command (a double block is
        # harmless on the terminal, but a double unblock after a
        # re-block in between would reopen the wrong member state).
        # Key is bound to this member + action.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="manual_member_access",
            headers=request.headers,
            payload={**payload, "member_id": member_id},
        )
        if replay is not None:
            return replay

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if member is None or member.deleted_at is not None:
            return error_response("NOT_FOUND", "Member was not found.", 404)
        if action == "unblock" and not member_is_proven_enableable(member):
            return error_response(
                "ENABLE_NOT_ALLOWED",
                "Member is not active per the stored dates, so the door cannot be reopened. "
                "Correct the dates in Date Repair first, then unblock.",
                409,
            )
        direct_integration = RRRIntegration.query.filter_by(
            gym_id=member.gym_id, connector_type="adms_direct"
        ).first()
        if (
            action == "block"
            and direct_integration is None
            and disable_must_be_cancelled(member)
        ):
            # M10 (bridge only): the bridge lease guard cancels any disable
            # for a non-blockable member, so queueing here would return 201
            # while the door stays open. Fail up front with a clear 409 —
            # but only when a bridge command would actually have been
            # queued: with no bridge / no enroll number the endpoint
            # already 409s DEVICE_NOT_READY below, which stays the right
            # error there. ADMS gyms are deliberately excluded: the
            # owner-override on that path (B-H1) awaits Bharath's explicit
            # decision and this endpoint must not pre-empt it.
            from app.models.bridge import BridgeInstallation

            bridge_ready = (
                BridgeInstallation.query.filter_by(
                    gym_id=member.gym_id, is_active=True
                ).first()
                is not None
                and bool(member.device_enroll_number)
            )
            if bridge_ready:
                return error_response(
                    "BLOCK_NOT_ALLOWED",
                    "This member cannot be blocked: active members are never blocked. "
                    "Pause or expire the membership first, then block.",
                    409,
                )
        command = queue_manual_adms_member_command(member, action, g.user_id)
        if direct_integration is not None:
            if command is None:
                return error_response(
                    "DEVICE_NOT_READY",
                    "Direct ADMS is configured but not commissioned for access commands. No bridge command was sent.",
                    409,
                )
            # ADMS membership blocks now use the tested reversible Group update.
            # Flush first: the payload carries the queued command's id.
            db.session.flush()
            data_out = {"command": _adms_command_payload(command)}
            if action == "block":
                data_out["note"] = ADMS_GROUP_BLOCK_NOTE
            response_body = {"success": True, "data": data_out}
            record_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="manual_member_access",
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
                    scope="manual_member_access",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if replayed is not None:
                    return replayed
                raise
            return jsonify(response_body), 201
        # Use the bridge only when no direct-ADMS integration is configured.
        bridge_command = queue_manual_bridge_member_command(member, action, g.user_id)
        if bridge_command is None:
            return error_response(
                "DEVICE_NOT_READY",
                "Biometric commands are not available: finish device commissioning and bind this member's enroll number first.",
                409,
            )
        # Flush first: the payload carries the queued command's id.
        db.session.flush()
        data_out = {
            "command": {
                "id": bridge_command.id,
                "command_type": bridge_command.command_type,
                "status": bridge_command.status,
            },
            "connector": "bridge",
        }
        if action == "block":
            data_out["warning"] = (
                "Block switches this member's terminal time-zone to the deny schedule. "
                "Unblock restores it — no re-enrollment needed."
            )
        response_body = {"success": True, "data": data_out}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="manual_member_access",
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
                scope="manual_member_access",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body), 201

    # ── Smart enroll matching ──────────────────────────────────────────
    # Terminal already has users enrolled (names typed on the device)? Don't
    # type each enroll ID by hand: scan the terminal, get name-matched
    # suggestions, confirm with one tap per member.

    @bp.post("/rrr/enroll-scan")
    @limiter.limit("10 per hour")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_scan():
        """Queue a sync_users command: the terminal's user list (enroll number
        + name) comes back for smart matching.

        Prefers the PC-less ADMS path (``DATA QUERY USERINFO``) when the gym
        has a direct-ADMS integration; falls back to the Windows bridge
        (connector ``sync_users``) otherwise.
        """
        from app.models.bridge import BridgeCommand, BridgeInstallation
        from app.models.rrr import RRRAdmsCommand, RRRIntegration
        from app.services.bridge_service import adms_command_text

        # PC-less ADMS path first — gated on supervised commissioning
        # (M12), like every other ADMS command path. An uncommissioned
        # terminal must not be scanned: its user table is untrusted input
        # until the owner has proven the PUSH path with a mapped punch
        # and an acked test command.
        integration = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is not None:
            if not integration.commands_enabled:
                return error_response(
                    "NOT_COMMISSIONED",
                    "Complete supervised commissioning before scanning terminal users.",
                    403,
                )
            # V11-L6: gate on the live 5-min online check, not the sticky
            # stored status (which is set to "connected" on first contact
            # and never reset on timeout) — a terminal offline for days
            # used to get 201 "queued" instead of 409 DEVICE_OFFLINE.
            if not direct_adms_terminal_is_online(integration):
                return error_response(
                    "DEVICE_OFFLINE",
                    "The terminal is not connected.",
                    409,
                )
            # V11-L8: same in-flight guard as the test/advanced/unlock
            # endpoints — repeated taps used to stack sync_users rows and
            # wedge the single-command pipe.
            existing = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == integration.id,
                RRRAdmsCommand.status.in_(("queued", "delivered")),
            ).first()
            if existing is not None:
                return error_response(
                    "COMMAND_PENDING",
                    "A command is already in flight. Wait for acknowledgement.",
                    409,
                )
            cmd = RRRAdmsCommand(
                integration_id=integration.id,
                gym_id=g.gym_id,
                action="sync_users",
                command_text=adms_command_text("sync_users", None),
                requested_by_id=g.user_id,
            )
            db.session.add(cmd)
            db.session.commit()
            return jsonify({"success": True, "data": {
                "command_id": cmd.id,
                "path": "adms",
                "message": "Scan queued. The terminal will upload its user list on its next poll (~seconds). Then open match suggestions.",
            }}), 201

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return error_response("NOT_FOUND", "No paired bridge or ADMS integration for this gym. Pair the PC connector or provision ADMS first.", 404)
        # V11-L8: same in-flight guard on the bridge leg.
        existing_bridge = BridgeCommand.query.filter(
            BridgeCommand.bridge_id == bridge.id,
            BridgeCommand.status.in_(("pending", "leased")),
        ).first()
        if existing_bridge is not None:
            return error_response(
                "COMMAND_PENDING",
                "A command is already in flight. Wait for acknowledgement.",
                409,
            )
        cmd = BridgeCommand(
            bridge_id=bridge.id,
            gym_id=g.gym_id,
            command_type="sync_users",
            enroll_number="SYSTEM",
        )
        db.session.add(cmd)
        db.session.commit()
        return jsonify({"success": True, "data": {
            "command_id": cmd.id,
            "path": "bridge",
            "message": "Scan queued. The connector will read the terminal's user list (~10s). Then open match suggestions.",
        }}), 201

    @bp.get("/rrr/enroll-matches")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_matches():
        """Fuzzy-match the terminal user snapshot against unlinked members.

        V4-M7: served from a 60 s per-gym cache — the PWA polls this
        endpoint every 3 s while waiting for a scan, and each uncached
        call is an O(snapshot x members) fuzzy scan.
        """
        from app.services import enroll_match_service

        result = enroll_match_service.suggest_matches_cached(g.gym_id)
        return jsonify({"success": True, "data": result})

    @bp.get("/rrr/enroll-snapshot-status")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_snapshot_status():
        """Cheap snapshot-presence check (V4-M7).

        The PWA scan poll hits this instead of the full fuzzy scan:
        it only fetches the stored terminal snapshot (one query) and
        reports whether a user list has arrived yet. The caller loads
        the full suggestions once ``has_snapshot`` is true.
        """
        from app.services import enroll_match_service

        # V7-M8: same merged snapshot as the matchers — a stale bridge
        # row must not shadow the live ADMS list here either.
        snapshot = enroll_match_service.get_preferred_terminal_snapshot(
            g.gym_id
        )
        if not snapshot:
            return jsonify({"success": True, "data": {
                "has_snapshot": False,
                "terminal_user_count": 0,
                "acknowledged_at": None,
                "source": None,
            }})
        return jsonify({"success": True, "data": {
            "has_snapshot": True,
            "terminal_user_count": len(snapshot.get("users", [])),
            "acknowledged_at": snapshot.get("acknowledged_at"),
            "source": snapshot.get("source"),
            "command_id": snapshot.get("command_id"),
        }})

    @bp.post("/rrr/enroll-matches/confirm")
    @limiter.limit("60 per hour")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_match_confirm():
        """One-tap confirm: link a member to a terminal enroll number."""
        from app.services import enroll_match_service

        data = request.get_json(silent=True) or {}
        try:
            member_id = int(data.get("member_id"))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "member_id is required.", 422)
        enroll_number = str(data.get("enroll_number") or "").strip()
        if not enroll_number:
            return error_response("VALIDATION_ERROR", "enroll_number is required.", 422)
        # A retry after a successful confirm must replay instead of
        # re-linking (which would hit the already-linked conflict).
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="enroll_match_confirm",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        try:
            member = enroll_match_service.confirm_match(
                g.gym_id, member_id, enroll_number, g.user_id
            )
        except ValueError as exc:
            return error_response("CONFLICT", str(exc), 409)
        # V3-L14: confirm_match only flushes now (it runs inside
        # normalize_attendance's savepoint during ingest) — the direct
        # endpoint caller owns the commit.
        response_body = {"success": True, "data": {
            "member_id": member.id,
            "member_name": member.full_name,
            "enroll_number": member.device_enroll_number,
            "message": f"{member.full_name} linked to terminal user {member.device_enroll_number}.",
        }}
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="enroll_match_confirm",
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
                scope="enroll_match_confirm",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.post("/rrr/enroll-matches/auto-link")
    @limiter.limit("30 per hour")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_match_auto_link():
        """Automatically link high-confidence matches (e.g., spacing differences).

        V4-M7: gated on the shared auto-link throttle — each call is a
        full-gym fuzzy scan, so a manual caller may not re-run it more
        than once per interval. When throttled, the cached suggestions
        are returned with ``throttled: True`` instead of running a scan.
        """
        from app.services import enroll_match_service

        if not enroll_match_service.auto_link_scan_due(g.gym_id):
            cached = enroll_match_service.suggest_matches_cached(g.gym_id)
            return jsonify({"success": True, "data": {
                "linked": [],
                "skipped": [],
                "throttled": True,
                "message": "Auto-link scan ran recently — try again in a few minutes.",
                "suggestions": cached.get("suggestions", []),
            }})
        result = enroll_match_service.auto_link_high_confidence(g.gym_id, g.user_id)
        # V3-L14: auto-link only flushes (via confirm_match) — commit here.
        db.session.commit()
        return jsonify({"success": True, "data": result})

    @bp.get("/rrr/member/<int:member_id>/attendance")
    @token_required
    @roles_required("gym_owner", "staff")
    def member_attendance_history(member_id: int):
        """Per-member punch history from the biometric terminal."""
        from app.models.member import Member
        from app.models.rrr import RRRAttendanceEvent

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if not member or member.deleted_at:
            return error_response("NOT_FOUND", "Member not found.", 404)

        # Get pagination params (L1: tolerate non-numeric input)
        try:
            page = max(1, int(request.args.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            per_page = min(100, max(10, int(request.args.get("per_page", 30))))
        except (TypeError, ValueError):
            per_page = 30

        query = RRRAttendanceEvent.query.filter_by(
            gym_id=g.gym_id, member_id=member_id
        ).order_by(RRRAttendanceEvent.punch_time.desc())

        total = query.count()
        events = query.offset((page - 1) * per_page).limit(per_page).all()

        # Summary stats
        from datetime import datetime, timedelta, timezone
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        recent_count = RRRAttendanceEvent.query.filter(
            RRRAttendanceEvent.gym_id == g.gym_id,
            RRRAttendanceEvent.member_id == member_id,
            RRRAttendanceEvent.punch_time >= thirty_days_ago,
        ).count()

        return jsonify({"success": True, "data": {
            "member": {
                "id": member.id,
                "name": member.full_name,
                "enroll_number": member.device_enroll_number,
                "status": member.status,
            },
            "events": [{
                "id": e.id,
                "punch_time": e.punch_time.isoformat() if e.punch_time else None,
                "biometric_user_id": e.biometric_user_id,
                "device_serial": e.device_serial,
                "verify_method": e.verify_method,
                "direction": e.direction,
                "source": e.source,
            } for e in events],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": (total + per_page - 1) // per_page,
            },
            "stats": {
                "total_punches": total,
                "last_30_days": recent_count,
            },
        }})

    @bp.route("/rrr/bulk-remove-expired", methods=["GET", "POST"])
    @limiter.limit("10 per hour")
    @token_required
    @roles_required("gym_owner")
    def bulk_remove_expired():
        """Block terminal access for all expired members (owner requested).
        
        Queues the connector's reversible access-block command for eligible
        members. Renewals restore access through the same connector.
        """
        from app.models.gym import Gym
        from app.models.member import Member
        from app.services.bridge_service import (
            member_is_proven_blockable,
            queue_membership_command,
        )
        from app.services.audit_service import audit
        from app.services.timezone_service import today_for_gym

        # POST only: a retry after queueing blocks for every expired
        # member must replay the stored counts, not queue a second
        # block per member. The GET branch is a plain read and never
        # takes a key.
        idempotency_key, request_hash, replay = (None, "", None)
        if request.method == "POST":
            idempotency_key, request_hash, replay = begin_idempotency(
                gym_id=g.gym_id,
                user_id=g.user_id,
                scope="bulk_remove_expired",
                headers=request.headers,
                payload={},
            )
            if replay is not None:
                return replay

        # M8: "today" is gym-local, not UTC — the UTC date lags IST by
        # 5:30, and the day boundary is exactly where the fail-safe
        # guard's blockability decision lives.
        gym = db.session.get(Gym, g.gym_id)
        today = today_for_gym(gym.timezone if gym else "Asia/Kolkata")

        # V4-L7: mirror the scheduler's reconcile filter (V3-M8) — expired
        # with a past end, or paused (freeze = blockable on any dates) —
        # with a terminal identity via enroll number OR a confirmed
        # mapping. Mapping-only members were invisible here, and paused
        # members were never counted at all. Active members with a past
        # end are NOT blockable, but they stay in the target set so the
        # response still reports them as skipped_not_blockable (pinned by
        # test_bulk_remove_uses_blockable_filter_and_never_mutates_status)
        # instead of silently dropping them.
        mapping_member_ids = select(RRRIdentityMapping.member_id).where(
            RRRIdentityMapping.gym_id == g.gym_id,
            RRRIdentityMapping.status == "confirmed",
        )
        blockable = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.is_(None),
            or_(
                and_(
                    Member.status.in_(["expired", "inactive"]),
                    Member.membership_end < today,
                ),
                Member.status == "paused",
            ),
            or_(
                Member.device_enroll_number.isnot(None),
                Member.id.in_(mapping_member_ids),
            ),
        ).all()
        overdue_active = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.is_(None),
            Member.device_enroll_number.isnot(None),
            Member.status == "active",
            Member.membership_end < today,
        ).all()
        all_targets = list({m.id: m for m in blockable + overdue_active}.values())

        # M8: never mutate member status as a side effect of a device
        # command. Queueing derives the desired state from the UNMUTATED
        # member row, and only members the fail-safe guard would actually
        # serve (proven blockable) are queued. Everyone else — notably
        # active members with a past end date, whose status transition
        # belongs to the expiry flow, not to this endpoint — is reported
        # as skipped, not silently queued for a serve-time cancel.
        queued = 0
        skipped = 0
        skipped_not_ready = 0
        for member in all_targets:
            if not member_is_proven_blockable(member):
                skipped += 1
                continue
            cmd = queue_membership_command(member, force=True)
            if cmd:
                queued += 1
            else:
                skipped_not_ready += 1

        response_body = {"success": True, "data": {
            "queued": queued,
            "total": len(all_targets),
            "skipped_not_blockable": skipped,
            "skipped_terminal_not_ready": skipped_not_ready,
            "message": (
                f"Queued access blocks for {queued} expired members. The terminal will apply them on its next poll."
                + (f" {skipped} members were skipped: they are not proven blockable "
                   "(e.g. still active) — expire them through the membership flow first."
                   if skipped else "")
                + (f" {skipped_not_ready} members were not queued because the commissioned terminal is unavailable."
                   if skipped_not_ready else "")
                + " Direct ADMS uses Grp=100 and preserves the terminal user and fingerprint."
            ),
        }}
        # V10-M1: audit BEFORE the commit — an audit staged after the
        # final commit is rolled back by teardown and lost in prod.
        audit(
            action="bulk_remove_expired",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"members_queued": queued, "total_expired": len(all_targets),
                      "skipped_not_blockable": skipped,
                      "skipped_terminal_not_ready": skipped_not_ready},
        )
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="bulk_remove_expired",
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
                scope="bulk_remove_expired",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.post("/rrr/members/<int:member_id>/remove-from-terminal")
    @limiter.limit("60 per hour")
    @token_required
    @roles_required("gym_owner")
    def remove_member_from_terminal(member_id):
        """Queue the member's current membership state to the terminal."""
        from app.models.member import Member
        from app.services.bridge_service import queue_membership_command
        from app.services.audit_service import audit

        # A retry after a queued block must replay instead of queueing
        # a second terminal command. Key is bound to this member.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="remove_member_from_terminal",
            headers=request.headers,
            payload={"member_id": member_id},
        )
        if replay is not None:
            return replay

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if not member:
            return jsonify({"success": False, "error": "Member not found"}), 404
        if not member.device_enroll_number:
            return jsonify({"success": False, "error": "Member has no terminal enroll number"}), 400
        # M8: refuse active members outright instead of queueing a
        # command that does the opposite of this endpoint's name (an
        # enable, via desired-state derivation) or one the serve-time
        # guard will cancel — with a success message either way.
        if member.status == "active":
            return jsonify({"success": False, "error": (
                "Member is still active. Blocking from the terminal is only "
                "available for expired, inactive, or paused members; expire "
                "the membership first."
            )}), 400

        cmd = queue_membership_command(member, force=True)
        if cmd is None:
            return error_response(
                "DEVICE_NOT_READY",
                "No commissioned terminal is available to receive this block command.",
                409,
            )
        response_body = {"success": True, "data": {
            "queued": bool(cmd),
            "message": f"Queued terminal block for {member.full_name or member.id}. Direct ADMS uses Grp=100 and preserves the terminal user and fingerprint.",
        }}
        # V10-M1: audit BEFORE the commit — an audit staged after the
        # final commit is rolled back by teardown and lost in prod.
        audit(
            action="remove_member_from_terminal",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"enroll_number": member.device_enroll_number,
                      "method": "membership_state_block"},
        )
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="remove_member_from_terminal",
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
                scope="remove_member_from_terminal",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.post("/rrr/restore-deleted-members")
    @limiter.limit("5 per hour")
    @token_required
    @roles_required("gym_owner")
    def restore_deleted_members():
        """Restore all soft-deleted members for this gym (undo bulk delete)."""
        from app.models.member import Member
        from app.services.audit_service import audit
        from app.services.bridge_service import queue_membership_command
        from app.services.reminder_service import today_for_gym
        from app.models.gym import Gym

        # The body is empty, so the key alone identifies the action:
        # a retry after a restore must replay the stored counts, not
        # restore (and re-unblock) an already-restored set.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="restore_deleted_members",
            headers=request.headers,
            payload={},
        )
        if replay is not None:
            return replay

        gym = Gym.query.get(g.gym_id)
        local_today = today_for_gym(gym.timezone or "Asia/Kolkata") if gym else None

        members = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.isnot(None),
        ).all()

        restored = 0
        unblocks_queued = 0
        # V3-M4: pre-delete statuses, from the soft_delete_member audit
        # entries (recorded at delete time). A member frozen (paused)
        # before deletion must come back paused with the door closed —
        # not active with a fresh unblock queued. Members deleted before
        # this was recorded have no entry and fall back to the old
        # expired/active logic below.
        delete_notes = {}
        if members:
            from app.models.audit_log import AuditLog

            entries = (
                AuditLog.query.filter(
                    AuditLog.gym_id == g.gym_id,
                    AuditLog.action == "soft_delete_member",
                    AuditLog.resource_type == "member",
                    AuditLog.resource_id.in_([str(m.id) for m in members]),
                )
                .order_by(AuditLog.created_at.desc())
                .all()
            )
            for e in entries:
                rid = str(e.resource_id)
                if rid not in delete_notes:
                    delete_notes[rid] = (e.metadata_json or {}).get("previous_status")
        for m in members:
            m.deleted_at = None
            # Set correct status based on the pre-delete status first,
            # then on the membership end date. V4-M18: paused is
            # checked BEFORE expiry — a member frozen while their end
            # passed must restore as paused, not expired (an
            # expired restore would reactivate them on the next
            # renewal while freeze markers still sit in notes).
            # Paused restores keep the door closed (no unblock queued
            # — the active-only check below handles it).
            prev_status = delete_notes.get(str(m.id))
            if prev_status == "paused":
                m.status = "paused"
            elif m.membership_end and local_today and m.membership_end < local_today:
                m.status = "expired"
            elif m.status == "deleted":
                m.status = "active"
            restored += 1
            # H5: a restored active member was Grp=100-blocked on the
            # terminal while deleted; queue the unblock now or the paying
            # member stays locked out with no self-healing (the scheduler
            # only re-queues blocks). Expired/paused restores keep the door
            # closed, so only active restores with a known end date queue.
            # force=True: a stale acked unblock must not stand in for a
            # fresh command after the member was deleted and restored.
            if m.status == "active" and m.membership_end is not None:
                try:
                    if queue_membership_command(m, force=True) is not None:
                        unblocks_queued += 1
                except Exception:
                    # One bad terminal identity must not fail the restore
                    # of every member; the member is restored and the
                    # unblock can be queued from the member screen instead.
                    current_app.logger.exception(
                        "restore: could not queue unblock for member %s", m.id
                    )

        response_body = {"success": True, "data": {
            "restored": restored,
            "unblocks_queued": unblocks_queued,
            "message": f"Restored {restored} members.",
        }}
        # V10-M1: audit BEFORE the commit — an audit staged after the
        # final commit is rolled back by teardown and lost in prod.
        audit(
            action="bulk_restore_members",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"restored": restored, "unblocks_queued": unblocks_queued},
        )
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="restore_deleted_members",
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
                scope="restore_deleted_members",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise

        return jsonify(response_body)

    @bp.delete("/rrr/attendance/unmapped")
    @token_required
    @roles_required("gym_owner")
    def clear_unmapped_punches():
        """Delete all unmapped punch entries for this gym.

        Owner-only (V10-L5): wiping the whole mapping queue /
        unattributed attendance history in one call is destructive and
        must not be a staff action.

        Removes RRRAttendanceEvent rows with no linked member (member_id IS NULL).
        Mapped punches and members are untouched. Used to clean the slate
        before manual re-linking.
        """
        from sqlalchemy import func as _func

        from app.models.rrr import RRRIntegration

        # V11-L9: the rows deleted here were counted in
        # integration.unmapped_records at ingest — decrement each
        # integration's counter by its resolved share (floored at 0),
        # or the PWA "unknown punches" number never comes down.
        resolved_counts = (
            db.session.query(
                RRRAttendanceEvent.integration_id,
                _func.count(RRRAttendanceEvent.id),
            )
            .filter(
                RRRAttendanceEvent.gym_id == g.gym_id,
                RRRAttendanceEvent.member_id.is_(None),
                RRRAttendanceEvent.processing_status == "unmapped",
                RRRAttendanceEvent.integration_id.is_not(None),
            )
            .group_by(RRRAttendanceEvent.integration_id)
            .all()
        )
        deleted = RRRAttendanceEvent.query.filter(
            RRRAttendanceEvent.gym_id == g.gym_id,
            RRRAttendanceEvent.member_id.is_(None),
        ).delete(synchronize_session=False)
        for integration_id, resolved in resolved_counts:
            row = db.session.get(RRRIntegration, integration_id)
            if row is not None and row.gym_id == g.gym_id:
                row.unmapped_records = max(0, row.unmapped_records - resolved)
        # V10-M1: audit BEFORE the commit.
        audit(
            action="rrr_clear_unmapped_punches",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"deleted": deleted},
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"deleted": deleted}})

