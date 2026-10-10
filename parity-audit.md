# Renewal Desk — PWA vs Android Parity & Owner UX Audit

**Date:** 2026-10-10
**Scope:** PWA (`renewal-desk-pwa/src/`) vs Android Expo app (`renewal-desk-android/src/`), branch `main` (post owner-ux-overhaul + polish round 2)
**Trigger:** Owner reports "More [tab] not working and options not working" on PWA; wants owner-perspective UX review and PWA↔Android parity.
**Method:** Static code trace of navigation chains, screen mounts, event bindings, route registrations; feature inventory of both `screens/` dirs; journey walkthrough of core owner flows.

---

## 1. Investigation: PWA "More" tab → "Options" screen

### 1.1 The full tap chain (verified working in code)

| Step | Location | Status |
|---|---|---|
| Tab bar renders More button | `components.js:123` `{ id: 'more', label: 'More', icon: 'menu' }` | ✅ |
| Tab click → `switchTab('more')` | `app.js:143-149` (guard: `tabId !== activeTab`) | ✅ |
| `TAB_CONFIG.more` → screen `'settings'` | `app.js:25` | ✅ |
| `router.switchTab('more', 'settings', {})` → `push('settings')` | `router.js:197-230` | ✅ |
| `'settings'` route registered | `app.js:45` `router.register('settings', () => import('./screens/settings.js'), { auth: true })` | ✅ |
| `dist/` chunk exists | `dist/assets/settings-DSS1-pbC.js` | ✅ |
| `settings.js` mount: all imports resolve (`getCachedSession`, `logout`, `renderMenuItem`, `renderBadge`, icons) | `api.js:32`, `api.js:218`, `components.js:148,271` | ✅ |
| Mount is fully synchronous rendering — no API call can fail mid-mount | `settings.js:9-75` | ✅ |
| Menu items render `data-action` | `components.js:273` | ✅ |
| Click binding: `querySelectorAll('[data-action]')` → `navigate.push(...)` | `settings.js:79-83` | ✅ |
| Every `onClick` target is a registered route (gym-profile, plans, staff, reports, payment-setup, access, whatsapp, bot-overview, campaigns, inbox, notifications, subscription) | verified via grep against `app.js` | ✅ (12/12) |
| `bindHeaderEvents` cannot throw before menu binding (optional chaining, guards) | `components.js:98-114` | ✅ |
| `node --check` clean on settings.js, gym-profile.js, app.js, router.js, components.js | — | ✅ |
| `.menu-item` CSS: `cursor:pointer`, `:active` state | `styles/components.css:983-995` | ✅ |

### 1.2 Verdict: no code defect found in the More → Options chain

The entire path — tab tap, route resolution, module load, mount, menu-item event binding, per-option navigation — is correct as written. There is **no dead handler, no missing route, no throwing import, no unbound button** in the current `main`.

**Most likely cause: stale service-worker-cached PWA on the owner's phone.** The PWA uses Workbox precaching (`dist/sw.js`, `dist/workbox-e4022e15.js`); the More tab only shipped ~1h before the complaint. If the phone holds the previous bundle, there is no More tab at all ("More not working"), or the old Options screen without the new destinations ("options not working").

**Secondary possibility:** the complaint describes behavior from *before* the overhaul merge (when Settings truly was unreachable on mobile — prior audit §1.1).

### 1.3 Real label inconsistency found (P2)

The tab is labeled **"More"** but the screen header reads **"Options"** (`settings.js:11` `renderHeader({ title: 'Options' ... })`). An owner tapping "More" and landing on "Options" may feel lost or think it's the wrong screen. Recommend renaming the header to "More" or "Settings".

### 1.4 Recommended verification (not code)

1. On the owner's phone: hard-refresh the PWA (or remove + re-add to home screen) to force the new service worker.
2. Confirm the tab bar shows **Home / Members / Payments / Renewals / More** (new taxonomy). If it shows Dashboard/Revenue/Retain/Recover, the phone is on the stale bundle — that alone explains the report.
3. If the new tab bar IS showing and More still does nothing, capture the on-device JS console (Safari → Develop → phone) — a runtime import failure would surface there.

