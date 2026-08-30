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
    from app.mobile_api.staff import register_staff_routes
    from app.mobile_api.reports import register_reports_routes
    from app.mobile_api.bot import register_bot_routes
    from app.mobile_api.notifications import register_notifications_routes
    from app.mobile_api.subscription import register_subscription_routes

    register_auth_routes(bp)
    register_dashboard_routes(bp)
    register_members_routes(bp)
    register_renewals_routes(bp)
    register_payments_routes(bp)
    register_whatsapp_routes(bp)
    register_settings_routes(bp)
    register_staff_routes(bp)
    register_reports_routes(bp)
    register_bot_routes(bp)
    register_notifications_routes(bp)
    register_subscription_routes(bp)

    return bp


mobile_api_bp = create_mobile_api_blueprint()
