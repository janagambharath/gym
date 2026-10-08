"""Owner-facing RRR Growth System API."""
from __future__ import annotations

from decimal import Decimal

from flask import g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.models import Member
from app.models.rrr import RRRAttendanceEvent, RRRIntegration, RRROpportunity, RRRRule
from app.services.audit_service import audit
from app.services.rrr_service import (
    DEFAULT_RULES,
    dashboard_for_gym,
    ensure_default_rules,
    integration_payload,
    remap_unresolved,
    rules_for_gym,
)


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
        query = RRROpportunity.query.filter_by(gym_id=g.gym_id)
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
            if value < 1 or value > 365:
                return error_response("VALIDATION_ERROR", f"{key} must be between 1 and 365.", 422)
            RRRRule.query.filter_by(gym_id=g.gym_id, rule_key=key).first().value = value
        audit(action="rrr_rules_updated", resource_type="rrr_rule", gym_id=g.gym_id, actor_id=g.user_id)
        db.session.commit()
        return jsonify({"success": True, "data": {"rules": rules_for_gym(g.gym_id)}})

    @bp.get("/rrr/integrations")
    @token_required
    @roles_required("gym_owner", "staff")
    def rrr_integrations():
        rows = RRRIntegration.query.filter_by(gym_id=g.gym_id).order_by(RRRIntegration.connector_type).all()
        return jsonify({"success": True, "data": {"integrations": [integration_payload(x) for x in rows]}})

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
            "instructions": "Enter this code in the eBioServer Bridge on the gym PC. Do not share it.",
        }})

    @bp.post("/rrr/integrations/<int:integration_id>/commission")
    @token_required
    @roles_required("gym_owner")
    def commission_integration(integration_id: int):
        row = RRRIntegration.query.filter_by(id=integration_id, gym_id=g.gym_id, connector_type="ebioserver").first()
        if row is None:
            return error_response("NOT_FOUND", "eBioServer integration was not found.", 404)
        payload = request.get_json(silent=True) or {}
        if payload.get("physical_test_passed") is not True:
            return error_response("VALIDATION_ERROR", "physical_test_passed must be true after a supervised door test.", 422)
        attendance_exists = RRRAttendanceEvent.query.filter_by(gym_id=g.gym_id, integration_id=row.id, processing_status="processed").first()
        if attendance_exists is None:
            return error_response("COMMISSIONING_REQUIRED", "A mapped real attendance event is required before commands can be enabled.", 409)
        row.commissioning_status = "physical_test_passed"
        row.commands_enabled = True
        audit(action="ebioserver_commands_enabled", resource_type="rrr_integration", resource_id=row.id,
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
        resolved = remap_unresolved(g.gym_id, external_id.strip(), member, g.user_id)
        audit(action="rrr_identity_mapped", resource_type="member", resource_id=member.id, gym_id=g.gym_id,
              actor_id=g.user_id, metadata={"external_id": external_id, "events_replayed": resolved})
        db.session.commit()
        return jsonify({"success": True, "data": {"member_id": member.id, "events_resolved": resolved}})
