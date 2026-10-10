# PWA Council Review — Direct Cloud Gym Visit (Elite Gym)

**Date:** 2026-10-10
**Reviewer:** PWA council member (static code review)
**Scope:** PWA only. Bharath at Elite Gym TODAY, Direct Cloud ADMS via phone PWA.
**Method:** Screen-by-screen trace of `rrr-integrations.js`, `rrr-mappings.js`, `member-detail.js` block/unblock, verified against backend API contracts in `app/mobile_api/rrr.py` and `app/services/rrr_service.py`.

---

## Verdict: 1 BLOCKER that can kill the visit, 2 MAJORs that will confuse him under pressure. The PWA code itself is solid — the risks are in device/network reality and one wrong-checklist trap.

---

## BLOCKER-1: X2008 may not support HTTPS ADMS — Direct Cloud could be dead on arrival

**Where:** `rrr-integrations.js` → `directPanel()` → terminal settings card.

**What happens:** The PWA shows:
- Cloud Server Address: `gym-production-910c.up.railway.app`
- Port: `443`
- HTTPS: `On`
- Path: `/iclock/<token>`

These come from `adms_terminal_settings()` in `app/services/rrr_service.py:337`, computed from `PUBLIC_BASE_URL` (Railway = HTTPS).

**The problem:** eSSL/ZKTeco ADMS terminals historically speak **plain HTTP only**. The X2008's Cloud Server Setting menu may not have an HTTPS toggle at all. If the terminal can only do HTTP on port 80, it can never reach `https://gym-production-910c.up.railway.app:443`.

**Evidence this is a known risk:** `docs/EBIOSERVER_RRR_ONBOARDING.md:62` says: *"If the terminal cannot use HTTPS, use a router/site-to-cloud VPN or obtain an eSSL-supported hosted deployment design."* The docs anticipate this failure.

**Why it's a BLOCKER:** If the X2008 doesn't do HTTPS, the terminal never phones home. `isLive()` stays false. The commissioning buttons stay disabled forever. The entire Direct Cloud path is dead. There is no HTTP fallback — Railway is HTTPS-only, and the backend has no plain-HTTP ADMS listener.

**What to do at the gym:**
1. In the X2008's Cloud Server Setting menu, look for any HTTPS/SSL/TLS option. If present, enable it and proceed.
2. If no HTTPS option exists, try HTTP anyway (port 80, same host) — it will fail against Railway, confirming the limitation.
3. **Fallback:** eBioServer on his laptop (local HTTP on the LAN — no HTTPS needed). The bridge binary is ready.

**Code fix (post-visit):** The PWA should warn when `settings.https` is true: *"If your terminal has no HTTPS option in Cloud Server Settings, it cannot use Direct Cloud — use eBioServer instead."* Currently it only warns when HTTPS is *off* (the reverse case).

---

## MAJOR-1: Member-detail Block button WILL 409 during the door test — wrong tool for the job

**Where:** `member-detail.js:266` → `POST /api/mobile/v1/rrr/members/<id>/access`.

**What happens:** The "Block Biometric Access" button on member detail calls the `/access` endpoint, which is gated (backend `rrr.py:407-413`):
- Returns **409 DEVICE_NOT_READY** if `commands_enabled` is false (i.e., before commissioning completes)
- Returns **409** if the member has no bound `device_enroll_number`

**The trap:** Any checklist that says "PWA → pick a test member → Block Biometric Access" for the door test will fail with: *"Biometric commands are not available: finish device commissioning and bind this member's enroll number first."*

This is circular — you can't finish commissioning without the door test, and you can't do the door test via this button until commissioning is done.

**The correct door-test path:** Use the commissioning console's **"2. Test block"** / **"3. Test unblock"** buttons with a temporary User ID (e.g., 999). These use `/adms/commands` (test commands), which work *before* commissioning. The PWA's `wireDirectPanel` handles this correctly.

