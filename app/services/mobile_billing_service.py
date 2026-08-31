"""Authoritative mobile billing helpers and Google Play verification adapter."""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, time, timezone
from typing import Any

from flask import current_app

from app.extensions import db
from app.models import GooglePlaySubscription, Gym
from app.models.mixins import utcnow


SUPPORTED_LOCALES: dict[str, dict[str, str]] = {
    "IN": {"currency": "INR", "locale": "en-IN", "timezone": "Asia/Kolkata"},
    "AE": {"currency": "AED", "locale": "en-AE", "timezone": "Asia/Dubai"},
    "GB": {"currency": "GBP", "locale": "en-GB", "timezone": "Europe/London"},
    "AU": {"currency": "AUD", "locale": "en-AU", "timezone": "Australia/Sydney"},
    "US": {"currency": "USD", "locale": "en-US", "timezone": "America/New_York"},
}

DEFAULT_CATALOG: dict[str, list[dict[str, str]]] = {
    "IN": [
        {"id": "online.revorax.renewaldesk.sub.starter", "name": "Starter", "price": "999.00", "currency": "INR"},
        {"id": "online.revorax.renewaldesk.sub.growth", "name": "Growth", "price": "1499.00", "currency": "INR"},
        {"id": "online.revorax.renewaldesk.sub.pro", "name": "Pro", "price": "2499.00", "currency": "INR"},
    ],
    "AE": [
        {"id": "online.revorax.renewaldesk.sub.starter", "name": "Starter", "price": "99.00", "currency": "AED"},
        {"id": "online.revorax.renewaldesk.sub.growth", "name": "Growth", "price": "199.00", "currency": "AED"},
        {"id": "online.revorax.renewaldesk.sub.pro", "name": "Pro", "price": "299.00", "currency": "AED"},
    ],
}


def _as_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def catalog_for(country: str, currency: str) -> list[dict[str, str]]:
    """Return the centrally configured catalog for an allowed country/currency.

    `GOOGLE_PLAY_CATALOG_JSON` permits controlled deployment-time product
    mapping.  Invalid configuration deliberately falls back to the reviewed
    starter catalog rather than accepting a malformed client supplied price.
    """
    country = (country or "").upper()
    # Existing gyms may still store a country name from the web onboarding
    # flow; the billing catalog is keyed by ISO country code.
    country = {
        "INDIA": "IN",
        "UAE": "AE",
        "UNITED ARAB EMIRATES": "AE",
        "UNITED KINGDOM": "GB",
        "UNITED STATES": "US",
        "AUSTRALIA": "AU",
    }.get(country, country)
    configured = current_app.config.get("GOOGLE_PLAY_CATALOG_JSON", "")
    if configured:
        try:
            raw = json.loads(configured)
            entries = raw.get(country, []) if isinstance(raw, dict) else []
            if isinstance(entries, list) and all(
                isinstance(entry, dict)
                and isinstance(entry.get("id"), str)
                and isinstance(entry.get("name"), str)
                and isinstance(entry.get("price"), (str, int, float))
                and entry.get("currency") == currency
                for entry in entries
            ):
                return [
                    {
                        "id": entry["id"],
                        "name": entry["name"],
                        "price": str(entry["price"]),
                        "currency": currency,
                    }
                    for entry in entries
                ]
        except (TypeError, ValueError):
            current_app.logger.error("GOOGLE_PLAY_CATALOG_JSON is invalid")
    return list(DEFAULT_CATALOG.get(country, []))


def find_catalog_product(gym: Gym, product_id: str) -> dict[str, str] | None:
    return next((item for item in catalog_for(gym.country, gym.currency) if item["id"] == product_id), None)


def entitlement_for(gym: Gym) -> dict[str, Any]:
    """Serialize billing state without relying on a device or cached purchase."""
    status = (gym.subscription_status or "TRIAL").upper()
    source = (gym.billing_source or "MANUAL").upper()
    # Founder-created gyms predate the entitlement columns. Preserve their
    # existing manual end date in the new read model rather than displaying a
    # misleading "no expiry" state.
    legacy_manual_expiry = None
    if source == "MANUAL" and gym.billing_expires_at is None and gym.trial_ends_at:
        legacy_manual_expiry = datetime.combine(
            gym.trial_ends_at, time.max, tzinfo=timezone.utc
        )
    expires_at = gym.billing_expires_at or legacy_manual_expiry
    return {
        "billing_source": source,
        "plan_id": gym.billing_plan_id,
        "plan_name": gym.billing_plan_name,
        "subscription_status": status,
        "started_at": gym.billing_started_at.isoformat() if gym.billing_started_at else None,
        "renews_at": gym.billing_renews_at.isoformat() if gym.billing_renews_at else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "grace_period_end": gym.billing_grace_period_end.isoformat() if gym.billing_grace_period_end else None,
        "purchase_management_available": source == "GOOGLE_PLAY" and bool(gym.billing_plan_id),
    }


