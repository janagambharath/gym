# Android UX Audit — Owner Perspective

**Date:** 2026-10-10
**Auditor:** Subagent (static code review, owner-persona)
**Scope:** `renewal-desk-android/` (Expo React Native, owner app)
**Method:** Read App.tsx (1496 lines, full navigation), all key screens, theme, components. Judged each screen by: can an owner COMPLETE the core job? Are primary actions visible buttons? Dead ends? Is setup guided?

**Verdict up front:** The app is ~85% complete and the core money flows (add member → record payment → verify → renew) work. But the owner's complaint is valid: there are **real dead buttons** (taps that do nothing), a **wrong device-setup path** that would break terminal onboarding, and **missing owner capabilities** (block/unblock, edit gym profile). The bugs cluster in one architectural root cause (see §1).

---

## 1. Navigation & Information Architecture

**Structure (owner tabs):** Dashboard · Members · Access · Renewals · Payments · More

Each tab owns a native stack; key screens (`MemberDetail`, `RenewMember`, `RecordPayment`, `EditMember`) are **duplicated across 3–4 stacks** with hand-wired callback props. This is the root cause of most dead-button bugs: the same screen renders with different callbacks per stack, and two stacks pass **no-op callbacks** (`App.tsx:427`, `App.tsx:877-879`).

**What's good:**
- Tab labels match owner mental model (Dashboard/Members/Access/Renewals/Payments/More).
- Deep stacks preserve back navigation; per-tab stacks don't clobber each other.
- Push-notification deep links wired for conversations, leads, payments, renewals, inbox, campaigns (`App.tsx:1255-1300`).
- All `navigate('X')` targets resolve to registered screens — no orphan routes.

**What's wrong:**
- **Same screen, different behavior per tab.** `MemberDetail` from Members tab = fully working. From Access tab = Renew/Edit/Record-Payment buttons dead. An owner can't predict what a button will do.
- **Settings is a flat link farm.** 12 destinations under "More" with no grouping by setup-vs-daily-use. First-run setup (device pairing, WhatsApp, UPI) is buried at the same level as Privacy Policy.
- **No guided first-run flow.** `OnboardingChecklistCard` exists on Dashboard (good), but tapping items routes to generic screens, not a stepper.

---

## 2. Screen-by-Screen Verdicts

### Dashboard (`DashboardScreen.tsx`, 1751 lines) — ✅ COMPLETE, 1 defect
Rich owner home: greeting, first-action hero for empty gyms, onboarding checklist, RRR integration card, handover alerts, revenue hero, today's actions, live access, leads, attention tiles, upcoming renewals, recent payments, quick actions (Add Member / Renew / Payment / WhatsApp).

**Defect:** Upcoming Renewals per-row "Renew" button (`DashboardScreen.tsx:743-744`) calls `onNavigateRenewals` — it dumps the owner on the renewals **list** instead of opening Renew for **that member**. The owner must find the member again. Should call `onNavigateMemberDetail`-style renew with the member.

### Members (`MembersScreen.tsx`) — ✅ COMPLETE
Search, status filters, pagination, "Add Member" header button, empty-state CTA. Fine.

### Member Detail (`MemberDetailScreen.tsx`, 1213 lines) — ⚠️ COMPLETE except from Access tab
Profile, membership card, days-remaining bar, financial summary, activity, biometric enroll/unenroll, check-in/out, **Renew Membership button**, WhatsApp reminder, Record Payment, Edit, Pause/Resume, Deactivate (owner-only). This is the best-built screen in the app.

**Defects:**
1. **From the Access tab, Renew/Edit/Record-Payment are dead** (`App.tsx:877-879` passes `() => {}`). The "Renew Membership" button renders but does nothing; Record Payment and Edit render disabled. This is almost certainly what the owner hit.
2. **"Renew Membership" is `variant="outline"`** (line ~505) — the single most important money button on the screen is visually weaker than "Check In Member". Should be `variant="primary"`.
3. **Activity rows are fake affordances** (lines ~420-460): "Renewal History", "Payment History", "WhatsApp Reminders", "Access & Attendance" show forward chevrons/icons but are plain `View`s — not tappable. Either wire them or remove the chevrons.

