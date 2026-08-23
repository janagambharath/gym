# Security review — Android foundation

## Implemented controls

- The project has its own Git repository outside the Bridge/backend worktree.
- No backend, web, database, Railway, WhatsApp, payment, or biometric files were changed.
- API base URL is public runtime configuration, never a secret hardcoded in source.
- Non-local API URLs require HTTPS.
- A future access token is scoped to Expo SecureStore, not AsyncStorage or plain files.
- Service-health requests time out and surface a generic human-readable error rather than raw exception details.
- The Android manifest requests only Internet access.
- No Bridge API key, terminal serial, Meta credential, payment secret, or test account is included.
- There is no direct biometric hardware access and no WebView/browser-session workaround.

## Required before mobile workflows can ship

- A backend-authorized mobile authentication/session contract.
- JSON API routes with server-enforced RBAC and gym scoping.
- Idempotency for payment, renewal, reminder, and access mutations.
- Field-level validation errors and pagination metadata.
- A reviewed production privacy policy and Google Play Data Safety declaration.
- Approved Renewal Desk launcher/splash artwork; the template Expo assets are not final store assets.
- Android SDK/EAS release build plus signed AAB validation.

## Evidence from the 2026-08-23 launch gate

- `npm.cmd run verify` passed (TypeScript, lint, and 10 unit tests).
- `npx.cmd expo-doctor` passed all 21 checks.
- Production config resolution confirmed package `online.revorax.renewaldesk`, version `1.0.0`, versionCode `1`, `allowBackup: false`, and an Internet-only permission policy.
- The regenerated native manifest retains Internet access and explicitly removes storage, overlay, and vibration permissions added by dependencies. Android backup is disabled and Expo SecureStore backup exclusions are generated.
- A focused source scan found no committed credentials, Bridge credentials, Meta/WhatsApp credentials, payment credentials, or production member data. The only credential-related text is defensive validation, test fixtures, and documentation.
- This is not a full mobile-security sign-off: the deployed token-authenticated Mobile API, authentication flow, tenant isolation, and real-device release build are still unavailable. See `BLOCKERS.md`.
