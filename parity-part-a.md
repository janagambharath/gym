# UI/UX Parity Audit — Part A: Home/Dashboard, RRR family, Settings, Auth

**Date:** 2026-10-11 · **Scope:** PWA (`renewal-desk-pwa/src/screens/*.js`) vs Android (`renewal-desk-android/src/screens/*.tsx`)
**Note on structure:** On PWA, the home tab **is** the RRR dashboard (`app.js:21` maps `home` → `dashboard` route, registered at `app.js:37` → `rrr-dashboard.js`). On Android, Home (`DashboardScreen.tsx`) is a broad operational dashboard, and the RRR family is consolidated into a **single** screen (`RrrGrowthScreen.tsx`, reached from Settings). There is no 1:1 screen mapping — this is the single biggest structural divergence, and each section below calls out exactly what lands where.

---

## 0. Where the RRR family lives (structural map)

| PWA screen | Android equivalent |
|---|---|
| `rrr-dashboard.js` (home tab) | Split: `DashboardScreen.tsx` (home) + `RrrGrowthScreen.tsx` (RRR content) |
| `rrr-list.js` (opportunities list) | **MISSING** — no Android equivalent (see §2) |
| `rrr-integrations.js` | `RrrGrowthScreen.tsx` — Direct Cloud + eBioServer cards (see §3) |
| `rrr-mappings.js` | **MISSING as a screen** — only a capped card inside `RrrGrowthScreen.tsx` (see §4) |
| `rrr-rules.js` | `RrrGrowthScreen.tsx` — "Signal thresholds" card at bottom (see §5) |

---

## 1. Home: PWA `rrr-dashboard.js` vs Android `DashboardScreen.tsx` (+ `RrrGrowthScreen.tsx` where it overlaps)

### 1a. Section order, top → bottom

**PWA `rrr-dashboard.js`:**
1. Workspace header bar — gym switcher (→ members tab), inbox icon (→ inbox), "Add member" button (→ add-member), owner avatar (→ settings) — `rrr-dashboard.js:36`
2. Hero — "TODAY AT {GYM}" eyebrow, "Run the gym. Grow the business.", dynamic copy: `N member opportunities need your attention` **or** "Everything looks clear…"; device-status button (`{integration} live` / `Attendance needs setup` → rrr-integrations) — `:38-41`
3. GROWTH ENGINE — "Where to focus next" + **"Tune signals"** button (→ rrr-rules); 3 pillar cards Revenue/Retain/Recover, each with icon, title, eyebrow, count, label, potential revenue, detail text, "View members →" (→ `rrr-list?pillar=`) — `:42`, pillar card `:60-64`
4. Member-list grid — 3 panels (one per pillar), top-N tappable member rows (→ member-detail), "View all" per panel (→ rrr-list); empty state "No action needed right now." — `:43`, `:67-71`
5. KPI row — 4 **tappable** cards: Total members (→ members tab), 30-day attendance (→ access), Identity reviews/unmapped count (→ rrr-mappings), Growth pipeline/potential value (→ rrr-list?pillar=revenue) — `:44-49`
6. Owner Today priority queue (`:50,52`) + Get-set-up checklist (`:51,53`) — **each rendered TWICE** (copy-paste bug, see §1c)
7. Growth impact panel (per-pillar potential-value bars) + Quick actions panel (Add new member / Record a payment / Start WhatsApp campaign / Review access control) — `:54-57`

