# Renewal Desk — Mobile API Inventory

**Date:** September 1, 2026  
**Scope:** Complete inventory of every mobile API endpoint in Renewal Desk, HTTP method, authentication requirements, role authorization, tenant scoping mechanism, and purpose.

---

## Mobile API Endpoints Table

| Method | Endpoint | Purpose | Authentication | Allowed Roles | Tenant Scoped |
|:---|:---|:---|:---:|:---:|:---:|
| `POST` | `/api/mobile/v1/auth/signup` | Self-serve gym owner registration + 7-day trial creation | Public | Anyone | Creates new gym tenant |
| `POST` | `/api/mobile/v1/auth/login` | Authenticate owner/staff with email & password | Public | Anyone | Bound to user's `gym_id` |
| `POST` | `/api/mobile/v1/auth/google` | Google Sign-In with OAuth2 id_token validation | Public | Anyone | Resolves or creates `gym_id` |
| `POST` | `/api/mobile/v1/auth/refresh` | Exchange valid refresh token for new access token | Refresh Token | Anyone | Preserves active `gym_id` |
| `POST` | `/api/mobile/v1/auth/logout` | Revoke active refresh token and invalidate session | Bearer JWT | Owner, Staff | Scoped to current user |
| `GET` | `/api/mobile/v1/auth/me` | Fetch authenticated user profile and gym summary | Bearer JWT | Owner, Staff | `g.gym_id == User.gym_id` |
| `DELETE` | `/api/mobile/v1/auth/account` | Permanently delete account and cascade gym data | Bearer JWT | Owner, Staff | Scoped to `g.gym_id` / `User` |
| `GET` | `/api/mobile/v1/dashboard` | Fetch live dashboard metrics, dues, and revenue at risk | Bearer JWT | Owner, Staff | Enforced on `Member.gym_id` |
| `GET` | `/api/mobile/v1/members` | Paginated list of members with search and status filters | Bearer JWT | Owner, Staff | `Member.gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/members` | Add single member with validation and plan assignment | Bearer JWT | Owner, Staff | `Member.gym_id = g.gym_id` |
| `GET` | `/api/mobile/v1/members/<id>` | Fetch single member profile and payment history | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `PUT` | `/api/mobile/v1/members/<id>` | Update existing member details and membership dates | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `DELETE` | `/api/mobile/v1/members/<id>` | Soft/hard delete member record | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/members/import` | Atomic CSV spreadsheet import with duplicate check | Bearer JWT | Owner, Staff | Enforced on all imported rows |
| `POST` | `/api/mobile/v1/members/scan` | Multimodal AI OCR extraction from document photos | Bearer JWT | Owner, Staff | Rate-limited (10/min), ephemeral |
| `POST` | `/api/mobile/v1/members/batch-create` | Atomic batch creation of confirmed candidate records | Bearer JWT | Owner, Staff | Enforces `Gym.max_members` |
| `GET` | `/api/mobile/v1/plans` | List active membership plans and pricing | Bearer JWT | Owner, Staff | `MembershipPlan.gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/plans` | Create new membership plan | Bearer JWT | Owner | Scoped to `g.gym_id` |
| `PUT` | `/api/mobile/v1/plans/<id>` | Update existing membership plan pricing / duration | Bearer JWT | Owner | Verified `gym_id == g.gym_id` |
| `DELETE` | `/api/mobile/v1/plans/<id>` | Deactivate membership plan | Bearer JWT | Owner | Verified `gym_id == g.gym_id` |
| `GET` | `/api/mobile/v1/renewals` | List members expiring soon (Today, 1-3d, 4-7d, Expired) | Bearer JWT | Owner, Staff | `Member.gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/renewals/renew` | Fast 1-tap membership extension and payment creation | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `GET` | `/api/mobile/v1/payments` | Paginated payment transaction history | Bearer JWT | Owner, Staff | `PaymentVerification.gym_id` |
| `POST` | `/api/mobile/v1/payments` | Record manual cash, UPI, card, or bank payment | Bearer JWT | Owner, Staff | `PaymentVerification.gym_id` |
| `GET` | `/api/mobile/v1/payments/<id>` | Fetch detailed payment verification breakdown | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `DELETE` | `/api/mobile/v1/payments/<id>` | Void / delete payment record with balance adjustment | Bearer JWT | Owner | Verified `gym_id == g.gym_id` |
| `GET` | `/api/mobile/v1/reports/summary` | Aggregate revenue, renewal rate, and member counts | Bearer JWT | Owner | Dynamic calculation for gym |
| `GET` | `/api/mobile/v1/staff` | List staff members and active access | Bearer JWT | Owner | `User.gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/staff` | Invite new staff member with email and password | Bearer JWT | Owner | Scoped to `g.gym_id` |
| `DELETE` | `/api/mobile/v1/staff/<id>` | Revoke staff access and delete user | Bearer JWT | Owner | Verified `gym_id == g.gym_id` |
| `GET` | `/api/mobile/v1/whatsapp/connection-status` | Query current WhatsApp connection state & error info | Bearer JWT | Owner, Staff | `Gym.id == g.gym_id` |
| `GET` | `/api/mobile/v1/whatsapp/onboarding-config` | Fetch Meta App ID and onboarding methods | Bearer JWT | Owner, Staff | Scoped to `g.gym_id` |
| `POST` | `/api/mobile/v1/whatsapp/connect-waba` | Link official WABA and Phone Number ID to gym | Bearer JWT | Owner | Scoped to `g.gym_id` |
| `POST` | `/api/mobile/v1/whatsapp/disconnect` | Disconnect WhatsApp integration | Bearer JWT | Owner | Scoped to `g.gym_id` |
| `GET` | `/api/mobile/v1/bot/overview` | Fetch AI receptionist configuration and statistics | Bearer JWT | Owner, Staff | `Gym.id == g.gym_id` |
| `POST` | `/api/mobile/v1/bot/test` | Test AI receptionist responses in sandbox environment | Bearer JWT | Owner, Staff | Scoped to gym's knowledge base |
| `POST` | `/api/mobile/v1/bot/takeover` | Pause or resume AI automated responses for conversation | Bearer JWT | Owner, Staff | `Conversation.gym_id == g.gym_id` |
| `GET` | `/api/mobile/v1/leads` | List leads captured automatically from inbound chats | Bearer JWT | Owner, Staff | `Lead.gym_id == g.gym_id` |
| `PATCH` | `/api/mobile/v1/leads/<id>` | Update lead status (New -> Contacted -> Converted) | Bearer JWT | Owner, Staff | Verified `gym_id == g.gym_id` |
| `POST` | `/api/mobile/v1/notifications/register-device` | Register Expo push token for authenticated device | Bearer JWT | Owner, Staff | Bound to `User.id` and `gym_id` |
| `POST` | `/api/mobile/v1/billing/verify-google-play` | Verify Google Play purchase token and extend plan | Bearer JWT | Owner | Validates purchase against gym |
| `GET` | `/api/mobile/v1/onboarding/progress` | Check completion status of 5-step activation checklist | Bearer JWT | Owner, Staff | Dynamic query on gym entities |
| `GET` | `/delete-account` | Public web page with account deletion instructions | Public | Anyone | Static HTML (Google Play policy) |
