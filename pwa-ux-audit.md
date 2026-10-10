# Renewal Desk PWA — Owner-Perspective UI/UX Audit

**Date:** 2026-10-10
**Perspective:** Gym owner opening the app on their phone to run their business.
**Verdict up front:** The PWA has ~40 screens of mostly *working* functionality, but the owner can't reach the most important ones on mobile. The entire Settings hub — Plans, Staff, Payment Setup, WhatsApp, Subscription — is **invisible on phones**. That single fact explains Bharath's "many things are missing" complaint. On top of that: two dead buttons, one broken navigation, two orphaned screens, RRR-jargon tab labels instead of owner jobs, no onboarding, and `window.prompt()` used for critical flows.

---

## 1. Navigation & Information Architecture

### 1.1 🔴 CRITICAL: Settings is unreachable on mobile

The Settings screen (`src/screens/settings.js`) is well-built — Gym Management (Plans, Staff, Reports, Payment Setup, Access Control), Communication (WhatsApp, AI Receptionist, Campaigns, Inbox, Notifications), Account (Subscription), Sign Out. It is the **only hub** for 10+ owner capabilities.

But it is only linked from the desktop sidebar (`src/app.js:131`, `renderDesktopNavigation`), which is CSS-hidden below 900px (`src/styles/components.css:158`: `.desktop-owner-nav{display:none}` … `@media(min-width:900px){…display:flex…}`).

**On a phone there is zero path to Settings:**
- No tab, no "More" button, no hamburger menu (none exists in the codebase).
- The dashboard's owner avatar (`rrr-dashboard.js:37`, `<span class="rrr-owner-avatar">`) is a decorative `<span>` — not clickable.
- `grep` for `'settings'` across `src/` finds no mobile navigation link.

**Impact:** On mobile, the owner cannot: configure membership plans, manage staff, set up UPI/QR payments, connect WhatsApp, view subscription, or open Reports. These are not edge features — they are day-one setup.

### 1.2 🔴 Orphaned screens: CSV Import and AI Scan exist but are unreachable

- `src/screens/member-import.js` (CSV member import) and `src/screens/member-scan.js` (AI register-photo scan) are registered in `src/app.js` but **no screen links to them** (verified by grep across `src/`). Dead code in the navigation graph. The owner can never bulk-import members.

### 1.3 🟡 Tab bar speaks RRR-jargon, not owner jobs

Current tabs (`src/components.js:90-96`): **Dashboard, Revenue, Retain, Recover, Members**.

An owner opening the app at 6 AM thinks: *"Who's expiring today? Did yesterday's payments come in? Who's inside right now?"* — not *"Let me review my retain pillar."* Revenue/Retain/Recover are growth-consulting abstractions. Worse, the two highest-frequency daily jobs — **Payments** and **Renewals** — are not in the tab bar at all (reachable only via dashboard quick-actions or, for Renewals, not at all from tabs).

### 1.4 🟡 Two navigation models that disagree

- Desktop sidebar: Growth (Overview/Revenue/Retain/Recover) / Operations (Members, Renewals, Payments, Daily collections, Leads, Access) / Engagement (Campaigns, Inbox, WhatsApp).
- Mobile: 5 RRR tabs.

The desktop model is actually closer to owner jobs. The mobile model should match it, not invent a second taxonomy.

### 1.5 🟡 No "More" overflow on mobile

There is no hamburger menu, no "More" tab, no overflow pattern anywhere. Everything must fit in 5 tabs or be pushed from the dashboard. This is *why* Settings fell off mobile entirely — there was nowhere to put it.

---

## 2. Screen-by-screen verdicts

