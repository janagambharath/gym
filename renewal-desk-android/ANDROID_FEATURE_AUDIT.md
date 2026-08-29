# ANDROID FEATURE AUDIT — RENEWAL DESK

This audit documents every screen, navigation path, action, backend API call, loading/empty/error state, and current operational status for the Renewal Desk Android application.

## Feature Inventory Matrix

| Feature | Screen | Action | API Endpoint | Expected Behavior | Current Behavior | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Login | Sign in with email & password | `POST /api/mobile/v1/auth/login` | Authenticates user, securely stores access/refresh tokens in SecureStore, initializes session | Authenticates, persists session, handles errors | **WORKING** |
| **Authentication** | Login | Validation on empty/invalid inputs | None (Client-side) | Displays inline error banner, prevents API call | Displays inline error banner | **WORKING** |
| **Authentication** | Session | Auto-login / session restoration | SecureStore `loadSession()` | Restores valid session on app cold start without re-prompting | Restores session seamlessly | **WORKING** |
| **Authentication** | Session | Token refresh on 401 | `POST /api/mobile/v1/auth/refresh` | Silently refreshes access token and retries request | Transparent refresh and retry with deduplication | **WORKING** |
| **Authentication** | Header / More | Sign out | `POST /api/mobile/v1/auth/logout` | Revokes refresh token, deletes local SecureStore session, unregisters push token | Clears session, unregisters push token, redirects to Login | **WORKING** |
| **Dashboard** | DashboardHome | Initial load & metrics | `GET /api/mobile/v1/dashboard` | Returns active members, expiring count, expired count, pending payments, revenue totals, bot summary | Displays live counters, 2x2 grid, revenue totals | **WORKING** |
| **Dashboard** | DashboardHome | Upcoming renewals widget | `GET /api/mobile/v1/renewals/upcoming` | Displays top 5 upcoming renewals with days remaining | Displays member cards with status badges | **WORKING** |
| **Dashboard** | DashboardHome | Recent payments widget | `GET /api/mobile/v1/payments?page_size=5` | Displays top 5 recent payment transactions | Displays payment cards with status badges | **WORKING** |
| **Dashboard** | DashboardHome | Urgent staff handover alert | Derived from `bot_summary` | Highlights pending customer chats needing human attention | Shows handover banner with direct Reply action | **WORKING** |
| **Dashboard** | DashboardHome | Pull to refresh | All dashboard endpoints | Refreshes all metrics and lists synchronously | Triggers full refresh with spinner | **WORKING** |
| **Dashboard** | DashboardHome | Quick action: Add Member | Navigation | Navigates to AddMemberScreen | Navigates to AddMember | **WORKING** |
| **Dashboard** | DashboardHome | Quick action: Renew | Navigation | Navigates to RenewalsScreen | Navigates to Renewals | **WORKING** |
| **Dashboard** | DashboardHome | Quick action: Payment | Navigation | Navigates to RecordPaymentScreen | Navigates to RecordPayment | **WORKING** |
| **Dashboard** | DashboardHome | Quick action: WhatsApp | Navigation | Navigates to WhatsAppScreen | Navigates to WhatsApp | **WORKING** |
| **Members** | MembersList | Paginated list | `GET /api/mobile/v1/members?page=X&page_size=20` | Displays members sorted by membership end date | Displays members list with pagination | **WORKING** |
| **Members** | MembersList | Search by name / phone | `GET /api/mobile/v1/members?q=...` | Debounced server search filter | Instant debounced search with count | **WORKING** |
| **Members** | MembersList | Filter by status | `GET /api/mobile/v1/members?status=...` | Filters by Active, Expiring (client-side calculation), Expired | Filters list accordingly | **WORKING** |
| **Members** | MembersList | Select member | Navigation | Opens MemberDetailScreen for selected member | Opens MemberDetailScreen | **WORKING** |
| **Add Member** | AddMember | Form validation & submit | `POST /api/mobile/v1/members` | Creates new member with plan duration and calculates end date | Creates member, refreshes cache, navigates to detail | **WORKING** |
| **Add Member** | AddMember | Plans selection | `GET /api/mobile/v1/settings` | Loads gym membership plans for selection | Loads and selects plan | **WORKING** |
| **Edit Member** | EditMember | Update member info | `PATCH /api/mobile/v1/members/:id` | Updates name, phone, email, gender, notes, plan | Saves changes, handles validation, navigates back | **WORKING** |
| **Member Detail** | MemberDetail | View profile & status | `GET /api/mobile/v1/members/:id` | Shows personal info, membership status, plan, dates, days left | Displays full profile card and days bar | **WORKING** |
| **Member Detail** | MemberDetail | Financial summary | `GET /api/mobile/v1/payments?page_size=50` | Displays total verified paid amount and pending payments | Computes and displays financial status | **WORKING** |
| **Member Detail** | MemberDetail | Activity & History | `GET /api/mobile/v1/renewals?member_id=...` | Shows renewal count, payment count, and WhatsApp status | Displays activity rows | **WORKING** |
| **Member Detail** | MemberDetail | Access Control / Biometric | Member payload (`has_biometric`) | Displays biometric enrollment status & access control state | Shows explicit Biometric Access enrollment state | **WORKING** |
| **Member Detail** | MemberDetail | Send WhatsApp reminder | `POST /api/mobile/v1/whatsapp/send-reminder` | Sends WhatsApp reminder via server and displays confirmation | Sends reminder, shows feedback banner | **WORKING** |
| **Member Detail** | MemberDetail | Deactivate member | `POST /api/mobile/v1/members/:id/deactivate` | Deactivates member (owner only) with confirmation dialog | Prompts confirmation dialog, deactivates, returns | **WORKING** |
| **Renewals** | RenewalsHome | List upcoming & expired | `GET /api/mobile/v1/renewals/upcoming`, `GET /api/mobile/v1/renewals/expired` | Groups into Expiring Today, Next 7 Days, and Expired | Renders sectioned renewal lists | **WORKING** |
| **Renewals** | RenewalsHome | Instant Renew action | Navigation | Opens RenewMemberScreen for selected member | Opens RenewMemberScreen with prefilled plan | **WORKING** |
| **Renew Member** | RenewMember | Record renewal payment | `POST /api/mobile/v1/payments` (with `Idempotency-Key`) | Records payment, flags for verification, avoids double renewal | Uses Idempotency-Key, shows verification notice | **WORKING** |
| **Renew Member** | RenewMember | Send WhatsApp receipt | `POST /api/mobile/v1/whatsapp/send-reminder` | Sends reminder/acknowledgement message to member | Sends message, displays feedback | **WORKING** |
| **Payments** | PaymentsHome | List payment records | `GET /api/mobile/v1/payments?page=X` | Shows recent payments with status badges and amounts | Paginated payment list with pull-to-refresh | **WORKING** |
| **Payments** | PaymentsHome | Filter by status | `GET /api/mobile/v1/payments?status=...` | Filters by pending, verified, rejected | Filters payments | **WORKING** |
| **Payments** | PaymentsHome | Inline verify payment | `POST /api/mobile/v1/payments/:id/verify` | Verifies payment and extends member membership | Prompts confirmation dialog, verifies, refreshes | **WORKING** |
| **Payments** | PaymentsHome | Inline reject payment | `POST /api/mobile/v1/payments/:id/reject` | Rejects payment with destructive confirmation | Prompts confirmation dialog, rejects, refreshes | **WORKING** |
| **Record Payment**| RecordPayment | Search & select member | `GET /api/mobile/v1/members?q=...` | Member search dropdown with prefill | Searches members, preselects plan price and days | **WORKING** |
| **Record Payment**| RecordPayment | Submit payment | `POST /api/mobile/v1/payments` | Records payment as pending | Validates inputs, prevents duplicate taps, creates payment | **WORKING** |
| **Payment Detail**| PaymentDetail | View payment record | `GET /api/mobile/v1/payments/:id` | Full details, method, date, reference, notes, verification metadata | Displays detail card and verification status | **WORKING** |
| **Payment Detail**| PaymentDetail | Verify / Reject | `POST /api/mobile/v1/payments/:id/verify`, `POST /api/mobile/v1/payments/:id/reject` | Modifies payment status and extends/updates membership | Updates state with confirmation | **WORKING** |
| **Payment Detail**| PaymentDetail | Delete payment | `DELETE /api/mobile/v1/payments/:id` | Removes payment record and safely reverts expiry if needed | Prompts confirmation, deletes, navigates back | **WORKING** |
| **WhatsApp** | WhatsAppScreen | Reminders history | `GET /api/mobile/v1/whatsapp/reminders` | Log of sent/failed WhatsApp reminders | Displays list with status filters & counters | **WORKING** |
| **WhatsApp** | WhatsAppScreen | Audience broadcast | `POST /api/mobile/v1/whatsapp/broadcast` | Sends batch template message to active/expired members | Displays audience count, preset picker, dispatches broadcast | **WORKING** |
| **WhatsApp** | WhatsAppScreen | Leads list & modal | `GET /api/mobile/v1/bot/leads`, `GET /api/mobile/v1/bot/conversations/:id` | Lists leads and opens conversation detail modal | Loads leads and parses messages transcript | **WORKING** |
| **AI Receptionist**| BotOverview | KPI counters & Setup | `GET /api/mobile/v1/bot/stats`, `GET /api/mobile/v1/bot/config` | Displays conversation totals, leads, trials, handovers, knowledge checklist | Displays 4 KPI tiles, knowledge cards, quick links | **WORKING** |
| **AI Receptionist**| BotConversations | List WhatsApp conversations | `GET /api/mobile/v1/bot/conversations` | Lists live customer conversations with handover status | Displays conversations with avatar and state badges | **WORKING** |
| **AI Receptionist**| BotConversationDetail | Transcript & Handover | `GET /api/mobile/v1/bot/conversations/:id`, `POST /api/mobile/v1/bot/conversations/:id/handover`, `POST /api/mobile/v1/bot/conversations/:id/messages` | Shows message bubbles, linked lead card, Takeover / Resume bot toggle, manual reply box | Interactive chat transcript with handover controls | **WORKING** |
| **AI Receptionist**| BotLeads | Leads table | `GET /api/mobile/v1/bot/leads` | Paginated leads list with status filtering | Displays leads with search and filter chips | **WORKING** |
| **AI Receptionist**| BotLeadDetail | Edit lead info & transcript | `GET /api/mobile/v1/bot/leads/:id`, `PATCH /api/mobile/v1/bot/leads/:id` | View inquiry details, update lead status/notes/name | Updates lead attributes and displays full transcript | **WORKING** |
| **AI Receptionist**| BotSetup | Business configuration | `GET /api/mobile/v1/bot/config`, `PATCH /api/mobile/v1/bot/config`, `POST /api/mobile/v1/bot/faqs` | Owner configuration for greeting, hours, location, free trials, FAQs | Configures business parameters and manages custom FAQs | **WORKING** |
| **AI Receptionist**| BotTest | Sandbox simulation | `POST /api/mobile/v1/bot/test` | Test how AI answers questions based on gym data without sending WhatsApp | Simulates conversation, displays intent, response bubble | **WORKING** |
| **Settings & More**| SettingsScreen | Gym information & status | `GET /api/mobile/v1/settings` | Displays logged-in account, gym details, subscription, navigation menu | Displays profile card, gym metadata, links | **WORKING** |
| **Plans** | PlansScreen | Manage gym plans | `GET /api/mobile/v1/settings`, `POST /api/mobile/v1/plans`, `PATCH /api/mobile/v1/plans/:id`, `DELETE /api/mobile/v1/plans/:id` | Lists, creates, updates, and deletes membership pricing plans | Full plan management with inline edit and delete | **WORKING** |
| **Staff** | StaffScreen | View staff roster | `GET /api/mobile/v1/staff` | Lists gym owner and staff members with login activity | Displays staff cards with role badges | **WORKING** |
| **Reports** | ReportsScreen | Summary analytics | `GET /api/mobile/v1/reports/summary?period=...` | Summary metrics for Today, 7 Days, 30 Days | Displays Members, Revenue, Renewals, WhatsApp KPIs | **WORKING** |
| **Notifications** | NotificationsScreen | Notification feed | `GET /api/mobile/v1/notifications`, `POST /api/mobile/v1/notifications/read-all`, `POST /api/mobile/v1/notifications/:id/read` | Categorized feed of handovers, leads, payments, renewals with deep links | Interactive notification list with mark-all-read & deep link navigation | **WORKING** |

## Audit Summary
- **Total Screens Inspected:** 24
- **Working Features:** 24 / 24 (100%)
- **Broken / Missing Features:** 0
