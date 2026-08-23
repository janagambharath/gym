# Renewal Desk Android — Final Production Launch Review

**Review date:** 2026-08-23
**Reviewer:** Codex
**Scope:** Separate Expo Android repository only. The web application, backend,
Railway deployment, Redis, WhatsApp configuration, database, biometric Bridge,
and deployed gym terminals were not changed.

## Executive Verdict

## NOT READY

This repository is a clean, security-conscious **Android foundation**, not a
complete gym-operations mobile application or a Google Play release candidate.
It currently renders one service-readiness screen and performs one public,
read-only `/health` request. It does not implement login, any authenticated
mobile workflow, or an installable signed Android release artifact.

The current public production service health endpoint is healthy, but the
production mobile API endpoint returned `404` during this review. Its source
documentation also explicitly prevents public financial, renewal, and broadcast
writes until durable, database-backed idempotency is implemented and reviewed.
Do not work around that gate in Android.

## Evidence Summary

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Pass | `npm run typecheck` via `npm run verify` |
| Lint | Pass | `expo lint` via `npm run verify` |
| Unit tests | Pass | 9/9 tests passed |
| Expo Doctor | Pass | `npx expo-doctor`: 21/21 checks passed |
| Android JS bundle | Pass | `npx expo export --platform android` created a 1.4 MB Hermes bundle in the review temp directory |
| Production health client | Pass | The implemented `fetchPlatformHealth` client successfully parsed the live `/health` result |
| Mobile API in production | Fail | `GET /api/mobile/v1/health` returned `404` |
| Production Android build | Not available | EAS stopped: no authenticated Expo account; no AAB produced |
| Real device / gym pilot | Not performed | No installable release artifact exists |

## Safe Fix Applied During Review

The runtime URL validator previously accepted `http://localhost` regardless of
the selected environment. A production build could therefore be configured with
an insecure local endpoint by mistake.

`src/config/runtime.ts` now:

- accepts loopback HTTP only when `EXPO_PUBLIC_APP_ENV=development`;
- requires HTTPS in staging and production; and
- rejects API URLs that embed credentials.

The affected unit tests were added and all verification checks passed afterward.
This change is confined to the Android client and does not alter the backend or
Bridge.

## Build and Release Configuration

| Item | Result |
| --- | --- |
| Application ID | `online.revorax.renewaldesk` — valid candidate, but not proven registered/final in Play Console |
| Version name | `1.0.0` |
| Android version code | `1` |
| Permissions | `android.permission.INTERNET` only — appropriately minimal for the current foundation |
| Secure storage | `expo-secure-store` is configured with Android backup handling enabled |
| Signing | Not configured or verified |
| EAS project/account | No authenticated Expo account; no project linkage was found |
| Native Android project | None generated in this managed Expo repository |
| AAB/APK | None found or produced |
| Git release history | None — branch `main` has no commits and no remote is configured |

The `production` EAS profile is structurally reasonable, but an EAS profile is
not a release. A real production Android build needs an authenticated Expo/EAS
account, controlled signing credentials, an actual build, and an `.aab`.

The checked icon is a generic Expo-style asset and the splash asset is a template
grid. Neither is acceptable as verified final Renewal Desk store branding.

## Actual Android Feature Coverage

The current `App.tsx` renders only `ServiceReadinessScreen`. The only actual
backend integration is:

```text
ServiceReadinessScreen
  -> fetchPlatformHealth()
  -> GET {API_BASE_URL}/health
  -> defensive health state shown in the UI
```

There are no implemented native screens or client flows for:

- login, refresh-token rotation, logout, or `/me`;
- tenant-aware dashboard;
- members, search, filters, details, create, edit, deactivate, or pagination;
- renewals and payment creation/verification/rejection;
- WhatsApp reminders or announcements;
- owner/staff settings, plans, reports, or staff management;
- biometric access status, queued command state, or acknowledgement history;
- idempotency keys, retry recovery, offline state, or mutation locking;
- role-aware navigation or tenant-local cache clearing.

The existing SecureStore helper is only a future boundary. It is not wired into
an authentication or API client and does not yet model a refresh token.

## API, Authentication, RBAC, and Tenant Isolation

### Current deployment result

The read-only production checks returned:

```json
GET /health
200 {"db":"ok","revision":"ff763b204eb6","schema":"ok","status":"ok"}
```

```text
GET /api/mobile/v1/health
404 Not Found
```

Therefore, no mobile authentication, dashboard, member, renewal, payment,
WhatsApp, settings, report, staff, or access-control flow could be safely tested
against production. No credentials, test gyms, or test users were used.

### Contract status

The protected backend repository contains a documented mobile API implementation
under `/api/mobile/v1`, but its own `docs/MOBILE_API.md` states that
`MOBILE_API_ENABLED` is false by default and that public financial, renewal, and
broadcast mutations must remain disabled until a database-backed idempotency
ledger/outbox is implemented and reviewed. The deployed `404` is consistent with
that gate.

Consequently, the following are **unproven and blocked** rather than passed:

