# Security review — Android (execution pass)

Updated: 2026-08-23

## Implemented controls

- API base URL is public runtime configuration, never hardcoded in source.
- Non-local API URLs require HTTPS; embedded credentials and loopback URLs rejected outside development.
- Access and refresh tokens stored only in Expo SecureStore with `AFTER_FIRST_UNLOCK` accessibility.
- Session cleared on logout, 401 refresh failure, and manual sign-out.
- API client sends Bearer tokens via `Authorization` header — no cookies, no CSRF.
- Automatic 401→refresh→retry with deduplication (only one refresh in flight).
- Service-health requests use a 10-second abort timeout with generic user-facing errors.
- Android manifest requests only `android.permission.INTERNET`.
- `allowBackup: false` set in app.json.
- `expo-secure-store` configured with `configureAndroidBackup: true` for proper backup exclusion.
- No Bridge API key, terminal serial, Meta credential, payment secret, or test account included.
- No WebView/browser-session workaround or direct biometric hardware access.
- No `console.log` calls in production source code.
- No hardcoded member names, phone numbers, UPI IDs, gym names, or business data.

## Security scan results (2026-08-23)

Grep scan across entire `renewal-desk-android/src/` for: `password`, `secret`, `token`, `api_key`, `client_secret`, `PRIVATE_KEY`, `META_`, `WABA`, `BRIDGE`, `localhost`, `127.0.0.1`, `console.log`, `debug`, `mock`, `fake`, `placeholder`.

**All results are defensive code:**
- `password` — appears in `runtime.ts` URL credential rejection logic and test fixtures
- `localhost`/`127.0.0.1` — appears in `runtime.ts` loopback validation and test fixtures
- `Bridge` — appears in `ServiceReadinessScreen.tsx` documentation string only

**No actual secrets, credentials, debug output, or mock data found.**

## Remaining blockers

- Full session lifecycle cannot be tested until backend JWT endpoints exist.
- No privacy policy URL in app configuration or release materials.
- No Data Safety declaration.
- `npm audit --omit=dev`: 10 moderate transitive advisories in Expo `uuid`/`xcode` chain. No safe auto-fix available.

## Permission review

| Permission | Status |
| --- | --- |
| `android.permission.INTERNET` | ✅ Required — API communication |
| `android.permission.READ_EXTERNAL_STORAGE` | ❌ Blocked in app.json |
| `android.permission.SYSTEM_ALERT_WINDOW` | ❌ Blocked in app.json |
| `android.permission.VIBRATE` | ❌ Blocked in app.json |
| `android.permission.WRITE_EXTERNAL_STORAGE` | ❌ Blocked in app.json |
| Contacts, SMS, Location, Camera, Microphone | Not requested |
