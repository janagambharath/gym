# Renewal Desk — Auth + Onboarding Review (PWA vs Android)

Code review only. Repo: `~/workspace/renewal-desk`. Reviewed 2026-10-11.
Backend reference (read, not run): `app/mobile_api/auth.py` — the mobile register/login/refresh/google endpoints.

Legend: 🔴 blocker · 🟠 major · 🟡 minor.

---

## 1. PWA install prompt

**Works** — but only for iOS.

- Manifest: `renewal-desk-pwa/public/manifest.json` (plus a VitePWA-generated manifest in `vite.config.js`) — name/icons/start_url/scope/display standalone all present. **Works.**
- Service worker: `vite.config.js:19-44` — `VitePWA` with `registerType: 'autoUpdate'`, `navigateFallback: '/index.html'`, API runtime caching. **Works** (production builds).
- Install UI: `renewal-desk-pwa/src/app.js:203-226` (`checkInstallPrompt`) is **iOS-only** — checks `/iphone|ipad|ipod/i`, shows an "Add to Home Screen" banner after 3s with Safari share-sheet steps (`components.js:321-341`), dismiss persisted via `localStorage 'rd-install-dismissed'`. **Works.**

🟡 **No `beforeinstallprompt` handling anywhere** (grep: no hits). On Android Chrome there is zero in-app install prompt — users only get whatever Chrome's native UI offers. If installs matter to the funnel, capture `beforeinstallprompt` and surface a banner. (Android native app is N/A here.)

---

## 2. Signup — brand-new gym owner

### Backend (both clients hit the same endpoint)

`POST /api/mobile/v1/auth/register`, rate-limited **5 per hour per IP** (`app/mobile_api/auth.py:127`).

- Password rule: **≥12 chars + upper + lower + number + symbol** (`auth.py`, `_registration_error`).
- Phone: must be **E.164** — starts with `+`, 8–16 digits (`auth.py`).
- 409s: `DUPLICATE_EMAIL` "An account already exists for this email." and `DUPLICATE_PHONE` "An account already exists for this phone number."
- Success returns the full auth payload (tokens + user + gym, role `gym_owner`), so clients go straight to the app — no email verification step.
- `terms_accepted` must be `true`.

### Android — SignupScreen.tsx

🟢 **Works well.**

- 2-step wizard with a step indicator (`SignupScreen.tsx:24-122`).
- Step 1 validation: all fields required, email format check (`:36-42`), and the password rule enforced client-side exactly matching the server (`:43-53`).
- Phone auto-prefixed with the selected country code, digits stripped (`:63`) — E.164 satisfied.
- Error display: error banner inside the card (`:130-135`); 409 messages surface verbatim and the user stays on Step 2 to fix/retry; network failure caught → "Network error during signup." (`:75-77`).
- Success → `onSignupSuccess()` → owner tab navigator (`App.tsx`).
- Country chips on Step 2 also double as the timezone/currency/locale pick (`:170-196`).

🟡 **Google sign-up skips gym-name collection.** On Step 1 the Google button passes only `country`/`timezone` (`SignupScreen.tsx:161-176`); the backend auto-names the gym `"{GoogleName}'s Gym"` (`auth.py`, `google_auth`). The owner lands in the app with a placeholder gym name and must find Settings → Edit Gym Profile to rename it. Minor, but worth either collecting the gym name pre-Google or prompting on first launch.

### PWA — signup.js + api.js

🟠 **Two top-of-funnel validation holes that both end in server 400s after a round trip:**

1. **Password: placeholder lies, no client validation.** `signup.js:17` renders `placeholder: 'Min 6 characters'` and there is *zero* client-side password validation — the backend requires 12+ chars with upper/lower/number/symbol. Every user who picks a 6–11 char password (which the UI itself suggests is fine) gets a round-trip failure with the server's message. Android validates this client-side (`SignupScreen.tsx:43-53`). **Parity gap + confusing copy.**
2. **Phone: raw input sent to an E.164 endpoint.** `signup.js:44` sends `phone: ...value.trim()` unchanged, while the backend rejects anything not starting with `+` and all-digits. The placeholder shows `+91 98765 43210`, but anyone typing `9876543210` (no `+91`) gets `400 "Phone must be in E.164 format"`. Android auto-prefixes the country code (`SignupScreen.tsx:63`). **Parity gap.** This also burns the 5/hour registration rate limit on repeated retries.

🟡 **Error banner is not cleared on resubmit** (`signup.js:48-60`): after a failed attempt the old error stays visible while the next request is in flight. `login.js:116-118` clears errors on input; signup doesn't.

🟡 **`terms_accepted: true` is hardcoded** (`api.js`, `signup()` body) with no checkbox or terms link shown to the user. Technically valid (backend accepts it), but there's no visible consent — legal/consent surface, not just cosmetic.

