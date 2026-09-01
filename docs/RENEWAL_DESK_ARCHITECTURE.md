# Renewal Desk — System Architecture & Data Flow

**Date:** September 1, 2026  
**Scope:** High-level system architecture, client-server data flow, external integration gateways, security boundaries, and tenant isolation mechanics.

---

## 1. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Android Mobile Client (React Native / Expo)       │
│  - TypeScript & Functional Components                                   │
│  - React Navigation (Bottom Tabs + Native Stacks)                       │
│  - expo-secure-store (JWT Session & Offline Token Storage)              │
│  - expo-iap (Google Play Billing API Client)                            │
│  - expo-notifications (Push Notification Client)                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTPS (EAS Production URL)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Renewal Desk Cloud API (Flask / WSGI)               │
│                                                                         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │ Rate Limiter (Flask) │  │  JWT Auth Gate      │  │ Tenant Isolator│  │
│  │ (Redis / Memory)     │  │  (Token Required)   │  │ (g.gym_id)     │  │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Mobile API Blueprints (/api/mobile/v1/...)                        │  │
│  │  - auth.py           - dashboard.py      - members.py             │  │
│  │  - renewals.py       - payments.py       - plans.py               │  │
│  │  - reports.py        - bot.py            - whatsapp.py            │  │
│  │  - staff.py          - notifications.py  - billing.py             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Business Services Layer                                           │  │
│  │  - DocumentScanService (Multimodal OCR & Data Normalizer)          │  │
│  │  - MobileMemberImportService (CSV Parser & Duplicate Matcher)     │  │
│  │  - MobileBillingService (Google Play In-App Purchase Validator)   │  │
│  │  - WhatsAppService (Meta Cloud API Connector)                     │  │
│  │  - BotAIService (Grounded OpenRouter Receptionist)                │  │
│  │  - ReminderScheduler (APScheduler Expiry Dispatcher)              │  │
│  │  - AuditService (Security & Event Logging)                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────┬───────────────────┬───────────────────┬──────────────┘
                   │                   │                   │
         SQLAlchemy│                   │                   │
                   ▼                   ▼                   ▼
┌─────────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
│ PostgreSQL Database     │ │ In-Memory / Redis │ │ External Gateways     │
│ - Tenants (Gym)         │ │ - Cache / Metrics │ │ - Google Play API     │
│ - Users / Roles         │ │ - Rate Limits     │ │ - OpenRouter AI       │
│ - Members / Plans       │ │ - Lock Mutexes    │ │ - Meta WhatsApp Cloud │
│ - Renewals / Payments   │ └───────────────────┘ │ - Expo Push Server    │
│ - Conversations / Leads │                       └───────────────────────┘
│ - Audit Logs            │
└─────────────────────────┘
```

---

## 2. Security & Tenant Isolation Enforcement

1. **JWT Verification (`@token_required`):**
   - Every incoming request to `/api/mobile/v1/*` must present a valid Bearer token.
   - The token payload encodes `user_id` and `gym_id`.
   - The gate verifies signature validity, expiration, and user active status, setting Flask context `g.current_user` and `g.gym_id`.
2. **Strict Multi-Tenant Scoping:**
   - Every database query in the service and route layer filters explicitly by `gym_id == g.gym_id`.
   - Access to arbitrary resource IDs (`/members/<id>`, `/payments/<id>`, `/plans/<id>`) verifies ownership against `g.gym_id` before returning data or mutating state, throwing `404 / 403` on cross-tenant attempts.
3. **Role Authorization (`@roles_required`):**
   - Endpoints requiring gym management authority (e.g. Staff creation, Plan modifications, Account deletion, WABA connections) restrict access strictly to `gym_owner`.
   - Daily operational workflows (Member check-in, manual payment recording, fast renewal) permit `staff` and `gym_owner`.

---

## 3. Biometric Turnstile Bridge Architecture

- **Separation of Concerns:** The mobile app does not directly interact with local hardware turnstiles.
- **Asynchronous Sync Queue:** The backend maintains a `BridgeQueue` command table.
- **Local Bridge Daemon:** Gyms with biometric hardware run a Python desktop bridge service (`app/bridge/`) on local Windows/Linux hardware that polls the cloud API over HTTPS, writes fingerprint templates to ZKTeco/BioStar terminals, and posts attendance timestamps back to the cloud.
