# Renewal Desk — Google Play Subscriptions Architecture

## 1. Product Catalog & Tiers
Renewal Desk operates a centralized 3-tier subscription catalog across 7 major currencies:

| Tier | Google Play Product ID | INR (₹) | AED | USD ($) | Features Included |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Starter** | `online.revorax.renewaldesk.sub.starter` | ₹999/mo | AED 99/mo | $19/mo | Up to 150 members, automated WhatsApp renewals, basic dashboard |
| **Growth** *(Recommended)* | `online.revorax.renewaldesk.sub.growth` | ₹1,499/mo | AED 199/mo | $39/mo | Up to 500 members, AI Receptionist, 24/7 lead capture, staff handover |
| **Pro** | `online.revorax.renewaldesk.sub.pro` | ₹2,499/mo | AED 299/mo | $59/mo | Unlimited members, AI Desk, Biometric Bridge sync, advanced analytics |

## 2. Acquisition Dual Paths
- **Path A: Founder-Assisted / Concierge Customers**:
  - `billing_source: MANUAL`
  - Managed by founder via direct invoice or onboarding agreement.
  - The Android app displays founder-concierge status without prompting Google Play paywalls.
- **Path B: Self-Serve Customers**:
  - `billing_source: GOOGLE_PLAY`
  - Signed up via Android app.
  - Subscribes via Google Play Billing Client, with receipt token verified on backend.

## 3. Server-Side Verification Flow
1. **Purchase in App**: User selects plan and completes purchase via Google Play Billing.
2. **Token Handshake**: Android client sends `purchase_token` and `product_id` to `POST /api/mobile/v1/subscription/verify`.
3. **Backend Validation**:
   - Parses Google Play purchase token.
   - Identifies associated tier (`starter`, `growth`, `pro`).
   - Updates `Gym.subscription_status = 'ACTIVE'`, `Gym.plan_tier`, `Gym.billing_source = 'GOOGLE_PLAY'`.
   - Extends entitlement expiration by 30 days.
4. **Restore Purchases**:
   - Client calls `POST /api/mobile/v1/subscription/restore` when reinstalling app or changing devices.
   - Backend restores active subscriptions safely.
