"""Owner-facing RRR Growth System API."""
from __future__ import annotations
import secrets

from decimal import Decimal
import re
from urllib.parse import urlparse

from flask import current_app, g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member
from app.models.rrr import RRRAttendanceEvent, RRRAdmsCommand, RRRDevice, RRRIntegration, RRROpportunity, RRRRule
from app.services.audit_service import audit
from app.services.bridge_service import adms_command_text, queue_manual_adms_member_command
from app.services.rrr_service import (
    DEFAULT_RULES,
    adms_terminal_settings,
    dashboard_for_gym,
    ensure_default_rules,
    integration_payload,
    remap_unresolved,
    rules_for_gym,
)


def _direct_adms_command_text(action: str, enroll_number: str | None) -> str:
    """Return only documented, server-generated PUSH SDK test commands.

    The wire format is shared with the automatic membership commands in
    ``app.services.bridge_service.adms_command_text``; this wrapper keeps the
    owner-driven commissioning endpoint on the same bytes.
    """

    return adms_command_text(action, enroll_number)


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
        data = dashboard_for_gym(g.gym_id, g.current_user.gym.timezone or "Asia/Kolkata")
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
        status = str(payload.get("status") or "").lower()
        if status not in {"open", "actioned", "closed", "dismissed"}:
            return error_response("VALIDATION_ERROR", "Invalid opportunity status.", 422)
        row.status = status
        if status == "actioned":
            from app.models.mixins import utcnow
            row.actioned_at = utcnow()
        if status == "closed":
            from app.models.mixins import utcnow
            row.closed_at = utcnow()
            try:
                row.outcome_revenue = Decimal(str(payload.get("outcome_revenue") or 0))
            except Exception:
                return error_response("VALIDATION_ERROR", "outcome_revenue must be a number.", 422)
        audit(action="rrr_opportunity_updated", resource_type="rrr_opportunity", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"status": status})
        db.session.commit()
        return jsonify({"success": True, "data": {"id": row.id, "status": row.status}})

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
        return jsonify({"success": True, "data": {
            "integrations": [integration_payload(x) for x in rows],
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
    @token_required
    @roles_required("gym_owner")
    def provision_direct_adms():
        """Register one terminal serial for direct, cloud ADMS attendance.

        Access-control automation is deliberately not enabled by this route.
        Owners can later run a narrowly scoped, acknowledged test command.
        """
        payload = request.get_json(silent=True) or {}
        serial = str(payload.get("device_serial") or "").strip()[:120]
        name = str(payload.get("device_name") or "Elite Gym eSSL terminal").strip()[:160]
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
            row = RRRIntegration(
                gym_id=g.gym_id, connector_type="adms_direct", display_name="Direct eSSL ADMS",
            )
            db.session.add(row)
        row.device_serial = serial
        row.device_name = name
        if not row.adms_path_token:
            row.adms_path_token = secrets.token_urlsafe(32)
        row.status = "not_configured"
        row.commands_enabled = False
        row.commissioning_status = "not_started"
        audit(action="direct_adms_provisioned", resource_type="rrr_integration", resource_id=row.id,
              gym_id=g.gym_id, actor_id=g.user_id, metadata={"serial": serial})
        db.session.commit()
        settings = adms_terminal_settings(request.host_url, path_token=row.adms_path_token)
        settings["warning"] = (
            "Attendance works immediately. Automatic block/unblock unlocks after "
            "the supervised commissioning test on the integrations screen."
        )
        return jsonify({"success": True, "data": {
            "integration": integration_payload(row),
            "terminal_settings": settings,
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
        if integration.status != "connected":
            return error_response("DEVICE_OFFLINE", "Wait until the terminal is connected before queuing a test.", 409)
        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"probe_info", "block_test", "unblock_test", "sync_users", "delete_biodata_test", "delete_fingertmp_test"}:
            return error_response("VALIDATION_ERROR", "action must be probe_info, block_test, unblock_test, sync_users, delete_biodata_test, or delete_fingertmp_test.", 422)
        enroll_number = None
        if action not in {"probe_info", "sync_users"}:
            enroll_number = str(payload.get("test_enroll_number") or "").strip()
            if not re.fullmatch(r"[1-9][0-9]{0,8}", enroll_number):
                return error_response("VALIDATION_ERROR", "test_enroll_number must be a 1–9 digit number.", 422)
        existing = RRRAdmsCommand.query.filter(
            RRRAdmsCommand.integration_id == integration.id,
            RRRAdmsCommand.status.in_(("queued", "delivered")),
        ).first()
        if existing is not None:
            # Stuck-command timeout: if a command has been delivered for >5 min
            # without ack, the terminal likely already executed it but the ack
            # was lost. Mark it timed out so testing isn't blocked forever.
            try:
                from datetime import timedelta, timezone as tz
                from app.models.mixins import utcnow
                stuck_cutoff = utcnow() - timedelta(minutes=5)
                delivered_at = existing.delivered_at or existing.created_at
                if delivered_at is not None and delivered_at.tzinfo is None:
                    delivered_at = delivered_at.replace(tzinfo=tz.utc)
                if existing.status == "delivered" and delivered_at and delivered_at < stuck_cutoff:
                    existing.status = "failed"
                    db.session.commit()
                    existing = None
            except Exception:
                db.session.rollback()
                # Don't let the timeout check break the endpoint; fall through
                # to the normal pending-command guard.
                pass
        if existing is not None:
            return error_response("COMMAND_PENDING", "Wait for the current terminal command acknowledgement before sending another test.", 409)
        command_text = _direct_adms_command_text(action, enroll_number)
        row = RRRAdmsCommand(
            gym_id=g.gym_id, integration_id=integration.id, action=action,
            test_enroll_number=enroll_number, command_text=command_text,
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
          - delete_user: Delete a user from the terminal
          - unlock_door: Remotely unlock the door relay
          - clear_log:   Clear attendance logs from the device
          - reboot:      Reboot the terminal
          - check:       Request device status check
        """
        integration = RRRIntegration.query.filter_by(
            id=integration_id, gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is None:
            return error_response("NOT_FOUND", "Direct Cloud integration was not found.", 404)
        if integration.status != "connected":
            return error_response("DEVICE_OFFLINE", "The terminal is not connected.", 409)
        if not integration.commands_enabled:
            return error_response(
                "NOT_COMMISSIONED",
                "Complete supervised commissioning before sending device commands.",
                403,
            )

        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        allowed = {"create_user", "delete_user", "unlock_door", "clear_log", "reboot", "check"}
        if action not in allowed:
            return error_response("VALIDATION_ERROR", f"action must be one of: {', '.join(sorted(allowed))}.", 422)

        enroll_number = None
        member_name = None
        delay_seconds = 5

        if action in {"create_user", "delete_user"}:
            enroll_number = str(payload.get("enroll_number") or payload.get("test_enroll_number") or "").strip()
            if not re.fullmatch(r"[1-9][0-9]{0,8}", enroll_number):
                return error_response("VALIDATION_ERROR", "enroll_number must be a 1–9 digit number.", 422)
        if action == "create_user":
            member_name = str(payload.get("member_name") or payload.get("name") or "Member").strip()[:24]
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
        return jsonify({"success": True, "data": {"command": _adms_command_payload(row)}}), 201

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
        attendance_exists = attendance_query.first()
        if attendance_exists is None:
            return error_response("COMMISSIONING_REQUIRED", "A mapped real attendance event from the selected device is required before commands can be enabled.", 409)
        if row.connector_type == "adms_direct":
            # Machine proof that the PUSH command/acknowledgement path works
            # both ways: the owner must have run at least one commissioning
            # test command that the terminal acknowledged.
            acked_test = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == row.id,
                RRRAdmsCommand.action.in_(("probe_info", "block_test", "unblock_test")),
                RRRAdmsCommand.status == "acked",
            ).first()
            if acked_test is None:
                return error_response(
                    "COMMISSIONING_REQUIRED",
                    "Run a test command from the integration screen and wait for the terminal to acknowledge it before enabling automatic commands.",
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
        rows = RRRAttendanceEvent.query.filter_by(gym_id=g.gym_id, processing_status="unmapped").order_by(RRRAttendanceEvent.punch_time.desc()).all()
        return jsonify({"success": True, "data": {"events": [
            {"id": x.id, "biometric_user_id": x.biometric_user_id, "punch_time": x.punch_time.isoformat(),
             "source": x.source, "device_serial": x.device_serial} for x in rows
        ]}})

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
        results = []
        for item in mappings:
            external_id = str(item.get("external_id") or "").strip()
            try:
                member_id = int(item.get("member_id"))
            except (TypeError, ValueError):
                results.append({"external_id": external_id, "ok": False, "error": "member_id required"})
                continue
            if not external_id:
                results.append({"external_id": external_id, "ok": False, "error": "external_id required"})
                continue
            member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
            if member is None:
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
        db.session.commit()
        ok_count = sum(1 for r in results if r["ok"])
        return jsonify({"success": True, "data": {"linked": ok_count, "total": len(results), "results": results}})

    @bp.post("/rrr/mappings/<string:external_id>")
    @token_required
    @roles_required("gym_owner", "staff")
    def resolve_mapping(external_id: str):
        payload = request.get_json(silent=True) or {}
        try:
            member_id = int(payload.get("member_id"))
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "member_id is required.", 422)
        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if member is None:
            return error_response("NOT_FOUND", "Member was not found.", 404)
        external_id = external_id.strip()
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
              actor_id=g.user_id, metadata={"external_id": external_id, "events_replayed": resolved})
        db.session.commit()
        return jsonify({"success": True, "data": {"member_id": member.id, "events_resolved": resolved}})

    @bp.post("/rrr/members/<int:member_id>/access")
    @limiter.limit("30 per hour")
    @token_required
    @roles_required("gym_owner")
    def manual_member_access(member_id: int):
        """Owner-initiated block/unblock of one member's biometric access.

        Queues a ``block``/``unblock`` ADMS command for the member's terminal
        identity. Gated on supervised commissioning (``commands_enabled``) and
        on the member having a bound enroll number — same safety bar as the
        automatic path. The terminal picks the command up on its next poll.
        """
        payload = request.get_json(silent=True) or {}
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"block", "unblock"}:
            return error_response("VALIDATION_ERROR", "action must be 'block' or 'unblock'.", 422)
        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if member is None or member.deleted_at is not None:
            return error_response("NOT_FOUND", "Member was not found.", 404)
        command = queue_manual_adms_member_command(member, action, g.user_id)
        if command is None:
            return error_response(
                "DEVICE_NOT_READY",
                "Biometric commands are not available: finish device commissioning and bind this member's enroll number first.",
                409,
            )
        db.session.commit()
        return jsonify({"success": True, "data": {"command": _adms_command_payload(command)}}), 201

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

        # PC-less ADMS path first.
        integration = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is not None:
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
        """Fuzzy-match the terminal user snapshot against unlinked members."""
        from app.services import enroll_match_service

        result = enroll_match_service.suggest_matches(g.gym_id)
        return jsonify({"success": True, "data": result})

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
        try:
            member = enroll_match_service.confirm_match(
                g.gym_id, member_id, enroll_number, g.user_id
            )
        except ValueError as exc:
            return error_response("CONFLICT", str(exc), 409)
        return jsonify({"success": True, "data": {
            "member_id": member.id,
            "member_name": member.full_name,
            "enroll_number": member.device_enroll_number,
            "message": f"{member.full_name} linked to terminal user {member.device_enroll_number}.",
        }})

    @bp.post("/rrr/enroll-matches/auto-link")
    @limiter.limit("30 per hour")
    @token_required
    @roles_required("gym_owner", "staff")
    def enroll_match_auto_link():
        """Automatically link high-confidence matches (e.g., spacing differences)."""
        from app.services import enroll_match_service

        result = enroll_match_service.auto_link_high_confidence(g.gym_id, g.user_id)
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
        from datetime import datetime, timezone
        from sqlalchemy import func
        thirty_days_ago = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        # Use date comparison
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
        """Remove all expired members from the terminal (owner requested).
        
        Queues DELETE commands for all expired members with enroll numbers.
        Owner will re-add them on renewal (auto-unblock handles it).
        """
        from app.models.member import Member
        from app.services.bridge_service import queue_membership_command
        from app.services.audit_service import audit

        # Find all expired members with terminal enroll numbers
        expired = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.is_(None),
            Member.device_enroll_number.isnot(None),
            Member.status.in_(["expired", "inactive"]),
        ).all()

        # Also catch active members with past end date (not yet auto-expired)
        from datetime import date
        from app.models.mixins import utcnow
        today = utcnow().date()
        overdue = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.is_(None),
            Member.device_enroll_number.isnot(None),
            Member.status == "active",
            Member.membership_end < today,
        ).all()

        all_targets = {m.id: m for m in expired + overdue}.values()
        
        queued = 0
        for member in all_targets:
            # Ensure status is expired
            if member.status == "active":
                member.status = "expired"
            cmd = queue_membership_command(member, force=True)
            if cmd:
                queued += 1

        db.session.commit()
        
        audit(
            action="bulk_remove_expired",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"members_queued": queued, "total_expired": len(list(all_targets))},
        )

        return jsonify({"success": True, "data": {
            "queued": queued,
            "total": len(list(all_targets)),
            "message": f"Queued removal for {queued} expired members. Terminal will block them on next poll.",
        }})

    @bp.post("/rrr/members/<int:member_id>/remove-from-terminal")
    @limiter.limit("60 per hour")
    @token_required
    @roles_required("gym_owner")
    def remove_member_from_terminal(member_id):
        """Queue DELETE command for a single member (removes from terminal only, not from app)."""
        from app.models.member import Member
        from app.services.bridge_service import queue_membership_command
        from app.services.audit_service import audit

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).first()
        if not member:
            return jsonify({"success": False, "error": "Member not found"}), 404
        if not member.device_enroll_number:
            return jsonify({"success": False, "error": "Member has no terminal enroll number"}), 400

        cmd = queue_membership_command(member, force=True)
        db.session.commit()

        audit(
            action="remove_member_from_terminal",
            resource_type="member",
            resource_id=member.id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"enroll_number": member.device_enroll_number},
        )

        return jsonify({"success": True, "data": {
            "queued": bool(cmd),
            "message": f"Queued removal for {member.full_name or member.id}",
        }})

    @bp.post("/rrr/restore-deleted-members")
    @limiter.limit("5 per hour")
    @token_required
    @roles_required("gym_owner")
    def restore_deleted_members():
        """Restore all soft-deleted members for this gym (undo bulk delete)."""
        from app.models.member import Member
        from app.services.audit_service import audit
        from app.services.reminder_service import today_for_gym
        from app.models.gym import Gym

        gym = Gym.query.get(g.gym_id)
        local_today = today_for_gym(gym.timezone or "Asia/Kolkata") if gym else None

        members = Member.query.filter(
            Member.gym_id == g.gym_id,
            Member.deleted_at.isnot(None),
        ).all()

        restored = 0
        for m in members:
            m.deleted_at = None
            # Set correct status based on membership end date
            if m.membership_end and local_today and m.membership_end < local_today:
                m.status = "expired"
            elif m.status == "deleted":
                m.status = "active"
            restored += 1

        db.session.commit()

        audit(
            action="bulk_restore_members",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"restored": restored},
        )

        return jsonify({"success": True, "data": {
            "restored": restored,
            "message": f"Restored {restored} members.",
        }})

    @bp.delete("/rrr/attendance/unmapped")
    @token_required
    @roles_required("gym_owner", "staff")
    def clear_unmapped_punches():
        """Delete all unmapped punch entries for this gym.

        Removes RRRAttendanceEvent rows with no linked member (member_id IS NULL).
        Mapped punches and members are untouched. Used to clean the slate
        before manual re-linking.
        """
        deleted = RRRAttendanceEvent.query.filter(
            RRRAttendanceEvent.gym_id == g.gym_id,
            RRRAttendanceEvent.member_id.is_(None),
        ).delete(synchronize_session=False)
        db.session.commit()

        audit(
            action="rrr_clear_unmapped_punches",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.user_id,
            metadata={"deleted": deleted},
        )
        return jsonify({"success": True, "data": {"deleted": deleted}})

