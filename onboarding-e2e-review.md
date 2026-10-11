# Renewal Desk — End-to-End Onboarding Review (Pre-Production)

**Date:** 2026-10-11 | **Repo:** `~/workspace/renewal-desk` | **Scope:** full gym-owner journey from scratch, PWA vs Android
**Method:** code review (no servers run). All blocker claims re-verified against current `main` before writing.
**Section reports:** `onboarding-review-auth.md`, `onboarding-review-core.md`, `onboarding-review-integrations.md`

Legend: 🔴 blocker (breaks the flow) · 🟠 major (wrong data / silent failure / big UX gap) · 🟡 minor.

---

## Journey map — can a gym owner download and onboard completely?

| # | Step | PWA | Android |
|---|------|-----|---------|
| 1 | Install / first launch | 🟢 works (iOS banner; no `beforeinstallprompt` on Chrome) | 🟢 works (native) |
| 2 | Signup | 🟠 password + phone validation gaps → server 400s | 🟢 solid 2-step wizard |
| 3 | Login + session | 🟢 works; 🟠 dashboard 401 dead-ends | 🟢 works + Google auth |
| 4 | Gym creation | 🟢 atomic at signup, can't get stuck | 🟢 same |
| 5 | First dashboard (empty) | 🟠 sections render twice | 🟢 good empty states + checklist |
| 6 | First plan | 🟢 works, weak validation | 🟢 works, no delete confirm |
| 7 | First member | 🔴 duplicate-phone check **crashes** | 🟢 works |
| 8 | First payment | 🟢 works | 🟢 works |
| 9 | Payments search | 🔴 **crashes** on keystroke | 🟢 works |
| 10 | WhatsApp connect | 🔴 completion **500s** (backend `NameError`) | 🔴 reachable entry **400s** (wrong params) |
| 11 | Templates after signup | 🟢 provisioned (name mismatch major) | 🟢 same |
| 12 | Biometric — Direct Cloud ADMS | 🟢 full loop works | 🟢 full loop works |
| 13 | Biometric — eBioServer | 🟢 works | 🟢 works |
| 14 | Biometric — TCP bridge | 🟡 no in-app UI (manual only) | 🟡 no in-app UI (manual only) |

**Bottom line: the owner CANNOT complete onboarding today.** WhatsApp signup is broken on both platforms (different root causes), and the PWA has two crash bugs in core money flows. The biometric paths (the revenue-critical ones) are the healthiest part of the system.

---

## 🔴 Blockers (fix before production)

### B1. PWA WhatsApp signup can never complete — backend `NameError: User`
- `app/mobile_api/whatsapp.py:57` (in `whatsapp_handshake_or_token_required`): `db.session.get(User, ...)` but `User` is never imported (line 14 imports only `Member, QRSettings, ReminderLog`). → HTTP 500 on every handshake-authenticated POST to `/connect-waba`.
- The PWA's only completion path is the embedded page's direct fetch with the handshake Bearer → always 500s → gym can never reach CONNECTED. The page's `.catch` only logs to console; the owner sees "Signed in. Verifying Meta connection…" forever.
- **Fix:** add `User` to the import (one line).

### B2. Android WhatsApp signup 400s — the reachable entry uses the wrong URL, the fixed screen is orphaned
- `renewal-desk-android/src/components/WhatsAppOnboardingModal.tsx:84-111` builds the signup URL with `&token=<full access token>` and **no `handshake`** → backend requires `handshake` (`whatsapp.py:439-442`) → 400 "Signup handshake is missing or invalid."
- This modal is the **only reachable entry** (`WhatsAppScreen.tsx:396`). `WhatsAppSetupScreen.tsx` (fixed in an earlier commit to use `signup_handshake`) is **never imported or registered** — 0 references in `App.tsx`. The fix went to a dead screen.
- Secondary: full Bearer token in a WebView URL (security), plus hardcoded fallback `metaAppId`/`configId` if `onboarding-config` fails.
- **Fix:** route the status-card tap to the fixed screen, or fix the modal URL to use `signup_handshake` (and delete the orphan).