### Renewals (`RenewalsScreen.tsx`) — ✅ COMPLETE
Sectioned (Today / 7 days / Expired), per-row renew icon correctly opens `RenewMember` for that member. Good.

### Renew Member (`RenewMemberScreen.tsx`, 1072 lines) — ✅ COMPLETE
Plan picker, discount shortcuts, online/offline channel, agreement checkbox, WhatsApp receipt. Full flow.

### Payments (`PaymentsScreen.tsx`, 822 lines) — ✅ COMPLETE
List + status/channel filters, summary header, **"+" header button** to record payment, inline verify/reject, detail with delete. Good.

### Access (`AccessScreen.tsx`, 1177 lines) — ⚠️ FEED WORKS, SETUP MISSING
Live event feed with filters (all/inside/entry/exit/denied), inside-now list, device online indicator, manual check-in modal, pull-to-refresh + polling. Solid operations screen.

**Missing:** No device pairing, no integration status management, no block/unblock. An owner who hasn't set up a terminal gets "Access device may be offline" with **no button to fix it**. Device setup lives only in the RRR screen (which shows the wrong path — see below).

### RRR Growth (`RrrGrowthScreen.tsx`, 147 lines) — ❌ FUNCTIONAL BUT BUGGY
Has Direct Cloud provisioning, commissioning console (probe/block-test/unblock-test), eBioServer pairing, identity review, rules, cash close. But:

1. **Wrong ADMS path shown** (line 120): hardcodes `Path /iclock`. Backend now uses per-device tokenized paths `/iclock/<token>` (`adms_terminal_settings`). The provision response **returns** `terminal_settings` with the real path and the screen ignores it. Owner types `/iclock` into the terminal → terminal never connects.
2. **Hardcoded host** `gym-production-910c.up.railway.app` (lines 80, 120) — breaks on any other deploy/env.
3. **Identity review maps to the wrong member** (line 122): every unresolved punch shows "Map to {people[0].full_name}" — it assigns the punch to the **first member in the list**, with no member picker. Data-corruption-grade UX bug.
4. **Back button lies**: says "‹ Settings" but the screen is also reachable from Dashboard (`onNavigateRrr`).
5. Whole screen is single-line JSX blobs — unmaintainable, but that's a code-quality note.

### WhatsApp (`WhatsAppScreen.tsx`, 1028 lines) — ⚠️ MOSTLY COMPLETE, 1 dead tap
Connection status card with checklist, onboarding modal, reminders log with filters + today counters, broadcast with audience counts + presets, AI leads with reply modal. Good.

**Defect:** Reminder rows call `onNavigateMemberDetail?.(item.member_id)` but **neither stack passes the prop** (`App.tsx` DashboardStackScreen ~line 425 and MoreStackScreen render `<WhatsAppScreen onBack={...} />` only). Tapping a reminder row does nothing.

### AI Receptionist (`BotOverviewScreen.tsx` etc.) — ⚠️ 3 DEAD BUTTONS from Dashboard tab
`BotOverviewScreen.tsx:281,290,304` — "Human Handover" card, "Edit Settings" header action, and "Customize AI Settings" button all call `onOpenSetup`, which is `() => {}` when reached from the Dashboard tab (`App.tsx:427`). From More tab it's wired correctly. Conversations/leads/detail/test/setup screens themselves are complete.

### Settings (`SettingsScreen.tsx`, 516 lines) — ✅ ORGANIZED, minor issues
Gym profile, plans, campaigns, UPI setup row with status pill, WhatsApp status row, bot, RRR, staff (owner-only), access, reports, subscription card, about, delete account, sign out. Best-organized hub.

**Issues:**
- Gym profile is **read-only** — email/phone/address/timezone displayed but not editable anywhere in the app. Missing capability.
- `MenuItem` doesn't handle undefined `onPress` — renders a tappable-looking row that does nothing if a callback is missing.
- Subscription card is a `TouchableOpacity` wrapping a nested `MenuItem` TouchableOpacity — nested taps, both fire.