**The PWA is not broken here** — it shows the error as a toast. But the error message is confusing under pressure, and the button's presence on member detail invites the wrong workflow.

**Code fix (post-visit):** Hide or disable the member-detail Block button with an explanatory tooltip when `commands_enabled` is false, instead of letting it 409.

---

## MAJOR-2: `isLive()` 5-minute window can disable commissioning buttons mid-test

**Where:** `rrr-integrations.js:14-18` → `isLive()` → `wireDirectPanel()` button `disabled` state.

**What happens:** The probe/test-block/test-unblock buttons are `disabled` unless `isLive(direct)` — which requires `last_success_at` within the last **5 minutes**.

**The trap:** The terminal phones home on its own poll interval (typically 1-5 minutes for ADMS). If Bharath is slow between steps (talking to the gym owner, typing settings, etc.), the terminal's last check-in can age past 5 minutes. The buttons grey out. He'll think something broke.

The UI does show "LAST SEEN X MIN AGO" vs "LIVE", but under pressure, disabled buttons without an inline explanation look like a bug.

**Mitigation:** The page reloads after each command (`load(el)`), which re-fetches `last_success_at`. If the terminal is still polling, it'll go live again. But there's a 60-second `pollCommand` timeout that says "Still waiting — the terminal may be offline" — which is the right message.

**Code fix (post-visit):** Add a tooltip/explanation on disabled buttons: *"Waiting for terminal check-in (last seen X ago)."* Or widen the window to 10 minutes.

---

## Screen-by-screen results

### 1. `rrr-integrations.js` — Direct Cloud provision → terminal settings

| Check | Result |
|---|---|
| Provision form → `POST /rrr/integrations/adms/provision` | ✅ Correct endpoint, correct fields (`device_serial`, `device_name`) |
| Response handling | ✅ Calls `load(el)` to refresh — doesn't depend on provision response shape |
| Error display | ✅ `apiMessage()` surfaces backend error, e.g., "device_serial is required" or 409 conflict |
| Terminal settings card fields | ✅ All 5 fields (`server_address`, `server_port`, `https`, `path`, `server_mode`) match backend `adms_terminal_settings()` output |
| Copy buttons | ✅ `copyText()` with `navigator.clipboard` + `execCommand` fallback for older mobile browsers |
| X2008 menu guidance | ✅ "Menu → Comm. → Cloud Server Setting" is correct for eSSL |
| Path with token (`/iclock/<token>`) | ⚠️ **MINOR:** If the X2008's path field has a character/length limit, the token path might get truncated. No validation. The doc warns "do not paste `/iclock` into a field that accepts only host/IP" but doesn't address token length. |
| HTTPS warning | ❌ **BLOCKER-1:** No warning when HTTPS=On but terminal may not support it (see above) |

**Verdict: BLOCKER** (HTTPS question)

### 2. Commissioning console — probe → test block/unblock → checkbox → enable

| Check | Result |
|---|---|
| `wireCommission` button unlock logic | ✅ Correct: `checkbox.checked && hasAttendance && hasAckedTest` |
| `hasAttendance` check | ✅ `(integration.records_synced || 0) > 0` matches backend's "mapped real attendance event" requirement |
| `hasAckedTest` check | ✅ `commands.some(c => c.status === 'acked' && [...].includes(c.action))` matches backend's acked test command requirement |
| Hint text when not ready | ✅ Shows "unlocks after a test command..." or "unlocks after the first real punch..." |
| Enable → `POST /integrations/<id>/commission` | ✅ Correct endpoint, correct body `{physical_test_passed: true}` |
| Error on commission failure | ✅ Shows backend message, e.g., "Run a test command... before enabling" |
| Success → `load(el)` refresh | ✅ Shows "✓ Automatic block/unblock is ON" |
| `pollCommand` timeout (60s) | ✅ Shows "Still waiting — the terminal may be offline" — actionable |
| Test User ID validation | ✅ Regex `^[1-9][0-9]{0,8}$`, clear error: "Enter the temporary device User ID first (digits only, e.g. 999)" |
| Button disable during command queue | ✅ Prevents double-submit; re-enables on error |

