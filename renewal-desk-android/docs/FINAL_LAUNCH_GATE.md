# Renewal Desk Android launch gate

Updated: 2026-08-24

## Verdict

**NOT READY FOR A PUBLIC PRODUCTION LAUNCH YET.**

The source code is feature-complete for the supported mobile workflows and has
passed its automated checks. A public launch still requires configuration,
staging migration validation, an installed-device test, and real provider
verification. This is a release gate, not a statement that the app lacks the
implemented features below.

## What is implemented

- Secure native login, refresh-token rotation, logout, and authenticated API
  requests.
- Live dashboard, members, member detail, add/edit/deactivate, search, status
  filters, and pagination.
- Renewal and payment workflows. The primary mobile renewal flow records a
  **pending** payment and extends membership only after payment verification;
  it never shows a pending payment as paid.
- WhatsApp reminder history and sending, plans, staff, settings, and reports.
- Entitlement-gated WhatsApp Bot overview, conversations, leads, handover,
  owner configuration, and test flow. Bot access is denied server-side unless
  the gym has an enabled entitlement.
- Native visual hierarchy aligned to the Renewal Desk dashboard, member,
  renewal, and bot reference flows. All screen content is sourced from APIs;
  no demonstration member or payment data is embedded in the client.

## Code gate evidence

| Check | Result |
| --- | --- |
| Backend test suite | `103 passed` |
| Android type checking, lint, and runtime tests | `npm run verify` passed (10 runtime tests) |
| Expo dependency/configuration audit | `expo-doctor` passed 21/21 checks |
| Android JavaScript bundle | `expo export --platform android` passed |
| Database migration topology | One Alembic head: `1e5f6a7b8c9d` |
| Mobile payment retry safety | Idempotency-key coverage passed |

## Required launch work, in order

1. Set `EXPO_PUBLIC_API_BASE_URL` for the EAS `preview` environment and the
   approved HTTPS production API URL for `production`. Do not put secrets in
   these public build variables.
2. In staging and production, set `MOBILE_API_ENABLED=true` and a distinct
   production-strength `MOBILE_API_TOKEN_SECRET` (at least 32 characters),
   then verify the protected mobile routes are registered. The local runtime
   currently reports the mobile API as disabled, which is the safe default.
3. Back up and apply the two new Alembic migrations in staging, then smoke-test
   login, tenant isolation, member changes, payment verification, and bot
   entitlement behavior.
4. Build and install a preview APK on a physical Android device. Test owner and
   staff accounts, slow/offline network behavior, logout/account switching,
   and every mobile mutation.
5. Run a consented real WhatsApp reminder and bot handover test with the
   provider configuration used for launch.
6. Complete the gym-owner pilot, Play Console listing/policy/Data Safety
   materials, support and reviewer access, then build the signed production
   AAB.
7. Formally accept or resolve the current 10 moderate Expo transitive audit
   findings with an Expo-compatible upgrade plan. Do not force the incompatible
   automatic Expo downgrade.

## Deliberate boundaries

The Android app does not embed payment, Meta/WhatsApp, AI-provider, or Bridge
secrets. The separate biometric PC Bridge remains outside the mobile client;
the backend is the authority for tenant data, membership state, payments, and
provider delivery.