**Android `DashboardScreen.tsx`:**
1. Top bar — logo + "RRR Growth System", gym selector, notification bell with attention dot (→ notifications), avatar (→ settings) — `:170-210`
2. Time-based greeting ("Good morning, {first name}") + "Here's the live view…" — `:218-225`
3. GROWTH ENGINE — "Where to focus next"; 3 full-width pillar cards (icon, title, eyebrow, count, count label, potential, "View members" CTA) — **all three tap to the same `onNavigateRrr`, no per-pillar deep link** — `:226-262`
4. First-Action hero for new gyms (`total_active === 0`): "GET STARTED / Bring Your Members In" — Import (Excel/CSV) / Scan Records / Add Manually — `:265-316`
5. `OnboardingChecklistCard` — server-driven steps, % progress bar, collapsible — `:317-348` (see §1b)
6. RRR integration card ("RRR Growth & eBioServer") → `onNavigateRrr`; shows `Connected · N punches synced` or fallback copy — `:349-364`
7. Staff handover alert box (bot handovers, "Reply" → conversations) — `:367-408`
8. Metrics grid — Revenue Recovery hero (At Risk / Recovered 30d / Rate + last-campaign callout), Today's Actions card, Revenue Collected (today/week/month), Active / Expiring Soon / Expired / Pending Payments metrics — `:410-508`
9. Live Access card (device online/offline, Inside Now / Entries / Exits / Denied → access) — `:510-598`
10. Inbound Leads & AI Bot card (Total/New/Trials/Handovers → bot leads/conversations; "Open AI Chats", "Broadcast / WhatsApp") — `:600-678`
11. Revenue Overview card (today/week/month, empty-state hint, Revenue-at-Risk banner → renewals) — `:680-744`
12. Attention Required card (conditional tiles → renewals/payments) — `:746-776`
13. Upcoming Renewals card (rows → member detail; per-row **Renew** button; empty state) — `:778-838`
14. Recent Payments card (rows; empty state) — `:840-872`
15. Quick Actions — Add Member / Renew / Payment / WhatsApp — `:874-884`

### 1b. Key deltas (user-visible)

- **Per-pillar member lists exist only on PWA.** PWA §4 (3 panels with tappable member rows → member-detail, "View all" → rrr-list) has **no Android counterpart**. On Android, pillar cards all funnel to `RrrGrowthScreen`, whose inline opportunities (max 2 per pillar) only offer "Action ›" = mark-actioned — they don't open member detail and don't show the full list. Member-level follow-up from the dashboard is a PWA-only flow.
- **PWA KPI row is tappable; Android metrics are not.** PWA `:44-49` — Total members→members tab, Attendance→access, Identity reviews→rrr-mappings, Pipeline→rrr-list. Android's `DashboardMetric` renders a plain `View` (`DashboardScreen.tsx:891-908`) — no navigation. Android's Attention tiles *are* tappable, but there's no home-screen path to identity review/mappings at all (only the capped card inside `RrrGrowthScreen`).
- **Android home has major sections PWA home lacks:** handover alerts, Live Access, Leads & AI Bot, Revenue Overview, Attention Required, Upcoming Renewals (with 1-tap Renew), Recent Payments. PWA's closest equivalents are the Owner-Today queue and the member-list grid. Net: Android home is a much denser operational dashboard; PWA home is a leaner RRR dashboard.
- **PWA-only on home:** "Growth impact" bars panel; hero device-status button; "Tune signals" button in the growth heading (Android rules live at the bottom of `RrrGrowthScreen`); per-pillar "View members" deep links.
- **Quick actions differ:** PWA = Add new member, **Record a payment**, **Start WhatsApp campaign** (→ campaign-create), **Review access control** (→ access). Android = Add Member, **Renew**, Payment, WhatsApp. Android home has no direct "start campaign" or "access control" shortcut; PWA home has no Renew shortcut.
- **Onboarding checklist:** PWA `:72-85` hard-codes 5 steps (plans → `plans`, members → `member-import`, WhatsApp → `whatsapp-setup`, payments → `payment-setup`, biometric → `rrr-integrations`), shows "N steps left", dims completed steps. Android `OnboardingChecklistCard.tsx:8-64` is **server-driven** (`getOnboardingProgress()`), shows % progress bar, is collapsible, and hides entirely when complete. Step contents may diverge from PWA's 5 since they come from the API — worth verifying against the backend's onboarding definition.
- **Loading/error:** both have skeletons (PWA inline `:18`; Android `DashboardSkeleton`) and error+retry (PWA `:26-33`; Android `ErrorState` at `:213-215`). Android additionally logs out on 401 (`:196`). **But `RrrGrowthScreen` has NO skeleton and NO error state** — before load it renders zeros/defaults, and failed fetches silently leave defaults (`RrrGrowthScreen.tsx:55-92`). Users on a flaky connection see "0 members, SET UP" instead of a loading or error state.

