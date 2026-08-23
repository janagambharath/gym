# Renewal Desk mobile API capability map

Audit date: 2026-08-23 (execution pass — verified against actual backend source)

## Critical finding

**The backend has no mobile API.** Previous documentation referenced a mobile contract under `/api/mobile/v1` — this does not exist in the source code. The `app/__init__.py` `_register_blueprints()` function registers only:

- `auth_bp` — browser session login/register/logout with Flask-Login + CSRF
- `gym_bp` — HTML dashboard
- `staff_bp` — HTML staff management
- `members_bp` — HTML member management
- `import_bp` — CSV import
- `payments_bp` — HTML payment management
- `reminders_bp` — HTML reminder management
- `webhooks_bp` — WhatsApp webhooks
- `admin_bp` — HTML admin dashboard
- `bridge_bp` — Biometric PC agent API (device-bound, CSRF-exempt)

There is no mobile blueprint, no JWT/token auth, and no JSON API designed for native mobile clients.

## Current deployed production interfaces

| Capability | Interface | Authentication | Mobile-client suitability |
| --- | --- | --- | --- |
| Service health | `GET /health` | None | Safe read-only; implemented in Android. |
| Web sign-in | `POST /auth/login` | Flask-Login session + CSRF form | Not suitable for native mobile. |
| Dashboard | `GET /app/dashboard` | Browser session | HTML, not JSON. |
| Members | `/members/*` | Browser session + CSRF | HTML/forms, not JSON. |
| Payments | `/payments/*` | Browser session + CSRF | HTML/forms, not JSON. |
| Reminders/WhatsApp | `/reminders/*` | Browser session + CSRF | HTML/forms, not JSON. |
| Settings/staff/plans | `/app/*` | Browser session + CSRF | HTML/forms, not JSON. |
| Biometric PC agent | `/api/bridge/v1/*` | Device-bound API key | **Forbidden for Android.** |

## What the Android app needs (does not exist yet)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/mobile/v1/auth/login` | JWT login returning access + refresh tokens |
| `POST /api/mobile/v1/auth/refresh` | Token refresh |
| `POST /api/mobile/v1/auth/logout` | Server-side token invalidation |
| `GET /api/mobile/v1/auth/me` | Current user + gym info |
| `GET /api/mobile/v1/dashboard` | Tenant-scoped dashboard stats |
| `GET /api/mobile/v1/members` | Paginated member list with search/filter |
| `GET /api/mobile/v1/members/:id` | Member detail |
| `POST /api/mobile/v1/members` | Create member |
| `PUT /api/mobile/v1/members/:id` | Update member |
| `POST /api/mobile/v1/members/:id/renew` | Renew membership |
| `GET /api/mobile/v1/payments` | Payment list |
| `POST /api/mobile/v1/payments` | Record payment |
| `POST /api/mobile/v1/reminders/send` | Send WhatsApp reminder |
| `GET /api/mobile/v1/settings` | Gym settings |

All endpoints must enforce tenant scoping (gym_id from JWT) and RBAC (owner vs staff).

## Hard stop: no invented or bypassed endpoint

The Android app must use only documented, versioned, deployed endpoints. It must not:
- Scrape browser HTML or use Flask session cookies
- Call the Bridge API or use Bridge credentials
- Carry Meta/WhatsApp secrets, payment secrets, or Bridge API keys
- Invent endpoint paths, payloads, or response shapes
