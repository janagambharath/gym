# PWA Code Review: AI Receptionist + WhatsApp Integration

**Date:** 2026-10-11 | **Scope:** `renewal-desk-pwa/src/` → backend `app/mobile_api/bot.py`, `app/mobile_api/whatsapp.py`
**Verdict:** 3 screens fully broken (Bot Setup, Conversation Detail, Lead Detail), 1 partially broken (Conversations list), 1 fully broken flow (Meta embedded signup from PWA), template creation doesn't exist.

---

## 1. AI Receptionist

### 1.1 Overview — ✅ WORKS
**File:** `renewal-desk-pwa/src/screens/bot-overview.js`

| Check | Result |
|---|---|
| Stats load (`GET /api/mobile/v1/bot/overview`) | ✅ Backend `app/mobile_api/bot.py:263` returns `total_conversations`, `total_leads`, `handover_count`, `resolution_rate` — all fields match |
| Resolution % calc | ✅ `closed/total*100`, guarded div-by-zero (`bot.py:295`). PWA renders `(d.resolution_rate\|\|'0')+'%'` — shows `0%` correctly, `75.5%` for decimals (minor cosmetic) |
| Menu navigation | ✅ Conversations/Leads/Bot Setup/Test Bot all route correctly |
| Back button | ✅ `navigate.pop()` |

### 1.2 Conversations List — ⚠️ PARTIALLY BROKEN (wrong field names)
**File:** `renewal-desk-pwa/src/screens/bot-conversations.js` → `GET /bot/conversations` (`bot.py:311`)

Backend returns per conversation: `id, phone, customer_name, state, handover_status, last_message_at`

PWA reads fields that don't exist:
- `bot-conversations.js:15` — `c.needs_handover` → **always falsy**. Backend sends `handover_status` (string). **Handover badge never renders.**
- `bot-conversations.js:18` — `c.last_message` → **always undefined**. Every row shows "No messages" as the preview.
- `bot-conversations.js:21` — `formatRelativeTime(c.updated_at||c.created_at)` → both undefined. `formatRelativeTime` returns `''` for falsy (`utils.js:76`) so no crash, but **no timestamp ever shows**. Backend field is `last_message_at`.

**Fix:** map `handover_status` → needs_handover check (`['human_requested','human_active'].includes(...)`), use `last_message_at`, and either add `last_message` to the backend payload or drop the preview line.

### 1.3 Conversation Detail — 🔴 BROKEN (empty chat bubbles)
**File:** `renewal-desk-pwa/src/screens/bot-conversation-detail.js` → `GET /bot/conversations/{id}` (`bot.py:339`)

Backend message shape: `{id, sender, body, created_at}` (`bot.py:363-370`).

PWA mismatches (`bot-conversation-detail.js:20-23`):
- `m.role==='bot'` → `role` is always undefined → **bot messages get wrong CSS class**
- `m.content||m.text` → both undefined → **every bubble renders EMPTY**
- `m.timestamp||m.created_at` → `created_at` exists, timestamps OK

**Fix:** use `m.sender` (`'bot'`/`'customer'`/`'staff'`) for the class and `m.body` for content.

Reply send (`bot-conversation-detail.js:28`): POST `{body: text}` → matches backend `data.get("body")` (`bot.py:463`) ✅. But note the send path requires `gym.whatsapp_enabled` (`bot.py:472`) — if WhatsApp isn't connected, staff get a generic "Message could not be sent" with no guidance.

**UX gap:** no handover take-over/resume UI. `POST /bot/conversations/{id}/handover` exists (`bot.py:414`, actions `take_over`/`resume_bot`) but the PWA never calls it — an owner who sees a handover conversation has no way to take over from the app.

### 1.4 Leads List — ✅ WORKS
**File:** `renewal-desk-pwa/src/screens/bot-leads.js` → `GET /bot/leads` (`bot.py:135`)

Backend `data.leads[]` with `id, name, phone, source, status, created_at` — all match PWA reads. Detail navigation passes `leadId` correctly.

