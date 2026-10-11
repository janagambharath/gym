# Integrations Review — Renewal Desk Gym-Owner Journey (PWA + Android + Backend)

Code review only (no servers run). Repo: `~/workspace/renewal-desk`. Reviewed 2026-10-11.

## Verdicts at a glance

| Path | PWA | Android | Backend |
|---|---|---|---|
| WhatsApp embedded signup | **Broken** (500 on completion) | **Broken** (400 on the reachable entry) | Partially broken (missing import) |
| Template auto-provisioning | Works | Works | Works, with a template-name mismatch (major) |
| Biometric — Direct Cloud (ADMS) | Works | Works | Works |
| Biometric — eBioServer bridge | Works | Works | Works |
| Biometric — TCP direct_bridge | **Dead end** (no UI) | **Dead end** (no UI) | Recognized, but invisible in-app |
| Unresolved-punch mapping | Works | Works | Works |

---

## 1. WhatsApp embedded signup

### BLOCKER — Android's reachable signup entry 400s; the "fixed" screen is orphaned

`renewal-desk-android/src/components/WhatsAppOnboardingModal.tsx:84-111` builds the signup-page URL with `&token=<full access token>` and **no `handshake` param**. The backend (`app/mobile_api/whatsapp.py:439-442`) requires `handshake` matching `[A-Za-z0-9_.-]{16,512}` → this URL gets **400 "Signup handshake is missing or invalid."**

This modal is the *only* reachable signup entry: `WhatsAppScreen.tsx:396` opens it from the status-card tap. `WhatsAppSetupScreen.tsx` (the file fixed in commit `364df4e` to use `signup_handshake`) is **not imported or registered in any navigator** — verified: no import of it in `App.tsx` or anywhere else. The fix went to a dead screen. So on Android, tapping "Connect WhatsApp" opens a WebView that shows a backend Configuration Error page.

Secondary: the modal also leaks the full access token into the WebView URL — the exact security issue the handshake design exists to avoid — and falls back to hardcoded `metaAppId='1711816793132513'` / `configId='1075973911551679'` if `onboarding-config` fails.

### BLOCKER — PWA completion path 500s (`NameError: User`)

`app/mobile_api/whatsapp.py:57`, inside `whatsapp_handshake_or_token_required`:
```python
user = db.session.get(User, payload.get("sub"))
```
`User` is **not imported** (line 14 imports only `Member, QRSettings, ReminderLog`; `User` exists at `app/models/user.py` and is exported from `app/models/__init__.py`). Any request authenticated with the handshake Bearer hits this → uncaught `NameError` → **HTTP 500**.

The PWA (`renewal-desk-pwa/src/screens/whatsapp-setup.js`) opens the signup page in a new tab; that page's *only* completion path is its direct `fetch('/api/mobile/v1/whatsapp/connect-waba')` with `Authorization: Bearer <handshake>` → always 500 → the gym can never reach CONNECTED from the PWA. The page's `.catch` only logs to console, so the owner sees the status text stuck at "Signed in. Verifying Meta connection…" with no error surfaced.

(On Android's orphaned `WhatsAppSetupScreen`, the RN-side `connectWaba` uses the full access token via `apiRequest`, so it bypasses the handshake branch — but that screen is unreachable anyway. The embedded page's own redundant fetch 500s silently there, which is currently *masking* the race below.)

### MAJOR — Double submission of the single-use Meta code (latent; unmasked by fixing the import)

The embedded-signup HTML (`app/mobile_api/whatsapp.py`, `_EMBEDDED_SIGNUP_HTML`, `FB.login` callback) does **both**:
1. `postToApp({type: 'embedded_signup_code', code})` → RN posts it to `/connect-waba`, **and**
2. its own `fetch('/api/mobile/v1/whatsapp/connect-waba', {code})` with the handshake Bearer.

Meta auth codes are single-use. Once the `User` import is fixed, both submissions race; the loser gets `409 EMBEDDED_SIGNUP_FAILED` — so Android can show "Setup Failed" *after* the connection actually succeeded server-side. Same pattern in `handleSignupSuccess` (WA_EMBEDDED_SIGNUP path): posts `embedded_signup_complete` to RN **and** fetches `/connect-waba` with the same waba/phone (Flow 2, idempotent but double audit + double webhook-subscribe).

Fix: when `window.ReactNativeWebView` exists, the page should post the message and *not* do its own fetch (keep the direct fetch only as the PWA/new-tab fallback).

### MAJOR — "Open in Browser" fallback is a dead end (both platforms)

The page posts `{type: 'open_external_browser', direct_meta_url}` → Android opens the system browser (`WhatsAppSetupScreen.tsx:128-133`); PWA navigates the new tab (`window.location.href = directMetaUrl`). The `direct_meta_url` carries no app redirect/deep link, so completing Meta's flow in the external browser has **no return path** — the app never learns the result and shows nothing. The owner is stranded mid-flow.

