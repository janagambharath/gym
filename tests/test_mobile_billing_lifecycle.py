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
    assert failed == "PAYMENT_FAILED" and grace_end is not None
