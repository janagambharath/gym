# Test report

Updated: 2026-08-23 (execution pass)

## Automated validation

| Check | Command | Result |
| --- | --- | --- |
| Strict TypeScript | `npm run typecheck` | ✅ Passed |
| Expo lint | `npm run lint` | ✅ Passed (0 errors, 0 warnings) |
| Unit tests | `npm test` | ✅ Passed: 10/10 |
| Combined validation | `npm run verify` | ✅ Passed |
| Expo Doctor | `npx expo-doctor` | ✅ Passed: 21/21 checks |
| Android JavaScript bundle | `npx expo export --platform android` | ✅ Passed: 834 modules, 1.9 MB Hermes bundle |
| Live health client | `fetchPlatformHealth(...)` against production `/health` | ✅ Passed (previous review confirmed `db`, `schema`, `status` = `ok`) |
| Production mobile API route | `GET /api/mobile/v1/health` | ❌ 404 — endpoint does not exist in backend source |

## Security scan

| Pattern | Files with matches | Assessment |
| --- | --- | --- |
| `password` | `runtime.ts`, `runtime.test.ts` | Defensive URL credential rejection — safe |
| `secret` | None | Clean |
| `token` | None in source (only type definitions) | Clean |
| `localhost` / `127.0.0.1` | `runtime.ts`, `runtime.test.ts` | Loopback validation logic — safe |
| `console.log` | None | Clean |
| `mock` / `fake` / `placeholder` | None | Clean |
| `api_key` / `META_` / `WABA` / `BRIDGE` | `ServiceReadinessScreen.tsx` (doc string only) | Clean |

## Dependency audit

`npm audit --omit=dev`: 10 moderate transitive advisories via `uuid` < 11.1.1 → `xcode` → `@expo/config-plugins` → Expo SDK chain. The only offered fix is `npm audit fix --force` which downgrades to Expo SDK 46 (breaking). **Not applied.**

## Not yet possible

- **Android emulator/device launch**: No Android SDK or `adb` on this host.
- **Signed AAB/APK**: JDK 8 installed; Gradle requires JDK 17+. No EAS account authenticated.
- **Native functional testing**: Backend mobile API does not exist.
- **Real gym testing**: Requires deployed mobile API, test accounts, and signed artifact.
- **Authentication flow testing**: Backend JWT endpoints do not exist.
- **Tenant isolation testing**: Requires two gym accounts with mobile API access.
- **Offline/network failure testing**: Requires installable build on real device.