### MINOR — `embedded_signup_error` is never emitted

The page never posts `embedded_signup_error`; the handlers in `WhatsAppSetupScreen.tsx:113` and `WhatsAppOnboardingModal.tsx:144` are dead code. Meta-side failures (SDK timeout, login failure) surface only in the WebView page's own status text.

### MINOR — PWA never refreshes status after the new tab

`whatsapp-setup.js` fetches `connection-status` once on mount; after "Complete the Meta setup in the new tab, then return here," there is no `visibilitychange` listener or refresh button — the owner sees the stale "Start Setup" screen and must navigate away and back.

### MINOR — PWA signup URL uses `window.location.origin`

`whatsapp-setup.js` builds the signup-page URL from `window.location.origin`, while all API calls use the hardcoded `API_BASE_URL` (`renewal-desk-pwa/src/api.js:10`). Works today because the Flask app serves the PWA dist itself (`app/__init__.py:73-129`), but it breaks if the PWA is ever served from a different origin than the API.

### MINOR — Handshake 10-minute lifetime vs. slow Meta flows

The handshake is minted at `onboarding-config` time (`token_service.py:91-107`, 10-min expiry). If Meta OAuth takes longer, the page's completion fetch 401s. (RN path unaffected — it uses the full access token.)

### Verified correct

- Param sets on both fixed screens: `handshake` + `config_id` + `meta_app_id` from `onboarding-config` ✓; backend regexes accept all three ✓.
- `WA_EMBEDDED_SIGNUP` message parsing handles both snake_case and camelCase variants on Android ✓ and in the page ✓.
- User cancel: Android `embedded_signup_cancel` → `onBack()` ✓ (PWA new-tab cancel is a no-op — owner closes the tab manually; could call `window.close()`).

---

## 2. Template auto-provisioning after signup

### Works

- Step 7 of `EmbeddedSignupService.process_signup` (`app/services/embedded_signup_service.py:124-133`) calls `provision_templates()` inside `try/except` → **failure is non-fatal**, sets `whatsapp_templates_provisioned=True` on success.
- `GET /campaigns/templates` → `get_approved_templates` (`app/services/campaign_service.py:117-156`) builds from `STANDARD_TEMPLATES` in `template_provisioning_service.py` — same 8 names PWA and Android see. Name cross-checks pass: `gym_announcement`, `gym_announcement_01`, `expired_member_reactivation_01`, `gym_special_offer_01`, `renewal_desk_test_01`, `vynla_otp` match their send sites.

### MAJOR — Configured reminder template name is not a provisioned name

`railway.env.example:58` / `.env.example:80` set `WHATSAPP_REMINDER_TEMPLATE_NAME=membership_renewal_reminder_01`, but `STANDARD_TEMPLATES` provisions `renewal_reminder` and `membership_renewal_reminder` — there is **no `membership_renewal_reminder_01`**. `_send_template_message` (`app/services/reminder_service.py:278-287`) sends the env value verbatim to Meta → "template not found" failures for any deployment following the example env. The provisioned set and the documented default must agree on one name.

### MINOR — Approval status is fictional

Provisioned templates start as PENDING in Meta, but `get_approved_templates` hardcodes `"status": "APPROVED"` — the campaign UI offers templates before Meta approves them; sends fail until approval lands.

### MINOR — Language code mismatch risk

Provisioned templates use `"language": "en"`; sends default to `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE=en_US` (`reminder_service.py:285`). Meta template lookup is language-exact — worth pinning both to the same code.

---

## 3. Biometric — Direct Cloud (ADMS)

### Works end-to-end, loop closable from both apps

- PWA: serial → `POST /rrr/integrations/adms/provision` (`app/mobile_api/rrr.py:193-240`) → server card (address/port/HTTPS/path from `adms_terminal_settings`, `app/services/rrr_service.py:341-369`) with copy buttons → checklist → command console (`probe_info` / `block_test` / `unblock_test`, `rrr.py:257-308`) → supervised commissioning (`/commission`, `rrr.py:310-358`, requires mapped attendance **and** an acked test command).
- Terminal side: `app/adms/routes.py` — `/iclock/<path_token>/{cdata,registry,getrequest,devicecmd}`; `_touch` marks `connected` + `last_success_at`; `getrequest` delivers the oldest queued/delivered `RRRAdmsCommand` as `C:<id>:<text>`; `devicecmd` records `acked`/`failed` from the terminal's `Return` code.
- Android (`RrrGrowthScreen.tsx`) mirrors all of this: provision, server values, command queue, door-confirm checkbox, commission.

### Offline UX — clear on PWA, usable on Android

