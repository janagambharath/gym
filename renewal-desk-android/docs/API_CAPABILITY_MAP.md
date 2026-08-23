# Renewal Desk mobile API capability map

Audit date: 2026-08-23

This Android project is intentionally independent from the existing web, backend,
and biometric Bridge repositories. This document distinguishes the reviewed
backend source contract from the public production deployment observed on
2026-08-23.

## Current deployed production interfaces

| Capability | Existing interface | Authentication | Mobile-client suitability |
| --- | --- | --- | --- |
| Service health | `GET /health` | None | Safe read-only health check; implemented in this foundation. |
| Mobile v1 health | `/api/mobile/v1/health` | N/A | **Not deployed:** returned `404` in the public production check. |
| Web sign-in | `POST /auth/login` | Flask browser session + CSRF form | Not suitable for a first-class native client. |
| Dashboard | `GET /app/dashboard` | Browser session | HTML, not a mobile JSON contract. |
| Members | `/members/*` | Browser session + CSRF forms | HTML/forms, not a mobile JSON contract. |
| Payments | `/payments/*` | Browser session + CSRF forms | HTML/forms, not a mobile JSON contract. |
| Reminders/WhatsApp | `/reminders/*`, dashboard announcement form | Browser session + CSRF forms | HTML/forms, not a mobile JSON contract. |
| Settings/staff/plans | `/app/*` | Browser session + CSRF forms | HTML/forms, not a mobile JSON contract. |
| Biometric PC-agent | `/api/bridge/v1/*` | Device-bound API key, terminal serial, protocol header | Forbidden for Android. It is only for the gym PC Bridge. |

## Backend source mobile contract (not currently deployed publicly)

| Mobile feature | Source contract / existing web behavior | Android status |
| --- | --- | --- |
| Authentication | Source `POST /auth/login`, refresh, logout, and `me` token contract | Not implemented in Android; public deployment unavailable. |
| Dashboard | Source tenant-scoped JSON dashboard | Not implemented in Android; public deployment unavailable. |
| Members | Source JSON list/detail/create/update/renew contract | Not implemented in Android; public deployment unavailable. |
| Payments | Source JSON list/detail/create/verify/reject contract | Not implemented; documented durable-idempotency gate remains open. |
| Reminders | Source authorized JSON actions and statuses | Not implemented in Android; public deployment unavailable. |
| WhatsApp campaigns | Source owner-only campaign/test/delivery-status contract | Not implemented; consent and durable-write gate remain enforced server-side. |
| Settings/staff/plans | Source owner-authorized JSON reads/mutations | Not implemented in Android; public deployment unavailable. |
| Biometric visibility | Source read-only status and command history | Not implemented; Android must never expose Bridge keys or direct hardware control. |

## Hard stop: no invented or bypassed endpoint

The app must use the documented, versioned source contract only after it is
safely deployed. It must not guess alternate paths, payloads, tokens, or
response shapes, and it must not bypass the production deployment gate by using
browser sessions or the Bridge API. The backend durable-idempotency change and
staging/production enablement remain separate authorized work.

The Android app must never use a gym's `X-Api-Key`, device serial, or Bridge protocol credentials.
