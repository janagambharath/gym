# Android launch blockers

This ledger records blockers that could not be safely solved in the Android repository on 2026-08-23. No backend, database, Railway, WhatsApp, payment, or biometric Bridge system was changed.

| ID | Severity | Component and evidence | Exact issue | Safe fix applied here | Required external next action | Retest result |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | Critical | `App.tsx`, `src/screens/ServiceReadinessScreen.tsx` | The shipped app is a service-readiness screen. It has no login, session refresh/logout, navigation, dashboard, members, renewals, payments, WhatsApp, settings, reports, staff/RBAC, or owner workflows. | Kept the honest readiness UI. No browser scraping, cookie workaround, direct Bridge access, or fake data was added. | Deliver an authorized Mobile API contract, then implement and test the actual Android owner/staff workflows. | Blocked: no feature workflow exists to test. |
| B-02 | Critical | Public deployment `/api/mobile/v1/health` | `https://gym-production-910c.up.railway.app/api/mobile/v1/health` returns HTTP 404. The source documentation describes a Mobile API, but it is not publicly deployed/enabled. | Runtime configuration refuses to invent a production API URL, requires HTTPS, and rejects loopback URLs outside development. | Deploy and enable a documented HTTPS `/api/mobile/v1` service with a health endpoint and authentication contract. | Blocked: Android cannot connect to a production Mobile API. |
| B-03 | Critical | Authentication, API client, tenant tests | No usable mobile login/refresh/logout endpoint or designated two-gym test environment is available. Tenant isolation, RBAC, duplicate-action, payment, renewal, and WhatsApp tests cannot be performed honestly. | No unsafe fallback was added. SecureStore remains a future boundary only. | Provide owner, staff, inactive, and two-gym non-production test accounts plus token, refresh, and idempotency contracts. | Blocked: requested API workflow tests are unverified. |
| B-04 | Critical | Local Android release build | A genuine `gradlew.bat app:bundleRelease` attempt stopped before compilation: Gradle 9.3.1 requires JVM 17+, while this host has JVM 8. No `.aab` or `.apk` exists. | Expo native configuration regenerated successfully from current config. | Use a controlled release workstation with JDK 17+, Android SDK/adb, and rerun bundle/APK builds. | Blocked: no production artifact exists. |
| B-05 | Critical | EAS/release signing | No authenticated Expo/EAS account or approved Android signing configuration is available. | Keystores and credentials remain ignored; none were generated or committed. | Authorize the EAS project/account or a controlled Play App Signing/local signing process. Keep signing material outside Git. | Blocked: signed distribution cannot be verified. |
| B-06 | High | Store assets and legal configuration | There is no final public privacy-policy URL, verified Data Safety declaration, approved store screenshots, reviewer access, or final branding approval. | Added a human-owned Play Console checklist; no fake policy or reviewer account was created. | Business/legal owner must approve factual policy and Play declarations after final data flows are known. | Unverified. |
| B-07 | High | Device and gym acceptance | No release APK, Android SDK/adb device run, two-tenant test, offline test, or three-gym pilot has occurred. | Automated static validation completed. | Build signed test APK, recruit authorized real testers, and execute the acceptance plan at three gyms. | Blocked. |
| B-08 | Medium | Dependency audit | `npm.cmd audit --omit=dev` reported 10 moderate transitive advisories in the Expo toolchain. Its only automatic suggestion was a breaking downgrade to Expo SDK 46. | Did not run `npm audit fix --force` or downgrade the SDK. | Review Expo-supported upgrades/advisories before a release candidate. | Unverified pending supported remediation. |

## Fixes completed safely in this repository

- Hardened production API URL parsing: HTTPS is required outside development; embedded credentials and non-development loopback URLs are rejected.
- Added runtime tests for production URL absence, HTTPS enforcement, loopback rejection, and embedded credential rejection.
- Set the production EAS profile to label itself production and request an Android App Bundle.
- Disabled Android backup and blocked unneeded storage, overlay, and vibration permissions. The regenerated manifest retains only active Internet permission.
- Strengthened `.gitignore` to exclude builds, credentials, signing materials, logs, and local assistant configuration.

## Build evidence

- `npm.cmd run verify`: passed (TypeScript, Expo lint, 10/10 unit tests).
- `npx.cmd expo-doctor`: passed 21/21 checks.
- `npx.cmd expo prebuild --platform android --no-install --clean`: passed.
- `gradlew.bat app:bundleRelease`: failed before compilation due to JVM 8; no APK/AAB output was produced.
