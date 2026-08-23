# Renewal Desk Android

Native Android foundation for Renewal Desk, built as an isolated Expo + TypeScript project.

## Important current status

The protected Renewal Desk backend source includes a versioned `/api/mobile/v1`
contract, but the currently deployed production service does **not** expose that
namespace. The backend's own mobile API documentation also keeps financial,
renewal, and broadcast writes behind a durable-idempotency release gate.

For that reason, this project deliberately does not:

- scrape browser forms or persist browser cookies;
- load the website in a WebView and call it a native app;
- use the biometric Bridge API/key/device serial;
- substitute an unavailable production API with invented endpoints, payloads,
  token formats, or business rules;
- show mock members, payments, or fake successes.

The app currently provides a secure, tested native foundation and an actual
`/health` connectivity check. Core workflows remain blocked until the existing
mobile contract is made safely available in a separate staging/prod deployment
after its documented durable-write release gate is closed. See
[docs/BLOCKERS.md](docs/BLOCKERS.md),
[docs/API_CAPABILITY_MAP.md](docs/API_CAPABILITY_MAP.md), and
[docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).

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

The backend source has a documented owner/staff mobile contract with tenant and
RBAC controls, but it must be enabled only through its approved deployment path.
The documented database-backed idempotency ledger/outbox prerequisite must be
implemented and reviewed before public financial, renewal, or broadcast writes
are enabled. This work is outside this repository and requires separate
authorization.

## Future build profiles

`eas.json` defines non-secret `development`, `staging`, and `production` build
profiles. The production profile explicitly builds an Android App Bundle and
sets the production environment label, but it intentionally does not embed an
unverified production mobile API URL. An Expo account/project plus an approved
backend deployment are still required before running an EAS build. Do not
commit signing keys or use an unreviewed production API URL.

## Release status

No production AAB is produced yet. A signed AAB, final icon/splash assets, a public privacy-policy URL, and Google Play Data Safety answers cannot be truthfully prepared until the mobile API and final production behavior exist.
