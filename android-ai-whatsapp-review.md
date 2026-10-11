# Android AI Receptionist + WhatsApp Review (pre-AAB)

Date: 2026-10-11. Scope: `renewal-desk-android/src/` vs PWA `renewal-desk-pwa/src/`, backend `app/mobile_api/bot.py` + `app/mobile_api/whatsapp.py`.

---

## CRITICAL — must fix before AAB

### 1. Android embedded signup is broken (wrong query param + token leak)

**File:** `renewal-desk-android/src/screens/WhatsAppSetupScreen.tsx:60-66`

```js
const { meta_app_id, config_id } = res.data;   // signup_handshake ignored
const tokenParam = session?.accessToken ? `&token=${encodeURIComponent(session.accessToken)}` : '';
const pageUrl = `${config.apiBaseUrl}/api/mobile/v1/whatsapp/embedded-signup-page?meta_app_id=...&config_id=...${tokenParam}`;
```

**Backend** (`app/mobile_api/whatsapp.py:461-463`) requires a `handshake` param matching `[A-Za-z0-9_.-]{16,512}` and returns **400 "Signup handshake is missing or invalid"** when absent. Android sends `token=` (the full Bearer access token), not `handshake=`. Result: the embedded-signup WebView page **fails to load with a 400** on Android.

Two problems:
- **Functional:** missing `handshake` → 400 → signup cannot start.
- **Security:** the owner's full access token is placed in a page URL (server access logs, WebView history). The backend docstring explicitly says: *"The owner's full access token must never be placed in a page URL."* The `onboarding-config` endpoint mints a short-lived `signup_handshake` for exactly this purpose (`whatsapp.py:419-421`).

**PWA does it correctly** (`renewal-desk-pwa/src/screens/whatsapp-setup.js:33`):
```js
const url = `${base}/api/mobile/v1/whatsapp/embedded-signup-page?handshake=${encodeURIComponent(d.signup_handshake||'')}...`;
```

**Fix:**
1. Add `signup_handshake: string` to the `getWhatsAppOnboardingConfig` return type (`apiClient.ts:483-489` — currently missing).
2. In `WhatsAppSetupScreen`, destructure `signup_handshake` and build `?handshake=...&meta_app_id=...&config_id=...`. Remove the `token=` param entirely.

### 2. External-browser fallback is a dead end (OAuth completes outside the app)

**File:** `renewal-desk-android/src/screens/WhatsAppSetupScreen.tsx:130-135`

`onOpenWindow` intercepts Meta's OAuth popup and opens it in the system browser via `WebBrowser.openBrowserAsync`. The completion signal (`WA_EMBEDDED_SIGNUP` postMessage → `window.ReactNativeWebView.postMessage`) only works inside the WebView (`app/mobile_api/whatsapp.py:875-876`). In the external browser there is **no deep-link return path** — `App.tsx` has no `Linking` listener, and the schemes in `app.json` (`renewaldesk://`) are not wired to any handler.

Result: user completes Meta signup in Chrome, returns to the app manually, and the connection is never saved (the `connect-waba` POST never fires). The "Having trouble? Open in Browser" button (`whatsapp.py:856`) leads to the same dead end.

**Fix options (pick one):**
- Keep the popup inside the WebView (don't intercept `onOpenWindow`; let Meta's popup render in-WebView), or
- Implement the deep-link return: add a `Linking` listener in `App.tsx` for `renewaldesk://whatsapp-complete`, and have the external flow redirect there (requires backend HTML change).

---

## HIGH

### 3. Stats parity: Android and PWA show different metrics from different endpoints

| | PWA (`bot-overview.js:9`) | Android (`BotOverviewScreen.tsx:82-83`) |
|---|---|---|
| Endpoint | `/api/mobile/v1/bot/overview` | `/api/mobile/v1/bot/stats` |
| Metrics | Conversations, Leads, **Handovers, Resolution %** | Conversations, Leads, **Contacted, Trials** |

Backend calculations are correct in both (`bot.py:263-307` for overview, `bot.py:698-722` for stats):
- `handover_count` = conversations with `handover_status IN ('human_requested','human_active')` — correct.
- `resolution_rate` = `closed / total_conversations * 100` — correct, guards divide-by-zero.

But the user-facing numbers differ by platform. The review brief asked to verify "handovers, resolution %" — **Android does not display either**. Decide on one canonical set and align both clients.

### 4. FAQ enable/disable toggle missing on both platforms