| Screen | File | Verdict | Notes |
|---|---|---|---|
| Dashboard | `rrr-dashboard.js` | **B+** | Rich (KPIs, owner-today queue, quick actions, pillars). Issues: avatar not clickable → no settings path; "Tune signals" is jargon; only "Identity reviews" KPI is tappable (inconsistent affordance); speculative "potential value" shown as prominently as real collections. |
| Members list | `members.js` | **A-** | Search, filters, FAB, infinite scroll, empty-state CTA. Minor: "Expiring" filter is client-side on the loaded page only — members on later pages are silently missed. |
| Member detail | `member-detail.js` | **A-** | Surprisingly complete: Renew, Record Payment, Check In/Out, Pause/Resume, WhatsApp Reminder, Biometric enroll/unenroll, Deactivate. **The Renew button EXISTS** (`#btn-renew` → `renew-member`) — the complaint may be a stale cached PWA. Issues: `window.prompt()` for enroll number, freeze days, freeze reason (janky native dialogs, no validation UI); three redundant Edit buttons (header icon + quick-edit + edit-contact). |
| Renewals | `renewals.js` | **B+** | Good sections (Today / 7 days / Upcoming / Expired), per-row Renew buttons. Odd: header megaphone icon jumps to Campaigns. Missing: bulk "remind all expiring" action. |
| Payments | `payments.js` | **A-** | Summary cards, filters, FAB, verify/reject/delete in detail. Solid. |
| Record payment | `record-payment.js` | **A-** | Member search, plan auto-fill, idempotency key, WhatsApp receipt share. Good. |
| Renew member | `renew-member.js` | **B+** | Works. Posts to `/payments`. Fine. |
| Payment detail | `payment-detail.js` | **A-** | Verify/reject/delete with double-submit guards. Good. |
| Settings hub | `settings.js` | **A content / F reachability** | Well organized. **Unreachable on mobile** (§1.1). Also contains a dead button (§4.1). |
| Plans | `plans.js` | **B+** | Full CRUD. Fine. |
| Staff | `staff.js` | **A-** | Add modal, reset password, activate/deactivate, WhatsApp invite with temp password. One of the best screens. |
| Reports | `reports.js` | **C** | Read-only summary. No date-range picker, no export, no drill-down into any number. |
| Payment setup | `payment-setup.js` | **B+** | UPI ID + QR upload with preview. Good. |
| Access (Live) | `access.js` | **B** | Live stats, manual check-in modal, per-member check-out, denied banner, 15s auto-refresh. **Broken member navigation** (§4.2). |
| Integrations | `rrr-integrations.js` | **A-** | Best guided setup in the app: 3 steps, copy-buttons for terminal values, live command console, supervised commissioning checklist. Issue: hardcoded `"ELITE GYM · ATTENDANCE"` eyebrow (§4.5) instead of the gym name. |
| Identity mapping | `rrr-mappings.js` | **B+** | Functional unmapped-punch review. Fine. |
| Signal rules | `rrr-rules.js` | **B** | Works, but "Signal rules" / "Tune signals" is jargon; owner doesn't know what a "signal" is. |
| WhatsApp | `whatsapp.js` | **C+** | Status + recent logs + Broadcast/Campaigns. **No "Connect WhatsApp" CTA when disconnected** — the single most important action on this screen is missing (§4.3). |
| Campaigns / Create / Detail | `campaigns.js`, `campaign-create.js`, `campaign-detail.js` | **B** | Functional create with segment preview + count. Detail is read-only (no duplicate/resend). |
| AI Receptionist | `bot-overview.js`, `bot-setup.js`, `bot-test.js`, `bot-conversations.js`, `bot-leads.js` | **B** | Stats, config, sandbox test, transcripts. Navigation between them works. |
| Inbox | `inbox.js` | **C-** | List renders, but **items are not tappable** — can't open a conversation. |
| Notifications | `notifications.js` | **C-** | List renders, but **items are not tappable** — no deep-link to the relevant member/payment. |
| Subscription | `subscription.js` | **C** | Read-only display (plan, status, dates, limits). No upgrade/change CTA. |
| Owner finance | `owner-finance.js` | **A-** | Daily collections, method breakdown, cash-close with variance. Good. |
| Owner leads | `owner-leads.js` | **A-** | Pipeline with filters, add-lead form, status actions, trial booking. Good. Uses `prompt()` for dates though (§4.6). |
| Add member | `add-member.js` | **B+** | Full form, plan auto-fill, paid/unpaid toggle. Good. |
| Edit member | `edit-member.js` | **B** | Works. Fine. |
| Member import (CSV) | `member-import.js` | **D** | **Orphaned** (§1.2). Also skips the preview/review step — uploads straight to `/members/import` while the backend offers `/members/import/preview` + `member-scan-review`. Hardcoded prod URL (§4.4). |
| Member scan (AI) | `member-scan.js` | **D** | **Orphaned** (§1.2). Hardcoded prod URL (§4.4). |
| Login / Signup | `login.js`, `signup.js` | **B+** | Clean, with error states and member-login escape hatch. No post-signup onboarding (§5.4). |
| Member app screens | `screens/member/*` | — | Out of scope (member-facing, not owner). |