### B3. PWA Payments search crashes on any keystroke
- `renewal-desk-pwa/src/screens/payments.js:32`: debounced handler calls `load()`, but the function is named `loadPayments` (line 41). → `ReferenceError` the moment the owner types in search.
- **Fix:** `load()` → `loadPayments()` (one line).

### B4. PWA Add Member duplicate-phone warning crashes instead of warning
- `renewal-desk-pwa/src/screens/add-member.js:71`: the debounced duplicate check calls `icon()` and `escapeHtml()`, neither imported (imports at lines 3–5 lack them). Typing a genuinely duplicate phone throws instead of showing the warning.
- **Fix:** add the two imports (two lines).

### B5. PWA dashboard renders OWNER TODAY + "Get set up" twice
- `renewal-desk-pwa/src/screens/rrr-dashboard.js:51-54`: `${today ? ownerToday(today) : ''}` and `${setupChecklist(data)}` each appear twice back-to-back. A new owner sees the whole onboarding checklist duplicated.
- **Fix:** delete the duplicated lines.

---

## 🟠 Majors

### M1. Latent double-submission race in embedded signup (unmasked by fixing B1)
The embedded-signup page does **both** `postToApp({type:'embedded_signup_code'})` → RN posts to `/connect-waba`, **and** its own `fetch` to `/connect-waba` with the same single-use Meta code. Once B1 is fixed, the loser gets 409 → Android can show "Setup Failed" after a successful connect. **Fix:** when `window.ReactNativeWebView` exists, post the message and skip the page's own fetch (keep the direct fetch as PWA fallback).

### M2. "Open in Browser" fallback is a dead end (both platforms)
No deep-link return path — completing Meta's flow in the external browser never notifies the app. Either wire a deep link or remove the button.

### M3. `WHATSAPP_REMINDER_TEMPLATE_NAME` doesn't match any provisioned template
`railway.env.example:58` sets `membership_renewal_reminder_01`, but provisioning creates `renewal_reminder` / `membership_renewal_reminder` (no `_01`). Reminder sends would fail "template not found" on any deployment following the example env. Also: sends default to language `en_US` while templates are provisioned as `en` (Meta lookup is language-exact).

### M4. PWA signup validation holes (top of funnel)
- No client-side password validation; placeholder says "Min 6 characters" while the server demands 12+ with complexity (`signup.js:17`) → guaranteed confusing round-trip failures. Android validates correctly.
- Phone field sends raw input to an E.164-only endpoint (`signup.js:44`) → `9876543210` without `+91` gets 400. Android auto-prefixes. Both burn the 5/hour registration rate limit on retries.

### M5. PWA dashboard 401 → infinite "temporarily unavailable + Retry"
`rrr-dashboard.js:18-24` doesn't force logout on 401 like every other PWA screen does. Android handles it correctly.

### M6. No-plan member: 0-day membership (PWA) vs 30-day (Android)
`add-member.js:100-107` leaves endDate = startDate when no plans exist → instantly-expired member. Android falls back to 30 days. Also PWA defaults to "Paid Now" with no amount → `paid:true` + `amount:undefined` sent.

### M7. direct_bridge gyms have no in-app presence
No setup UI on either platform (manual provisioning only). Dashboard says "Bridge live" but the integrations screen shows Direct Cloud prompts and hides the mappings link — no device visibility, no status, no reconnect path for Yodha-style gyms.

### M8. Record Payment payload divergence
Android sends validated `renewal_days` (1–730); PWA sends `plan_id`. If the backend honors only one, the other platform's payments don't extend membership correctly. Payment-method enums also differ (`online` vs `bank_transfer`).

### M9. Provisioned templates show as APPROVED before Meta approves
`get_approved_templates` hardcodes `"status": "APPROVED"`; freshly provisioned templates are PENDING in Meta → campaign UI offers templates whose sends will fail until approval lands.

---

## 🟡 Minors (condensed)

