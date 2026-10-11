# Core First-Run Operations Review — PWA vs Android

Code review only (no servers run). Repo: `~/workspace/renewal-desk`.
Scope: brand-new gym, zero data. Screens: Plans → Add Member → Record Payment → Renewals → Payments → Dashboard (zero members) → Member import.

Severity: **blocker** = breaks the flow or crashes | **major** = wrong data, silent failure, or significant UX gap | **minor** = polish/edge case.

---

## Blockers

### 1. PWA Payments search crashes — `load()` is not defined
- **File:** `renewal-desk-pwa/src/screens/payments.js:32`
- The search input's debounced handler calls `load()`, but the loader function is named `loadPayments` (defined at line 41, invoked correctly at line 94). `load` is undefined → `ReferenceError` the moment a user types in the Payments search box. The screen renders fine until then; any search attempt throws.
- Android PaymentsScreen search works (debounced `handleSearch` → state-driven refetch).
- **Fix:** change `load()` → `loadPayments()` at line 32.

### 2. PWA Add Member — `icon` / `escapeHtml` used but never imported
- **File:** `renewal-desk-pwa/src/screens/add-member.js:71` (imports at lines 3–5)
- The duplicate-phone warning branch (inside the 600 ms debounced callback) calls `icon('warning', 18)` and `escapeHtml(...)`. Neither is imported (`icon` comes from `../icons.js`, `escapeHtml` from `../utils.js`). The form itself works, but the instant a genuinely duplicate phone is typed, the callback throws `ReferenceError` — so the duplicate-detection feature crashes instead of warning.
- Android AddMemberScreen has the same debounced duplicate check (`AddMemberScreen.tsx:61-79`) and imports everything correctly — works.
- **Fix:** add `import { icon } from '../icons.js';` and `escapeHtml` to the utils import in `add-member.js`.

### 3. PWA RRR Dashboard renders OWNER TODAY and "Get set up" twice
- **File:** `renewal-desk-pwa/src/screens/rrr-dashboard.js:51-54`
- Template has `${today ? ownerToday(today) : ''}` then `${setupChecklist(data)}` — then the same two lines repeated immediately after. On a brand-new gym the "Get set up" checklist (plans / members / WhatsApp / UPI / biometric) and the OWNER TODAY queue both appear twice on the page.
- Android DashboardScreen has no such duplication; its onboarding checklist (`OnboardingChecklistCard`) and First-Action Hero render once.
- **Fix:** delete the duplicated lines (keep one copy each).

---

## Majors

### 4. Adding a member with no plans creates a 0-day membership (PWA) vs 30-day (Android) — parity gap
- **Files:** `renewal-desk-pwa/src/screens/add-member.js:100-107`; `renewal-desk-android/src/screens/AddMemberScreen.tsx:160-164`
- PWA: `planId` is null when no plans exist, so `endDate` stays equal to `startDate` → membership starts and ends **today**. The new member lands as instantly-expired/expiring rather than Active.
- Android: falls back to `selectedPlan?.duration_days ?? 30`, so the member gets today + 30 days and shows Active.
- Brand-new gym that adds a member before creating a plan gets different (and PWA-side wrong) status. **Fix:** PWA should use a sensible default (e.g. 30 days) or block submit until a plan exists.

### 5. No-plan member defaults to "Paid Now" with no amount (PWA) — backend-dependent silent error
- **File:** `renewal-desk-pwa/src/screens/add-member.js:23,92,124-127`
- `am-paid` defaults to `paid`; `am-amount` defaults to `''` when there are no plans. Submit sends `paid: true`, `amount: undefined`, `payment_method: 'cash'` — a verified payment with no amount. If the backend 422s, the first-run flow errors with a generic toast; if it accepts, a ₹0 payment is recorded silently.
- Android labels this case clearly ("Add Member (Free / ₹0)") via `submitLabel` (`AddMemberScreen.tsx:187-192`). **Fix:** PWA should either default to "Collect Later" when no amount, or validate amount > 0 when Paid is selected.

### 6. Plan delete has no confirmation on Android (PWA has one)
- **File:** `renewal-desk-android/src/screens/PlansScreen.tsx:150` (called directly from `onPress` at line ~226); compare `renewal-desk-pwa/src/screens/plans.js:24-27` which shows a destructive `showConfirm`.
- On Android a single tap on "Delete" permanently deletes the plan. Also note: Android gates add/edit/delete behind `canEdit` (`userRole === 'gym_owner'`, line 61) while PWA shows them to every role — server-side enforcement assumed; flagging in case the API doesn't enforce it.

