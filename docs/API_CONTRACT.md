# Renewal Desk — Unified API Contract & Data Specification
**Version:** 2.1 (Web, Mobile & Biometric Bridge Unified Specification)  
**Date:** August 26, 2026  

---

## 1. Authentication & Security Headers

### Mobile & Web REST API (`/api/mobile/v1/`)
- **Header:** `Authorization: Bearer <access_token>`
- **Token Type:** HMAC-SHA256 JWT (15-min TTL) with `sub` (user_id), `gym_id`, `role`.
- **Refresh Flow:** `POST /api/mobile/v1/auth/refresh` with `{ "refresh_token": "<64_byte_opaque_token>" }`.
- **Replay Protection:** Replayed refresh tokens automatically revoke the entire token family.

### Biometric Bridge API (`/api/bridge/v1/`)
- **Header:** `X-Api-Key: <rdb_live_...>` (SHA-256 hash verified against `bridge_installations.api_key_hash`)
- **Header:** `X-RenewalDesk-Bridge-Protocol: 2`
- **Header:** `X-Device-Serial: <device_serial>`
- **Body Requirement:** Every bridge request contains `gymId` matching `bridge_installations.public_id`.

---

## 2. Biometric Bridge Endpoints (`/api/bridge/v1`)

### 1. `POST /api/bridge/v1/heartbeat`
- **Auth:** Bridge API Key + Protocol 2 + Device Serial
- **Payload:** `{ "gymId": "bridge_...", "status": "online", "timestamp": "ISO-8601" }`
- **Response:** `200 OK` `{ "ok": true, "serverTime": "ISO-8601" }`

### 2. `POST /api/bridge/v1/attendance`
- **Auth:** Bridge API Key + Protocol 2 + Device Serial
- **Payload:** `{ "gymId": "bridge_...", "deviceEnrollNumber": "123", "eventTime": "ISO-8601", "verifyMethod": 1, "isInvalid": false, "eventId": "uuid" }`
- **Response:** `201 Created` `{ "ok": true, "knownMember": true }` (or `200 OK` `{ "ok": true, "duplicate": true }`)

### 3. `GET /api/bridge/v1/commands/pending?gymId=bridge_...`
- **Auth:** Bridge API Key + Protocol 2 + Device Serial
- **Response:** `200 OK` `[ { "id": "cmd_id", "commandType": "enable_user|disable_user", "enrollNumber": "123", "memberName": "Kiran", "delaySeconds": 0, "leaseToken": "token" } ]`

### 4. `POST /api/bridge/v1/commands/<id>/ack`
- **Auth:** Bridge API Key + Protocol 2 + Device Serial
- **Payload:** `{ "status": "acked|failed", "leaseToken": "token", "errorMessage": "optional" }`
- **Response:** `200 OK` `{ "ok": true }`

### 5. `POST /api/bridge/v1/enrollment/confirm`
- **Auth:** Bridge API Key + Protocol 2 + Device Serial
- **Payload:** `{ "gymId": "bridge_...", "memberId": 45, "deviceEnrollNumber": "123", "terminalUserName": "Kiran" }`
- **Response:** `200 OK` `{ "ok": true }`

---

## 3. Web & Mobile API Endpoints (`/api/mobile/v1`)

| Method | Route | Description | Roles |
| :--- | :--- | :--- | :--- |
| `GET` | `/dashboard` | Urgent metrics, active/expired counts, health pills | Owner, Staff |
| `GET` | `/members` | Member directory with status, plan, & expiry filters | Owner, Staff |
| `GET` | `/members/<id>` | Full member profile, access state, payment history | Owner, Staff |
| `POST`| `/members` | Create new gym member | Owner, Staff |
| `PUT` | `/members/<id>` | Update member details | Owner, Staff |
| `DELETE`| `/members/<id>`| Soft-delete member | Owner |
| `GET` | `/payments` | List payments with status filter | Owner, Staff |
| `POST`| `/payments` | Record manual payment (Pending state) | Owner, Staff |
| `POST`| `/payments/<id>/verify` | Verify payment, extend expiry, queue bridge command | Owner, Staff |
| `POST`| `/payments/<id>/reject` | Reject payment | Owner, Staff |
| `GET` | `/renewals/upcoming` | Members expiring in next 7 days | Owner, Staff |
| `GET` | `/renewals/expired` | Currently expired members | Owner, Staff |
| `POST`| `/renewals/<id>` | Direct renewal with idempotency key | Owner, Staff |
| `GET` | `/whatsapp/reminders`| Recent WhatsApp reminder log entries | Owner, Staff |
| `POST`| `/whatsapp/send-reminder`| Trigger manual reminder for member | Owner, Staff |
| `POST`| `/whatsapp/broadcast`| Send bulk announcement to members | Owner, Staff |
| `GET` | `/bot/conversations`| Active WhatsApp conversation threads | Owner, Staff |
| `GET` | `/bot/conversations/<id>`| Chronological chat messages & lead context | Owner, Staff |
| `POST`| `/bot/conversations/<id>/handover`| Toggle AI vs Human Takeover | Owner, Staff |
| `POST`| `/bot/conversations/<id>/message`| Send manual staff WhatsApp reply | Owner, Staff |
| `GET` | `/bot/leads` | Lead pipeline | Owner, Staff |
| `GET` | `/bot/setup` | Bot business info & knowledge base | Owner |
| `POST`| `/bot/setup` | Update FAQs, hours, plans, & trial rules | Owner |
| `GET` | `/reports/summary`| Revenue recovery & conversion funnel analytics | Owner |
| `GET` | `/biometric/status` | Live bridge heartbeat, queue size, device serial | Owner, Staff |
| `POST`| `/biometric/sync/<id>`| Force access resync for specific member | Owner, Staff |
