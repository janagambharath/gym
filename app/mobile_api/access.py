"""Mobile API access endpoints for the Live Access feature.

Physical unlock is deliberately not exposed here.  A former placeholder route
only recorded an entry event and implied a door had opened, which is unsafe for
an owner-facing access product.  Device commands remain available through the
commissioned, acknowledged command pipeline instead.
"""
from __future__ import annotations

from datetime import timezone
from flask import g, jsonify, request

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
from app.services.bridge_service import queue_gym_reconciliation


def register_access_routes(bp):
    @bp.route("/access/summary", methods=["GET"])
    @bp.route("/access/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_summary():
        """Live Access summary: inside count, entries/exits/denied today, device & bridge status."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        summary = get_access_summary(g.gym_id, gym_timezone)
        summary["has_legacy_events"] = has_legacy_attendance_events(g.gym_id)
        # There is no confirmed controller protocol for a generic remote door
        # pulse.  Never render a button which could suggest the physical door
        # was unlocked when it was not.
        summary["remote_unlock_available"] = False
        summary["remote_unlock_reason"] = (
            "Remote physical unlock is unavailable until this installed controller "
            "has a verified command protocol and commissioning record."
        )

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

            summary["bridge_provisioned"] = True
            summary["bridge_online"] = is_online
            summary["device_online"] = is_online
            summary["device_serial"] = bridge.device_serial
            summary["installed_version"] = bridge.installed_version
            summary["pending_commands"] = pending_count
            summary["failed_commands"] = failed_count
            summary["heartbeat_age_seconds"] = int(hb_age) if hb_age is not None else None
        else:
            summary["bridge_provisioned"] = False
            summary["bridge_online"] = False
            summary["device_online"] = False
            summary["pending_commands"] = 0
            summary["failed_commands"] = 0
            summary["heartbeat_age_seconds"] = None

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

        result = get_access_events(
            g.gym_id,
            gym_timezone,
            page=page,
            per_page=per_page,
            event_type=event_type,
            search=search,
            date_filter=date_filter,
        )
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

        actor_name = g.current_user.full_name if hasattr(g, "current_user") and g.current_user else "Front Desk"
        evt = record_manual_access_event(
            gym_id=g.gym_id,
            member_id=member.id,
            event_type=event_type,
            actor_name=actor_name,
        )
        is_entry = evt.event_type in ("ENTRY", "ATTENDANCE")
        msg = f"{member.full_name} checked in successfully" if is_entry else (f"Access denied: {member.full_name} membership is expired" if evt.event_type == "ACCESS_DENIED" else f"{member.full_name} checked out")
        return jsonify({
            "success": True,
            "data": _serialize_access_event(evt),
            "message": msg,
        })

    @bp.route("/access/remote-unlock", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def remote_unlock():
        """Refuse an unverified physical command; no access event is fabricated."""
        audit(
            action="remote_gate_unlock_refused",
            resource_type="bridge",
            resource_id=None,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"reason": "controller_protocol_not_commissioned"},
        )
        db.session.commit()
        return jsonify({"success": False, "error": {
            "code": "UNSUPPORTED_DEVICE_COMMAND",
            "message": "No physical unlock command was sent. Commission a verified controller command before enabling remote unlock.",
        }}), 409

    @bp.route("/access/retry-sync", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def retry_sync():
        """Retry all failed biometric commands for this gym."""
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
        for cmd in failed_cmds:
            cmd.status = "pending"
            cmd.retry_attempt += 1
            cmd.lease_token = None
            cmd.lease_expires_at = None
            cmd.last_error = None

        db.session.commit()
        audit(
            action="retry_failed_biometric_syncs",
            resource_type="bridge",
            resource_id=bridge.id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"retried_count": len(failed_cmds)},
        )

        return jsonify({
            "success": True,
            "data": {
                "retried_count": len(failed_cmds),
                "message": f"Queued {len(failed_cmds)} failed command(s) for immediate retry.",
            },
        })

    @bp.route("/access/reconcile", methods=["POST"])
    @token_required
    @roles_required("gym_owner", "staff")
    def reconcile_all():
        """Re-sync all active gym members' access states to the biometric device."""
        count = queue_gym_reconciliation(g.gym_id)
        db.session.commit()
        audit(
            action="reconcile_biometric_all_mobile",
            resource_type="bridge",
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