### 1.5 Lead Detail — 🔴 BROKEN (wrong response shape)
**File:** `renewal-desk-pwa/src/screens/bot-lead-detail.js` → `GET /bot/leads/{id}` (`bot.py:190`)

Backend returns `{lead: {...}, messages: [...]}` (`bot.py:217-231`).

PWA does `const l = res.data` (`bot-lead-detail.js:10`) expecting flat fields → `l.name`, `l.phone`, `l.status`, `l.notes` all undefined → shows "Unknown" / "—" everywhere. `l.transcript` doesn't exist (backend key is `messages`) → **conversation transcript never renders**.

**Fix:** `const l = res.data.lead`, transcript from `res.data.messages` mapping `sender`/`body`.

**UX gap:** "Convert to Member" (`bot-lead-detail.js:31`) just navigates to `add-member` without pre-filling the lead's name/phone — the lead's contact info is lost at the handoff.

### 1.6 Bot Setup — 🔴 BROKEN (cannot load or save)
**File:** `renewal-desk-pwa/src/screens/bot-setup.js` → `GET`/`PATCH /bot/config` (`bot.py:530`, `bot.py:562`)

**Load is broken:** backend returns nested `data.config.{greeting_message, opening_hours, map_link, trial_enabled, ...}` plus `data.faqs[]`. PWA reads flat `res.data.greeting_message` etc. (`bot-setup.js:4`) → **all fields render empty**. Field name mismatch on top: PWA uses `business_hours`, backend uses `opening_hours`.

**Save is broken:** PWA PATCHes (`bot-setup.js:19-22`):
```js
{greeting_message, business_hours, location, trial_offer, faq}
```
Backend allowlist `BOT_CONFIG_FIELDS` (`bot.py:31-40`):
```
{greeting_message, opening_hours, map_link, trial_enabled, trial_price, trial_duration_days, registration_link, handover_enabled}
```
`_validate_bot_config_update` (`bot.py:43`) rejects unknown fields → **every save returns 400 "Unsupported configuration field: business_hours."** The setup form can never save.

**FAQ is unmapped:** PWA has a single "FAQ (one per line)" textarea; backend has separate `POST /bot/faqs`, `PATCH/DELETE /bot/faqs/{id}` (`bot.py:589-635`) with question/answer records. The PWA's `faq` string has no backend counterpart.

**Fix:** rewrite `bot-setup.js` to use `data.config` nesting, `opening_hours`, drop `location`/`trial_offer`/flat `faq`, and either wire the FAQ CRUD endpoints or remove the textarea.

### 1.7 Test Bot — ✅ WORKS
**File:** `renewal-desk-pwa/src/screens/bot-test.js` → `POST /bot/test` (`bot.py:673`)

PWA sends `{message}`, reads `r.data.response` — backend `test_generate_response` returns `{input, response, intent, handover, lead_captured}` (`bot_service.py:205-213`) ✅. No real WhatsApp send (sandbox) ✅. Enter-key handler ✅.

### 1.8 Entitlement gate — ⚠️ UX DEAD-END
All bot endpoints require `WHATSAPP_BOT_FEATURE` (`bot.py:116-129`) → 403 `FEATURE_NOT_ENABLED` "WhatsApp AI Bot is not enabled for this gym." The PWA treats this like empty data — the owner sees "No conversations" / "No leads yet" with **no indication the feature is disabled**. Flag: surface the 403 distinctly.

---

## 2. WhatsApp Embedded Signup

### 2.1 Setup screen — ✅ (until the handoff)
**File:** `renewal-desk-pwa/src/screens/whatsapp-setup.js`

`GET /whatsapp/connection-status` (`whatsapp.py:348`) field mapping is correct (`status`, `status_description`, `next_action`, `business_phone_number`) ✅.

### 2.2 Embedded signup handoff — 🔴 BROKEN (missing config_id)
**File:** `renewal-desk-pwa/src/screens/whatsapp-setup.js:31-38`

PWA builds:
```
/api/mobile/v1/whatsapp/embedded-signup-page?handshake=…&gym_id=…&gym_name=…&meta_app_id=…
```

