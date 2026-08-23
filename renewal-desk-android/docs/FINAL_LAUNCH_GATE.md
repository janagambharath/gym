# Renewal Desk Android final launch gate

Date: 2026-08-23
Repository: `renewal-desk-android`
Scope: Android repository only. Backend, web frontend, database, Railway, Redis, WhatsApp/Meta, payment systems, and the biometric Bridge were not changed.

## Verdict

**NOT READY**

## Evidence gathered

| Area | Result | Evidence |
| --- | --- | --- |
| Automated validation | Pass | `npm.cmd run verify` completed TypeScript, Expo lint, and 10/10 unit tests. |
| Expo project health | Pass | `npx.cmd expo-doctor` completed 21/21 checks. |
| Android configuration | Pass | Production Expo config resolves package `online.revorax.renewaldesk`, version `1.0.0`, versionCode `1`, `allowBackup: false`, and an Internet-only permission policy. |
| Native configuration generation | Pass | `npx.cmd expo prebuild --platform android --no-install --clean` succeeded. Generated manifest keeps Internet and removes storage, overlay, and vibration permissions. |
| Production deployment health | Pass, limited | `https://gym-production-910c.up.railway.app/health` returned healthy database/schema status. |
| Production Mobile API | Blocked | `https://gym-production-910c.up.railway.app/api/mobile/v1/health` returned HTTP 404. No Android-to-Mobile-API path can be verified. |
| Release AAB/APK | Blocked | `gradlew.bat app:bundleRelease` stopped before compilation because this host uses JVM 8 while Gradle 9.3.1 requires JVM 17+. No artifact was generated. |
| Product workflows | Blocked | The app contains a readiness screen, not owner/staff mobile workflows. Login, renewal, payments, WhatsApp, RBAC, and tenant isolation are unverified. |
| Secret/permission review | Pass, limited | Focused scan found no committed credentials or production data. Permission policy was minimized and native manifest checked. |
| Store/field acceptance | Unverified | No privacy-policy URL, Data Safety completion, reviewer account, closed-test group, real-device run, or three-gym pilot exists. |

## Exact current configuration

| Field | Value |
| --- | --- |
| Application ID | `online.revorax.renewaldesk` |
| Version | `1.0.0` |
| Version code | `1` |
| Active Android permission | `android.permission.INTERNET` |
| Production API environment used for testing | No Mobile API base URL was configured; the app intentionally refuses to invent one. The public production health endpoint was checked separately. |
| Production APK path | None — not generated. |
| Production AAB path | None — not generated. |

## Required external work

1. Deploy and enable the token-authenticated `/api/mobile/v1` API, then implement actual Android owner/staff workflows against it.
2. Supply safe two-gym test accounts and execute authentication, tenant isolation, idempotency, offline, payment, renewal, and WhatsApp tests.
3. Use a controlled release workstation with JDK 17+, Android SDK/adb, and authorized signing/EAS credentials to build a signed AAB and APK.
4. Complete the factual privacy policy, Data Safety, store listing, reviewer access, closed-test setup, and real-gym pilot.

The severity-ranked details, evidence, and retest results are in [BLOCKERS.md](BLOCKERS.md). No workaround, browser-cookie authentication, WebView scraping, direct Bridge access, or fake production data was introduced to bypass these gates.

## Git handoff

The standalone Android project has a clean local initial commit. The authorized `gym` remote was inspected and its `main` branch contains the existing Python backend, so the Android project must be published under `renewal-desk-android/` on a separate mergeable branch rather than overwriting the repository root.

## Next human action

Assign the backend/API owner to deploy the documented Mobile API and provide designated non-production owner/staff test accounts for two gyms. In parallel, provide a controlled Android release environment with JDK 17+, Android SDK, and signing/EAS authority so the first real signed test artifact can be built and installed.
