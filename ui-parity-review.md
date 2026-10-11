# Renewal Desk — PWA vs Android UI/UX Parity Review (Pre-Production)

**Date:** 2026-10-11 · **Repo:** ~/workspace/renewal-desk
**PWA:** renewal-desk-pwa/src/screens/ · **Android:** renewal-desk-android/src/screens/
**Method:** static code comparison by three parallel auditors, one per screen family. Sources: parity-part-a.md, parity-part-b.md, parity-part-c.md (same directory).

## Headline

The two apps are **structurally different products with overlapping features**, not two skins over one spec:

- PWA's home tab *is* the RRR dashboard; Android's home is a dense operational dashboard with RRR consolidated into a separate screen. PWA has two RRR screens with **no Android equivalent at all** (`rrr-list.js` opportunities lifecycle, `rrr-mappings.js` identity review).
- Android is a superset on Payments, Renewals workstation, Member Detail extras, Campaigns, and scan-review QA. PWA is a superset on Bot Setup fields reachable (after the recent fix), quick actions, and member-row address display.
- **Six API contract mismatches** exist where the two clients parse different shapes from the same endpoint — at least one side is broken per case.
- **Safety gaps run both directions:** Android skips PWA's supervised commissioning prerequisites for auto door block/unblock; PWA has no role gating on plans/bot-setup while Android deletes plans and resets staff passwords with no confirmation.

---

## 1. Home / Dashboard

| PWA (`rrr-dashboard.js`) | Android (`DashboardScreen.tsx` + `RrrGrowthScreen.tsx`) |
|---|---|
| Home tab = RRR dashboard | Home = operational dashboard; RRR lives in separate `RrrGrowthScreen` (Settings entry) |
| Pillars at top (Revenue/Retain/Recover) with per-pillar **tappable member rows + "View all"** | Pillars at top; all three tap to same `onNavigateRrr` (no per-pillar deep link) |
| KPI row tappable (members→tab, attendance→access, identity→mappings, pipeline→list) | Metrics are plain views, not tappable (only Attention tiles are) |
| Per-pillar "View members" deep links | None |
| "Tune signals" → rules screen | Rules at bottom of `RrrGrowthScreen` |
| Growth impact bars panel | Missing |
| Owner Today queue + setup checklist (rendered **twice** — PWA bug, `rrr-dashboard.js:50-53`) | Server-driven onboarding checklist w/ progress bar; Android renders each once |
| Hero device-status button | Integration card |

**Gaps on Android:** per-pillar member lists (PWA-only member follow-up flow); tappable KPIs; opportunity lifecycle entirely missing (see §RRR). **Gaps on PWA:** handover alerts, Live Access, Leads & AI Bot card, Revenue Overview, Attention Required, Upcoming Renewals w/ 1-tap Renew, Recent Payments. **Cross:** Android uses page buttons vs PWA infinite scroll; Android has pull-to-refresh and Retry on errors; PWA uses toasts vs Android alerts.

## 2. Members

