"""Legacy subscription route adapters.

The Android application uses ``/billing/*`` directly. These endpoints remain
for older mobile clients, but delegate to the same server-authoritative Google
Play verifier; they never activate an entitlement from a client token alone.
"""
from __future__ import annotations

from flask import g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.services.audit_service import audit
from app.services.mobile_billing_service import (
    GooglePlayConfigurationError,
    catalog_for,
    entitlement_for,
    find_catalog_product,
    verify_google_purchase,
)


_PLAN_PRESENTATION = {
    "Starter": {
        "id": "starter",
        "base_plan_id": "monthly-starter",
        "tagline": "For small gyms getting organized.",
        "positioning": "Manage your members.",
        "recommended": False,
        "max_members": 150,
        "features": [
            "Member profiles, status, search & filters",
            "Membership plan assignment & expiry tracking",
            "Expiring & expired member lists",
            "Manual renewal recording & follow-up tracking",
            "Record payments (Cash, UPI & offline)",
            "Core operational dashboard",
            "Basic reports & standard support",
        ],
        "entitlements": ["renewal_desk", "biometric"],
    },
    "Growth": {
        "id": "growth",
        "base_plan_id": "monthly-growth",
        "tagline": "For gyms serious about recovering renewals.",
        "positioning": "Recover more renewals.",
        "recommended": True,
        "max_members": 500,
        "features": [
            "Everything in Starter, plus:",
            "Advanced expiry dashboard & follow-up queues",
            "Automated WhatsApp renewal reminders & templates",
            "Revenue recovery analytics (actual collected amounts)",
            "Lead management & follow-up reminders",
            "AI-assisted response suggestions",
            "Staff assignments, permissions & activity tracking",
            "VYNLA member app renewal & UPI payments",
            "Membership-linked biometric access control",
            "Advanced renewal performance reports",
        ],
        "entitlements": ["renewal_desk", "whatsapp_bot", "biometric", "advanced_reports"],
    },
    "Pro": {
        "id": "pro",
        "base_plan_id": "monthly-pro",
        "tagline": "For high-volume gyms and operators who need deeper control.",
        "positioning": "Run and optimize your revenue operation.",
        "recommended": False,
        "max_members": None,
        "features": [
            "Everything in Growth, plus:",
            "Advanced revenue analytics & renewal trends",
            "Automated follow-up sequences & configurable rules",
            "Detailed team permissions & manager activity logs",
            "Multi-device access control management",
            "Priority onboarding & priority support",
        ],
        "entitlements": ["renewal_desk", "whatsapp_bot", "biometric", "advanced_reports", "ai_receptionist"],
    },
}

_CURRENCY_SYMBOLS = {"INR": "₹", "AED": "AED ", "USD": "$", "GBP": "£", "AUD": "A$", "EUR": "€", "SAR": "SAR "}


def _legacy_plans(gym) -> list[dict]:
    """Shape the canonical catalog for pre-billing-endpoint clients only."""
    plans = []
    for product in catalog_for(gym.country, gym.currency):
        presentation = _PLAN_PRESENTATION.get(product["name"], {})
        plans.append({
            "id": presentation.get("id", product["id"]),
            "name": product["name"],
            "base_plan_id": product.get("base_plan_id", presentation.get("base_plan_id", f"monthly-{product['name'].lower()}")),
            "tagline": presentation.get("tagline", ""),
            "positioning": presentation.get("positioning", ""),
            "recommended": presentation.get("recommended", False),
            "max_members": presentation.get("max_members"),
            "price": product["price"],
            "currency": product["currency"],
            "currency_symbol": _CURRENCY_SYMBOLS.get(product["currency"], f"{product['currency']} "),
            "product_id": product["id"],
            "billing_period": "monthly",
            "features": presentation.get("features", []),
            "entitlements": presentation.get("entitlements", []),
        })
    return plans


def _legacy_entitlement(gym) -> dict:
    """Preserve the old response shape without a second entitlement model."""
    entitlement = entitlement_for(gym)
    product = find_catalog_product(gym, entitlement["plan_id"] or "")
    plans = _legacy_plans(gym)
    matching_plan = next((plan for plan in plans if plan["product_id"] == entitlement["plan_id"]), None)
    return {
        **entitlement,
        "plan": {
            "id": matching_plan["id"] if matching_plan else entitlement["plan_id"],
            "name": entitlement["plan_name"] or "Trial",
            "price": product["price"] if product else "0.00",
            "currency": product["currency"] if product else gym.currency,
            "currency_symbol": _CURRENCY_SYMBOLS.get(gym.currency, f"{gym.currency} "),
            "product_id": entitlement["plan_id"],
            "billing_period": "monthly",
        },
        "max_members": matching_plan["max_members"] if matching_plan else gym.max_members,
        "active_entitlements": matching_plan["entitlements"] if matching_plan else [],
    }


def _verify_or_error(*, product_id: str, purchase_token: str):
    try:
        return verify_google_purchase(
            gym=g.current_user.gym,
            owner_id=g.current_user.id,
            product_id=product_id,
            purchase_token=purchase_token,
        ), None
    except ValueError as exc:
        return None, error_response("PURCHASE_INVALID", str(exc), 409)
    except GooglePlayConfigurationError:
        return None, error_response("BILLING_NOT_CONFIGURED", "Google Play verification is not available.", 503)


def register_subscription_routes(bp):
    @bp.route("/subscription/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def subscription_status():
        return jsonify({"success": True, "data": _legacy_entitlement(g.current_user.gym)})

    @bp.route("/subscription/plans", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_plans():
        gym = g.current_user.gym
        return jsonify({"success": True, "data": {"currency": gym.currency, "plans": _legacy_plans(gym)}})

    @bp.route("/subscription/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def verify_purchase():
        data = request.get_json(silent=True) or {}
        purchase_token = (data.get("purchase_token") or "").strip()
        product_id = (data.get("product_id") or "").strip()
        if not purchase_token or not product_id:
            return error_response("VALIDATION_ERROR", "purchase_token and product_id are required.", 400)
        entitlement, response = _verify_or_error(product_id=product_id, purchase_token=purchase_token)
        if response is not None:
            return response
        audit(
            action="mobile_verify_google_play_purchase",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"product_id": product_id},
        )
        db.session.commit()
        return jsonify({"success": True, "data": {"success": True, "subscription": entitlement}})

    @bp.route("/subscription/restore", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def restore_purchase():
        data = request.get_json(silent=True) or {}
        purchase_token = (data.get("purchase_token") or "").strip()
        product_id = (data.get("product_id") or "").strip()
        if not purchase_token or not product_id:
            return error_response("VALIDATION_ERROR", "purchase_token and product_id are required.", 400)
        entitlement, response = _verify_or_error(product_id=product_id, purchase_token=purchase_token)
        if response is not None:
            return response
        db.session.commit()
        return jsonify({"success": True, "data": {"success": True, "subscription": entitlement}})
