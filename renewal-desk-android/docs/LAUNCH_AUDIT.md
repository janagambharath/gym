# Android Release-Blocker Implementation Status

Updated: 2026-08-30
Scope: Android client and the additive `/api/mobile/v1` contracts it requires. No web routes, templates, CSS, JavaScript, onboarding, or biometric Bridge code was changed.

## Implemented and locally verified

| Area | Status | Evidence |
| --- | --- | --- |
| Self-service account creation | PARTIALLY VERIFIED | `POST /api/mobile/v1/auth/register` validates owner, gym, E.164 phone, strong password, locale, and duplicate email/phone. It creates the owner, gym defaults, session, and a `PLAN_SELECTION` state. Android has a welcome → owner → gym → country/currency → account-created sequence. Local API tests pass; no deployed-environment run was performed. |
| Billing entitlement | PARTIALLY VERIFIED | Server-owned entitlement includes source, plan, status, start/renewal/expiry/grace dates, and purchase-management availability. Android refreshes it from the API and does not infer access from a device callback. |
| Manual billing | PARTIALLY VERIFIED | The entitlement defaults existing/founder gyms to `MANUAL`; Android clearly hides Play controls for these gyms. A production founder-gym flow was not run. |
| Google Play infrastructure | BLOCKED | Server catalog, purchase verification endpoint, encrypted purchase-token storage, restore contract, RTDN endpoint, and reconciliation CLI are implemented. A real Play Billing client library, Play Console product IDs, service account, encryption key, Pub/Sub OIDC configuration, and internal-track verification are still absent. No purchase can become active without Google server verification. |
| Subscription UI | PARTIALLY VERIFIED | Shows current plan, source, status, dates, grace period, and Google management link only when source is `GOOGLE_PLAY`. It truthfully states that restore/checkout require a Play-Billing-enabled release instead of claiming success. |
| CSV import | PARTIALLY VERIFIED | Android now selects CSV files with Expo DocumentPicker/FileSystem, previews validation, shows row errors/duplicates, and only confirms an atomic backend import when every row is valid. Local contract tests pass; device file-provider testing remains required. |
| Internationalisation | PARTIALLY VERIFIED | Gym country/currency/timezone now come from the API/session. Currency, date, count, phone prefix, and new-record dates are locale-aware. Automated coverage exercises INR, AED, GBP, AUD, and USD; physical locale/device testing is outstanding. |
| WhatsApp connection truth | PARTIALLY VERIFIED | Mobile API exposes `NOT_CONNECTED`, `PENDING`, `ACTION_REQUIRED`, `CONNECTED`, and `FAILED`; broadcasts are enabled only for backend-confirmed `CONNECTED`. The app shows a truthful setup next step when Meta onboarding cannot be started by the mobile contract. Provider onboarding/delivery tests remain required. |
| Tenant and idempotency safety | PARTIALLY VERIFIED | Added a cross-gym altered-ID API test; existing mobile payment/renewal idempotency tests pass. Two-gym black-box UI, deep-link, and stale-cache tests remain required. |
| Dependency review | REVIEWED | `npm audit --json` reports 10 moderate transitive Expo/toolchain findings, including `uuid` via `xcode`. The only suggested fix is an incompatible downgrade to Expo 46, so no unsafe automated change was made. |

## Backend changes

- Added locale and entitlement fields on `Gym`, plus migration `a3b4c5d6e7f8` and an encrypted, tenant-scoped `GooglePlaySubscription` record.
- Added mobile registration, billing catalog/entitlement/purchase verification/restore/purchase-context, RTDN, reconciliation CLI, member CSV preview/import, and WhatsApp status contracts.
- Google verification calls Android Publisher API only with server-side credentials; purchase tokens are encrypted at rest for reconciliation and never returned to the client.
- The production configuration now rejects a partially configured Google Play setup.

## Android changes

- Added account-creation onboarding, Subscription, and Import Members screens.
- Added SDK-57-compatible `expo-document-picker` and `expo-file-system` for device CSV selection.
- Persisted gym country/currency/timezone in SecureStore and removed hard-coded currency/date formatting from production screens.
- Added backend-confirmed WhatsApp state display and kept disconnected broadcasts disabled.

## Automated validation

- `npm.cmd run verify`: PASS — typecheck, lint, 17 unit tests.
- `python -m pytest -q`: PASS.
- `npx.cmd expo export --platform android`: PASS — Android bundle exported to `renewal-desk-android/dist`.
- `npx.cmd expo install --check`: PASS — dependencies are SDK-57 compatible.
- `python -m py_compile` for changed API/models/migration: PASS.
- `git diff --check`: PASS (line-ending warnings only).

## Required external completion before release

1. Apply migration `a3b4c5d6e7f8` to the reviewed production database.
2. Configure the production API URL in controlled EAS environment variables; configure Google package name, service account JSON, Fernet key, Pub/Sub OIDC audience/service account, and production product mapping.
3. Add and test a real Android Play Billing integration in a development build, including purchase query/restore and submission of purchase tokens to the verification endpoint. Do not activate access before the API responds with an active entitlement.
4. Create products and run all lifecycle scenarios on a Play internal test track: first purchase, pending, cancel, grace, restore, reinstall, new device, manual customer, and RTDN.
5. Complete Meta onboarding/coexistence and test every WhatsApp state and delivery failure against the real provider.
6. Perform physical Android testing: login/logout/token expiry/offline/slow network, notifications foreground/background/cold-start, keyboard/font scaling/long content/large lists, and two-gym black-box isolation.
7. Build, install, and smoke-test a signed production AAB. None exists in this workspace.

## Release decision

**NO-GO.** The required mobile contracts and safer client paths are now implemented and locally tested, but real Google Play purchase/restore verification, provider onboarding, physical-device acceptance, production configuration, and a signed AAB have not been completed. These are release blockers and must remain **NOT VERIFIED / BLOCKED**.
