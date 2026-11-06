"""Mobile API access endpoints for the Live Access feature.

Physical unlock is available only as an owner-confirmed command through the
commissioned connector. Direct ADMS takes priority over a paired legacy bridge,
and the response reports that a command was queued rather than claiming the
door has already opened.
"""
from __future__ import annotations

from datetime import timezone
from flask import g, jsonify, request
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.models.bridge import BridgeCommand, BridgeInstallation
from app.models.member import Member
from app.models.mixins import utcnow
from app.services.access_event_service import (
    get_access_events,
    get_access_summary,
    get_members_inside,
    has_legacy_attendance_events,
    record_manual_access_event,
    _serialize_access_event,
)
from app.services.audit_service import audit
from app.services.bridge_service import (
    STALE_ENABLE_ERROR,
    STALE_ENABLE_MARKER,
    bridge_command_must_be_cancelled,
    bridge_enable_must_be_cancelled,
    cancel_bridge_command,
    queue_gym_reconciliation,
)
from app.services.idempotency_service import (
    begin_idempotency,
    record_idempotency,
    replay_after_conflict,
)


def register_access_routes(bp):
    @bp.route("/access/summary", methods=["GET"])
    @bp.route("/access/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_summary():
        """Live Access summary: inside count, entries/exits/denied today, device & bridge status."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        summary = get_access_summary(g.gym_id, gym_timezone)
        # Telemetry and hardware health
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id).first()
        if bridge:
            now = utcnow()
            hb = bridge.last_heartbeat_at
            if hb and hb.tzinfo is None:
                hb = hb.replace(tzinfo=timezone.utc)
            hb_age = (now - hb).total_seconds() if hb else None
            is_online = hb_age is not None and hb_age <= 120 and bridge.is_active

            pending_count = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="pending").count()
            failed_count = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").count()

            summary["remote_unlock_available"] = is_online
            summary["remote_unlock_reason"] = None if is_online else "Bridge PC is currently offline."
            summary["bridge_provisioned"] = True
            summary["bridge_online"] = is_online
            summary["device_online"] = is_online
            summary["device_serial"] = bridge.device_serial
            summary["installed_version"] = bridge.installed_version
            summary["pending_commands"] = pending_count
            summary["failed_commands"] = failed_count
            summary["heartbeat_age_seconds"] = int(hb_age) if hb_age is not None else None
        else:
            summary["remote_unlock_available"] = False
            # Don't show "No biometric bridge paired" when Direct Cloud is active
            if summary.get("adms_integration_id"):
                summary["remote_unlock_reason"] = "Remote unlock needs the bridge PC. Direct Cloud terminal is connected for attendance."
            else:
                summary["remote_unlock_reason"] = "No biometric bridge paired."
            summary["bridge_provisioned"] = False
            summary["bridge_online"] = False
            summary["device_online"] = False
            summary["pending_commands"] = 0
            summary["failed_commands"] = 0
            summary["heartbeat_age_seconds"] = None

        # Include direct ADMS integration status for the sync button.
        from app.models.rrr import RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms:
            from app.models.rrr import RRRAdmsCommand
            from app.services.access_event_service import adms_device_status

            summary["adms_integration_id"] = adms.id
            # A prior successful connection is not proof that the terminal
            # can receive commands now. Use the same five-minute authenticated
            # poll check as Direct Cloud commissioning (shared helper, also
            # used by get_access_summary for the dashboard — V3-M12).
            adms_status = adms_device_status(g.gym_id) or {}
            summary["adms_online"] = adms_status.get("adms_online", False)
            summary["adms_last_seen_at"] = adms_status.get("adms_last_seen_at")
            summary["adms_commands_enabled"] = bool(adms.commands_enabled)
            summary["adms_device_name"] = adms_status.get("adms_device_name")
            # Direct ADMS is authoritative when configured, even if a legacy
            # bridge is still paired. Never advertise or operate its TCP path.
            summary["remote_unlock_available"] = bool(
                summary["adms_online"] and adms.commands_enabled
            )
            summary["remote_unlock_path"] = "adms"
            summary["remote_unlock_reason"] = (
                None if summary["remote_unlock_available"]
                else "Complete supervised Direct ADMS setup and reconnect the terminal before remote unlock."
            )
            # V4-L11: only let ADMS override the bridge's device state
            # when the terminal is actually online. A disconnected ADMS
            # integration used to force device_online=False (and its
            # name) over a live bridge. When ADMS is offline, the bridge
            # heartbeat set above stands.
            if summary["adms_online"]:
                summary["device_online"] = True
                summary["device_name"] = summary["adms_device_name"]
                summary["device_serial"] = adms.device_serial
            # Hide stale legacy bridge queues from the ADMS-only access UI.
            summary["pending_commands"] = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == adms.id,
                RRRAdmsCommand.status.in_(["queued", "delivered"]),
            ).count()
            summary["failed_commands"] = 0
        else:
            summary["adms_integration_id"] = None
            summary["adms_online"] = False
            summary["adms_last_seen_at"] = None
            summary["adms_commands_enabled"] = False
            summary["adms_device_name"] = None

        # The top status card should show live if EITHER the bridge or the
        # direct ADMS terminal is online. Prefer the ADMS device name when
        # only ADMS is connected.
        if summary.get("adms_online") and not summary.get("device_online"):
            summary["device_online"] = True
            summary["device_name"] = summary.get("adms_device_name")
            summary["device_serial"] = adms.device_serial if adms else None

        resp = jsonify({"success": True, "data": summary})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/events", methods=["GET"])
    @bp.route("/access/log", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_events():
        """Paginated access event feed with filters."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        page = request.args.get("page", 1, type=int)
        per_page = min(
            request.args.get("per_page", request.args.get("page_size", 25, type=int), type=int),
            100,
        )
        event_type = request.args.get("type", None)
        search = request.args.get("search", None)
        date_filter = request.args.get("date", "today")

        if event_type and event_type not in ("entry", "exit", "denied"):
            event_type = None

        try:
            result = get_access_events(
                g.gym_id,
                gym_timezone,
                page=page,
                per_page=per_page,
                event_type=event_type,
                search=search,
                date_filter=date_filter,
            )
        except ValueError as exc:
            # V3-L12: unknown date_filter values are a 400, not an
            # all-time feed.
            from app.mobile_api.errors import error_response

            return error_response("VALIDATION_ERROR", str(exc), 400)
        result["log"] = result.get("events", [])
        resp = jsonify({"success": True, "data": result})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/inside", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_inside():
        """Paginated list of members currently inside the gym."""
        page = request.args.get("page", 1, type=int)
        per_page = min(
            request.args.get("per_page", request.args.get("page_size", 50, type=int), type=int),
            100,
        )
        search = request.args.get("search", None)

        result = get_members_inside(
            g.gym_id,
            page=page,
            per_page=per_page,
            search=search,
        )
        resp = jsonify({"success": True, "data": result})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/access/checkin", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_checkin():
        """Record manual member check-in or check-out directly from the app."""
        data = request.get_json(silent=True) or {}
        member_id = data.get("member_id")
        event_type = (data.get("type") or data.get("event_type") or "ENTRY").upper()
        if not member_id:
            return jsonify({"success": False, "error": {"message": "member_id is required"}}), 400

        member = Member.query.filter_by(id=member_id, gym_id=g.gym_id).filter(Member.deleted_at.is_(None)).first()
        if not member:
            return jsonify({"success": False, "error": {"message": "Member not found"}}), 404

        # A retry after a successful check-in must replay the stored
        # event instead of recording a second ENTRY (which would flip
        # the member's inside/outside state and double-count
        # attendance). NOTE: record_manual_access_event commits
        # internally, so the key record below is a second commit —
        # sequential-retry protection, not concurrent.
        idempotency_key, request_hash, replay = begin_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="access_checkin",
            headers=request.headers,
            payload=data,
        )
        if replay is not None:
            return replay

        actor_name = g.current_user.full_name if hasattr(g, "current_user") and g.current_user else "Front Desk"
        evt = record_manual_access_event(
            gym_id=g.gym_id,
            member_id=member.id,
            event_type=event_type,
            actor_name=actor_name,
        )
        is_entry = evt.event_type in ("ENTRY", "ATTENDANCE")
        msg = f"{member.full_name} checked in successfully" if is_entry else (f"Access denied: {member.full_name} membership is expired" if evt.event_type == "ACCESS_DENIED" else f"{member.full_name} checked out")
        response_body = {
            "success": True,
            "data": _serialize_access_event(evt),
            "message": msg,
        }
        record_idempotency(
            gym_id=g.gym_id,
            user_id=g.user_id,
            scope="access_checkin",
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
                scope="access_checkin",
                key=idempotency_key,
                request_hash=request_hash,
            )
            if replayed is not None:
                return replayed
            raise
        return jsonify(response_body)

    @bp.route("/access/remote-unlock", methods=["POST"])
    @bp.route("/access/unlock", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def remote_unlock():
        """Queue an explicitly confirmed unlock through the gym's active connector.

        Direct ADMS always takes priority over a paired bridge. The owner
        must confirm the physical action; success means the command was
        queued, not that the terminal has acknowledged it yet.
        """
        data = request.get_json(silent=True) or {}
        from app.models.rrr import RRRAdmsCommand, RRRIntegration
        integration = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if integration is not None:
            from app.services.bridge_service import adms_command_text
            from app.services.rrr_service import direct_adms_terminal_is_online

            if not integration.commands_enabled:
                return jsonify({"success": False, "error": {
                    "code": "NOT_COMMISSIONED",
                    "message": "Complete supervised Direct ADMS setup before remote unlock.",
                }}), 403
            if not direct_adms_terminal_is_online(integration):
                return jsonify({"success": False, "error": {
                    "code": "DEVICE_OFFLINE",
                    "message": "The Direct ADMS terminal is not polling. No command was queued.",
                }}), 409
            if data.get("confirm") is not True:
                return jsonify({"success": False, "error": {
                    "code": "CONFIRMATION_REQUIRED",
                    "message": "Confirm the door unlock by sending confirm=true.",
                }}), 422
            try:
                delay_seconds = max(1, min(30, int(data.get("delay_seconds") or 5)))
            except (TypeError, ValueError):
                delay_seconds = 5
            existing = RRRAdmsCommand.query.filter(
                RRRAdmsCommand.integration_id == integration.id,
                RRRAdmsCommand.status.in_(["queued", "delivered"]),
            ).first()
            if existing is not None:
                return jsonify({"success": False, "error": {
                    "code": "COMMAND_PENDING",
                    "message": "Wait for the current Direct ADMS command acknowledgement before unlocking.",
                }}), 409
            command = RRRAdmsCommand(
                gym_id=g.gym_id,
                integration_id=integration.id,
                action="unlock_door",
                command_text=adms_command_text("unlock_door", None, delay_seconds=delay_seconds),
                requested_by_id=g.current_user.id,
            )
            db.session.add(command)
            db.session.flush()
            reason = str(data.get("reason") or "").strip()[:500] or None
            audit(
                action="remote_door_unlock_dispatched",
                resource_type="rrr_adms_command",
                resource_id=command.id,
                gym_id=g.gym_id,
                actor_id=g.current_user.id,
                metadata={"delay_seconds": delay_seconds, "command_id": command.id,
                          **({"reason": reason} if reason else {})},
            )
            db.session.commit()
            return jsonify({"success": True, "data": {
                "command_id": command.id,
                "delay_seconds": delay_seconds,
                "status": command.status,
                "message": "Direct ADMS unlock command queued; waiting for the terminal acknowledgement.",
            }}), 201

        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": False,
                "error": {
                    "code": "BRIDGE_NOT_CONNECTED",
                    "message": "No active biometric bridge found for this gym. Please ensure the Windows connector is running.",
                },
            }), 404

        if data.get("confirm") is not True:
            return jsonify({"success": False, "error": {
                "code": "CONFIRMATION_REQUIRED",
                "message": "Confirm the door unlock by sending confirm=true.",
            }}), 422
        heartbeat = bridge.last_heartbeat_at
        if heartbeat and heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=timezone.utc)
        if heartbeat is None or (utcnow() - heartbeat).total_seconds() > 120:
            return jsonify({"success": False, "error": {
                "code": "DEVICE_OFFLINE",
                "message": "The bridge is offline. No unlock command was queued.",
            }}), 409
        try:
            delay_seconds = max(1, min(30, int(data.get("delay_seconds") or 5)))
        except (TypeError, ValueError):
            delay_seconds = 5
        reason = str(data.get("reason") or "").strip()[:500] or None

        cmd = BridgeCommand(
            bridge_id=bridge.id,
            gym_id=g.gym_id,
            command_type="unlock_door",
            enroll_number="SYSTEM",
            delay_seconds=delay_seconds,
        )
        db.session.add(cmd)
        db.session.flush()
        audit(
            action="remote_door_unlock_dispatched",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"delay_seconds": delay_seconds, "command_id": cmd.id,
                      **({"reason": reason} if reason else {})},
        )
        db.session.commit()

        return jsonify({
            "success": True,
            "data": {
                "command_id": cmd.id,
                "delay_seconds": delay_seconds,
                "message": f"Door unlock command queued for {delay_seconds} seconds.",
            },
        }), 201

    @bp.route("/access/retry-sync", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def retry_sync():
        """Retry all failed biometric commands for this gym."""
        from app.models.rrr import RRRIntegration
        if RRRIntegration.query.filter_by(gym_id=g.gym_id, connector_type="adms_direct").first():
            return jsonify({"success": False, "error": {
                "code": "DIRECT_ADMS_ACTIVE",
                "message": "Direct ADMS is active. No TCP bridge command was retried.",
            }}), 409
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": True,
                "data": {
                    "retried_count": 0,
                    "message": "No active biometric bridge connected.",
                },
            })

        failed_cmds = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").all()
        retried_count = 0
        for cmd in failed_cmds:
            # Fail-safe: never resurrect a disable unless the member is
            # proven blockable (paused, or expired with a past end date).
            # Stamp the cancellation so the skip is auditable.
            if bridge_command_must_be_cancelled(cmd):
                cancel_bridge_command(cmd)
                continue
            # H8 mirror: never resurrect a stale enable either.
            if bridge_enable_must_be_cancelled(cmd):
                cancel_bridge_command(cmd, marker=STALE_ENABLE_MARKER, error=STALE_ENABLE_ERROR)
                continue
            cmd.status = "pending"
            cmd.retry_attempt += 1
            cmd.lease_token = None
            cmd.lease_expires_at = None
            cmd.last_error = None
            retried_count += 1

        db.session.commit()
        audit(
            action="retry_failed_biometric_syncs",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"retried_count": retried_count},
        )

        return jsonify({
            "success": True,
            "data": {
                "retried_count": retried_count,
                "message": f"Queued {retried_count} failed command(s) for immediate retry.",
            },
        })

    @bp.route("/access/clear-failed", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def clear_failed():
        """Permanently delete failed biometric commands for this gym.

        Scoped: only status='failed', only this gym's bridge.
        Used when migrating a gym off the bridge (e.g. to ADMS direct).
        Irreversible — failed commands are undelivered and cannot be retried after.
        """
        from app.models.rrr import RRRIntegration
        if RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first():
            return jsonify({"success": False, "error": {
                "code": "DIRECT_ADMS_ACTIVE",
                "message": "Direct ADMS is authoritative for this gym. Legacy TCP commands were left untouched.",
            }}), 409
        bridge = BridgeInstallation.query.filter_by(gym_id=g.gym_id, is_active=True).first()
        if not bridge:
            return jsonify({
                "success": True,
                "data": {"cleared_count": 0, "message": "No active biometric bridge connected."},
            })

        failed_cmds = BridgeCommand.query.filter_by(bridge_id=bridge.id, status="failed").all()
        cleared_count = len(failed_cmds)
        for cmd in failed_cmds:
            db.session.delete(cmd)

        db.session.commit()
        audit(
            action="clear_failed_biometric_commands",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"cleared_count": cleared_count},
        )

        return jsonify({
            "success": True,
            "data": {
                "cleared_count": cleared_count,
                "message": f"Cleared {cleared_count} failed command(s).",
            },
        })

    @bp.route("/access/reconcile", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reconcile_all():
        """Re-sync all active gym members' access states to the biometric device."""
        from app.models.rrr import RRRIntegration
        adms = RRRIntegration.query.filter_by(
            gym_id=g.gym_id, connector_type="adms_direct"
        ).first()
        if adms is not None and not adms.commands_enabled:
            return jsonify({"success": False, "error": {
                "code": "NOT_COMMISSIONED",
                "message": "Complete supervised Direct ADMS setup before reconciling access.",
            }}), 403
        count = queue_gym_reconciliation(g.gym_id)
        db.session.commit()
        audit(
            action="reconcile_biometric_all_mobile",
            resource_type="rrr_integration" if adms is not None else "bridge",
            resource_id=adms.id if adms is not None else None,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"queued_count": count},
        )
        return jsonify({
            "success": True,
            "data": {
                "queued_count": count,
                "message": f"Re-sync queued for {count} enrolled member(s).",
            },
        })