### 7. "Expiring" member filter: server param (PWA) vs client-side (Android) — one of them is wrong
- **Files:** `renewal-desk-pwa/src/screens/members.js:66` sends `&expiring_within_days=7`; `renewal-desk-android/src/screens/MembersScreen.tsx:74-77` filters client-side with the comment "backend doesn't have this status filter".
- If the backend does **not** support `expiring_within_days`, the PWA Expiring chip is broken (returns unfiltered/all). If it does, the Android client-side filter is redundant but works. Verify against the API; unify.

### 8. Record Payment: Android sends `renewal_days`, PWA sends `plan_id` — different backend contracts
- **Files:** `renewal-desk-android/src/screens/RecordPaymentScreen.tsx:130-137` (validated 1–730 days); `renewal-desk-pwa/src/screens/record-payment.js:47-50` (plan select + `plan_id`, no renewal-days field).
- Two different mechanisms for extending membership on payment. If the backend expects `renewal_days`, the PWA payment doesn't extend; if it expects `plan_id`, the Android one doesn't. Also: PWA has no idempotency key?? — actually it does (`Idempotency-Key`, line 51); Android relies only on the `saving` double-tap guard. Works either way, but the payload divergence is a real parity gap.

### 9. Payment method options differ by platform
- PWA `add-member.js` / `record-payment.js`: cash / upi / card / **online** / other (+ bank_transfer in add-member only).
- Android AddMemberScreen: cash / upi / card / **bank_transfer** / other; Android RecordPaymentScreen: cash / upi / **bank_transfer** / card / other.
- A payment recorded as "Online" on PWA vs "BANK" on Android creates inconsistent method labels in reports. Unify the enum on both clients and the API.

### 10. Android AddMember lacks fields PWA has (gender, start date)
- **File:** `renewal-desk-android/src/screens/AddMemberScreen.tsx` — no gender picker (PWA `add-member.js:17`) and no membership start-date picker (PWA `add-member.js:26`, defaults today).
- Consequences: Android can't backdate a joining (gym onboarding existing members must use today as start), and gender-based analytics diverge by platform.

---

## Minors

### Plan creation validation is weak on both
- PWA `plans.js:49`: `duration_days: Number(value)` → empty = `0`; `price` sent as raw string (`''` when empty) → relies on server to 422. No guard against 0/negative price or duration.
- Android `PlansScreen.tsx:91-97`: empty price → `'0'` (creates a free plan silently); `parseInt('')||30` masks invalid duration as 30; negative duration passes through (`parseInt('-30',10)||30` = `-30`).
- Neither validates before the round trip. Recommend client-side checks: name non-empty, price ≥ 0, duration ≥ 1.

### Phone validation counts differently
- PWA `add-member.js:79-84`: strips non-digits, requires ≥ 10 **digits** → correctly handles `+91` prefix and spaces.
- Android `AddMemberScreen.tsx:148`: checks `phone.trim().length < 10` — counts non-digit characters too, and the field is pre-filled with `+91`, so a 9-digit entry after the prefix (`+91` + 7 digits = 10 chars) passes the length check but normalizes to a 9-digit `+919876543`. Edge case; align to digit-count validation like PWA.

### Amount validation differs
- Android rejects NaN/negative amounts (`AddMemberScreen.tsx:151-156`) and confirms ₹0 payments with an explicit "Confirm Complementary Payment" alert (`RecordPaymentScreen.tsx:157-168`). PWA sends the raw string with no client-side check in either screen. Recommend matching Android's behavior.

### Empty-state CTA parity
- Both Members screens offer "Add Member" from empty state; neither offers **Import** there (PWA has a header Import action + `member-import` route; Android routes Import from the dashboard hero). Adding an Import secondary CTA in both Members empty states shortens the first-run path.
- PWA `renewals.js:29-32`: "No renewals / All members are up to date!" has no action. Android `RenewalsScreen.tsx:187`: "All caught up!" has no action. Both fine as-is; adding a "Record payment" / "Add member" CTA would improve zero-state guidance.
- Android `PaymentsScreen.tsx:361`: "No payments / No payment activity yet." — no actionLabel despite a record-payment route existing one tap away in the header. PWA `payments.js:76` same. Minor on both.