---

## 3. Missing owner capabilities (prioritized)

### P0 — Can't run the business on mobile today
1. **Settings on mobile** — unlocks Plans, Staff, Payment Setup, WhatsApp, Subscription, Reports. (§1.1)
2. **WhatsApp connect flow** — when disconnected, there is no button to start connecting. The backend has embedded-signup; the PWA doesn't surface it. (§4.3)
3. **Member import / AI scan reachable** — bulk onboarding is orphaned. (§1.2)

### P1 — Daily jobs are harder than they should be
4. **Owner-job tab bar** — Home, Members, Payments, Renewals, More — instead of Dashboard/ Revenue/Retain/Recover/Members. (§1.3)
5. **New-gym setup checklist** — signup drops the owner on an empty dashboard with no guidance. No "add plans → add members → connect WhatsApp → set payment QR → pair device" flow. (§5.4)
6. **Bulk member actions** — no multi-select on Members/Renewals for "send reminder to all expiring". (Renewals has per-row buttons only.)
7. **Gym profile editing** — no screen to edit gym name, address, phone, timezone. (No such screen exists in `src/screens/`.)

### P2 — Polish / trust
8. **Tappable notifications & inbox** with deep links to member/payment/conversation.
9. **Reports with date ranges** and tap-to-drill-down.
10. **Replace all `window.prompt()`** with proper bottom-sheet modals (enroll number, freeze days/reason, lead dates).
11. **Campaign detail actions** — duplicate / resend.
12. **Subscription upgrade CTA** (if self-serve billing is desired).

---

## 4. Specific UX defects with file/line refs

### 4.1 🔴 Dead button: "Access Control" in Settings does nothing
`src/screens/settings.js:64-70` — the menu-item click handler special-cases `'access'` to `navigate.switchTab('access')`. But `'access'` is **not** in `TAB_CONFIG` (`src/app.js:20-26`), so `switchTab` hits `if (!config) return;` and silently does nothing. The owner taps "Access Control" → nothing happens. (Dashboard's quick action uses `navigate.push('access')`, which works — so this is purely the Settings path that's dead.)

### 4.2 🔴 Broken navigation: Live Access → Member detail shows "Member not found"
`src/screens/access.js:200,207` — member rows call `navigate.push('member-detail', { id: mid })`. But `src/screens/member-detail.js:16` reads `member?.id || params?.memberId` — it never reads `params.id`. Result: tapping any member in Live Access (inside list or event feed) lands on the "Member not found" error state. Every other caller passes `{member: JSON.stringify(m)}` correctly.

### 4.3 🔴 WhatsApp screen has no connect CTA when disconnected
`src/screens/whatsapp.js:8-40` — when `s.connected` is false, the screen shows a "Disconnected" badge and recent logs, but offers **no button** to start connecting. The two buttons (Broadcast, Campaigns) assume WhatsApp works. The owner whose WhatsApp is disconnected — the exact person who needs this screen most — gets no path forward.

### 4.4 🟡 Hardcoded production URL bypassing the API client
`src/screens/member-scan.js:22` and `src/screens/member-import.js:28` use `fetch('https://gym-production-910c.up.railway.app/...')` with a hand-rolled `Authorization` header from localStorage, instead of `apiRequest()`. This bypasses token refresh (stale tokens → silent 401s) and breaks if the backend URL ever changes. `api.js` already exports everything needed (`apiRequest` supports FormData? — no, it JSON-stringifies bodies; the QR upload in `api.js:uploadPaymentQrImage` shows the correct FormData pattern to follow).

### 4.5 🟡 Hardcoded gym name in Integrations
`src/screens/rrr-integrations.js:78` — eyebrow reads `ELITE GYM · ATTENDANCE` for every gym. Should use the session gym name like the dashboard does (`rrr-dashboard.js:29`).

### 4.6 🟡 `window.prompt()` for critical inputs
- `member-detail.js` — enroll number (`promptEnroll`), freeze days + reason.
- `owner-leads.js` — trial/follow-up datetime as free-text prompt (`bindLeadActions`).
- `rrr-list.js` — "Verified recovered revenue amount (₹)" prompt.
Native prompts are jarring on mobile, have no validation UI, and can't be styled. Each should be a bottom-sheet modal (the codebase already has modal patterns in `staff.js`).