**Verdict: CLEAR** (logic is correct; MAJOR-2 about `isLive` window is the only concern)

### 3. `rrr-mappings.js` — Identity mapping (first punch → map to member)

| Check | Result |
|---|---|
| `GET /rrr/mappings/unresolved` | ✅ Correct endpoint |
| Group by biometric ID | ✅ Sensible — groups multiple punches from same terminal user |
| Member search | ✅ Debounced 300ms, searches by name/phone |
| Map → `POST /rrr/mappings/<id>` | ✅ Correct endpoint, correct body `{member_id}` |
| "Choose member" validation | ✅ "Choose the matching member first." if no selection |
| Empty state | ✅ "No unresolved biometric punches. New unknown IDs will appear here automatically." |
| Error handling | ✅ Retry button on load failure; inline error on map failure |

**Verdict: CLEAR**

**MINOR:** The member dropdown loads first 100 members. If Elite Gym has >100 members and the test puncher isn't in the first 100, he must search. The UI does say "Showing first 100 members — search to narrow down." Acceptable.

**MINOR:** After mapping, `load(el)` refreshes the whole screen. If there are multiple unmapped IDs, he loses his search query. Annoying but not blocking.

### 4. Member detail block/unblock — manual door-test path

| Check | Result |
|---|---|
| Button → `POST /rrr/members/<id>/access` | ✅ Correct endpoint, correct body `{action: 'block'/'unblock'}` |
| Confirm dialog | ✅ `showConfirm` with clear messaging |
| Success handling | ✅ Updates label, shows toast |
| 409 before commissioning | ❌ **MAJOR-1:** Will fail during door test (see above) |
| Enroll number requirement | ⚠️ **MINOR:** After commissioning, member still needs bound `device_enroll_number`. If Elite Gym members don't have enroll numbers, Block still 409s. The error message mentions this but the PWA doesn't guide him to bind enroll numbers. |

**Verdict: MAJOR** (wrong tool for pre-commissioning door test)

### 5. Cross-cutting checks

| Check | Result |
|---|---|
| Dead buttons | ✅ None found — all buttons in the Direct Cloud flow have handlers |
| Wrong API field mappings | ✅ None found. All PWA field reads (`terminal_settings.server_address`, `response.data.command.id`, `integration.records_synced`, etc.) match backend response shapes. The whatsapp `s.connected` bug pattern does not repeat here. |
| Missing error handling | ✅ All API calls have error paths with user-facing messages |
| Confusing labels | ⚠️ **MINOR:** "Temporary device User ID" — Bharath may not know what this is. It's a fake enroll number for testing (e.g., 999) that doesn't correspond to a real member. The placeholder says "Example: 999" which helps, but a one-line explanation would prevent confusion. |
| Back button | ✅ `navigate.back()` on integrations header |

---

## Summary for the council

| Screen | Verdict | Key issue |
|---|---|---|
| Direct Cloud provision + settings | **BLOCKER** | X2008 may not support HTTPS; no warning in PWA |
| Commissioning console | **CLEAR** | Logic correct; watch the 5-min `isLive` window |
| Identity mapping | **CLEAR** | Solid |
| Member block/unblock | **MAJOR** | 409s before commissioning; use console test buttons for door test |

**The PWA code is production-ready.** The risks are:
1. **Device reality** (HTTPS support) — cannot be fixed in code today; test at the gym, fallback to eBioServer.
2. **Checklist accuracy** — ensure the go-live checklist says "use commissioning console test block/test unblock" for the door test, NOT "member detail Block button."
3. **The 5-minute `isLive` window** — if buttons grey out, wait for the terminal to phone home and reload.

No code changes are strictly required before the visit. The one improvement worth making (5 minutes): add an HTTPS warning to the terminal settings card when `settings.https` is true.
