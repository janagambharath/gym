"""JSON error envelope and error handlers for the mobile API."""
from __future__ import annotations

from flask import jsonify
from werkzeug.exceptions import HTTPException


def error_response(code: str, message: str, status: int, details: dict | None = None):
    body: dict = {
        "success": False,
        "error": {"code": code, "message": message},
    }
    if details:
        body["error"]["details"] = details
    resp = jsonify(body)
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp


def register_error_handlers(bp):
    """Attach JSON error handlers to the mobile API blueprint."""

    @bp.errorhandler(400)
    def bad_request(exc):
        msg = exc.description if isinstance(exc, HTTPException) else "Bad request."
        return error_response("BAD_REQUEST", msg, 400)

    @bp.errorhandler(401)
    def unauthorized(exc):
        return error_response("UNAUTHORIZED", "Authentication required.", 401)

    @bp.errorhandler(403)
    def forbidden(exc):
        return error_response("FORBIDDEN", "You do not have permission.", 403)

    @bp.errorhandler(404)
    def not_found(exc):
        return error_response("NOT_FOUND", "Resource not found.", 404)

    @bp.errorhandler(409)
    def conflict(exc):
        msg = exc.description if isinstance(exc, HTTPException) else "Conflict."
        return error_response("CONFLICT", msg, 409)

    @bp.errorhandler(429)
    def rate_limited(exc):
        return error_response("RATE_LIMITED", "Too many requests. Please slow down.", 429)

    @bp.errorhandler(500)
    def internal(exc):
        return error_response("INTERNAL_ERROR", "An unexpected error occurred.", 500)