---

## 2. Feature Parity Matrix

Legend: ✅ exists & works · ⚠️ exists with defects · ❌ missing · ➖ not applicable

| # | Owner capability | PWA | Android | Notes |
|---|---|---|---|---|
| 1 | Dashboard / home | ✅ | ✅ | Different designs; both functional. PWA KPIs now all tappable. |
| 2 | Members list (search, filter, paginate) | ✅ | ✅ | PWA expiring filter now server-side. |
| 3 | Add member | ✅ | ✅ | |
| 4 | Edit member | ✅ | ✅ | |
| 5 | Member detail (profile, status, financials) | ✅ | ✅ | |
| 6 | Renew membership | ✅ | ✅ | **Gap:** Android has explicit price-agreement checkbox (`RenewMemberScreen.tsx:459`); PWA submits with no confirmation (`renew-member.js:31-33`). |
| 7 | Fast renewal (quick renew) | ❌ | ✅ | `FastRenewalScreen.tsx` exists on Android only. PWA renewal always goes through the full form. |
| 8 | Record payment | ✅ | ✅ | |
| 9 | Payment verify / reject / delete | ✅ | ✅ | |
| 10 | Payment setup (UPI ID + QR) | ✅ | ✅ | |
| 11 | Block / unblock biometric access (per member) | ✅ | ✅ | Both added in overhaul; both call `POST /rrr/members/{id}/access`. |
| 12 | Biometric enroll / unenroll number | ✅ | ✅ | PWA uses new `showPrompt` modal; Android native. |
| 13 | Pause / resume (freeze) membership | ✅ | ✅ | |
| 14 | Deactivate member | ✅ | ✅ | |
| 15 | Check-in / check-out (manual attendance) | ✅ | ✅ | |
| 16 | Live access feed + inside-now | ✅ | ✅ | |
| 17 | WhatsApp connection status | ✅ | ✅ | |
| 18 | WhatsApp connect / setup flow | ✅ (`whatsapp-setup.js` → embedded signup) | ✅ (`WhatsAppSetupScreen.tsx`) | |
| 19 | WhatsApp reminders log | ✅ | ✅ | |
| 20 | Broadcast / campaigns create | ✅ | ✅ | |
| 21 | Campaign detail (read-only) | ✅ | ✅ | Neither has duplicate/resend. |
| 22 | AI Receptionist overview + setup + test | ✅ | ✅ | |
| 23 | Bot conversations / leads + detail | ✅ | ✅ | |
| 24 | Inbox (tappable, deep-linked) | ✅ | ✅ | |
| 25 | Notifications (tappable, deep-linked) | ✅ | ✅ | |
| 26 | Membership plans CRUD | ✅ | ✅ | |
| 27 | Staff management | ✅ | ✅ | |
| 28 | Gym profile edit | ✅ (`gym-profile.js`) | ✅ (`EditGymProfileScreen.tsx`) | |
| 29 | Reports | ⚠️ (read-only KPIs, no date range) | ⚠️ (KPIs only, no revenue-by-plan) | **Parity: both thin.** Neither answers "which plan makes money". |
| 30 | Subscription view | ✅ | ✅ | Both read-only; no upgrade CTA on either. |
| 31 | CSV member import | ✅ (linked from Members header) | ✅ (`ImportMembersScreen` + `MemberImportScreen`) | |
| 32 | AI register scan + review | ✅ | ✅ | |
| 33 | Device provisioning (Direct Cloud ADMS) | ✅ (`rrr-integrations.js`) | ✅ (`RrrGrowthScreen.tsx`, now reads `terminal_settings`) | |
| 34 | Commissioning console (probe/block-test) | ✅ | ✅ | |
| 35 | Identity mapping (unmapped punches) | ✅ (`rrr-mappings.js`) | ✅ (member picker modal added) | |
| 36 | Signal / automation rules | ✅ (`rrr-rules.js`) | ⚠️ | Android rules live inside `RrrGrowthScreen`; check whether full rule CRUD is exposed. |
| 37 | Daily collections + cash close | ✅ (`owner-finance.js`) | ⚠️ | Android has cash close inside `RrrGrowthScreen`; no standalone daily-collections screen found. Verify method breakdown exists. |
| 38 | Owner leads / trial pipeline | ✅ (`owner-leads.js`) | ❌ | **Gap:** no owner-lead (trial booking) pipeline screen found on Android — only *bot* leads (`BotLeadsScreen`). PWA's `owner-leads.js` (lead stages, trial booking, follow-ups) has no Android equivalent. |
| 39 | Opportunities list (RRR pillars) | ✅ (`rrr-list.js`) | ⚠️ | Android surfaces opportunities on Dashboard; verify a dedicated list exists. |
| 40 | New-gym setup checklist | ✅ (dashboard, 5 steps) | ✅ (`OnboardingChecklistCard` on Dashboard) | Different implementations; both present. |
| 41 | Settings hub | ✅ (More tab → Options) | ✅ (More tab → Settings) | |
| 42 | Sign out / delete account | ✅ | ✅ | |

