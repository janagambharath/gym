# Renewal Desk Android production launch review

Updated: 2026-08-24

## Executive verdict

**NOT READY FOR PUBLIC PRODUCTION RELEASE.**

This is not because the Android app is an unimplemented foundation: it now has
native, API-backed authentication, dashboard, member, renewal, payment,
WhatsApp, administration, report, and WhatsApp Bot workflows. The remaining
work is deployment and real-world release validation, which cannot be proven
from source code or automated tests alone.

## Verified implementation

- React Navigation presents five primary mobile areas: Dashboard, Members,
  Renewals, Payments, and More, with working drill-down and return/refresh
  behavior after mutations.
- Screens use the protected `/api/mobile/v1` API, bearer session tokens, token
  refresh, timeouts, and generic network failure states. Sessions are stored
  with Expo SecureStore.
- Membership renewal is deliberately payment-first. Payment creation uses an
  `Idempotency-Key`; a retry cannot create a duplicate payment. The member is
  extended after verified payment rather than being presented as renewed while
  payment is pending.
- All mobile Bot routes are tenant scoped and entitlement protected. Owner-only
  bot configuration is validated by the server; staff replies are added to the
  visible transcript only after WhatsApp accepts them.
- The client carries no payment, WhatsApp/Meta, OpenRouter, or Bridge secret.

## Automated evidence

| Check | Result |
| --- | --- |
| Backend suite | `103 passed` |
| Android verification | TypeScript, Expo lint, and 10 runtime tests passed |
| Expo Doctor | 21/21 checks passed |
| Android JS export | Passed; Metro produced Android bundle and assets |
| Alembic | `flask db heads` reports only `1e5f6a7b8c9d (head)` |
| Dependency audit | 10 moderate Expo transitive findings; no safe force-fix applied |

## Release blockers

1. EAS `preview` and `production` currently have no
   `EXPO_PUBLIC_API_BASE_URL`. Configure approved HTTPS endpoints before any
   cloud build.
2. The mobile route feature flag is currently disabled in the local runtime.
   Set `MOBILE_API_ENABLED=true` and a separate, production-strength
   `MOBILE_API_TOKEN_SECRET` in the staged and production backend before
   attempting app login.
3. Apply the new bot-entitlement and mobile-idempotency migrations in staging
   with a tested backup/rollback procedure, then validate the deployed mobile
   API.
4. Install a preview APK on a physical device and perform an owner/staff,
   tenant-isolation, mutation, network-recovery, and logout/account-switching
   test.
5. Perform a consented WhatsApp reminder, bot reply, handover, and provider
   failure test using the launch configuration.
6. Complete a real gym pilot and the Play Console privacy policy, Data Safety,
   support, reviewer access, store assets, and signing steps before creating a
   production AAB.

## Do not bypass these boundaries

Do not hardcode a production URL, secret, test credentials, or a mock success
state to obtain a build. Do not use the biometric Bridge directly from Android.
Do not run `npm audit fix --force`: its offered downgrade is incompatible with
this Expo SDK version.

See [FINAL_LAUNCH_GATE.md](FINAL_LAUNCH_GATE.md) for the ordered release
procedure and [FEATURE_PARITY.md](FEATURE_PARITY.md) for current scope.