### 1c. PWA bug (do NOT replicate on Android)

`rrr-dashboard.js:50-53` renders `${ownerToday(...)}` and `${setupChecklist(...)}` **twice each** — the Owner-Today queue and the Get-set-up checklist appear duplicated on the PWA home screen. Android renders each once. Flag for PWA fix; not an Android gap.

---

## 2. Opportunities list: PWA `rrr-list.js` vs Android — **NO EQUIVALENT (major gap)**

PWA `rrr-list.js` (24-line screen, full opportunity lifecycle):
- Per-pillar list (`?pillar=revenue|retain|recover`), back button, explainer copy — `:13`
- Per-row: member name, reason, **priority · status** labels, potential revenue — `:14`
- **Three actions per opportunity:** "Mark actioned", **"Close as recovered"** (prompts for verified recovered revenue amount via `showPrompt`, sent as `outcome_revenue` — `:19-24`), **"Dismiss"** — `:14-24`
- Loading ("Loading RRR actions…"), error ("Unable to load opportunities."), empty state ("No open opportunities.") — `:10-12`

Android: the only opportunities UI is the inline slice in `RrrGrowthScreen.tsx:123` — `(data?.opportunities || []).filter(pillar).slice(0, 2)` with a single **"Action ›"** link that PATCHes `status: 'actioned'` (`markActioned`, `:116`). **Missing on Android:** a full per-pillar list view, "Close as recovered" + revenue capture, "Dismiss", priority/status display, per-row revenue, empty/error/loading states. This is a production-relevant functional gap — the entire opportunity-closure loop (the thing that records recovered revenue) is PWA-only.

---

## 3. Integrations: PWA `rrr-integrations.js` vs Android `RrrGrowthScreen.tsx` (Direct Cloud + bridge cards)

Both cover: Direct Cloud provisioning, server-settings display, command console (probe/block/unblock), supervised commissioning, eBioServer bridge pairing + device selection. Differences:

### 3a. Direct Cloud provisioning
- PWA `rrr-integrations.js:102-120`: form with serial (required, autocapitalize off) + friendly name (default **"Elite Gym Entry"**), inline error text, submit button disabled with "Saving terminal…" state. Android `RrrGrowthScreen.tsx:124-125,102-113`: two `TextInput`s + "Save terminal and continue" button; serial empty → `Alert`; `autoCapitalize="characters"` on serial. Same fields, equivalent. Minor: PWA serial placeholder references the format (`X2008-123456`); Android has no example hint.

### 3b. Server-settings display — copy buttons missing on Android
- PWA `:130-138` (`copyRow`): Cloud Server Address, Port, HTTPS, Path, **Mode** — each with a **Copy** button, plus device identity header and the "Menu → Comm. → Cloud Server Setting" instruction. Android `:125`: selectable host text + one meta line (ADMS mode · Port · HTTPS · Path) — **no Copy buttons**, no Mode row (mode is implied in the meta line). Values are all present; the copy affordance is not.

### 3c. "Haven't heard from terminal" empty state + HTTPS guidance — Android missing
- PWA `:128-133`: when provisioned but never heard from, shows last error (if any) and a 3-point checklist (values saved in Cloud Server Setting; terminal has internet; serial matches sticker). **No Android equivalent.**
- PWA `:141`: HTTPS guidance — if HTTPS on but terminal has no HTTPS/SSL menu option → "cannot use Direct Cloud — use the eBioServer bridge instead"; if plain HTTP → "keep it on a trusted network or use a VPN". **No Android equivalent** — Android only prints `HTTPS on/off` in the meta line.

