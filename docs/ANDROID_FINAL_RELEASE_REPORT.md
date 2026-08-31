# Renewal Desk — Final Release Blocker Report

**Status date:** 2026-08-31

**Package:** `online.revorax.renewaldesk`

**Version / versionCode:** `1.0.0` / `6`
**EAS project:** `7eef8559-b676-40bc-a7e0-faa9424765db`

## Executive verdict

# GO WITH CONDITIONS

The code-level Android billing blocker has been removed and all automated gates pass. A release AAB, physical-device validation, Play Console testing, provider validation, and a production API value remain unverified external gates. This is not a claim that the app is currently live or ready for production rollout.

## Implemented and tested

- Native Android Play Billing via `expo-iap`, including product discovery, offer-token checkout, pending-purchase handling, server verification, restore, transaction completion, and Google Play subscription management.
- Entitlements remain server-authoritative. The client sends a real purchase token only to `POST /api/mobile/v1/billing/purchases/verify`; it never activates access locally.
- Legacy subscription write routes now delegate to the canonical verifier and cannot activate an invented token.
- The catalog uses `online.revorax.renewaldesk.sub.starter`, `.growth`, and `.pro` across client and backend.
- Canonical mobile signup accepts the supported legacy payload safely, enforces the documented password policy, and returns precise duplicate-email responses.
- Notification registration no longer falls back to a hard-coded EAS project ID.
- Session locale preferences drive date and currency formatting.

## Automated evidence

| Command | Actual result |
|---|---|
| `cd renewal-desk-android && npm run verify` | 17 passed; TypeScript and ESLint clean |
| `python -m pytest -q` | 165 passed, 40 SQLAlchemy `LegacyAPIWarning` warnings, 0 failed (119.64 s) |
| `cd renewal-desk-android && npx expo config --type public` | Resolved Expo SDK 57 configuration, package and `expo-iap` plugin present |
| `eas env:list --environment production` | `No variables found for this environment.` |

`npm audit --omit=dev` and `npx expo-doctor` must be re-run after the final dependency lockfile review before an AAB is started. No forced Expo downgrade is permitted to silence audit findings.

## Verification status

| Area | Status | Evidence / limitation |
|---|---|---|
| Auth and self-service signup | TESTED | Backend suite passes; duplicate and validation regressions covered. |
| Manual customer billing | TESTED | Server entitlement contract tested; app suppresses Play checkout for `MANUAL`. |
| Three plan IDs | TESTED | Canonical catalog test covers all three IDs. Play Console product existence is not verified. |
| Google Play Billing integration | IMPLEMENTED, NOT VERIFIED | Native implementation is compiled, but no real device/Internal Test transaction has run. |
| Subscription lifecycle | TESTED (mapping) | Pending, active, cancelled, grace, and failure state mapping covered; live RTDN not exercised. |
| WhatsApp / Meta / coexistence | NOT VERIFIED | Requires configured Meta provider, business approval, and live callback test. |
| AI provider | NOT VERIFIED | No provider-backed production request was made. |
| Notifications | NOT VERIFIED | No physical Android notification test was run. |
| UI/UX and accessibility | NOT VERIFIED | Code review added accessible billing controls and 44dp actions; no hardware/screen-reader review occurred. |
| Target API | IMPLEMENTED | Expo SDK 57 configuration resolved. Final compiled AAB target has not been inspected. |
| Production configuration | BLOCKED | Production EAS environment has no `EXPO_PUBLIC_API_BASE_URL`. |
| Signed AAB / EAS build | NOT VERIFIED | No production build was started because the required production API value is absent. |
| Play Console / internal test | BLOCKED | Requires account access, truthful listing/content declarations, products, and testing-track requirements. |

## Remaining external gates

1. Set the real HTTPS production value for `EXPO_PUBLIC_API_BASE_URL` in the EAS `production` environment. It must not be a localhost, staging, or secret value.
2. Configure server-only Google Play verification values on the deployed backend: `GOOGLE_PLAY_PACKAGE_NAME`, service-account JSON, purchase-token encryption key, and RTDN OIDC settings. Do not place any of them in EAS public variables.
3. Create and activate the exact three Play subscription products and eligible base plans/offers; then test with Google Play Internal Testing on physical Android hardware.
4. Build the production profile, inspect the resulting signed AAB, and record its EAS build ID, artifact URL, package, version, and versionCode.
5. Complete Play Console app content, data safety, listing, reviewer access, and account-specific testing requirements truthfully.
6. Obtain and validate Meta/WhatsApp configuration and any required approvals before calling those flows production-verified.

## Build record

- Build ID: not created
- Artifact: not created
- Signed AAB: not verified
- Google Play production: not submitted
