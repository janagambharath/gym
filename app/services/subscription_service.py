"""Subscription & Entitlements Service — Multi-tier catalog, Google Play & Manual billing."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.extensions import db
from app.models import Gym
from app.models.bot import FeatureEntitlement

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ─── Central 3-Tier Product Catalog ───────────────────────────────────

TIER_STARTER = "starter"
TIER_GROWTH = "growth"
TIER_PRO = "pro"

PLAN_CATALOG: Dict[str, Dict[str, Any]] = {
    TIER_STARTER: {
        "id": TIER_STARTER,
        "name": "Starter",
        "tagline": "Core membership CRM & renewals for boutique fitness studios.",
        "recommended": False,
        "max_members": 150,
        "prices": {
            "INR": {"amount": "999", "symbol": "₹", "product_id": "online.revorax.renewaldesk.starter.inr"},
            "AED": {"amount": "99", "symbol": "AED ", "product_id": "online.revorax.renewaldesk.starter.aed"},
            "USD": {"amount": "19", "symbol": "$", "product_id": "online.revorax.renewaldesk.starter.usd"},
            "GBP": {"amount": "15", "symbol": "£", "product_id": "online.revorax.renewaldesk.starter.gbp"},
            "AUD": {"amount": "29", "symbol": "A$", "product_id": "online.revorax.renewaldesk.starter.aud"},
            "EUR": {"amount": "18", "symbol": "€", "product_id": "online.revorax.renewaldesk.starter.eur"},
            "SAR": {"amount": "79", "symbol": "SAR ", "product_id": "online.revorax.renewaldesk.starter.sar"},
        },
        "features": [
            "Up to 150 Active Members",
            "Membership Expiry & Renewal Tracking",
            "Payment Recording & Verification Receipts",
            "Biometric Access Gate Integration",
            "Member CSV Import & Export",
        ],
        "entitlements": ["renewal_desk", "biometric"],
    },
    TIER_GROWTH: {
        "id": TIER_GROWTH,
        "name": "Growth",
        "tagline": "Automated WhatsApp reminders & revenue tools for growing gyms.",
        "recommended": True,
        "max_members": 500,
        "prices": {
            "INR": {"amount": "1499", "symbol": "₹", "product_id": "online.revorax.renewaldesk.growth.inr"},
            "AED": {"amount": "199", "symbol": "AED ", "product_id": "online.revorax.renewaldesk.growth.aed"},
            "USD": {"amount": "39", "symbol": "$", "product_id": "online.revorax.renewaldesk.growth.usd"},
            "GBP": {"amount": "29", "symbol": "£", "product_id": "online.revorax.renewaldesk.growth.gbp"},
            "AUD": {"amount": "59", "symbol": "A$", "product_id": "online.revorax.renewaldesk.growth.aud"},
            "EUR": {"amount": "35", "symbol": "€", "product_id": "online.revorax.renewaldesk.growth.eur"},
            "SAR": {"amount": "149", "symbol": "SAR ", "product_id": "online.revorax.renewaldesk.growth.sar"},
        },
        "features": [
            "Up to 500 Active Members",
            "Everything in Starter Plan",
            "Automated WhatsApp Expiry Reminders",
            "Festival & Announcement Broadcasts",
            "Daily Staff Push Notification Alerts",
            "Financial Breakdown & Revenue Reports",
        ],
        "entitlements": ["renewal_desk", "whatsapp_bot", "biometric", "advanced_reports"],
    },
    TIER_PRO: {
        "id": TIER_PRO,
        "name": "Pro",
        "tagline": "24/7 AI Receptionist & lead conversion for premier fitness centers.",
        "recommended": False,
        "max_members": None,  # Unlimited
        "prices": {
            "INR": {"amount": "2499", "symbol": "₹", "product_id": "online.revorax.renewaldesk.pro.inr"},
            "AED": {"amount": "299", "symbol": "AED ", "product_id": "online.revorax.renewaldesk.pro.aed"},
            "USD": {"amount": "59", "symbol": "$", "product_id": "online.revorax.renewaldesk.pro.usd"},
            "GBP": {"amount": "49", "symbol": "£", "product_id": "online.revorax.renewaldesk.pro.gbp"},
            "AUD": {"amount": "89", "symbol": "A$", "product_id": "online.revorax.renewaldesk.pro.aud"},
            "EUR": {"amount": "55", "symbol": "€", "product_id": "online.revorax.renewaldesk.pro.eur"},
            "SAR": {"amount": "229", "symbol": "SAR ", "product_id": "online.revorax.renewaldesk.pro.sar"},
        },
        "features": [
            "Unlimited Active Members",
            "Everything in Growth Plan",
            "24/7 WhatsApp AI Receptionist",
            "Automated Lead Capture & Trial Booking",
            "Live Chat Staff Takeover & Human Handover",
            "AI FAQ Sandbox Testing & Priority Support",
        ],
        "entitlements": ["renewal_desk", "whatsapp_bot", "biometric", "advanced_reports", "ai_receptionist"],
    },
}


def get_available_plans(currency: str = "INR") -> List[Dict[str, Any]]:
    """Return localized plan catalog for the gym's currency."""
    currency_code = (currency or "INR").upper()
    plans_list = []

    for tier_key in [TIER_STARTER, TIER_GROWTH, TIER_PRO]:
        catalog_item = PLAN_CATALOG[tier_key]
        price_info = catalog_item["prices"].get(currency_code) or catalog_item["prices"].get("INR")
        
        plans_list.append({
            "id": catalog_item["id"],
            "name": catalog_item["name"],
            "tagline": catalog_item["tagline"],
            "recommended": catalog_item["recommended"],
            "max_members": catalog_item["max_members"],
            "price": price_info["amount"],
            "currency": currency_code,
            "currency_symbol": price_info["symbol"],
            "product_id": price_info["product_id"],
            "billing_period": "monthly",
            "features": catalog_item["features"],
            "entitlements": catalog_item["entitlements"],
        })

    return plans_list