Backend supports `PATCH /api/mobile/v1/bot/faqs/<id>` with `{enabled: bool}` (`bot.py:637-660`). Neither client exposes it:
- Android `BotSetupScreen.tsx`: FAQ rows show ON/OFF badge but only offer **delete** — no toggle, no edit.
- PWA `bot-setup.js`: same gap (config PATCH only).

Users cannot disable a bad FAQ without deleting it. (Parity: both missing — fix in both or neither.)

---

## MEDIUM

### 5. "View lead" from conversation detail is dead code

**File:** `renewal-desk-android/App.tsx:468-475` — `BotConversationDetailScreen` is mounted **without** `onOpenLead`. The screen gates the button on `linkedLead && onOpenLead` (`BotConversationDetailScreen.tsx:290`), so it never renders. The backend returns `lead` in the detail response (`bot.py:339`), so the data is there — just wire `onOpenLead={(lead) => navigation.navigate('BotLeadDetail', { leadId: lead.id })}`.

### 6. FAQ edit missing (backend supports it)

`PATCH /bot/faqs/<id>` also accepts `question`/`answer` updates. Both clients only allow add/delete. Minor.

---

## VERIFIED WORKING

- **Conversations list** (`BotConversationsScreen.tsx`): loads via `GET /bot/conversations`, search + status filters work client-side, opens detail via `onSelectConversation`. Skeleton + empty + error states present. ✓
- **Transcript detail** (`BotConversationDetailScreen.tsx`): `GET /bot/conversations/<id>` → messages; handover take-over/resume via `POST .../handover {action}`; manual reply via `POST .../message {body}`. Closed-conversation guards correct. ✓
- **Leads** (`BotLeadsScreen.tsx` / `BotLeadDetailScreen.tsx`): paginated `GET /bot/leads` with search/status filters; detail `GET /bot/leads/<id>`; status update via PATCH (`BotLeadDetailScreen.tsx:108`). ✓
- **Bot Setup save** (`BotSetupScreen.tsx:118-168`): PATCH `/bot/config` with correct payload shape (`BotConfigUpdate`); price/duration client validation; 403/owner-only gating via `canEdit`; read-only banner for staff. ✓
- **Test Bot** (`BotTestScreen.tsx`): `POST /bot/test {message}` → renders response + intent + handover flag. Endpoint exists (`bot.py:673`). ✓
- **Back navigation**: all bot screens use `navigation.goBack()` via `onBack` — wired correctly in `App.tsx:446-475, 1066-1067`. ✓
- **Credential storage**: session tokens in `expo-secure-store` (`apiClient.ts:63`), never in AsyncStorage. ✓ (Except the URL leak in finding #1.)
- **Template creation**: does not exist as a flow on either platform — both only *select* from Meta-approved templates (`GET /campaigns/templates?purpose=`, `campaigns.py:284`). Template creation happens in Meta's dashboard. Not a bug, but flagging since the brief asked: there is no in-app template creation or status polling to review.

---

## BACKEND ENDPOINT TRACE (for reference)

| Android call | Backend route | Status |
|---|---|---|
| `GET /bot/stats` | `bot.py:698` | ✓ exists |
| `GET /bot/config` | `bot.py:530` | ✓ |
| `PATCH /bot/config` | `bot.py:562` | ✓ |
| `POST /bot/faqs` | `bot.py:589` | ✓ |
| `DELETE /bot/faqs/<id>` | `bot.py:625` | ✓ |
| `PATCH /bot/faqs/<id>` | `bot.py:637` | ✓ (unused by clients) |
| `GET /bot/conversations` | `bot.py:311` | ✓ |
| `GET /bot/conversations/<id>` | `bot.py:339` | ✓ |
| `POST /bot/conversations/<id>/handover` | `bot.py:414` | ✓ |
| `POST /bot/conversations/<id>/message` | `bot.py:459` | ✓ |
| `GET /bot/leads` | `bot.py:135` | ✓ |
| `GET /bot/leads/<id>` | `bot.py:190` | ✓ |
| `PATCH /bot/leads/<id>` | `bot.py:233` | ✓ |
| `POST /bot/test` | `bot.py:673` | ✓ |
| `GET /whatsapp/onboarding-config` | `whatsapp.py:392` | ✓ |
| `GET /whatsapp/embedded-signup-page` | `whatsapp.py:444` | ✓ (400s on Android's params) |
| `POST /whatsapp/connect-waba` | `whatsapp.py:504` | ✓ |

## Recommendation

Fix #1 (handshake param) before the AAB — without it, WhatsApp embedded signup cannot work on Android at all. #2 needs a decision on the popup strategy. #3 needs a product call on which metric set is canonical.