- PWA has no Google auth; Google-created accounts can't sign in on PWA (Android has it).
- PWA shows no staff-role UI gates (Android has owner-only gates); dashboard always says "Owner workspace" even for staff.
- Android `RegistrationScreen.tsx` (4-step) is dead code — not wired into `App.tsx`.
- PWA `terms_accepted: true` hardcoded with no consent UI.
- No `beforeinstallprompt` handling — Android Chrome gets no in-app install prompt.
- Android plan delete has no confirmation (PWA does).
- PWA `expiring_within_days=7` param vs Android client-side filter — verify which the backend supports.
- Android AddMember lacks gender + start-date fields PWA has (can't backdate joinings).
- Android phone validation counts characters not digits (`+91` prefix edge case).
- PWA plan/member/payment screens send raw strings with no client amount/price validation (Android validates).
- PWA member-import has no column guidance for CSV.
- Android `OnboardingChecklistCard` swallows API errors silently; `handleOwnerLogout` doesn't clear SecureStore.
- ADMS: backend `status` is sticky (never flips back from `connected`); PWA dashboard shows "Direct Cloud live" from sticky status while the integrations screen correctly applies the 5-min liveness gate — contradictory.
- eBioServer bridge card (both) shows "connected" from sticky status with no staleness gate.
- PWA signup error banner not cleared on resubmit.

---

## ADMS end-to-end resource check ✅

Independently verified the full Direct Cloud chain is closable from both apps:
- **Provision:** `POST /rrr/integrations/adms/provision` (`rrr.py:193-240`) → per-integration `adms_path_token`; `adms_terminal_settings()` (`rrr_service.py:341-369`) derives server address/port/HTTPS from `ADMS_PUBLIC_URL` (currently `http://136.87.19.164`) — the app never shows an address the backend doesn't listen on.
- **Terminal polling:** `app/adms/routes.py` serves `/iclock/<path_token>/{cdata,registry,getrequest,devicecmd}` (+ `.aspx` variants); `_touch` marks `connected` + `last_success_at`.
- **Command push:** `getrequest` delivers oldest queued/delivered `RRRAdmsCommand` as `C:<id>:<text>`; re-sends delivered-but-unacked commands (outage-safe).
- **Results:** `devicecmd` records `acked`/`failed` from the terminal's `Return` code.
- **Block/unblock:** `DATA UPDATE USERINFO` via `queue_direct_adms_test_command` (`rrr.py:257-308`); supervised commissioning requires mapped attendance + acked test command (`rrr.py:310-358`).
- **Proxy path:** GCP VM `136.87.19.164:80` → nginx → Railway; verified returning live health through the proxy.

---

## Parity gaps summary (PWA vs Android)

| Area | PWA | Android |
|------|-----|---------|
| Signup validation (password/phone) | ❌ server round-trip failures | ✅ client-side |
| Google auth | ❌ absent | ✅ |
| Staff UI gates | ❌ none | ✅ |
| Dashboard 401 | ❌ retry loop | ✅ logout |
| Member end-date w/o plans | ❌ 0-day | ✅ 30-day |
| Payment method enum | `online` | `bank_transfer` |
| Record payment payload | `plan_id` | `renewal_days` |
| AddMember fields | gender + start date | neither |
| Plan delete confirm | ✅ | ❌ |
| WhatsApp signup entry | new-tab page (500s) | modal WebView (400s) |
| ADMS command polling | ✅ 2.5s poll loop | ❌ pull-to-refresh only |
| Mappings view | grouped by biometric ID | raw ungrouped events |

---

## Recommended fix order

1. `app/mobile_api/whatsapp.py` — import `User` (unblocks PWA signup completion).
2. Android — point the WhatsApp status-card at the fixed signup screen (or fix the modal URL); delete the orphan.
3. Embedded page — skip own `fetch` when `window.ReactNativeWebView` exists (prevents the code-reuse race).
4. `payments.js:32` — `load()` → `loadPayments()`.
5. `add-member.js` — import `icon` + `escapeHtml`.
6. `rrr-dashboard.js:51-54` — remove duplicated sections.
7. Align `WHATSAPP_REMINDER_TEMPLATE_NAME` + language code with provisioned names.
8. PWA signup — client-side password + phone (E.164) validation matching Android.
9. PWA dashboard — `handleLogout()` on 401 like other screens.
10. Unify `renewal_days` vs `plan_id`, payment-method enums, `expiring_within_days`.
11. Render a `direct_bridge` status card in integrations (or explicit "admin-managed" messaging).
12. Decide: deep-link the "Open in Browser" return, or remove the button.
