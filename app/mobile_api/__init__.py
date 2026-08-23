"""Mobile API v1 blueprint — additive JSON API for the Android application."""
from __future__ import annotations

from flask import Blueprint

from app.mobile_api.errors import register_error_handlers


def create_mobile_api_blueprint() -> Blueprint:
    bp = Blueprint("mobile_api", __name__, url_prefix="/api/mobile/v1")

    register_error_handlers(bp)

    from app.mobile_api.auth import register_auth_routes
    from app.mobile_api.dashboard import register_dashboard_routes
    from app.mobile_api.members import register_members_routes
    from app.mobile_api.renewals import register_renewals_routes
    from app.mobile_api.payments import register_payments_routes
    from app.mobile_api.whatsapp import register_whatsapp_routes
    from app.mobile_api.settings import register_settings_routes

    register_auth_routes(bp)
    register_dashboard_routes(bp)
    register_members_routes(bp)
    register_renewals_routes(bp)
    register_payments_routes(bp)
    register_whatsapp_routes(bp)
    register_settings_routes(bp)

    return bp


mobile_api_bp = create_mobile_api_blueprint()