### Staff (`StaffScreen.tsx`) — ✅ COMPLETE
Roster, add-staff modal with role picker, create flow. Works.

### Payment Setup (`PaymentSetupScreen.tsx`) — ✅ COMPLETE
UPI ID, QR upload, preview, active toggle, save. The critical "get paid" setup is done well.

### Subscription (`SubscriptionScreen.tsx`) — ✅ EXISTS
Plan display, status. (Didn't deep-read; endpoint audit shows it resolves.)

### Reports (`ReportsScreen.tsx`, 187 lines) — ⚠️ THIN
Period switcher + summary KPIs only. No per-member, no revenue-by-plan, no export. Acceptable v1, but an owner can't answer "which plan makes me money."

### Login (`LoginScreen.tsx`) — ✅ FINE
Email/password + Google, validation, error banner, member-login switch. Fine.

---

## 3. Missing Owner Capabilities (prioritized)

| # | Capability | Status | Notes |
|---|-----------|--------|-------|
| 1 | **Block / unblock a member's biometric access** | ❌ MISSING | Only *test* block/unblock exists in RRR commissioning console. No per-member block/unblock anywhere. Owner asked about this explicitly. Backend supports it (`DATA UPDATE USERINFO Pri=1/0` via ADMS). |
| 2 | **Correct terminal setup values in-app** | ❌ BROKEN | RRR screen shows hardcoded `/iclock` path; real path is tokenized. Owner following the screen will fail to connect the terminal. |
| 3 | **Identity mapping with member picker** | ❌ BROKEN | "Map to {first member}" assigns punches to the wrong person. Needs a searchable member picker. |
| 4 | **Edit gym profile** (name, phone, address, timezone) | ❌ MISSING | Read-only everywhere. |
| 5 | **Device management from Access tab** | ❌ MISSING | Access tab shows "device offline" with no setup CTA. Pairing lives only in RRR screen. |
| 6 | **Per-member block/unblock from Member Detail** | ❌ MISSING | Natural home for it (next to Pause/Resume). |
| 7 | **Revenue-by-plan / member reports** | ⚠️ THIN | Reports screen is KPIs only. |
| 8 | **WhatsApp template management** | ❌ MISSING | Reminders reference templates; no screen to view/edit them. |
| 9 | **Notification preferences** | ❌ MISSING | No per-event toggles (handover alerts, payment alerts, expiry alerts). |
| 10 | **Bulk actions on members** (bulk renew reminders, bulk status change) | ❌ MISSING | |

---

## 4. Specific UX Defects (file:line)

1. **`App.tsx:877-879`** — `AccessStackScreen` renders `MemberDetailScreen` with `onRenew={() => {}}`, `onEdit={() => {}}`, `onRecordPayment={() => {}}`. From Access tab: Renew button dead, Record Payment + Edit disabled. **This is the "renew button does nothing" bug.**
2. **`App.tsx:427`** — `DashboardStackScreen` renders `BotOverviewScreen` with `onOpenSetup={() => {}}`. Three setup buttons dead from Dashboard tab (`BotOverviewScreen.tsx:281,290,304`).
3. **`DashboardScreen.tsx:743-744`** — Upcoming Renewals "Renew" button navigates to renewals list instead of renewing that member. Should navigate to `RenewMember` with the member.
4. **`RrrGrowthScreen.tsx:120`** — Shows `Path /iclock`; backend issues tokenized `/iclock/<token>`. Provision response's `terminal_settings` is ignored. Terminal onboarding will fail.
5. **`RrrGrowthScreen.tsx:80`** — Success alert hardcodes `gym-production-910c.up.railway.app`. Should use `terminal_settings.server_address` from the provision response.
6. **`RrrGrowthScreen.tsx:122`** — Identity review "Map to {people[0].full_name}" maps every punch to the first member. Needs member picker.
7. **`App.tsx` (DashboardStackScreen ~425, MoreStackScreen)** — `<WhatsAppScreen onBack={...} />` never passes `onNavigateMemberDetail`; reminder row taps are no-ops.
8. **`MemberDetailScreen.tsx:~420-460`** — Activity rows ("Renewal History", "Payment History") show chevrons but aren't touchable. Remove chevrons or wire navigation.
9. **`MemberDetailScreen.tsx:~505`** — "Renew Membership" uses `variant="outline"`. The primary money action should be `variant="primary"` (filled).
10. **`SettingsScreen.tsx:~250`** — Subscription card `TouchableOpacity` wraps nested `MenuItem` touchable; both fire on tap.
11. **`RrrGrowthScreen.tsx:114`** — Back button labeled "‹ Settings" when reached from Dashboard via `onNavigateRrr`.
12. **`DashboardScreen.tsx` `QuickAction`** — no `disabled` handling; renders tappable UI when `onPress` is undefined.
13. **`SettingsScreen.tsx` `MenuItem`** — same: tappable-looking row with optional `onPress`, no disabled state.

---

## 5. Recommended Fix List (ordered by owner impact)

### P0 — broken money or broken onboarding
1. **Fix RRR terminal setup values** (`RrrGrowthScreen.tsx:80,120`): read `terminal_settings` (server, port, path with token) from the `/adms/provision` response and display them; stop hardcoding host and `/iclock`. Without this, no owner can onboard a Direct-Cloud terminal from the app.
2. **Fix Access-tab MemberDetail dead buttons** (`App.tsx:877-879`): wire real `onRenew`/`onEdit`/`onRecordPayment` (navigate within Access stack — add `RenewMember`, `EditMember`, `RecordPayment` routes to `AccessStackParamList`, mirroring other stacks).
3. **Fix identity-review member picker** (`RrrGrowthScreen.tsx:122`): replace "Map to {first member}" with a searchable member picker modal before calling the map endpoint.
4. **Wire BotOverview setup from Dashboard tab** (`App.tsx:427`): pass `onOpenSetup={() => props.navigation.navigate('BotSetup')}`.

### P1 — owner daily-job friction
5. **Add per-member block/unblock** on `MemberDetailScreen` (new "Block Access"/"Unblock Access" button calling the ADMS command endpoint; show current state). This is the #1 asked-for capability.
6. **Dashboard Upcoming Renewals "Renew"** (`DashboardScreen.tsx:743-744`): open `RenewMember` for that member directly.
7. **Promote "Renew Membership" to primary** (`MemberDetailScreen.tsx:~505`): `variant="primary"`.
8. **Wire WhatsApp reminder → member** (pass `onNavigateMemberDetail` in both stacks) or remove the tap affordance.
9. **Fix Activity row affordances** (`MemberDetailScreen.tsx`): make Renewal/Payment history rows navigate to filtered lists, or drop the chevrons.

### P2 — setup & settings completeness
10. **Add Edit Gym Profile** (new screen or modal from Settings; `PATCH` gym endpoint — verify backend supports it, else add).
11. **Access-tab empty/error state CTA**: when no device is connected, show "Connect biometric device" button routing to RRR Direct Cloud setup.
12. **Fix nested touchables** in Settings subscription card; add `disabled` handling to `MenuItem` and `QuickAction`.
13. **Fix RRR back-button label** (pass a `title`/origin prop or use navigation header).

### P3 — nice to have
14. Flesh out Reports (revenue by plan, top members, export).
15. WhatsApp template viewer.
16. Notification preferences screen.
17. Standardize `MemberDetail`/`RenewMember`/`RecordPayment`/`EditMember` route registration into a shared stack fragment to prevent future callback drift (the architectural root cause of bugs #2 and #4).

---

## Appendix: What the owner got right

The complaint "no buttons, many things missing" maps to real defects, not taste: **5+ taps in the app literally do nothing** (Access-tab member actions, Dashboard-tab bot setup ×3, WhatsApp reminder rows), the **terminal setup screen shows the wrong server path**, and **block/unblock doesn't exist** outside a test console. The core transactional flows (add → pay → verify → renew) are genuinely solid — the app isn't a mess, it's a good app with landmines on secondary paths. Fix the P0 list and the "shitty" feeling mostly disappears.