class GooglePlayConfigurationError(RuntimeError):
    pass


def _publisher_client():
    """Create the official Android Publisher API client from server-only credentials."""
    credentials_json = current_app.config.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "")
    if not credentials_json:
        raise GooglePlayConfigurationError("Google Play verification is not configured.")
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        info = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/androidpublisher"],
        )
        return build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)
    except (ImportError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise GooglePlayConfigurationError("Google Play verification is unavailable on this server.") from exc


def purchase_account_context(gym_id: int, owner_id: int) -> str:
    """Stable obfuscated account identifier supplied to Play Billing at checkout."""
    secret = current_app.config.get("MOBILE_API_TOKEN_SECRET") or current_app.config.get("SECRET_KEY", "")
    return hmac.new(secret.encode("utf-8"), f"gym:{gym_id}:owner:{owner_id}".encode("utf-8"), hashlib.sha256).hexdigest()


def _token_cipher():
    key = current_app.config.get("GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY", "")
    if not key:
        raise GooglePlayConfigurationError("Google Play reconciliation is not configured.")
    try:
        from cryptography.fernet import Fernet

        return Fernet(key.encode("utf-8"))
    except (ImportError, ValueError) as exc:
        raise GooglePlayConfigurationError("Google Play reconciliation is not available on this server.") from exc


def _encrypted_purchase_token(purchase_token: str) -> str:
    return _token_cipher().encrypt(purchase_token.encode("utf-8")).decode("utf-8")


def _decrypted_purchase_token(value: str | None) -> str:
    if not value:
        raise GooglePlayConfigurationError("Stored purchase cannot be reconciled safely.")
    try:
        return _token_cipher().decrypt(value.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise GooglePlayConfigurationError("Stored purchase cannot be reconciled safely.") from exc


def _play_state(payload: dict[str, Any]) -> tuple[str, datetime | None, datetime | None]:
    state = str(payload.get("subscriptionState") or "").upper()
    line_items = payload.get("lineItems") or []
    first_item = line_items[0] if line_items and isinstance(line_items[0], dict) else {}
    expires_at = _as_utc(first_item.get("expiryTime"))
    if state in {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}:
        return ("ACTIVE" if state.endswith("ACTIVE") else "PAYMENT_FAILED", expires_at, expires_at)
    if state == "SUBSCRIPTION_STATE_CANCELED":
        return "CANCELLED", expires_at, None
    if state == "SUBSCRIPTION_STATE_PENDING":
        return "PENDING", expires_at, None
    if state in {"SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_ON_HOLD"}:
        return "PAYMENT_FAILED", expires_at, None
    if state == "SUBSCRIPTION_STATE_EXPIRED":
        return "EXPIRED", expires_at, None
    return "PENDING", expires_at, None


def _acknowledge_google_subscription(publisher, package_name: str, product_id: str, purchase_token: str) -> None:
    """Acknowledge an eligible subscription server-side before granting access."""
    try:
        publisher.purchases().subscriptions().acknowledge(
            packageName=package_name,
            subscriptionId=product_id,
            token=purchase_token,
            body={},
        ).execute()
    except Exception as exc:
        current_app.logger.warning("Google Play acknowledgement failed: %s", type(exc).__name__)
        raise GooglePlayConfigurationError("Google Play could not acknowledge this purchase.") from exc


def _apply_verified_purchase(
    *, gym: Gym, owner_id: int, product_id: str, purchase_token: str, payload: dict[str, Any]
) -> dict[str, Any]:
    product = find_catalog_product(gym, product_id)
    if product is None:
        raise ValueError("Unknown subscription product.")
    verified_product = next(
        (
            str(item.get("productId"))
            for item in payload.get("lineItems", [])
            if isinstance(item, dict) and item.get("productId")
        ),
        "",
    )
    if verified_product != product_id:
        raise ValueError("Purchase does not match the selected subscription.")
    provider_account = ((payload.get("externalAccountIdentifiers") or {}).get("obfuscatedExternalAccountId"))
    expected_account = purchase_account_context(gym.id, owner_id)
    if provider_account and not hmac.compare_digest(str(provider_account), expected_account):
        raise ValueError("Purchase is linked to a different account.")

    token_hash = hashlib.sha256(purchase_token.encode("utf-8")).hexdigest()
    subscription = GooglePlaySubscription.query.filter_by(purchase_token_hash=token_hash).first()
    if subscription is not None and subscription.gym_id != gym.id:
        raise ValueError("This subscription is already linked to another account.")
    if subscription is None:
        subscription = GooglePlaySubscription(
            gym_id=gym.id,
            owner_id=owner_id,
            product_id=product_id,
            purchase_token_hash=token_hash,
        )
        db.session.add(subscription)

    status, expires_at, grace_end = _play_state(payload)
    order_id = payload.get("latestOrderId")
    subscription.product_id = product_id
    subscription.owner_id = owner_id
    subscription.purchase_token_encrypted = _encrypted_purchase_token(purchase_token)
    subscription.order_id = str(order_id) if order_id else subscription.order_id
    subscription.state = status
    subscription.expires_at = expires_at
    subscription.renews_at = expires_at if status == "ACTIVE" else None
    subscription.grace_period_end = grace_end if status == "PAYMENT_FAILED" else None
    subscription.last_verified_at = utcnow()
    subscription.external_account_id = expected_account

    gym.billing_source = "GOOGLE_PLAY"
    gym.billing_plan_id = product_id
    gym.billing_plan_name = product["name"]
    gym.subscription_status = status
    gym.billing_started_at = gym.billing_started_at or utcnow()
    gym.billing_renews_at = subscription.renews_at
    gym.billing_expires_at = subscription.expires_at
    gym.billing_grace_period_end = subscription.grace_period_end
    return entitlement_for(gym)


def verify_google_purchase(*, gym: Gym, owner_id: int, product_id: str, purchase_token: str) -> dict[str, Any]:
    """Verify a purchase with Google, persist it once, then update the gym entitlement."""
    if find_catalog_product(gym, product_id) is None:
        raise ValueError("Unknown subscription product.")
    if not purchase_token or len(purchase_token) < 20:
        raise ValueError("Invalid purchase token.")

    package_name = current_app.config.get("GOOGLE_PLAY_PACKAGE_NAME", "")
    if not package_name:
        raise GooglePlayConfigurationError("Google Play verification is not configured.")
    publisher = _publisher_client()
    try:
        payload = publisher.purchases().subscriptionsv2().get(
            packageName=package_name, token=purchase_token
        ).execute()
    except Exception as exc:  # Provider exception types vary by google client release.
        current_app.logger.warning("Google Play purchase verification failed: %s", type(exc).__name__)
        raise GooglePlayConfigurationError("Google Play could not verify this purchase.") from exc

    state, _, _ = _play_state(payload)
    if state != "PENDING":
        _acknowledge_google_subscription(publisher, package_name, product_id, purchase_token)

    return _apply_verified_purchase(
        gym=gym,
        owner_id=owner_id,
        product_id=product_id,
        purchase_token=purchase_token,
        payload=payload,
    )


def reconcile_google_subscription(subscription: GooglePlaySubscription) -> dict[str, Any]:
    """Re-verify a stored subscription after an RTDN or scheduled sweep."""
    gym = subscription.gym
    if gym is None or subscription.owner_id is None:
        raise GooglePlayConfigurationError("Subscription is no longer linked to an active account.")
    package_name = current_app.config.get("GOOGLE_PLAY_PACKAGE_NAME", "")
    if not package_name:
        raise GooglePlayConfigurationError("Google Play verification is not configured.")
    token = _decrypted_purchase_token(subscription.purchase_token_encrypted)
    publisher = _publisher_client()
    try:
        payload = publisher.purchases().subscriptionsv2().get(packageName=package_name, token=token).execute()
    except Exception as exc:
        current_app.logger.warning("Google Play reconciliation failed: %s", type(exc).__name__)
        raise GooglePlayConfigurationError("Google Play could not reconcile this subscription.") from exc
    return _apply_verified_purchase(
        gym=gym,
        owner_id=subscription.owner_id,
        product_id=subscription.product_id,
        purchase_token=token,
        payload=payload,
    )
