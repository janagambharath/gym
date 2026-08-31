# Renewal Desk — Meta WhatsApp Coexistence Setup

## Status: NOT VERIFIED

Coexistence eligibility, provisioning, and approval are controlled by Meta and the customer’s WhatsApp Business account. No actual account was connected or tested during this release-blocker work.

## Safe setup sequence

1. Confirm that the intended customer phone/WABA is eligible for the current Meta coexistence program.
2. Complete Meta authorization using the approved onboarding flow; do not collect or embed Meta access tokens in the Android client.
3. Validate the callback and bind the resulting WABA and phone-number IDs to exactly one authorized Renewal Desk tenant.
4. Store credentials server-side with least privilege and rotate them through the provider-approved process.
5. Verify inbound webhooks, outbound templates, 24-hour-session rules, duplicate delivery handling, retries, and staff/AI takeover with the real provider.
6. Document provider state as `NOT_CONNECTED`, `PENDING`, `ACTION_REQUIRED`, `CONNECTED`, `FAILED`, or `DISCONNECTED` based on backend/provider evidence only.

## Release boundary

Do not mark coexistence connected, supported, or production-ready until the account-specific Meta flow above has completed and been recorded.