### PWA member-import gives no format guidance
- **File:** `renewal-desk-pwa/src/screens/member-import.js` (33 lines) — uploads CSV/XLSX to `/api/mobile/v1/members/import` with no sample template, no column list, no row preview. A brand-new gym won't know what columns to produce. Android has `ImportMembersScreen` + `MemberScan` options; verify Android documents the expected columns too.

### Dashboard zero-state handling
- Android `DashboardScreen.tsx`: zero-safe — `formatCurrency(x || '0')`, `?? 0` guards throughout; `DashboardMetric` renders `undefined` as blank (no crash); `total_active === 0` shows the First-Action Hero with Import/Scan/Add CTAs. Works.
- PWA `rrr-dashboard.js`: mostly guarded (`p.count || 0`, `formatCurrency(p.potential_revenue || 0)`) but `formatInteger(data.members.total)` (line 58) and `${data.members.attendance_rate}%` (line 59) are unguarded — if the backend omits them, the user sees `NaN` / `undefined%`. Also `pillar()`/`impactBar()` dereference `data.pillars[key]` without guarding `data.pillars` itself. Minor, backend-dependent.

### Small nits
- Android `PlansScreen.tsx:56`: `setPlans(res.data.plans)` without `|| []` — `null` would leave FlatList with bad data (PWA guards with `|| []`).
- Android dashboard "First Action Hero" uses strict `data.total_active === 0` — if backend ever returns `undefined`, the hero silently disappears. `!data.total_active` would be safer.
- Android RecordPaymentScreen notice says payments are recorded as **"pending"** and need verification, while AddMemberScreen says a **"verified"** payment is recorded immediately — contradictory copy about the same backend flow.
- PWA `record-payment.js`: amount sent as raw string; Android sends `parseFloat`. Server parses either way, fine.

---

## Per-flow verdict (brand-new gym, zero data)

| # | Flow | PWA | Android |
|---|------|-----|---------|
| 1 | Create first plan | **Works** — empty state has "Add Plan" CTA; inline form; success toast + list refresh. Weak validation (0/neg/empty possible). | **Works** — "Add New Plan" button; success notice. Weak validation; delete lacks confirmation. |
| 2 | Add first member | **Works** — but duplicate warning **crashes** (blocker #2); 0-day membership if no plans (major #4); "Paid" default with no amount (major #5). | **Works** — duplicate warning works; 30-day fallback when no plans; amount validation + ₹0 confirm. No gender/start-date fields. |
| 3 | Record first payment | **Works** — member search, plan pre-fill, WhatsApp receipt prompt, idempotency key. No amount validation. | **Works** — member search, renewal-days validated 1–730, ₹0 confirm, WhatsApp receipt prompt. |
| 4 | Renewals (none expiring) | **Works** — "No renewals / All members are up to date!" static empty state. | **Works** — "All caught up!" static empty state. |
| 5 | Payments (none) | **Works** — summary cards show ₹0 / 0 / 0; "No payments / Record your first payment" empty state. **Search crashes** (blocker #1). | **Works** — "No payments / No payment activity yet." empty state. |
| 6 | Dashboard (zero members) | **Major #3**: OWNER TODAY + setup checklist render **twice**. KPIs guarded except two spots (minor). | **Works** — all KPIs zero-safe; First-Action Hero + onboarding checklist guide the gym. |
| 7 | Member import (CSV) | **Works** — reachable from Members header and RRR checklist; functional upload but **no column guidance** (minor). Not reachable from the Members empty-state CTA (only "Add Member"). | Reachable from dashboard First-Action Hero (`onNavigateImportMembers`) via `ImportMembersScreen`. Not wired from MembersScreen empty state. |

---

## Fix priority (suggested order)
1. `payments.js:32` — `load()` → `loadPayments()` (1 line).
2. `add-member.js` — import `icon` + `escapeHtml` (2 lines).
3. `rrr-dashboard.js:51-54` — delete duplicated sections.
4. Unify member end-date default with no plans (PWA → 30-day default or require plan).
5. Default "Collect Later" (or validate amount) when adding a paid member with no amount on PWA.
6. Add delete confirmation on Android PlansScreen.
7. Resolve `expiring_within_days` server param vs Android client filter; unify `renewal_days` vs `plan_id`; unify payment-method enums.