### 3d. Command console — no polling, no connectivity gating on Android (behavioral gap)
- PWA `:143-152, 165-205`: "Live commissioning" with per-command progress text (`progressText` — acked / failed with result code / delivered / sent), buttons **disabled until the terminal phones home** (`isLive`, `:144`), "Buttons unlock once the terminal phones home" hint; after queueing, **polls every 2.5s up to 24 tries**, shows "Still waiting — the terminal may be offline" on timeout, reloads on ack/fail.
- Android `:128-129` (`queue`, `:109-114`): fire-and-forget POST → `Alert` "Command queued…"; **buttons are always enabled even when the terminal is offline**; only the *latest* command's action/status/result-code is shown as a static line — no live progress, no polling, no ack/fail distinction beyond the status string. A user can't tell whether the terminal actually received the test command without pulling-to-refresh.

### 3e. Supervised commissioning — Android skips prerequisites (safety-relevant)
- PWA `:207-236` (`commissionBox`/`wireCommission`): enable button stays **disabled until (a) the door-test checkbox is ticked AND (b) a real punch reached RRR AND (c) a test command was acknowledged** (direct only); hint text explains exactly what unlocks it; ON state shows "✓ Automatic block/unblock is ON".
- Android `:130-137` (`commissionIntegration`, `:104-107`): only checks the door-test checkbox (`if (!confirmed) Alert…`) — **no real-punch or acked-test prerequisite**, no hint about prerequisites. The automatic door block/unblock can be enabled without the supervised commissioning steps PWA enforces. Given the PWA's explicit "Access-control safety" framing (`rrr-integrations.js:90-92`, which also has **no Android equivalent**), this is the highest-risk divergence in Part A.

### 3f. eBioServer bridge
- PWA `:238-258` (`bridgeCard`/`wireBridge`): "FALLBACK" pill, status summary, device list with **"Selected ✓" pill** vs Select buttons, commission box rendered **whenever the bridge exists**, pairing code in a code box with **Copy button + "Valid for 10 minutes — expires {time}"** + "Type it into the eBioServer Bridge on the gym PC."
- Android `:138-147`: status line, device list (Select link shown only for unselected devices — **no "Selected ✓" indicator** for the selected one), pairing via "Generate gym-PC pairing code" → code shown as plain selectable text with expiry inline — **no Copy button, no "type it into the bridge on the gym PC" instruction**. Bridge commissioning UI only renders when `bridge.status === 'connected'` (PWA shows it whenever the bridge record exists).

### 3g. Steps checklist + safety note — Android missing
- PWA `:79-89`: "Three small steps. Then RRR takes over." checklist with per-step done states (terminal registered / pointed at RRR Cloud / one real punch) + **"Review unknown punches (N) →"** link to rrr-mappings. Android has no steps checklist and no link from the integration area to identity review (the Identity Review card is further down the same screen).
- PWA `:90-92`: access-control safety note ("attendance flows as soon as the terminal connects; automatic door block/unblock switches on only after supervised commissioning…"). No Android equivalent.

---

## 4. Mappings: PWA `rrr-mappings.js` vs Android — **NO DEDICATED SCREEN (gap)**

PWA `rrr-mappings.js` (full screen):
- Groups unresolved punches **by biometric ID** — count, source, device serial, latest punch time — `:47-56`
- Member search with 300ms debounce, result-count meta ("N members match…", "Showing first 100 — search to narrow down") — `:39-44, 58-75`
- Per-group member dropdown + **"Map ID & replay"** (replays retained punches), validation "Choose the matching member first." — `:57-64, 77-99`
- Loading, error + Retry, empty state ("No unresolved biometric punches. New unknown IDs will appear here automatically.") — `:16-23, 54`

Android: only the **"Identity Review" card** in `RrrGrowthScreen.tsx:148-149` — shows **`unresolved.slice(0, 5)`**, each row "Terminal ID {id}" + punch time + "Map to member…" → `MemberPickerModal` (which does have search — `MemberPickerModal.tsx:34`). The POST mapping action itself exists (`mapIdentity`, `:117`).
**Missing on Android:** a full-screen review surface; grouping by biometric ID with punch counts/source/device; visibility beyond the first 5 unresolved (a backlog of 20 unknown IDs looks like 5); the "replay" framing; loading/error/retry states. For a gym mid-onboarding with dozens of unknown punches, the Android card is inadequate — recommend a dedicated screen or at minimum "View all".