### Parity gaps ranked

**P1-A — Owner leads / trial pipeline missing on Android.** PWA `owner-leads.js` is a full pipeline (stages, trial booking, follow-up dates, lost reasons). Android has no equivalent screen; `BotLeadsScreen` covers only AI-receptionist leads. An owner running trials from the Android app has nowhere to track them.

**P1-B — Renew confirmation asymmetry.** Android requires ticking "I confirm the commercial price … is approved" (`RenewMemberScreen.tsx:459`); PWA's renew form submits immediately on button press (`renew-member.js:31`). Money-affecting action with no confirmation on PWA — either add the checkbox to PWA or confirm this is intentional.

**P1-C — Fast renewal Android-only.** `FastRenewalScreen.tsx` (quick renew path) has no PWA counterpart. If owners use it, PWA renewals feel slow by comparison.

**P2 — Daily collections depth.** PWA `owner-finance.js` (method breakdown, cash-close with variance) vs Android's cash-close embedded in `RrrGrowthScreen`. Verify Android shows the same numbers; if not, it's a reporting gap.

**P2 — RRR rules / opportunities discoverability.** PWA has dedicated `rrr-rules.js` / `rrr-list.js`; on Android these live inside `RrrGrowthScreen`/Dashboard. Functionally present but harder to find — matches the "flat link farm" critique from the prior audit.

---

## 3. Owner Journey Review (both apps)

### Journey 1: New gym setup (signup → ready to operate)
- **PWA:** ✅ Good. Dashboard setup checklist (plans → members → WhatsApp → payments → device), each step deep-links to the right screen. WhatsApp setup drives Meta embedded signup. Device provisioning shows copyable terminal values.
- **Android:** ⚠️ `OnboardingChecklistCard` exists but items route to generic screens, not a guided stepper (prior audit §1). Device setup values now correct (fixed), but pairing still lives only in the RRR screen — Access tab's "device offline" state has no "connect device" CTA (prior audit P2-11, still open).
- **Friction:** Neither app explains *order of operations* strongly (e.g., "add plans before members"). PWA checklist implies order visually; Android less so.

### Journey 2: Add member → record payment
- **Both:** ✅ Solid. PWA: add-member → plan auto-fill → paid/unpaid toggle. Android: same. Record-payment member search works on both. PWA has idempotency key + WhatsApp receipt share — verify Android receipt share exists (`RenewMemberScreen.tsx:230` shows a WhatsApp confirmation element; confirm it sends).

### Journey 3: Renew an expiring member
- **PWA:** Renewals tab → per-row Renew → full form → **no confirmation** → submits. Expiring filter now server-side (fixed).
- **Android:** Renewals tab → per-row renew icon → RenewMember with **price-agreement checkbox** → submits. Dashboard upcoming-renewals Renew now opens the member directly (fixed).
- **Friction (PWA):** missing confirmation (P1-B above). **Friction (both):** no bulk "remind all expiring" action — owner must tap each row (prior audit P1-6, still open on both).

