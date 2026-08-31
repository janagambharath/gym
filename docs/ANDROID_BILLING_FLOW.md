# Renewal Desk — Android Billing Flow

## Source of truth

The canonical billing implementation is `app/services/mobile_billing_service.py` and the `/api/mobile/v1/billing/*` routes. Older `/subscription/*` routes are compatibility adapters only; they delegate to the same verifier and no longer create local entitlements from client-supplied tokens.

## Product IDs

| Plan | Product ID |
|---|---|
| Starter | `online.revorax.renewaldesk.sub.starter` |
| Growth | `online.revorax.renewaldesk.sub.growth` |
| Pro | `online.revorax.renewaldesk.sub.pro` |

Google Play owns storefront-specific prices and eligibility. The native client queries product details and offer tokens at runtime; it does not use the backend's display price to initiate a purchase.

## Purchase flow

```text
Android SubscriptionScreen
  -> GET /billing/entitlement, /billing/catalog, /billing/purchase-context
  -> expo-iap initConnection + fetchProducts
  -> requestPurchase with Play offer token and obfuscated account ID
  -> purchaseUpdatedListener receives the real purchase token
  -> POST /billing/purchases/verify
  -> Android Publisher API verifies package, product, account binding, state, and token
  -> backend stores encrypted token and authoritative entitlement
  -> client refreshes entitlement and only then finishTransaction
```

`PENDING` purchases are displayed as pending and do not unlock access. A server verification failure leaves the Play transaction unfinished for later retry and does not alter local access.

## Restore and lifecycle

- Android gets actual available purchases from the Play Billing client.
- The app posts product/token pairs to `/billing/restore`; the backend verifies every accepted token with Google before returning an entitlement.
- The client finalizes a restored transaction only after server verification.
- RTDN reconciliation re-verifies encrypted stored tokens and maps Google states to `ACTIVE`, `PENDING`, `PAYMENT_FAILED`, `CANCELLED`, or `EXPIRED`.
- A cancelled subscription keeps its provider expiry time; access must be controlled server-side until that expiry.

## Manual customers

`billing_source = MANUAL` is a valid server entitlement. The app shows plan/status/dates without presenting a Play checkout, restore, or false Play-subscription management option.

## Deployment prerequisites

The deployed backend needs server-only Google credentials and settings: package name, Android Publisher service-account JSON, token encryption key, and RTDN OIDC audience/service account. EAS public variables must contain only safe client configuration, such as the actual HTTPS API base URL.

## Verification status

The client/build integration and negative verification tests are implemented. A real Play Internal Testing purchase, restore, cancellation, pending-payment, and RTDN test have not been performed.
