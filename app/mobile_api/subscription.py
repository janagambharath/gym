"""Mobile API subscription & Google Play billing endpoints."""
from __future__ import annotations

from flask import g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.services.audit_service import audit
from app.services.subscription_service import (
    get_available_plans,
    get_gym_subscription,
    restore_gym_subscription,
    verify_google_play_purchase,
)


def register_subscription_routes(bp):
    @bp.route("/subscription/status", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def subscription_status():
        """Return the current gym subscription status, billing source, and active entitlements."""
        gym = g.current_user.gym
        sub_info = get_gym_subscription(gym)
        return jsonify({
            "success": True,
            "data": sub_info,
        })

    @bp.route("/subscription/plans", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def list_plans():
        """Return localized 3-tier subscription plans catalog for this gym's currency."""
        currency = request.args.get("currency") or g.current_user.gym.currency or "INR"
        plans = get_available_plans(currency)
        return jsonify({
            "success": True,
            "data": {
                "currency": currency.upper(),
                "plans": plans,
            },
        })

    @bp.route("/subscription/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def verify_purchase():
        """Verify Google Play purchase token, update entitlement, and activate subscription."""
        data = request.get_json(silent=True) or {}
        purchase_token = (data.get("purchase_token") or "").strip()
        product_id = (data.get("product_id") or "").strip()
        order_id = (data.get("order_id") or "").strip() or None

        if not purchase_token or not product_id:
            return error_response("VALIDATION_ERROR", "purchase_token and product_id are required.", 400)

        gym = g.current_user.gym
        result = verify_google_play_purchase(
            gym=gym,
            purchase_token=purchase_token,
            product_id=product_id,
            order_id=order_id,
        )

        if not result.get("success"):
            return error_response("VERIFICATION_FAILED", result.get("error", "Purchase verification failed."), 400)

        audit(
            action="google_play_subscription_verify",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=gym.id,
            actor_id=g.current_user.id,
            metadata={"product_id": product_id, "order_id": order_id},
        )

        return jsonify({
            "success": True,
            "data": result,
        })

    @bp.route("/subscription/restore", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    def restore_purchase():
        """Restore existing Google Play purchase for the authenticated gym owner."""
        data = request.get_json(silent=True) or {}
        purchase_token = (data.get("purchase_token") or "").strip()
        product_id = (data.get("product_id") or "").strip()

        if not purchase_token or not product_id:
            return error_response("VALIDATION_ERROR", "purchase_token and product_id are required.", 400)

        gym = g.current_user.gym
        result = restore_gym_subscription(gym, purchase_token, product_id)

        if not result.get("success"):
            return error_response("RESTORE_FAILED", result.get("error", "Could not restore subscription."), 400)

        audit(
            action="google_play_subscription_restore",
            resource_type="gym",
            resource_id=gym.id,
            gym_id=gym.id,
            actor_id=g.current_user.id,
            metadata={"product_id": product_id},
        )

        return jsonify({
            "success": True,
            "data": result,
        })