| Area | Status |
| --- | --- |
| Login / invalid login / inactive accounts | Not implemented in Android; not exercised |
| Bearer token / refresh / logout | Not implemented in Android; not exercised |
| Owner versus staff RBAC | Not implemented in Android; not exercised |
| Gym A versus Gym B isolation | Not implemented in Android; not exercised |
| Members and dashboard correctness | Not implemented in Android; not exercised |
| Renewals and payments | Not implemented in Android; public mutation gate remains closed |
| WhatsApp / consent / templates | Not implemented in Android; no consented test performed |
| Biometric commands / queued acknowledgement | Not implemented in Android; no direct device access exists |

This is the correct fail-closed state. Android must not use browser cookies,
scrape HTML, call the Bridge API, or carry any Bridge, Meta, or payment secret
to fill the gap.

## Security and Privacy Review

### Positive findings

- No hardcoded production API keys, passwords, Bridge credentials, payment
  secrets, Meta tokens, or test accounts were found in tracked source/config.
- `.env` and local environment files are ignored; `.env.example` clearly
  identifies only public, non-secret configuration.
- The app requests only Internet permission.
- The configured SecureStore plugin supports proper Android backup exclusion.
- The client does not contain a WebView/browser-session workaround or direct
  biometric hardware integration.
- The health request uses a 10-second abort timeout and a generic user-facing
  failure message.

### Remaining blockers

- A full session lifecycle is absent; a future implementation must store both
  access and refresh tokens only in SecureStore, rotate refresh tokens, clear
  all tenant-local state on logout, and never log tokens.
- No privacy policy URL exists in app configuration or release materials.
- No Data Safety declaration, account-deletion answer/path, support contact,
  store description, screenshots, or reviewer credentials are prepared.
- `npm audit --omit=dev` reported 10 moderate transitive findings under Expo
  tooling. The offered `expo@46.0.21` downgrade is not a safe automatic fix for
  this SDK 57 project. Triage the current Expo advisory chain before release;
  do not run `npm audit fix --force` blindly.

## QA and UX Review

The foundation UI has a readable status flow, retry action, error state,
accessibility headers, and minimal visual hierarchy. It is not an owner/staff
operations UX because the operational screens do not exist.

Not performed because there is no release artifact or implemented workflow:

- small, standard, large, and low-end Android testing;
- keyboard, back-navigation, gesture, background/foreground, and rotation
  validation;
- offline/intermittent-network and double-tap mutation tests;
- 500+ member performance checks;
- real-device install/launch;
- two-tenant isolation and owner/staff authorization tests;
- real consented WhatsApp recipient test;
- three-gym pilot and regression pass.

## Google Play Readiness

| Requirement | Status |
| --- | --- |
| Final package identity | Candidate only; not verified in Play Console |
| Signed AAB | Missing |
| Play App Signing plan | Not set up/verified |
| Store icon/screenshots/descriptions/category/support email | Missing or unverified |
| Privacy policy URL | Missing |
| Data Safety declaration | Missing |
| Account deletion disclosure/path | Missing/unverified |
| Closed-test plan and real testers | Missing |
| Monitoring and incident/rollback plan | Missing |
| Production reviewer credentials | Missing |

Google Play requires an accurate Data Safety form and privacy policy even for
apps that collect no data. If this is a personal Play developer account created
after 13 November 2023, the current requirement is a closed test with at least
12 real opted-in testers continuously for 14 days before production access.
Confirm the account type in Play Console before scheduling release work.

## Risk Register

| Risk | Level | Why |
| --- | --- | --- |
| No actual mobile product workflows | Critical | A gym owner cannot manage normal daily operations in the app. |
| Production mobile API disabled / durable-write gate open | Critical | Safe financial, renewal, and broadcast operations cannot be exposed or tested. |
| No authentication/RBAC/tenant integration tests | Critical | Tenant and authorization safety are unproven. |
| No signed AAB or real-device test | Critical | There is nothing valid to install or submit. |
| No Git history/remote | High | There is no reproducible release baseline or safe push target. |
| Play privacy, Data Safety, account deletion, and assets missing | High | Submission would be incomplete/non-compliant. |
| Generic template branding | High | Store branding is not release-ready. |
| Moderate npm audit findings | Medium | Requires version-aware security triage before release. |

## Exact Next Action

**Keep `MOBILE_API_ENABLED=false` in production and approve a separate backend
change path for a durable database-backed idempotency ledger/outbox.**

Only after that change is reviewed and deployed to a separate staging
environment should the Android app be built into a real product against the
versioned mobile contract. The first Android delivery should include the full
login/session lifecycle, role/tenant-safe API client, dashboard, members,
renewals, payments, WhatsApp, offline/idempotency UX, and Bridge command status
workflow; then run a closed internal test before any gym pilot.

## Required Release Sequence After the Product Exists

1. Commit this Android repository to a private remote and protect the main
   branch; do not put signing credentials or production secrets in Git.
2. Provision a staging mobile API with isolated Redis, test gym accounts, and
   representative test data. Prove owner/staff RBAC and Gym A/Gym B isolation.
3. Build all required native flows against that contract and test every write
   with idempotency/retry behavior.
4. Create final Renewal Desk icon/splash/store screenshots and publish a real
   privacy policy, support contact, data-deletion process, and Data Safety
   declaration.
5. Configure EAS/Play App Signing under the authorized release account. Build
   a production `.aab`, install a test artifact, and complete real-device QA.
6. Run an internal test, then an appropriate closed test with real testers.
   Pilot with at least three real gyms, collect feedback, regress, and only
   then consider a production submission.

