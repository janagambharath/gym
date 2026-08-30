"""Authenticated mobile billing contracts.

The device can initiate a Play flow, but every returned entitlement comes
from the backend after verification.  No purchase callback is trusted alone.
"""
from __future__ import annotations

import base64
import json

from flask import current_app, g, jsonify, request

from app.extensions import db, limiter
from app.mobile_api.errors import error_response
from app.mobile_api.middleware import roles_required, token_required
from app.services.audit_service import audit
from app.services.mobile_billing_service import (
    GooglePlayConfigurationError,
    catalog_for,
    entitlement_for,
    purchase_account_context,
    reconcile_google_subscription,
    verify_google_purchase,
)


def register_billing_routes(bp):
    @bp.route("/billing/purchase-context", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def get_purchase_context():
        return jsonify({"success": True, "data": {
            "obfuscated_account_id": purchase_account_context(g.gym_id, g.current_user.id),
        }})

    @bp.route("/billing/entitlement", methods=["GET"])
    @token_required
    @roles_required("gym_owner", "staff")
    def get_entitlement():
        return jsonify({"success": True, "data": entitlement_for(g.current_user.gym)})

    @bp.route("/billing/catalog", methods=["GET"])
    @token_required
    @roles_required("gym_owner")
    def get_catalog():
        gym = g.current_user.gym
        return jsonify({
            "success": True,
            "data": {"country": gym.country, "currency": gym.currency, "plans": catalog_for(gym.country, gym.currency)},
        })

    @bp.route("/billing/purchases/verify", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def verify_billing_purchase():
        data = request.get_json(silent=True) or {}
        product_id = (data.get("product_id") or "").strip()
        purchase_token = (data.get("purchase_token") or "").strip()
        if not product_id or not purchase_token:
            return error_response("VALIDATION_ERROR", "product_id and purchase_token are required.", 400)
        try:
            entitlement = verify_google_purchase(
                gym=g.current_user.gym,
                owner_id=g.current_user.id,
                product_id=product_id,
                purchase_token=purchase_token,
            )
        except ValueError as exc:
            return error_response("PURCHASE_INVALID", str(exc), 409)
        except GooglePlayConfigurationError:
            return error_response("BILLING_NOT_CONFIGURED", "Google Play verification is not available.", 503)
        audit(
            action="mobile_verify_google_play_purchase",
            resource_type="gym",
            resource_id=g.gym_id,
            gym_id=g.gym_id,
            actor_id=g.current_user.id,
            metadata={"product_id": product_id},
        )
        db.session.commit()
        return jsonify({"success": True, "data": entitlement})

    @bp.route("/billing/restore", methods=["POST"])
    @token_required
    @roles_required("gym_owner")
    @limiter.limit("10 per minute")
    def restore_purchases():
        """Re-verify device supplied restore tokens; never activate without Google."""
        data = request.get_json(silent=True) or {}
        tokens = data.get("purchases")
        if not isinstance(tokens, list) or not tokens:
            return error_response("VALIDATION_ERROR", "At least one purchase is required to restore.", 400)
        verified = None
        for purchase in tokens[:10]:
            if not isinstance(purchase, dict):
                continue
            product_id = (purchase.get("product_id") or "").strip()
            token = (purchase.get("purchase_token") or "").strip()
            if not product_id or not token:
                continue
            try:
                verified = verify_google_purchase(
                    gym=g.current_user.gym,
                    owner_id=g.current_user.id,
                    product_id=product_id,
                    purchase_token=token,
                )
                break
            except ValueError:
                continue
            except GooglePlayConfigurationError:
                return error_response("BILLING_NOT_CONFIGURED", "Google Play verification is not available.", 503)
        if verified is None:
            return error_response("RESTORE_NOT_FOUND", "No eligible subscription could be restored.", 404)
        db.session.commit()
        return jsonify({"success": True, "data": verified})

    @bp.route("/billing/google-play/rtdn", methods=["POST"])
    def google_play_rtdn():
        """Google Pub/Sub push endpoint; validates OIDC before reconciling."""
        audience = current_app.config.get("GOOGLE_PLAY_RTDN_AUDIENCE", "")
        service_account = current_app.config.get("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL", "")
        if not audience or not service_account:
            return error_response("BILLING_NOT_CONFIGURED", "Google Play RTDN is not configured.", 503)
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            return error_response("UNAUTHORIZED", "Missing provider credentials.", 401)
        try:
            from google.auth.transport import requests as google_requests
            from google.oauth2 import id_token

            claims = id_token.verify_oauth2_token(authorization[7:], google_requests.Request(), audience)
        except Exception:
            return error_response("UNAUTHORIZED", "Invalid provider credentials.", 401)
        if claims.get("email") != service_account or not claims.get("email_verified"):
            return error_response("UNAUTHORIZED", "Invalid provider credentials.", 401)
        envelope = request.get_json(silent=True) or {}
        encoded = ((envelope.get("message") or {}).get("data"))
        if not isinstance(encoded, str):
            return error_response("VALIDATION_ERROR", "Invalid Pub/Sub payload.", 400)
        try:
            event = json.loads(base64.b64decode(encoded).decode("utf-8"))
            notification = event.get("subscriptionNotification") or {}
            token = notification.get("purchaseToken")
        except (ValueError, TypeError, UnicodeDecodeError):
            return error_response("VALIDATION_ERROR", "Invalid Pub/Sub payload.", 400)
        if not isinstance(token, str) or not token:
            return jsonify({"success": True, "data": {"ignored": True}}), 200
        from hashlib import sha256
        from app.models import GooglePlaySubscription

        subscription = GooglePlaySubscription.query.filter_by(
            purchase_token_hash=sha256(token.encode("utf-8")).hexdigest()
        ).first()
        if subscription is None:
            # It may belong to another Renewal Desk environment.  Acknowledge
            # it to prevent repeated delivery, without attaching it to a gym.
            return jsonify({"success": True, "data": {"ignored": True}}), 200
        try:
            reconcile_google_subscription(subscription)
            db.session.commit()
        except GooglePlayConfigurationError:
            db.session.rollback()
            return error_response("BILLING_RECONCILIATION_FAILED", "Google Play reconciliation failed.", 503)
        return jsonify({"success": True, "data": {"reconciled": True}}), 200
