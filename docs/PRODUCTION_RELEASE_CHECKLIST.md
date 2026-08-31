# Renewal Desk — Production Release Checklist

## Current gate status

- [x] Android package: `online.revorax.renewaldesk`
- [x] Version/versionCode: `1.0.0` / `6`
- [x] Production EAS profile is configured to request an Android App Bundle.
- [x] Native Play Billing dependency and Expo config plugin are configured.
- [x] `npm run verify`: 17 passed, TypeScript and lint clean.
- [x] `python -m pytest -q`: 165 passed, 0 failed (40 deprecation warnings).
- [x] `git diff --check` was clean before documentation updates.
- [ ] EAS production API: **BLOCKED**. `eas env:list --environment production` reported no variables.
- [ ] Server Google Play verification configuration: not verified.
- [ ] Google Play products/base plans/offers: not verified.
- [ ] Signed production AAB: not created.
- [ ] Physical Android release-candidate smoke test: not performed.
- [ ] Google Play Internal Test purchase/restore/cancellation: not performed.
- [ ] Play Console listing/content/data-safety/reviewer instructions: not verified.
- [ ] Account-specific Play testing requirement: not inspected.
- [ ] Meta/WhatsApp production approval and provider test: not performed.
- [ ] AI provider production validation: not performed.

## Required environment action

Set the following EAS **production** variable with the real deployed public endpoint:

```text
EXPO_PUBLIC_API_BASE_URL=https://<actual-production-api-host>
```

It must be HTTPS and must not be a localhost, staging endpoint, credential-bearing URL, or server secret. Do not add Google service-account JSON, Meta credentials, AI keys, token-encryption keys, or other private server configuration to EAS public variables.

## Only after the production API is configured

1. Run `npm run verify`, `npx expo-doctor`, `npm audit --omit=dev`, `python -m pytest -q`, and `git diff --check`.
2. Run `eas build --platform android --profile production`.
3. Verify the actual artifact signature, package, version, versionCode, production runtime value, build ID, and artifact URL.
4. Install through Google Play Internal Testing and record physical-device, billing, notification, deep-link, CSV, WhatsApp, and AI evidence.
5. Complete Google Play Console declarations and track requirements truthfully before any production submission.
