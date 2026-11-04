from __future__ import annotations

from app.services.mobile_billing_service import _play_state


def test_google_play_lifecycle_mapping_never_promotes_pending_purchase():
    pending, _, _ = _play_state({"subscriptionState": "SUBSCRIPTION_STATE_PENDING"})
    active, renews_at, _ = _play_state({
        "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
        "lineItems": [{"expiryTime": "2026-09-30T00:00:00Z"}],
    })
    cancelled, expires_at, _ = _play_state({
        "subscriptionState": "SUBSCRIPTION_STATE_CANCELED",
        "lineItems": [{"expiryTime": "2026-09-30T00:00:00Z"}],
    })
    failed, _, grace_end = _play_state({
        "subscriptionState": "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
        "lineItems": [{"expiryTime": "2026-09-30T00:00:00Z"}],
    })

    assert pending == "PENDING"
    assert active == "ACTIVE" and renews_at is not None
    assert cancelled == "CANCELLED" and expires_at is not None
    assert failed == "GRACE_PERIOD" and grace_end is not None


def test_verified_play_purchase_applies_the_paid_member_limit(app, seed_gym, monkeypatch):
    from app.services.mobile_billing_service import _apply_verified_purchase

    gym = seed_gym["gym"]
    gym.country = "IN"
    gym.currency = "INR"
    gym.max_members = 50
    monkeypatch.setattr(
        "app.services.mobile_billing_service._encrypted_purchase_token",
        lambda _token: "encrypted-test-token",
    )

    _apply_verified_purchase(
        gym=gym,
        owner_id=seed_gym["owner"].id,
        product_id="online.revorax.renewaldesk.sub.growth",
        purchase_token="x" * 32,
        payload={
            "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
            "lineItems": [{
                "productId": "online.revorax.renewaldesk.sub.growth",
                "expiryTime": "2027-11-04T00:00:00Z",
            }],
        },
    )

    assert gym.max_members == 500