- Both use a 5-minute `last_success_at` gate: LIVE pill vs "LAST SEEN X" (PWA `rrr-integrations.js:17-27`; Android `RrrGrowthScreen.tsx:40-44`).
- Backend `status` is **sticky** — nothing ever flips it back from `"connected"` (no offline sweep). Consequence: the `DEVICE_OFFLINE` 409 guard in `queue_direct_adms_test_command` (`rrr.py:283`) only fires pre-first-connection; a terminal offline for hours still accepts queued commands (they sit until it polls — the PWA poller correctly reports "the terminal may be offline" after 60s, `rrr-integrations.js:172-179`).
- Reconnect path: fix terminal network/config → it polls again → live. PWA shows the "haven't heard from this terminal" checklist with `last_error` when applicable.
- PWA truthfulness gap: the RRR *dashboard* (`rrr-dashboard.js:35`) shows "Direct Cloud live" from sticky `status`, contradicting the integrations screen's 5-min gate — a stale-offline terminal reads "live" on the dashboard.

### MINOR parity gaps (Android vs PWA)

- Android's `queue()` doesn't check liveness — PWA disables test buttons until live.
- Android has no command poll loop — owner must pull-to-refresh to see ack status; PWA polls every 2.5s × 24.
- Android's commission button stays tappable when already ON (backend re-checks, so harmless); PWA replaces it with a "✓ ON" panel.

---

## 4. Biometric — eBioServer bridge

### Works end-to-end

- Pairing code: `POST /rrr/integrations/ebioserver/pairing` (`rrr.py:185-199` → `RRRIntegration.issue_pairing_code`, `app/models/rrr.py:56-70` — 6-digit, SHA-256-hashed, 10-min expiry). Both apps show it (PWA with copy button; Android as selectable text).
- Bridge exchanges the code at `app/bridge/routes.py:512` → integration `status="connected"`; heartbeat (`app/bridge/routes.py:141-196`) reports devices and flips `connected`/`degraded`.
- Device selection: both apps list `devices` from `/rrr/integrations` and `POST /integrations/<id>/device` (`rrr.py:155-183`) ✓.
- Unresolved-punch mapping: PWA dedicated screen (`rrr-mappings.js` — grouped by biometric ID with counts, member search, "Map ID & replay"); Android inline IDENTITY REVIEW + `MemberPickerModal`. Both `POST /rrr/mappings/<external_id>` (`rrr.py:384-405`, replays retained punches via `remap_unresolved`). Minor parity: Android shows raw first-5 events ungrouped (duplicates possible); PWA groups.
- Commissioning: both require a real mapped punch + door-test checkbox (`commissionBox('ebio')` / `commissionIntegration`); backend enforces mapped attendance (`rrr.py:333-340`) ✓.

### Offline UX

- Heartbeat maintains `status`/`last_success_at`; per-device `status` shown in-app. Reconnect = bridge auto-heartbeats, or owner regenerates a pairing code.
- MINOR: PWA's bridge card (`rrr-integrations.js:273-285`) shows "Bridge connected" from sticky status with **no** 5-min staleness gate (unlike the Direct Cloud card) — a powered-off gym PC still reads "connected". Same on Android (`Status: {bridge?.status}`).

---

## 5. Biometric — TCP direct_bridge

### Dead end in-app (major for affected gyms)

- **No setup UI on either platform.** PWA `load()` (`rrr-integrations.js:55-57`) only looks for `adms_direct` and `ebioserver`. Android declares `'direct_bridge'` in its `Integration` type but never renders a section for it.
- Provisioning is manual: bridge pairing API (`app/bridge/routes.py:512-558`, `GymDeployment` path → `connector_type="direct_bridge"`).
- The backend *does* recognize it: `dashboard_for_gym` prefers `direct_bridge` with `status="connected"` in its picker (`app/services/rrr_service.py:314-320`), and the PWA dashboard labels it "Bridge" (`rrr-dashboard.js:30`).
- Net effect for a direct_bridge gym (e.g. Yodha): dashboard says "Bridge live", but the integrations screen shows Direct Cloud setup prompts + the eBioServer fallback card and **hides the mappings link** — no device visibility, no status, no reconnect path in-app. Needs at minimum a read-only status card with last-seen and a "contact support to re-pair" path.

---

## Recommended fix order

1. **Android**: route the WhatsApp status-card tap to the fixed signup screen (or fix the modal URL to use `signup_handshake`) — the current entry 400s.
2. **Backend**: `from app.models import User` (or `from app.models.user import User`) in `app/mobile_api/whatsapp.py` — one line, unblocks PWA completion.
3. **Page + Android**: stop the double submission — when `window.ReactNativeWebView` exists, post the message and skip the page's own `fetch` (keeps the direct fetch as the PWA fallback). Otherwise fixing #2 creates the code-reuse race.
4. **Config**: align `WHATSAPP_REMINDER_TEMPLATE_NAME` default with a provisioned template name (and pin the language code).
5. **In-app**: render a status card for `direct_bridge` integrations (or explicitly message that it's admin-managed).
6. **Fallback honesty**: either deep-link the "Open in Browser" return or remove the button — it currently strands the owner.