| Area | PWA | Android | Gap |
|---|---|---|---|
| List — Expiring filter | Server-side `expiring_within_days=7` | **Client-side over current page only** — members past page 1 invisible (`MembersScreen.tsx:79-86`). **Real data bug.** | Android HIGH |
| List — Import entry | Header action | Missing on Members screen (Dashboard-only) | Android MED |
| List — rows | Address line shown | Drops address; richer otherwise | Android LOW |
| Detail — Contact section | Email/Gender/Joined/Notes card | **Missing** — email, gender, joined date invisible | Android HIGH |
| Detail — extras | — | Financial Summary card (Android-only, good) | — |
| Detail — WhatsApp opt-in status | Shown | Static "Verified templates active", not member state | Android MED |
| Detail — Entered At | Shown when inside | Missing | Android MED |
| Detail — Deactivate | Anyone | `gym_owner` only — pick one rule | MED |
| Add member — Gender | Select | **Missing entirely** (data loss) | Android HIGH |
| Add member — Start Date | Editable (backfill) | **Hardcoded today** (can't backdate) | Android HIGH |
| Edit member — Gender | Controlled select | Free text (typos possible) | Android LOW |
| Import | Blind multipart upload | Preview/validate + duplicate blocking (richer); but **CSV-only in practice** (reads file as text), 2MB cap | Android MED |

## 3. Payments

- Android is a superset: channel filter + badges, discount display, **inline Verify/Reject/Cancel on list rows**, richer summary. PWA requires opening detail to verify.
- **Record Payment:** Android lacks `Idempotency-Key` (double-submit risk — PWA has it); Android sends `renewal_days` where PWA sends `plan_id` (different semantics — verify backend); method labels differ (`bank_transfer` vs `online`).
- **Payment Detail:** Android has "Cancel Demand" (no PWA equivalent); Delete restricted to `gym_owner` on Android, anyone on PWA.
- **Payment Setup:** Android can toggle collection off (PWA hardcodes `is_active:true` — re-save clobbers); Android allows blank UPI ID, PWA blocks.

## 4. Renewals

- **Bucketing bug (HIGH):** Android's "Next 7 Days" bucket is `days > 0`, so 8–30-day expiries are mislabeled; the "Upcoming (>7)" section doesn't exist. Reconcile with backend contract.
- **Campaigns entry missing on Android** (`onNavigateCampaigns` prop never rendered).
- PWA caps Expired at 20; Android uncapped (long scroll).
- **Renew Member:** Android is a full workstation (discount engine, VYNLA publish route, success screen) — strict superset, except it drops the Reference/Transaction ID field.

## 5. AI Receptionist

| Screen | Verdict |
|---|---|
| Overview | ⚠️ Metrics differ: PWA shows Handovers + Resolution % (`/bot/overview`); Android shows Contacted + Trials (`/bot/stats`). Pick one canonical set. |
| Conversations | Android richer (search, filters, retry). PWA shows fake "No conversations" on API failure. |
| Conversation detail | ❌ **PWA has no handover take-over** — staff can reply but AI keeps auto-replying. Android has take-over/resume. |
| Leads list | Android richer (search, filters, pagination). |
| Lead detail | Split: PWA has **Convert to Member + WhatsApp deep link** (Android missing); Android has lead status workflow (PWA missing). |
| Bot setup | ❌ PWA is a 6-field form — no FAQ management, no trial/handover switches, **no role gating**. Android is a full console (FAQs, validation, owner gating). |
| Test bot | ⚠️ **Android `BotTestScreen` is fully built but UNREACHABLE** (zero references in src/). PWA reaches it from the menu. |

## 6. WhatsApp

| Screen | Verdict |
|---|---|
| Setup (embedded signup) | Same backend flow. Android completes in-app (WebView + postMessage + success state). **PWA opens a browser tab and never learns the result** — no success/error detection after return. |
| Dashboard | Android is a 3-tab work center (Broadcast composer w/ live preview, Reminders tab, AI Leads tab). PWA is a status card + recent log. PWA's Broadcast routes to campaign wizard; Android has free-text composer — two different flows for the same capability. |

## 7. RRR

| PWA screen | Android | Gap |
|---|---|---|
| `rrr-list.js` (opportunities) | **NO EQUIVALENT** | ❌ "Close as recovered" + revenue capture and "Dismiss" are PWA-only. Android: 2 inline opportunities per pillar, mark-actioned only. |
| `rrr-mappings.js` (identity review) | Capped 5-row card in `RrrGrowthScreen` | ❌ No full screen; backlog beyond 5 invisible; no biometric-ID grouping. |
| `rrr-integrations.js` | `RrrGrowthScreen` cards | ⚠️ Android missing: Copy buttons on server settings, HTTPS guidance, "haven't heard from terminal" checklist, pairing-code instructions. **Command console is fire-and-forget** (no 2.5s polling, buttons enabled while terminal offline). **SAFETY: Android skips PWA's commissioning prerequisites** — auto block/unblock enabled by checkbox alone, no real-punch or acked-test gates. |
| `rrr-rules.js` | Rules card in `RrrGrowthScreen` | ⚠️ Android inputs accept 0 (no min/max validation); no server-defaults display; no explainer. |
| Loading/error states | Present on PWA | **`RrrGrowthScreen` has none** — failed loads silently show zeros. |

## 8. Settings

- Android missing **Inbox** and **Notifications** menu entries (PWA has them).
- **Android Sign Out has no confirmation dialog** (PWA asks). Delete flow matches.
- Android-only additions: gym info rows, UPI status pill, Test AI Receptionist, About + Privacy Policy.

## 9. Auth

- Login matches on fields/validation. Android adds Google sign-in, disabled-until-valid button. **Member login differs:** PWA → `/vynla` redirect; Android → in-app WhatsApp-OTP login.
- Signup diverges most: Android is a 2-step wizard enforcing **12-char upper/lower/number/symbol** passwords, sending currency+timezone; PWA is a single form with unenforced "min 6". If the backend enforces the strict policy, PWA signups fail server-side — confirm backend is the source of truth.

---

## Cross-cutting findings

**C1. Dead screens on Android (P0):** `BotTestScreen.tsx` and `RegistrationScreen.tsx` have zero references in src/. RegistrationScreen is an alternate owner-signup wizard — the live path is `SignupScreen.tsx`.

**C2. Entire PWA screens missing on Android (P0):** `owner-finance.js` (daily collections + **cash-close recording**) and `owner-leads.js` (front-desk lead capture) — no Android equivalent. Note: earlier in this session the PWA cash-close UI was removed per owner request, but the screen/API still exist; confirm whether Android should get these at all.

**C3. API contract mismatches (P0):** `/reports/summary` (flat vs nested keys — one side broken); `/bot/overview` vs `/bot/stats`; `/inbox` (`data.messages` vs `data.conversations`+`summary`); `/members/scan` (multipart vs base64 JSON); campaign create payload + separate `POST /:id/send` on Android.

**C4. Reversed safety gaps (P1):** PWA plans + bot-setup have no role gating (staff can mutate); Android deletes plans and resets/deactivates staff with **no confirmation**.

**C5. Loading/empty/error consistency:** Android consistently has skeletons + Retry; PWA bot screens show fake "No conversations/leads" on API failure; `RrrGrowthScreen` (Android) has no loading/error states at all.

---

## Priority fix list for production

| # | Sev | Issue |
|---|---|---|
| 1 | P0 | Android: add commissioning prerequisites (real punch + acked test) before enabling auto block/unblock — safety |
| 2 | P0 | Resolve `/reports/summary` contract (flat vs nested) — one side's Reports is broken |
| 3 | P0 | Wire `BotTestScreen` into Android nav (or delete); decide fate of `RegistrationScreen` |
| 4 | P0 | Decide Android fate of owner-finance / owner-leads (build or confirm dropped) |
| 5 | P0 | Fix Android Members "Expiring" filter to use `expiring_within_days=7` server-side |
| 6 | P0 | Fix Android Renewals bucketing (>7-day expiries mislabeled "Next 7 Days") |
| 7 | P1 | Add `gym_owner` gating to PWA plans + bot-setup (or backend enforcement) |
| 8 | P1 | Add confirm dialogs to Android plan-delete / staff deactivate / password reset |
| 9 | P1 | Add Gender + Start Date to Android Add Member (data loss otherwise) |
| 10 | P1 | Add handover take-over to PWA conversation detail |
| 11 | P1 | Add "Convert to Member" + WhatsApp link to Android lead detail |
| 12 | P1 | Add Contact/Email/Gender/Joined section to Android member detail |
| 13 | P1 | Add Idempotency-Key to Android record-payment |
| 14 | P1 | Add loading/error states to Android `RrrGrowthScreen` |
| 15 | P1 | Add full opportunity lifecycle (or at least list view) to Android — recovered-revenue capture is PWA-only |
| 16 | P1 | Add full mappings screen (or "View all") to Android |
| 17 | P2 | Android: rules min/max validation; command-console polling + connectivity gating |
| 18 | P2 | PWA: stop rendering Owner-Today + checklist twice (`rrr-dashboard.js:50-53`) |
| 19 | P2 | PWA: error states instead of fake empty states on bot screens |
| 20 | P2 | Confirm signup password policy source of truth; surface backend errors on both |
