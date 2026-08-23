# Test report

Date: 2026-08-23

## Automated validation

| Check | Command | Result |
| --- | --- | --- |
| Strict TypeScript | `npm.cmd run typecheck` | Passed |
| Expo lint | `npm.cmd run lint` | Passed |
| Unit tests | `npm.cmd test` | Passed: 10/10 |
| Combined validation | `npm.cmd run verify` | Passed |
| Expo Doctor | `npx.cmd expo-doctor` | Passed: 21/21 checks |
| Resolved production Expo config | `EXPO_PUBLIC_APP_ENV=production npx.cmd expo config --type public --json` | Passed: package `online.revorax.renewaldesk`, version `1.0.0`, versionCode `1`, `allowBackup: false`, Internet-only permission policy |
| Generated Android manifest | `npx.cmd expo prebuild --platform android --no-install --clean` | Passed: only `android.permission.INTERNET` remains active; storage, overlay, and vibration permissions are explicit removals |
| Android JavaScript bundle | `npx.cmd expo export --platform android` | Passed: 586 modules; generated a 1.4 MB Hermes bundle |
| Live health client | `fetchPlatformHealth(...)` against production `/health` | Passed: `db`, `schema`, and `status` were `ok` |
| Production mobile API route | `GET /api/mobile/v1/health` | Failed closed: public deployment returned `404` |

The unit tests cover safe runtime environment resolution and defensive parsing of the actual `/health` JSON shape. They do not touch customer records or run production mutations.

## Not yet possible in this environment

- Android emulator/device launch: Android SDK and `adb` are not installed/configured.
- Signed Android App Bundle (`.aab`) and installable APK: the EAS local build attempt stopped before build because no Expo account is authenticated; no signing setup or Android SDK is available.
- Native functional testing: Android workflows are not implemented and the documented mobile API is not deployed publicly.
- Real gym testing: must wait for a usable, enabled token-authenticated mobile API, complete Android workflows, and designated test accounts.

## Dependency security audit

`npm.cmd audit --omit=dev` reported 10 moderate transitive advisories in the current Expo toolchain path (through `uuid`/`xcode`). The only offered automated remediation would force a breaking downgrade to Expo SDK 46. It was **not** applied. Before release, review an Expo-supported dependency update/advisory fix rather than using `npm audit fix --force`.

## Release-artifact attempt

`gradlew.bat app:bundleRelease` was genuinely attempted on 2026-08-23. Gradle 9.3.1 stopped before compilation because this host provides JVM 8 and requires JVM 17 or later. No signed APK or AAB was produced. An earlier EAS local-build attempt was also unable to start because no Expo account is authenticated.
