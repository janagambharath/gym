"""Mobile API access endpoints for the Live Access feature."""
from __future__ import annotations

from flask import g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.middleware import roles_required, token_required
from app.services.access_event_service import (
    get_access_events,
    get_access_summary,
    get_members_inside,
    has_legacy_attendance_events,
)


def register_access_routes(bp):
    @bp.route("/access/summary", methods=["GET"])
    @bp.route("/access/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def access_summary():
        """Live Access summary: inside count, entries/exits/denied today, device status."""
        gym_timezone = g.current_user.gym.timezone or "Asia/Kolkata"
        summary = get_access_summary(g.gym_id, gym_timezone)
        summary["has_legacy_events"] = has_legacy_attendance_events(g.gym_id)
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