---

## 5. Rules: PWA `rrr-rules.js` vs Android `RrrGrowthScreen.tsx` rules card

PWA `rrr-rules.js` (dedicated "Signal rules" screen):
- Back button labeled **"← Integrations"** → rrr-integrations — `:14, 17`
- "Gym thresholds" + explainer: "These thresholds control explainable opportunity detection. **No automated messages are sent from this screen.**" — `:17`
- 4 numeric inputs (expiry window / no-visit threshold / attendance decline % / recent-expiry window) with **min=1, max=365, required**, prefilled from server rules falling back to server defaults — `:6-11, 17`
- Inline save confirmation ("Thresholds saved." / error text) — `:17, 20-23`
- Loading ("Loading gym signal rules…"), error + Retry — `:14-16`

Android `RrrGrowthScreen.tsx:150` ("Signal thresholds" card at screen bottom):
- Same 4 fields, compact rows with unit labels (days / %) — `ruleFields:30`
- Save → `Alert` ("Saved" / error) — `saveRules`, `:118`
- **Gaps:** no min/max validation — clearing a field yields `Number('')` = **0**, which can be saved as a threshold (`onChangeText` → `Number(value)`, `:150`); no server-defaults fallback display; no explainer text; no loading/error states; no back-navigation context (it's inline). The missing numeric guard is the actionable item: a 0-day threshold would make the signal engine misbehave.

---

## 6. Settings: PWA `settings.js` vs Android `SettingsScreen.tsx`

### 6a. Menu order

**PWA:** Profile card (avatar, name, gym, role badge) → **Gym Management** (Gym Profile, Membership Plans, Staff, Reports, Payment Setup, Access Control) → **Communication** (WhatsApp, AI Receptionist→bot-overview, Campaigns, Inbox, Notifications) → **Account** (Subscription) → Sign Out (confirm) / Delete Account & Data.

**Android** (`SettingsScreen.tsx`): Gym Profile & Information (info rows: Email/Phone/Address/Timezone + **Edit Gym Profile** button — `:118-168`) → Memberships & Plans (Membership Plans, Promotional Campaigns) → Payments & Invoicing (UPI status row with Active/Setup-Needed pill — gym_owner only; Payment Transactions & Ledger) → WhatsApp & Automation (WhatsApp status row, AI Receptionist, **Test AI Receptionist**) → Integrations & Access (RRR Growth System & eBioServer, Staff Management — gym_owner only, Biometric Devices & Access Logs) → RRR Growth & Reports (**Revenue · Retain · Recover** *and* Operational Analytics — two entries both → `onNavigateRrr`/`onNavigateReports`) → Renewal Desk Subscription (status badge, member limit, Manage Subscription & Billing) → About (logo, Version 1.0.0, Build 5, **Privacy Policy** → `{apiBaseUrl}/privacy`) → Account Management (Delete Account & Data) → Sign Out.

### 6b. Deltas
- **Missing on Android:** **Inbox** and **Notifications** menu items (PWA Communication section, `settings.js:47-48`). Inbox *is* reachable from the PWA home header and Android home notifications bell, but there's no Settings entry on Android.
- **Android-only additions:** gym info rows + Edit Gym Profile, UPI setup status pill, Payment Transactions & Ledger, Test AI Receptionist, Promotional Campaigns (≈ PWA's Campaigns), RRR entries, subscription status/member-limit detail, About + Privacy Policy.
- **Behavioral:** Android **Sign Out has no confirmation dialog** (`SettingsScreen.tsx:75-78` → `handleLogout` directly); PWA asks "Are you sure you want to sign out?" (`settings.js:69-72`). Delete flow matches on both (destructive confirm); Android additionally surfaces an error alert if deletion fails (`:60-73`), PWA logs out regardless (`settings.js:74-81`).
- Role gating is consistent (payment setup / staff entries gym_owner-only on both).

---

## 7. Auth: PWA `login.js`/`signup.js` vs Android `LoginScreen.tsx`/`SignupScreen.tsx`

### 7a. Login — fields/flows match; Android adds Google + stricter button state
- Same: branding (logo, "Renewal Desk", "Your gym management command center"), "Sign in" card, Email + Password fields, inline error banner, required-field validation with the same message ("Email and password are required."), error cleared on typing, loading state on submit, signup link, member-login link.
- **Android-only:** **Google Sign-In** (`GoogleAuthButton`, `LoginScreen.tsx:117-135`) — PWA has none; Sign-In button **disabled until both fields are non-empty** (`:110`) vs PWA validates on submit; footer "Secure login · Data encrypted in transit".
- **Member login differs:** PWA → `window.location.href = '/vynla'` ("I'm a gym member → Open VYNLA", `login.js:96`); Android → in-app `onNavigateMemberLogin` ("Gym Member? Sign in with WhatsApp OTP →", `:138-149`).
- PWA shows "Welcome back!" toast on success (`login.js:73`); Android just calls `onLogin()`.

### 7b. Signup — Android is a 2-step wizard with strict policy; PWA is a single loose form
- **PWA** `signup.js`: one form — Full Name, Email, Phone, Password (placeholder "Min 6 characters", **no enforced policy in the screen**), Gym Name, Country **dropdown** (India/UAE/US/UK/Australia); single "Create Account" submit; "Account created!" toast.
- **Android** `SignupScreen.tsx`: **Step 1** Owner Account (name/email/phone/password) → **Step 2** Gym Information (gym name, **country chips** with currency), with step indicator, back button, and "Start 7-Day Trial" CTA:
  - Password policy enforced client-side: **min 12 chars + upper + lower + number + symbol** (`:53-61`) — much stricter than PWA's unenforced "min 6".
  - Email format check (`:48-51`); email lowercased before submit (`:81`).
  - Phone field prefixed with the selected country's dial code (+91 default); non-digits stripped (`:79`).
  - Sends `currency` + `timezone` per country to the signup API (`:78-87`) — PWA sends only the country name.
  - **Google sign-up** option on step 1 (`:157-178`).
  - "7 days free • No credit card required…" info box (`:200-206`).
- Net: Android signup is the stricter, more complete flow. If the backend enforces the 12-char policy, PWA signups with 6–11 char passwords would fail server-side with only the API error message — worth checking backend validation alignment.

---

## Priority-ordered gaps for production

1. **Commissioning prerequisites skipped on Android** (§3e) — automatic door block/unblock can be enabled without the real-punch + acked-test gates PWA enforces. Safety-relevant; align before any gym goes live with access control.
2. **No opportunity lifecycle on Android** (§2) — "Close as recovered" + recovered-revenue capture and "Dismiss" are PWA-only; Android can only mark actioned (and only 2 per pillar inline).
3. **No full mappings screen on Android** (§4) — identity review capped at 5 rows; onboarding gyms with real punch backlogs can't work through them.
4. **Command console: no polling / no connectivity gating** (§3d) — test commands are fire-and-forget on Android; users can't confirm the terminal received them.
5. **Rules inputs accept 0** (§5) — no min/max validation on Android signal thresholds.
6. **PWA renders Owner-Today + setup checklist twice** (§1c) — PWA-side bug, quick fix.
7. **Android `RrrGrowthScreen` has no loading/error states** (§1b) — failed loads silently show zeros.
8. **Settings: Inbox + Notifications entries missing on Android; Sign-Out lacks confirm** (§6b).
9. Copy buttons / HTTPS guidance / "haven't heard from terminal" checklist / pairing-code instructions missing on Android integrations (§3b, §3c, §3f) — onboarding-friction items.
10. Signup password-policy mismatch between clients (§7b) — confirm backend is the source of truth and both clients surface its errors.
