# Mobile API v1 — Endpoint Reference

Base URL: `/api/mobile/v1`

## Authentication

All endpoints (except `/health`, `/auth/login`, `/auth/refresh`) require:

```
Authorization: Bearer <access_token>
```

### POST /auth/login

Login with email and password. Returns access + refresh tokens.

**Request:**
```json
{"email": "owner@example.com", "password": "..."}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "refresh_token": "...",
    "user": {"id": 1, "email": "...", "full_name": "...", "role": "gym_owner"},
    "gym": {"id": 1, "name": "...", "slug": "...", "timezone": "Asia/Kolkata", "whatsapp_enabled": false}
  }
}
```

### POST /auth/refresh

Rotate refresh token. Old token is invalidated.

**Request:**
```json
{"refresh_token": "..."}
```

**Response (200):**
```json
{"success": true, "data": {"access_token": "...", "refresh_token": "..."}}
```

### POST /auth/logout

Revoke current refresh token.

**Request:**
```json
{"refresh_token": "..."}
```

### POST /auth/logout-all

Revoke all refresh tokens for the authenticated user.

### GET /me

Returns current user and gym information.

---

## Dashboard

### GET /dashboard

Returns gym statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total_active": 25,
    "expiring_soon": 3,
    "expired": 5,
    "pending_payments": 2,
    "sent_reminders": 10,
    "failed_reminders": 1,
    "total_collected": "45000.00"
  }
}
```

---

## Members

### GET /members

Paginated member list with search and filters.

**Query params:** `?page=1&page_size=20&status=active&q=search`

### GET /members/:id

Member detail with plan info.

### POST /members

Create a new member.

**Request:**
```json
{
  "full_name": "John Doe",
  "phone": "+919876543210",
  "email": "john@example.com",
  "gender": "male",
  "plan_id": 1,
  "membership_start": "2026-08-23",
  "membership_end": "2026-09-23",
  "notes": "New member"
}
```

### PATCH /members/:id

Update member fields (partial update).

### POST /members/:id/deactivate

Soft-delete a member. **Owner only.**

---

## Renewals

### GET /renewals

Paginated renewal history. Optional: `?member_id=1`

### GET /renewals/upcoming

Members expiring within 7 days.

### GET /renewals/expired

Currently expired members.

### POST /renewals/:member_id

Legacy immediate renewal for an authorized owner/staff workflow. Prefer the
pending-payment and verification workflow below for ordinary mobile renewals.
Supports an optional `Idempotency-Key` request header; a matching retry returns
the original response and a key reused with another payload returns 409.

**Request:**
```json
{
  "renewal_days": 30,
  "amount": "1200.00",
  "notes": "August renewal"
}
```

---

## Payments

### GET /payments

Paginated list. Optional: `?status=pending`

### GET /payments/:id

Payment detail.

### POST /payments

Create a pending payment. Supports an optional `Idempotency-Key` request
header; a matching retry returns the original response and a key reused with
another payload returns 409.

**Request:**
```json
{
  "member_id": 1,
  "amount": "1500.00",
  "renewal_days": 30,
  "method": "upi",
  "reference": "TXN123",
  "paid_on": "2026-08-23",
  "notes": "Monthly payment"
}
```

### POST /payments/:id/verify

Verify payment and extend membership.

### POST /payments/:id/reject

Reject a pending payment.

---

## WhatsApp

### POST /whatsapp/send-reminder

Send a renewal reminder to a member.

**Request:**
```json
{"member_id": 1}
```

---

## Settings

### GET /settings

Returns gym settings and active plans.

### PATCH /settings

Update gym settings. **Owner only.**

**Request:**
```json
{"name": "My Gym", "phone": "+91...", "timezone": "Asia/Kolkata"}
```

---

## Staff and reports

### GET /staff

Returns staff for the authenticated gym. **Owner only.**

### GET /reports/summary

Returns tenant-scoped member and revenue summaries. Query parameter:
`?period=today`, `7d`, or `30d`. Calendar boundaries use the gym's configured
timezone.

---

## WhatsApp Bot

All Bot endpoints require an active server-side `whatsapp_bot` entitlement for
the authenticated gym. Otherwise they return 403 `FEATURE_NOT_ENABLED`.

### GET /bot/stats

Returns counts for conversations, leads, trials, handovers, and conversions.

### GET /bot/conversations

Returns tenant-scoped conversations. `?handover=human_requested` may filter
for conversations needing staff attention.

### GET /bot/conversations/:id

Returns a tenant-scoped conversation, its newest 100 messages in chronological
order, and a safe linked-lead summary. It never returns another gym's thread.

### POST /bot/conversations/:id/handover

Takes ownership of, or returns, a conversation to the bot.

```json
{"action": "take_over"}
```

Allowed actions are `take_over` and `resume_bot`.

### POST /bot/conversations/:id/message

Sends a manual WhatsApp message. The message appears in conversation history
only after the provider accepts it. Failed delivery submission returns
`WHATSAPP_SEND_FAILED`.

```json
{"body": "A staff member will call you shortly."}
```

### GET /bot/leads and GET /bot/leads/:id

Returns tenant-scoped lead records. `PATCH /bot/leads/:id` updates supported
lead status and staff notes.

### GET /bot/config and PATCH /bot/config

Returns and updates bot setup. GET does not create a configuration row. PATCH
is **owner only** and validates strict booleans, bounded text, HTTPS links,
trial price, and trial duration.

### POST /bot/test

Runs the bot response simulator without sending a WhatsApp message.

---

## Error Format

All errors follow:

```json
{
  "success": false,
  "error": {"code": "ERROR_CODE", "message": "Human-readable message."}
}
```

### Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| UNAUTHORIZED | 401 | Missing or invalid auth |
| TOKEN_EXPIRED | 401 | Access/refresh token expired |
| FORBIDDEN | 403 | Insufficient permissions |
| ACCOUNT_LOCKED | 403 | Too many failed login attempts |
| ACCOUNT_DISABLED | 403 | Account deactivated |
| GYM_INACTIVE | 403 | Gym suspended |
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 400 | Invalid input |
| CONFLICT | 409 | Duplicate or state conflict |
| RATE_LIMITED | 429 | Too many requests |
| MEMBER_LIMIT | 409 | Gym at member limit |
| IDEMPOTENCY_KEY_REUSED | 409 | Retry key was used for a different request |
| FEATURE_NOT_ENABLED | 403 | Server-side feature entitlement is missing or inactive |
| WHATSAPP_NOT_CONFIGURED | 400 | WhatsApp not set up |
| WHATSAPP_SEND_FAILED | 502 | WhatsApp provider did not accept a manual bot message |

## Pagination

All list endpoints return:

```json
{
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

Default page_size: 20, max: 100.
