# Renewal Desk Android

Native Android foundation for Renewal Desk, built as an isolated Expo + TypeScript project.

## Current capability and safety boundary

The Android app is a native, authenticated client of the versioned
`/api/mobile/v1` backend. It supports real member operations, pending payment
recording and verification, renewals, WhatsApp reminders, reports, and the
entitlement-gated WhatsApp Bot operations workspace.

It deliberately does not:

- scrape browser forms or reuse browser cookies;
- load the web product in a WebView;
- access biometric Bridge credentials or terminal hardware;
- expose provider/API credentials to the app;
- invent member, payment, WhatsApp, or bot data.

Production availability remains a deployment responsibility. Test preview and
staging builds against a separately configured backend first; do not point
those builds at production by default.

## Stack decision

- Expo SDK 57
- React Native 0.86
- React 19
- TypeScript (strict)
- Expo SecureStore for the future backend-issued session boundary

Expo was selected because Renewal Desk needs normal authenticated business workflows, not direct biometric hardware access. The PC Bridge remains separate.

## Prerequisites

- Node.js 22 or later
- npm
- Android Studio + a current Android SDK for local emulator/AAB validation, or authorized EAS Build credentials for cloud builds

## Configure a non-secret environment

Copy `.env.example` to `.env.local` and set a public service base URL:

```powershell
Copy-Item .env.example .env.local
```

Do not place passwords, tokens, payment secrets, WhatsApp/Meta secrets, database credentials, or biometric Bridge credentials in any Expo environment file.

## Run validation

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```

## Launch during development

```powershell
npm.cmd start
```

An Android emulator/device launch requires an Android SDK; `npm.cmd run android` will not work until that is installed/configured.

## Required backend deployment work

The backend includes owner/staff mobile API contracts, tenant/RBAC controls,
database-backed idempotency records for payment and direct-renewal retries, and
Alembic migrations for the bot, entitlements, and idempotency ledger. Those
migrations must still follow the approved deployment sequence: backup, staging
upgrade, smoke test, review, then production upgrade. The app does not run
migrations automatically.

## EAS build profiles

`eas.json` maps `development`, `preview`, and `production` build profiles to
their corresponding EAS environments. It intentionally does **not** hard-code
an API URL. Configure the public `EXPO_PUBLIC_API_BASE_URL` separately in EAS
for each environment, using an isolated staging service for the `preview`
environment and the reviewed service URL only for `production`.

The production profile builds an Android App Bundle. An Expo account/project,
approved backend deployment, and signing approval are still required before
running an EAS build. Never commit signing keys or app credentials.

## Release status

No production AAB is produced by this repository. A signed AAB, physical-device
test, gym pilot, privacy policy, and Play Console data-safety review remain
external release gates.
