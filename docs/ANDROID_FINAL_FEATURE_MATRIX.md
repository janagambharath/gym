# Renewal Desk — Final Android Feature Matrix

| Feature | Screen | Mobile API Endpoint | Backend Service / Model | Role | Implemented | Tested | Real-world Verified | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Owner / Staff Login** | `LoginScreen.tsx` | `POST /api/mobile/v1/auth/login` | `User`, `app/mobile_api/auth.py` | All | YES | YES | YES | **PASS** | Dual JWT issuance & secure store persistence |
| **Session Refresh** | `App.tsx` | `POST /api/mobile/v1/auth/refresh` | `app/mobile_api/auth.py` | All | YES | YES | YES | **PASS** | Transparent background token refresh on 401 |
| **Self-Service Registration** | `SignupScreen.tsx` | `POST /api/mobile/v1/auth/signup` | `Gym`, `User`, `app/mobile_api/auth.py` | Owner | YES | YES | YES | **PASS** | 2-step onboarding, plan seeding, 30-day trial |
| **Dashboard Metrics** | `DashboardScreen.tsx` | `GET /api/mobile/v1/dashboard` | `Gym`, `Member`, `Payment` | All | YES | YES | YES | **PASS** | Active, Expiring, Expired, Pending payments |
| **Onboarding Checklist** | `DashboardScreen.tsx` | `GET /api/mobile/v1/onboarding/progress` | `app/mobile_api/dashboard.py` | Owner | YES | YES | YES | **PASS** | 8-milestone interactive setup progress tracker |
| **Members List & Filter** | `MembersScreen.tsx` | `GET /api/mobile/v1/members` | `Member`, `app/mobile_api/members.py` | All | YES | YES | YES | **PASS** | Paginated search, status chips, avatar badges |
| **Member Detail** | `MemberDetailScreen.tsx` | `GET /api/mobile/v1/members/<id>` | `Member`, `Plan`, `Payment` | All | YES | YES | YES | **PASS** | Membership timeline, renewal ledger, quick actions |
| **Add Member** | `AddMemberScreen.tsx` | `POST /api/mobile/v1/members` | `Member`, `Payment`, `Plan` | All | YES | YES | YES | **PASS** | Auto-calculates expiry based on selected plan |
| **Edit Member** | `EditMemberScreen.tsx` | `PUT /api/mobile/v1/members/<id>` | `Member`, `app/mobile_api/members.py` | All | YES | YES | YES | **PASS** | Updates phone, name, email, membership status |
| **CSV Member Import** | `MembersScreen.tsx` | `POST /api/mobile/v1/members/import-csv` | `Member`, `Plan` | Owner | YES | YES | YES | **PASS** | Client preview, schema validation, error reporting |
| **Renewals Hub** | `RenewalsScreen.tsx` | `GET /api/mobile/v1/renewals` | `Member`, `Plan`, `app/mobile_api/renewals.py` | All | YES | YES | YES | **PASS** | Filter by upcoming, expiring today, expired |
| **Renew Member** | `RenewMemberScreen.tsx` | `POST /api/mobile/v1/renewals` | `Member`, `Payment`, `Plan` | All | YES | YES | YES | **PASS** | Idempotent renewal with payment mode tracking |
| **Payments Ledger** | `PaymentsScreen.tsx` | `GET /api/mobile/v1/payments` | `Payment`, `Member`, `Plan` | All | YES | YES | YES | **PASS** | Full transaction history with mode filters |
| **Record Payment** | `RecordPaymentScreen.tsx` | `POST /api/mobile/v1/payments` | `Payment`, `Member` | All | YES | YES | YES | **PASS** | Idempotent payment recording preventing double entry |
| **Payment Detail** | `PaymentDetailScreen.tsx` | `GET /api/mobile/v1/payments/<id>` | `Payment`, `Member` | All | YES | YES | YES | **PASS** | Digital invoice receipt, PDF share, mode tag |
| **WhatsApp Reminders** | `WhatsAppScreen.tsx` | `GET /api/mobile/v1/whatsapp/reminders` | `WhatsAppMessageLog` | All | YES | YES | YES | **PASS** | Delivery status tracking, failed retry action |
| **WhatsApp Broadcast** | `WhatsAppScreen.tsx` | `POST /api/mobile/v1/whatsapp/broadcast` | `WhatsAppMessageLog` | Owner | YES | YES | YES | **PASS** | Audience segmenting (active, expired, all) & presets |
| **Meta WABA Onboarding** | `WhatsAppScreen.tsx` | `POST /api/mobile/v1/whatsapp/connect-waba` | `Gym`, `app/mobile_api/whatsapp.py` | Owner | YES | YES | YES | **PASS** | Links WABA ID & Phone Number ID via modal |
| **WhatsApp Profile** | `WhatsAppScreen.tsx` | `GET/PATCH /api/mobile/v1/whatsapp/profile` | `app/mobile_api/whatsapp.py` | Owner | YES | YES | YES | **PASS** | Updates business description and gym address |
| **AI Receptionist Hub** | `BotOverviewScreen.tsx` | `GET /api/mobile/v1/bot/overview` | `BotLead`, `BotConversation` | All | YES | YES | YES | **PASS** | Inquiries count, trial requests, handover metrics |
| **Inbound Leads** | `BotLeadsScreen.tsx` | `GET /api/mobile/v1/bot/leads` | `BotLead`, `app/mobile_api/bot.py` | All | YES | YES | YES | **PASS** | Pipeline status (New, Trial Requested, Contacted) |
| **Lead Detail** | `BotLeadDetailScreen.tsx` | `GET /api/mobile/v1/bot/leads/<id>` | `BotLead`, `BotConversation` | All | YES | YES | YES | **PASS** | Lead history, conversion to member action |
| **AI Chat Inbox** | `BotConversationsScreen.tsx`| `GET /api/mobile/v1/bot/conversations` | `BotConversation`, `BotMessage` | All | YES | YES | YES | **PASS** | Live conversation stream with handover badges |
| **Chat & Human Takeover**| `BotConversationDetailScreen.tsx`| `POST /api/mobile/v1/bot/conversations/<id>/messages` | `BotConversation`, `BotMessage` | All | YES | YES | YES | **PASS** | 1-hour cooldown suppression on manual reply |
| **AI Receptionist Config**| `BotSetupScreen.tsx` | `GET/POST /api/mobile/v1/bot/setup` | `GymBotConfig` | Owner | YES | YES | YES | **PASS** | Timings, facilities, trial policy, FAQs |
| **Bot Test Sandbox** | `BotTestScreen.tsx` | `POST /api/mobile/v1/bot/test` | `GymBotConfig`, AI Provider | All | YES | YES | YES | **PASS** | Interactive sandbox for testing gym bot prompts |
| **Membership Plans** | `PlansScreen.tsx` | `GET/POST/PUT/DELETE /api/mobile/v1/plans` | `Plan`, `app/mobile_api/plans.py` | Owner | YES | YES | YES | **PASS** | Create, edit, activate/deactivate plans |
| **Staff Management** | `StaffScreen.tsx` | `GET/POST/DELETE /api/mobile/v1/staff` | `User`, `app/mobile_api/staff.py` | Owner | YES | YES | YES | **PASS** | Add staff credentials, delete staff access |
| **Analytics & Reports** | `ReportsScreen.tsx` | `GET /api/mobile/v1/reports` | `Payment`, `Member`, `Plan` | Owner | YES | YES | YES | **PASS** | Revenue breakdown, member growth, retention rate |
| **Subscription & Billing**| `SubscriptionScreen.tsx` | `GET /api/mobile/v1/subscription/status` | `subscription_service.py` | Owner | YES | YES | YES | **PASS** | 3-tier catalog, currency switch, plan upgrade |
| **Purchase Verification** | `SubscriptionScreen.tsx` | `POST /api/mobile/v1/subscription/verify` | `subscription_service.py` | Owner | YES | YES | YES | **PASS** | Server-authoritative Google Play verification |
| **Purchase Restoration** | `SubscriptionScreen.tsx` | `POST /api/mobile/v1/subscription/restore`| `subscription_service.py` | Owner | YES | YES | YES | **PASS** | Re-links active subscription on device change |
| **Push Notifications** | `NotificationsScreen.tsx`| `GET /api/mobile/v1/notifications` | `NotificationLog` | All | YES | YES | YES | **PASS** | Allowlisted routing on notification tap |
| **Settings & Profile** | `SettingsScreen.tsx` | `GET /api/mobile/v1/settings` | `Gym`, `User`, `app/mobile_api/settings.py`| All | YES | YES | YES | **PASS** | Gym details, navigation shortcuts, safe logout |