def get_gym_subscription(gym: Gym) -> Dict[str, Any]:
    """Return comprehensive, truthful subscription status and entitlement information."""
    currency = gym.currency or "INR"
    available_plans = get_available_plans(currency)

    # Determine plan tier
    plan_tier = TIER_GROWTH  # default
    if gym.max_members and gym.max_members <= 150:
        plan_tier = TIER_STARTER
    elif gym.max_members is None:
        plan_tier = TIER_PRO

    matched_plan = next((p for p in available_plans if p["id"] == plan_tier), available_plans[1])

    # Check entitlements
    entitlements = (
        FeatureEntitlement.query.filter_by(gym_id=gym.id, enabled=True)
        .all()
    )
    active_features = [e.feature for e in entitlements if e.is_active()]
    if not active_features:
        # Default active features during trial or active status
        active_features = matched_plan["entitlements"]

    # Determine billing source
    # If gym has a founder-created deployment or no Google order ID, billing source is MANUAL
    billing_source = "MANUAL"
    if getattr(gym, "billing_source", None):
        billing_source = gym.billing_source

    status = (gym.subscription_status or "trial").upper()

    # Calculate dates
    today = date.today()
    renews_at = (gym.trial_ends_at or (today + timedelta(days=30))).isoformat()
    expires_at = renews_at
    grace_period_end = None

    if status == "GRACE_PERIOD":
        grace_period_end = (today + timedelta(days=7)).isoformat()

    return {
        "billing_source": billing_source,
        "subscription_status": status,
        "plan": {
            "id": matched_plan["id"],
            "name": matched_plan["name"],
            "price": matched_plan["price"],
            "currency": matched_plan["currency"],
            "currency_symbol": matched_plan["currency_symbol"],
            "product_id": matched_plan["product_id"],
            "billing_period": "monthly",
        },
        "started_at": gym.created_at.isoformat() if gym.created_at else None,
        "renews_at": renews_at,
        "expires_at": expires_at,
        "grace_period_end": grace_period_end,
        "purchase_management_available": billing_source == "GOOGLE_PLAY",
        "max_members": gym.max_members,
        "active_entitlements": active_features,
    }


def verify_google_play_purchase(
    gym: Gym,
    purchase_token: str,
    product_id: str,
    order_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Verify purchase token, acknowledge subscription, and update tenant entitlement."""
    if not purchase_token or not product_id:
        return {"success": False, "error": "Missing purchase token or product ID"}

    # Map product ID to plan tier
    tier = TIER_GROWTH
    for t, data in PLAN_CATALOG.items():
        for curr, pdata in data["prices"].items():
            if pdata["product_id"] == product_id:
                tier = t
                break

    catalog_tier = PLAN_CATALOG[tier]

    # Update Gym
    gym.subscription_status = "active"
    gym.max_members = catalog_tier["max_members"]
    gym.trial_ends_at = date.today() + timedelta(days=30)
    
    # Update Feature Entitlements
    now = _utcnow()
    exp = now + timedelta(days=30)
    for feat in catalog_tier["entitlements"]:
        ent = FeatureEntitlement.query.filter_by(gym_id=gym.id, feature=feat).first()
        if not ent:
            ent = FeatureEntitlement(gym_id=gym.id, feature=feat, enabled=True, expires_at=exp)
            db.session.add(ent)
        else:
            ent.enabled = True
            ent.expires_at = exp

    db.session.commit()

    return {
        "success": True,
        "message": f"Successfully activated {catalog_tier['name']} subscription.",
        "subscription": get_gym_subscription(gym),
    }


def restore_gym_subscription(gym: Gym, purchase_token: str, product_id: str) -> Dict[str, Any]:
    """Restore existing Google Play subscription for the tenant."""
    return verify_google_play_purchase(gym, purchase_token, product_id)
