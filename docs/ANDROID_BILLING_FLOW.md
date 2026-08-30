# Renewal Desk — Android Billing Architecture & Google Play Subscriptions

## 1. Dual Acquisition Paths & Billing Sources

Renewal Desk supports two customer acquisition models:

### Path A: Founder-Assisted / Concierge Customer (`billing_source: MANUAL`)
- **Target**: High-touch gym clients onboarded directly by the founder via custom contracts.
- **Client Behavior**:
  - The mobile app identifies `billing_source === 'MANUAL'` from `GET /api/mobile/v1/subscription/status`.
  - Suppresses all Google Play checkout triggers, paywalls, and auto-renew warnings.
  - Displays a dedicated Concierge Account banner with direct support contact details.
  - Access to features is managed via `Gym.subscription_status` and `Gym.active_until`.

### Path B: Self-Service Mobile Customer (`billing_source: GOOGLE_PLAY`)
- **Target**: Gym owners downloading the app directly from Google Play.
- **Client Behavior**:
  - Initial 30-day all-inclusive `TRIAL` provisioned on registration.
  - Subscribes to recurring billing via Google Play In-App Billing.
  - Receipt token verified server-side.

---

## 2. Server-Authoritative Verification Rule

> **CRITICAL SECURITY INVARIANT**:
> The Android client **MUST NOT** grant premium feature entitlements solely from a client-side Google Play purchase callback.

### Enforced Purchase Handshake Flow:
```
[Android Client]
      │
      │ 1. User selects plan & confirms purchase in Play Dialog
      ▼
[Google Play Store]
      │
      │ 2. Issues purchase token to Android client
      ▼
[Android Client]
      │
      │ 3. POST /api/mobile/v1/subscription/verify { purchaseToken, productId }
      ▼
[Renewal Desk Backend (subscription_service.py)]
      │
      │ 4. Validates token & product ID against catalog
      │ 5. Updates Gym.subscription_status = 'ACTIVE'
      │ 6. Updates Gym.plan_tier & sets renews_at = now + 30 days
      │ 7. Grants FeatureEntitlements
      ▼
[Android Client]
      │
      │ 8. Receives 200 OK + active subscription object
      ▼
[Active Entitlement Screen]
```

If backend verification fails or is unreachable, the client remains in its current state with an error banner and **zero** unauthorized access granted.

---

## 3. Standardized 3-Tier Subscription Catalog

All tiers are defined centrally in `app/services/subscription_service.py`:

```json
{
  "starter": {
    "id": "starter",
    "name": "Starter",
    "product_id": "online.revorax.renewaldesk.sub.starter",
    "tagline": "Essential member renewals & attendance tracking",
    "member_limit": 150,
    "pricing": {
      "INR": 999,
      "AED": 99,
      "USD": 19,
      "GBP": 15,
      "AUD": 29,
      "EUR": 19,
      "SAR": 79
    },
    "features": [
      "Up to 150 active members",
      "Automated WhatsApp renewal reminders",
      "Payment tracking & digital receipts",
      "Basic dashboard metrics"
    ]
  },
  "growth": {
    "id": "growth",
    "name": "Growth",
    "recommended": true,
    "product_id": "online.revorax.renewaldesk.sub.growth",
    "tagline": "Automated renewal recovery + 24/7 AI Desk",
    "member_limit": 500,
    "pricing": {
      "INR": 1499,
      "AED": 199,
      "USD": 39,
      "GBP": 29,
      "AUD": 59,
      "EUR": 39,
      "SAR": 149
    },
    "features": [
      "Up to 500 active members",
      "24/7 WhatsApp AI Receptionist",
      "Automated lead capture & free trials",
      "Staff takeover & conversation inbox",
      "CSV bulk member import",
      "Urgent staff handover alerts"
    ]
  },
  "pro": {
    "id": "pro",
    "name": "Pro",
    "product_id": "online.revorax.renewaldesk.sub.pro",
    "tagline": "Unlimited members, biometric syncing & advanced reports",
    "member_limit": 999999,
    "pricing": {
      "INR": 2499,
      "AED": 299,
      "USD": 59,
      "GBP": 49,
      "AUD": 89,
      "EUR": 59,
      "SAR": 229
    },
    "features": [
      "Unlimited active members",
      "All Growth features included",
      "Biometric Bridge real-time sync",
      "Multi-staff access control",
      "Advanced financial & retention reports",
      "Priority 24/7 founder support"
    ]
  }
}
```

---

## 4. Subscription Lifecycle State Machine

```
[TRIAL (30 Days)] ──(Subscribe)──► [ACTIVE] ──(Auto-Renew)──► [ACTIVE]
        │                              │
        │ (Expires)                    │ (Payment Failed)
        ▼                              ▼
    [EXPIRED]                   [GRACE_PERIOD (3 Days)]
                                       │
                                       │ (Unpaid)
                                       ▼
                                  [PAST_DUE]
                                       │
                                       ▼
                                  [CANCELLED]
```

- **Cancelled Subscriptions**: If a gym cancels recurring billing mid-cycle, `subscription_status` remains `ACTIVE` until the end of the paid 30-day period (`renews_at`), after which it transitions to `EXPIRED`.
- **Restore Purchases**: If an owner switches devices or reinstalls the app, tapping **Restore Purchases** triggers `POST /api/mobile/v1/subscription/restore` to query existing Google Play entitlements and reactivate the account without duplicate charges.

---

## 5. Verification vs External Dependencies

| Capability | Verification Status | Notes |
| :--- | :--- | :--- |
| **Catalog API (`GET /plans`)** | **VERIFIED** | Multi-currency pricing verified via unit tests |
| **Status API (`GET /status`)** | **VERIFIED** | Manual vs Google Play detection verified |
| **Verification API (`POST /verify`)** | **VERIFIED** | Server verification & database entitlement state verified |
| **Restore API (`POST /restore`)** | **VERIFIED** | Device restore logic verified via automated tests |
| **Live Play Store Payment Dialog** | **EXTERNAL DEPENDENCY** | Requires Google Play Console Closed Testing track & Merchant setup |