Backend `embedded_signup_page` (`whatsapp.py:444`) reads `meta_app_id`, **`config_id`**, `feature_type`, `handshake` and validates:
```python
if not re.fullmatch(r"[A-Za-z0-9_-]{4,128}", config_id):
    return "...Configuration ID is missing or invalid.", 400
```

The PWA **never passes `config_id`** (it receives it from `GET /whatsapp/onboarding-config` as `d.config_id` but drops it). **The signup page always returns 400 "Configuration ID is missing or invalid" — Meta embedded signup can never launch from the PWA.**

The PWA also passes `gym_id`/`gym_name`, which the backend ignores.

**Fix (one line):** add `&config_id=${encodeURIComponent(d.config_id||'')}` to the URL in `whatsapp-setup.js:34`.

### 2.3 Backend signup page — ✅ solid
- XSS allowlist on all reflected params (`whatsapp.py:461-468`) ✅
- Custom CSP for Meta SDK, `no-store` cache, `X-Frame-Options: SAMEORIGIN` ✅
- Handshake token instead of owner access token in URL ✅

### 2.4 OAuth callback — ✅ exists
`POST /whatsapp/connect-waba` (`whatsapp.py:503`) handles the embedded-signup callback (`code` + `waba_id` + `phone_number_id`) via `EmbeddedSignupService.process_signup`, plus a manual fallback. Phone-number selection is server-driven.

### 2.5 Credential storage — ✅ secure
`Gym.whatsapp_access_token_enc` — encrypted at rest via `encrypt_token`/`decrypt_token` (`app/models/gym.py:59,122-133`). No tokens in URLs or client storage.

---

## 3. Meta Template Creation — 🔴 DOESN'T EXIST

There is **no template creation flow** anywhere:
- No `POST` template endpoint in `app/mobile_api/` (only `GET /campaigns/templates` → `campaigns.py:284`)
- `get_approved_templates()` returns hardcoded `APPROVED_TEMPLATES` (`app/services/campaign_service.py:117-122`)
- No Graph API `/{waba_id}/message_templates` POST call in `app/services/`
- No status polling, no rejection/appeal handling

`campaign-create.js:7` lists templates from the hardcoded set — if Meta rejects or deprecates a template, or the gym needs a new one, there is **no in-app path to create it**. This must be built before production if gyms are expected to self-serve templates.

---

## Fix priority (pre-production)

| # | Issue | File:line | Severity |
|---|---|---|---|
| 1 | Bot Setup PATCH always 400 (wrong field names) | `bot-setup.js:19-22` ↔ `bot.py:31-40` | 🔴 Blocker |
| 2 | Bot Setup GET reads flat, backend nests under `data.config` | `bot-setup.js:4` ↔ `bot.py:538-556` | 🔴 Blocker |
| 3 | Embedded signup URL missing `config_id` → 400 | `whatsapp-setup.js:34` ↔ `whatsapp.py:463-465` | 🔴 Blocker |
| 4 | Conversation detail renders empty bubbles (`role`/`content` vs `sender`/`body`) | `bot-conversation-detail.js:20-23` ↔ `bot.py:363-370` | 🔴 Blocker |
| 5 | Lead detail reads flat, backend nests under `data.lead` | `bot-lead-detail.js:10` ↔ `bot.py:217-231` | 🔴 Blocker |
| 6 | Conversations list: no preview, no timestamp, no handover badge | `bot-conversations.js:15,18,21` ↔ `bot.py:322-333` | 🟠 Major |
| 7 | No Meta template creation flow at all | (missing) | 🟠 Major |
| 8 | No handover take-over UI in PWA | (missing; endpoint `bot.py:414`) | 🟡 Minor |
| 9 | Lead→Member conversion drops name/phone | `bot-lead-detail.js:31` | 🟡 Minor |
| 10 | 403 FEATURE_NOT_ENABLED shows as empty state | all bot screens | 🟡 Minor |

**Root cause pattern:** the PWA bot screens were written against a different (probably earlier or planned) API contract than what `app/mobile_api/bot.py` implements. A contract-sync pass over all six bot screens is needed, not just spot fixes.