🟢 **What works:** all fields marked `required` (HTML5 blocks empty submit); 409 duplicate email/phone shows the server message in the error banner and re-enables the button (`signup.js:52-58`); network failure shows "Could not reach the server. Check your connection."; success shows a toast then `handleLogin()` → main app dashboard. Email is trimmed; casing is normalized server-side (Android lowercases client-side, PWA doesn't — non-issue).

---

## 3. Login + session + token refresh

### Login screens

- **PWA** `login.js`: empty-field guard (`:68-71`), error banner cleared on input (`:116-118`), spinner + disabled button during request, "Welcome back!" toast → `handleLogin()` (`:79-82`). Wrong credentials → backend's generic `401 "Invalid email or password."` (no account enumeration). 🟢 **Works.**
- **Android** `LoginScreen.tsx`: same UX, button disabled until both fields non-empty, plus **Google Sign-In** (`GoogleAuthButton`, `:105-122`). 🟢 **Works.**

🟡 **Parity gap:** PWA has no Google auth at all. Google-created accounts get a random password server-side (`auth.py`, `google_auth`), so a PWA user who signed up via Google on Android can never sign in on the PWA (and vice versa for password resets).

### Session persistence

- **PWA:** `localStorage` (`session.js`), `restoreSession()` at boot, `router.isAuthenticated = () => !!getCachedSession()` guarding all `auth: true` screens (`app.js:229-241`). Survives reload. 🟢 **Works.**
- **Android:** `expo-secure-store` (`secureSessionStore.ts`), bootstrap splash → `restoreSession()` → `authRole: owner | member | none` (`App.tsx:1310-1346`). Survives restarts. 🟢 **Works.**

### Token refresh on 401

Both implement single-flight refresh (`refreshInFlight` / `refreshOnce`), retry the failed request once, clear the local session on refresh 401/403, and don't nuke credentials on transient network failure. PWA: `api.js:57-104`. Android: `apiClient.ts:117-169`. 🟢 **Works.**

🟠 **PWA dashboard has no 401 escape hatch.** Several PWA screens force logout on 401 (`members.js:67`, `payments.js:57`, `renewals.js`, `add-member.js:140-141`, `edit-member.js:61-62`, `payment-setup.js:74-75` → `handleLogout()`), but the *first* screen — `rrr-dashboard.js` — does not: on 401 it renders **"Your dashboard is temporarily unavailable" + Retry** (`rrr-dashboard.js:20-24`), which retries forever. The user can still reach More → Sign Out via tabs, but the dead-end loop is the first thing a fresh-but-expired session hits. Android's `DashboardScreen.tsx:128` calls `onLogout()` on 401.

🟡 **Android 401 handling is per-screen, and `handleOwnerLogout` doesn't clear storage.** Most Android screens call `onLogout()` on 401, and `OnboardingChecklistCard` silently ignores failures (`OnboardingChecklistCard.tsx:17-22`). `handleOwnerLogout` (`App.tsx`) only resets in-memory state without calling `apiClient.logout()` to clear SecureStore — harmless in the refresh-failed path (apiClient already cleared it) but fragile if a 401 ever arrives through another path.

🟡 Neither client shows friendly copy for backend rate limits (login 5/min, register 5/hour) — the raw `error_response` message surfaces. Minor.

---

## 4. Gym creation / onboarding wizard

**There is no standalone gym-creation wizard on either platform — by design.** Gym name + country are collected on the signup form, and the backend creates the gym + owner + seed data (plans, QR settings, notification template) atomically in `register()`. Consequences:

- 🟢 **A user cannot get stuck with no gym.** Registration always yields a gym; login hard-rejects gym-less/inactive accounts with `403 GYM_INACTIVE` (`auth.py`, `login()`), and `_mobile_auth_payload` never runs without a gym.
- 🟢 **Skipping is safe.** Post-signup onboarding is a passive checklist on the dashboard, not a blocking flow:
  - PWA: `setupChecklist()` in `rrr-dashboard.js:108-124` (plans, members, WhatsApp, payments, biometric pairing), driven by server fields.
  - Android: `OnboardingChecklistCard` (`DashboardScreen.tsx:292`, component in `src/components/OnboardingChecklistCard.tsx`), driven by `GET /api/mobile/v1/onboarding/progress`, auto-hides when complete.
  - Parity is good here.
- 🟡 **Dead code: `RegistrationScreen.tsx` is unreachable.** It's a full 4-step registration flow with plan selection (`BillingCatalogResponse`, step 4) using `registerAccount()`, but it is **not referenced in `App.tsx`** (the Auth stack wires `SignupScreen`, not `RegistrationScreen`). Two divergent registration UIs will drift; delete or wire it.
- Note: the live signup path (`signup()`, "legacy" payload) seeds 3 real plans server-side (`1 Month Membership` etc.), so the PWA's "Add membership plans" checklist step shows done immediately. Fine.

---

## 5. First dashboard load — brand-new gym, zero members

Both are helpful; neither crashes on empty data.

**PWA** (`rrr-dashboard.js`):
- Hero: *"Everything looks clear. New signals will appear as members check in, pay and renew."* — good tone for day one.
- Pillars render 0 counts with *"No action needed right now."*; KPIs show zeros; the "Get set up" checklist points at the next 5 actions. Helpful.
- `members.js:75`: *"No members found"* + *"Add your first member to get started"* + Add Member CTA. 🟢
- 🟡 **Duplicate rendering bug:** `ownerToday()` and `setupChecklist()` are each interpolated **twice** in the dashboard template (`rrr-dashboard.js:43-46` — the two `${today ? ownerToday(today) : ''}` and two `${setupChecklist(data)}` lines back-to-back). A new owner sees the "Get set up" checklist and the "Owner today" section stacked twice.

**Android** (`DashboardScreen.tsx`):
- Stats show *"No members added yet"* (`:487`); renewals card: *"No memberships expiring in the next 7 days"* (`:804`); `MembersScreen.tsx:211-212`: *"No members yet"* + *"Add your first member to get started."* Helpful.
- Null-safe: renders skeleton → error → `data ? ...` (`:189-194`); `OnboardingChecklistCard` returns null when incomplete data. 🟢
- 🟡 One trust-the-server shape: `upcomingRes.data.members.slice(0, 5)` (`:133`) assumes `members` is present in the envelope — fine against the current backend, fragile if the shape ever changes.

---

## 6. Role handling (gym_owner vs staff) on first screens

- Staff accounts are created by the owner (PWA `staff.js`, Android `StaffScreen.tsx`) and **log in through the same email/password screen** — there's no separate staff entry point.
- Backend allows only `gym_owner` / `staff` roles on mobile login (`auth.py`, `login()`).
- **Android gates:** Settings shows "Gym Owner" vs "Staff" (`SettingsScreen.tsx:123`); Staff Management and Payment Setup are hidden from staff (`:160`, `:228`); `BotSetupScreen`/`PlansScreen` are read-only for staff (`canEdit`, `:66`/`:54`); payment delete and member delete are owner-only (`PaymentDetailScreen.tsx:253-254`, `MemberDetailScreen.tsx:670`). 🟢 Decent.
- **PWA:** role badge in Settings (`settings.js:22`) and badges in the staff list (`staff.js:74`) — but **no owner-only UI gates found**: Staff menu, Payment Setup, etc. are visible to staff too. 🟡 Parity gap (backend presumably enforces; cosmetic on client, but staff will see screens they can't use).
- 🟡 No route-level guards on either — hidden screens are hidden from menus, not from navigation. Minor.
- 🟡 Cosmetic: PWA dashboard labels every session "Owner workspace" (`rrr-dashboard.js:36`) even for staff logins.

---

## Parity gaps — PWA vs Android (summary)

| Area | PWA | Android |
|---|---|---|
| Password validation | ❌ none (misleading "Min 6" placeholder) | ✅ 12+ upper/lower/number/symbol client-side |
| Phone E.164 | ❌ raw input → server 400s | ✅ auto-prefixes country code |
| Google auth | ❌ absent | ✅ login + signup |
| Staff UI gates | ❌ none | ✅ several owner-only gates |
| 401 on dashboard | ❌ dead-end "unavailable + Retry" loop | ✅ logs out |
| Install prompt | iOS-only nudge, no `beforeinstallprompt` | N/A (native) |
| Registration flow | single-page form | 2-step wizard (+ unreachable 4-step `RegistrationScreen.tsx`) |

## Severity-ordered findings

1. 🟠 **PWA signup phone field sends raw input to an E.164-only endpoint** — plain-digit numbers fail with a 400. Fix: prefix with the selected country's dial code like Android, or validate client-side. (`renewal-desk-pwa/src/screens/signup.js:44`, `renewal-desk-pwa/src/api.js` `signup()`)
2. 🟠 **PWA signup has no client-side password validation and the placeholder says "Min 6 characters"** while the server demands 12+ with complexity — guaranteed confusing round-trip failures at the top of the funnel. (`renewal-desk-pwa/src/screens/signup.js:17`)
3. 🟠 **PWA dashboard 401 → infinite "temporarily unavailable + Retry"** instead of logout. Add the same `handleLogout()` on 401 that the other PWA screens use. (`renewal-desk-pwa/src/screens/rrr-dashboard.js:18-24`)
4. 🟡 PWA dashboard renders the "Owner today" and "Get set up" sections **twice** (`rrr-dashboard.js:43-46`).
5. 🟡 PWA has no Google sign-in while Android does — Google-created accounts can't log in on PWA.
6. 🟡 PWA shows no staff-role UI gating (Android has it): staff see owner screens in menus.
7. 🟡 Android `RegistrationScreen.tsx` is dead code — not wired into `App.tsx`; remove or wire it.
8. 🟡 PWA `terms_accepted: true` hardcoded with no visible consent UI (`api.js`).
9. 🟡 Android Google signup auto-names the gym `"{Name}'s Gym"` with no chance to set the real name during signup.
10. 🟡 No `beforeinstallprompt` handling — Android Chrome users get no in-app install prompt.
11. 🟡 Android `handleOwnerLogout` (`App.tsx`) doesn't clear SecureStore; per-screen 401 handling only (checklist card swallows errors silently).
12. 🟡 PWA signup error banner isn't cleared on resubmit; login screen clears it (`signup.js:48-60` vs `login.js:116-118`).
13. 🟡 PWA dashboard always says "Owner workspace" even for staff sessions (`rrr-dashboard.js:36`).
