# RENEWAL DESK — ANDROID FINAL FEATURE MATRIX

| Feature | Screen | Backend Endpoint | Role | Current State | Test State | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **User Login** | `LoginScreen.tsx` | `POST /auth/login` | Owner / Staff | Complete | Tested | **PASS** | Validates email/password, issues JWT access + refresh tokens, stores in SecureStore. |
| **Token Rotation** | Background / `apiClient.ts` | `POST /auth/refresh` | Owner / Staff | Complete | Tested | **PASS** | Deduplicated single in-flight refresh. Retains session on transient network error. |
| **Sign Out** | `SettingsScreen.tsx` | `POST /auth/logout` | Owner / Staff | Complete | Tested | **PASS** | Clears secure storage, unregisters push notifications. |
| **Dashboard Metrics** | `DashboardScreen.tsx` | `GET /dashboard` | Owner / Staff | Complete | Tested | **PASS** | 2x2 grid (Active, Expiring Soon, Expired, Pending), Revenue breakdown (Today, Week, Month). |
| **Urgent Staff Handover** | `DashboardScreen.tsx` | `GET /dashboard` | Owner / Staff | Complete | Tested | **PASS** | Displays urgent handover banner with customer message snippet and direct Reply action. |
| **Member Directory** | `MembersScreen.tsx` | `GET /members` | Owner / Staff | Complete | Tested | **PASS** | Paginated (20/page), debounced name/phone search, active/expiring/expired chips. |
| **Member Detail** | `MemberDetailScreen.tsx` | `GET /members/:id` | Owner / Staff | Complete | Tested | **PASS** | Shows profile, membership dates, financial summary, and Biometric enrollment status badge. |
| **Add Member** | `AddMemberScreen.tsx` | `POST /members` | Owner / Staff | Complete | Tested | **PASS** | Name, phone (E.164 normalized), plan selection, auto-calculates end date. |
| **Edit Member** | `EditMemberScreen.tsx` | `PATCH /members/:id` | Owner / Staff | Complete | Tested | **PASS** | Edit personal details, gender, plan, notes with duplicate-tap prevention. |
| **Deactivate Member** | `MemberDetailScreen.tsx` | `POST /members/:id/deactivate`| Owner only | Complete | Tested | **PASS** | Confirmation dialog, soft deletes member, queues bridge command. |
| **Renewals Hub** | `RenewalsScreen.tsx` | `GET /renewals` | Owner / Staff | Complete | Tested | **PASS** | Segmented into Expiring Today, Next 7 Days, and Overdue with urgency styling. |
| **Renew Member** | `RenewMemberScreen.tsx` | `POST /renewals` | Owner / Staff | Complete | Tested | **PASS** | Records renewal with `Idempotency-Key` header, updates end date. |
| **Payments List** | `PaymentsScreen.tsx` | `GET /payments` | Owner / Staff | Complete | Tested | **PASS** | Filter by pending, verified, rejected. Shows method, amount, reference. |
| **Payment Detail** | `PaymentDetailScreen.tsx` | `GET /payments/:id` | Owner / Staff | Complete | Tested | **PASS** | Payment receipt view with member link, timestamp, and audit trail. |
| **Verify / Reject Payment**| `PaymentsScreen.tsx` | `POST /payments/:id/verify` | Owner / Staff | Complete | Tested | **PASS** | Confirmation modal before verifying/rejecting, extends membership end date on verify. |
| **Record Payment** | `RecordPaymentScreen.tsx` | `POST /payments` | Owner / Staff | Complete | Tested | **PASS** | Member picker, amount, method (Cash, UPI, Card), renewal days extension. |
| **WhatsApp Reminders** | `WhatsAppScreen.tsx` | `GET /whatsapp/reminders` | Owner / Staff | Complete | Tested | **PASS** | Log of sent/failed/pending renewal reminders with timestamps. |
| **WhatsApp Broadcast** | `WhatsAppScreen.tsx` | `POST /whatsapp/broadcast`| Owner / Staff | Complete | Tested | **PASS** | Broadcast announcements with quick presets to segmented audiences. |
| **AI Bot Overview** | `BotOverviewScreen.tsx` | `GET /bot/stats` | Owner / Staff | Complete | Tested | **PASS** | 4 KPI stats: Total chats, leads, trial requests, handovers. |
| **AI Conversations** | `BotConversationsScreen.tsx`| `GET /bot/conversations` | Owner / Staff | Complete | Tested | **PASS** | Live customer conversations with status badges and search. |
| **Bot Chat & Takeover** | `BotConversationDetailScreen.tsx`| `POST /bot/conversations/:id/handover` | Owner / Staff | Complete | Tested | **PASS** | Staff Takeover stops AI auto-replies; Resume AI restores receptionist. |
| **AI Leads Directory** | `BotLeadsScreen.tsx` | `GET /bot/leads` | Owner / Staff | Complete | Tested | **PASS** | Captured leads from WhatsApp, intent classification, interested plan. |
| **Bot Setup & FAQs** | `BotSetupScreen.tsx` | `PATCH /bot/config` | Owner only | Complete | Tested | **PASS** | Greeting, opening hours, map link, trial options, FAQ management. |
| **AI Sandbox Test** | `BotTestScreen.tsx` | `POST /bot/test` | Owner / Staff | Complete | Tested | **PASS** | Safe testing sandbox simulating customer queries and intent parsing. |
| **Push Notifications** | `NotificationsScreen.tsx` | `GET /notifications` | Owner / Staff | Complete | Tested | **PASS** | Push token registration, in-app feed, unread counter, allow-listed deep links. |
| **Plan Management** | `PlansScreen.tsx` | `GET / POST / PATCH / DELETE /plans` | Owner only | Complete | Tested | **PASS** | Full CRUD for gym membership plans with duration and price configuration. |
| **Staff Directory** | `StaffScreen.tsx` | `GET / POST /staff` | Owner only | Complete | Tested | **PASS** | Manage staff accounts and permissions. |
| **Analytics Reports** | `ReportsScreen.tsx` | `GET /reports/summary` | Owner / Staff | Complete | Tested | **PASS** | Period analytics for Revenue, Members, Renewals, and WhatsApp delivery. |
| **Gym Settings** | `SettingsScreen.tsx` | `GET / PATCH /settings` | Owner / Staff | Complete | Tested | **PASS** | Gym profile, address, timezone, subscription status, build info. |