### 4.7 🟡 Inconsistent back-button behavior on tab roots
`renderHeader` defaults `showBack` to `router.canGoBack()`. On tab root screens (dashboard, members list) the back button correctly hides. But `access.js` passes `showBack: router.depth > 1` explicitly while `settings.js` passes `showBack: true` unconditionally — tapping back from Settings (if reached) with an empty stack falls through to `router.back()` → `window.history.back()`, which can exit the app. Minor, but the back contract isn't uniform.

### 4.8 🟡 Dashboard KPI cards: only one is tappable
`rrr-dashboard.js:44` — the "Identity reviews" card has `id="rrr-kpi-mapping"` + `rrr-kpi-tappable` class and navigates to `rrr-mappings`. The other three KPI cards (members, attendance, pipeline) look identical but do nothing. Either make them all tappable (members → members tab, pipeline → revenue tab) or remove the tappable styling from the one.

### 4.9 🟡 "Expiring" filter misses members beyond page 1
`src/screens/members.js:66-69` — the "Expiring" chip filters the *already-fetched page* client-side (`days_until_expiry <= 7`) instead of passing a server-side filter. With pagination, expiring members on later pages never appear.

### 4.10 🟢 Minor: three Edit buttons on member detail
`member-detail.js` — header edit icon, "Edit Member" quick button, and "Edit" link in Contact card all do the same thing (`openEdit`). Redundant; keep one.

---

## 5. Recommended fix list — ordered by owner impact

1. **Put Settings on mobile.** Cheapest high-impact option: make the dashboard owner avatar a button → `navigate.push('settings')`, AND/OR add a 5th "More" tab rendering the Settings hub. This single change unlocks Plans, Staff, Payment Setup, WhatsApp, Subscription, Reports, Notifications on phones. (Fixes §1.1; unblocks P0 items.)
2. **Fix the dead Access Control button** in Settings: change `settings.js:68` `navigate.switchTab('access')` → `navigate.push('access')`. One line. (Fixes §4.1.)
3. **Fix Live Access → member navigation**: change `access.js:200,207` `{ id: mid }` → `{ memberId: mid }`. Two lines. (Fixes §4.2.)
4. **Add "Connect WhatsApp" CTA** on `whatsapp.js` when `!s.connected` — link to the embedded-signup flow / onboarding config the backend already exposes. (Fixes §4.3.)
5. **Link Member Import + AI Scan** from the Members screen header (e.g. an import icon next to Add, opening an action sheet: "Add manually / Import CSV / Scan register"). Delete the dead-end direct-upload path in `member-import.js`; route through the preview → `member-scan-review` flow the backend supports. (Fixes §1.2.)
6. **Re-label the tab bar to owner jobs**: Home (dashboard), Members, Payments, Renewals, More (settings hub). Keep Revenue/Retain/Recover as sections *inside* Home, not tabs. Update `TAB_CONFIG`, `components.js` tabs, and desktop nav to one shared taxonomy. (Fixes §1.3, §1.4, §1.5.)
7. **New-gym onboarding checklist** on the dashboard when the gym is fresh (no plans / no members / WhatsApp disconnected / no device): a dismissible card with 4–5 steps linking to plans → add-member → whatsapp → payment-setup → rrr-integrations. Backend already exposes everything needed. (Fixes P0/P1 setup gap.)
8. **Replace `window.prompt()`** with bottom-sheet modals for: biometric enroll number, freeze days/reason, lead trial/follow-up datetime, recovered-revenue amount. (Fixes §4.6.)
9. **Make notifications + inbox items tappable** with deep links (member → member-detail, payment → payment-detail, conversation → bot-conversation-detail). (Fixes C- screens.)
10. **Small correctness batch**: gym name in integrations eyebrow (§4.5); route scan/import uploads through `apiRequest`-style FormData helper (§4.4); server-side expiring filter (§4.9); make all dashboard KPI cards tappable or none (§4.8); collapse the three Edit buttons to one (§4.10).

---

## Appendix: what the audit did NOT find

To be fair: the core transactional flows (add member, renew, record payment, verify/reject payment, check-in/out, staff CRUD, plans CRUD, cash close, lead pipeline, device commissioning) are implemented and their buttons exist — including the **Renew button on member detail** (`member-detail.js`, `#btn-renew`), which contradicts the complaint as of this build. If Bharath still doesn't see it, the likely cause is a stale cached PWA on his phone (the app has a service worker; `dist/` was rebuilt 2026-10-10) rather than missing code. Worth verifying on his device before "re-adding" anything.
