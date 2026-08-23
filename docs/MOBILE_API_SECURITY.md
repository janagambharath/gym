# Mobile API v1 — Security Architecture

## Authentication

- **Access tokens**: HMAC-SHA256 signed JWT with 15-minute TTL
- **Refresh tokens**: 64-byte `secrets.token_urlsafe`, server stores SHA-256 hash
- **Token secret**: Separate `MOBILE_API_TOKEN_SECRET` (required ≥32 chars in production)
- **No cookie/session/CSRF**: Mobile API uses Bearer tokens exclusively

## Refresh Token Rotation

- Each refresh issues a new token pair and invalidates the old token
- **Replay detection**: If a used token is resubmitted, the entire token family is invalidated
- **Family tracking**: All tokens in a chain share a `family_id` for bulk revocation

## Revocation

- `POST /auth/logout` — revoke single refresh token
- `POST /auth/logout-all` — revoke all tokens for the user
- Password change / account deactivation → all tokens invalidated

## Brute-Force Protection

- Login: 5 attempts/minute per IP
- Account lockout schedule: 3→5min, 5→15min, 8→60min, 12→24h
- Lockout events reported to Sentry

## Tenant Isolation

- Gym ID derived from authenticated user, never from client input
- Every database query scoped through `gym_id`
- Cross-tenant access returns 404 (not 403) to prevent enumeration

## RBAC

- `gym_owner`: Full access including settings, member deactivation
- `staff`: Read/write access to members, payments, renewals, reminders
- `super_admin`: Blocked from mobile login
- Server-side enforcement — UI restrictions are not trusted

## Data Protection

- No SQL errors, stack traces, or file paths in error responses
- No Bridge credentials, Meta tokens, or payment secrets exposed
- WhatsApp credentials never returned to Android
- `Cache-Control: no-store` on sensitive responses

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/auth/login` | 5/min per IP |
| `/auth/refresh` | 10/min per IP |
| `/whatsapp/*` | 5/min per user |
| General | 200/min per IP |

## Feature Flag

- `MOBILE_API_ENABLED=false` (default) — routes not registered
- Production requires `MOBILE_API_TOKEN_SECRET` ≥ 32 characters
- Feature flag does not affect web routes, Bridge, or existing functionality
