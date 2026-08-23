# Release status

Updated: 2026-08-23 (execution pass)

## App identity

| Field | Value |
| --- | --- |
| App name | Renewal Desk |
| Android package ID | `online.revorax.renewaldesk` |
| Version name | `1.0.0` |
| Version code | `1` |
| Target SDK | Determined by Expo SDK 57 at native build time |

## Current status

This is an **Android client with screens built but no backend API to connect to**. It includes login, dashboard, and members screens with a full auth-aware API client, but the Flask backend has no mobile API implementation (no JWT auth, no JSON endpoints, no `/api/mobile/v1` routes).

### What is implemented and verified
- Login screen with email/password
- API client with Bearer auth, automatic token refresh, and retry
- Dashboard screen with stats and pull-to-refresh
- Members screen with search, filters, and pagination
- React Navigation with auth-conditional flow
- SecureStore session management (access + refresh tokens)
- Health check connectivity
- TypeScript strict mode, Expo lint, 10 unit tests passing
- Expo Doctor 21/21 passing
- JS bundle exports successfully (834 modules, 1.9MB)

### What is blocked
- All screens show errors or empty states because the backend mobile API does not exist
- No signed AAB/APK (JDK 17+ required)
- No EAS account authenticated

## Release blockers (ordered by priority)

1. **Backend mobile API** — JWT auth + JSON endpoints for all features. This is the #1 blocker.
2. **JDK 17+ / Android SDK** — required for native builds.
3. **EAS account or local signing setup** — required for signed distribution.
4. **Privacy policy** — required for Play Store.
5. **Data Safety declaration** — required for Play Store.
6. **Final branding assets** — app icon and splash are Expo templates.
7. **12+ testers for 14 days** — if personal Play developer account.
8. **Real gym pilot** — at least 3 gyms.