### Journey 4: Block a member's access
- **Both:** ✅ Now present on member detail with confirm dialog → `POST /rrr/members/{id}/access` → queued-command feedback; 409 surfaced when device not commissioned.
- **Friction (both):** blocked state is optimistic client-side; reopening the member may show "Block" again even though a block is queued. No server-side "currently blocked" read exists (known caveat from fix summary). Owner could double-queue blocks.

### Journey 5: Send a WhatsApp reminder
- **PWA:** Member detail → "Send WhatsApp Reminder" → works. WhatsApp screen → Broadcast/Campaigns when connected; Connect CTA when not.
- **Android:** Same, plus reminder rows now navigate to the member (fixed).
- **Friction (both):** if WhatsApp is disconnected mid-journey, the reminder send fails with an error toast — no inline "reconnect" affordance on the failure. Minor.

### Cross-cutting friction notes
1. **Back-button contract still inconsistent (PWA):** `settings.js` passes `showBack: true` unconditionally; tab-root back with empty stack falls to `window.history.back()` (prior audit §4.7, still open). From the More tab root, tapping back can exit the PWA.
2. **"Options" vs "More" label mismatch** (§1.3 above).
3. **Android `MenuItem`/`QuickAction` still render tappable UI with undefined `onPress`** (prior audit defects 12–13; fix summary does not mention them — verify).
4. **Android nested touchables in Settings subscription card** (prior audit defect 10; not mentioned in fix summary — verify).

---

## 4. Prioritized Findings

### P0 — Broken (needs owner/device verification, not code fixes)
1. **"More tab / options not working" report — no code defect found.** Full chain traced and verified (§1.1). Likely stale service-worker cache on the owner's phone. **Action:** hard-refresh / re-add PWA on his device and confirm the tab bar reads Home/Members/Payments/Renewals/More. If the new taxonomy shows and More still fails, capture the on-device JS console.

### P1 — Missing parity / money-flow asymmetry
2. **Owner leads / trial pipeline has no Android screen** (matrix #38). PWA-only capability; Android owners can't track trial bookings.
3. **PWA renew has no price confirmation; Android does** (matrix #6). Align the two — recommended: add the agreement checkbox to PWA `renew-member.js`.
4. **Fast renewal is Android-only** (matrix #7). Decide: port to PWA or remove from Android to keep one renew mental model.

### P2 — Polish / consistency
5. **Rename PWA "Options" header** to "More" (or "Settings") to match the tab label (§1.3).
6. **Unify PWA tab-root back behavior** — `settings.js` unconditional `showBack: true` can exit the app from the More tab root (journey note 1).
7. **Verify Android leftovers from prior audit:** `MenuItem`/`QuickAction` undefined-`onPress` rendering (defects 12–13), subscription nested touchables (defect 10), Access-tab "connect device" CTA (P2-11). The fix summary doesn't claim these; confirm before closing.
8. **Block/unblock optimistic state** — both apps can show "Block" after a block is already queued. Consider polling command status or a server "blocked" read (backend work).
9. **Bulk "remind all expiring"** — still missing on both apps (both backlogs).
10. **Reports depth** — both apps thin (KPIs only). Shared backlog item, not a parity gap.

---

## Appendix — Files examined

- PWA: `src/app.js` (TAB_CONFIG, switchTab, navigate, showMainApp), `src/router.js` (push/switchTab), `src/components.js` (renderTabBar, renderMenuItem, bindHeaderEvents, renderHeader), `src/screens/settings.js`, `src/screens/gym-profile.js`, `src/screens/member-detail.js`, `src/screens/renew-member.js`, `src/styles/components.css` (`.menu-item`, tab bar)
- Android: `src/screens/` inventory (43 files), `App.tsx` (route registration), `MemberDetailScreen.tsx` (block/unblock), `RenewMemberScreen.tsx` (agreement checkbox), `DashboardScreen.tsx`, `RrrGrowthScreen.tsx`
- Prior: `pwa-ux-audit.md`, `android-ux-audit.md`, `android-fix-summary.md`
- `dist/` chunk inventory for settings screen
