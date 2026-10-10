# Council Review — Reliability / Edge Cases (Direct Cloud ADMS)

**Date:** 2026-10-10
**Reviewer:** Reliability seat
**Scope:** Elite Gym onboarding via Direct Cloud ADMS — backend (`app/adms/`, `app/mobile_api/rrr.py`), PWA, Android. Spotty gym wifi, time pressure, owner watching.

**Verdict: No BLOCKERs. 3 MAJORs that will bite in the field. Core flow is solid.**

---

## MAJOR-1: Stuck test commands have no recovery path

**What:** If the X2008 goes offline after a test command is queued, the command sits in `queued` status indefinitely. The `COMMAND_PENDING` 409 then blocks ALL future test commands. There is no cancel/clear endpoint and no expiry on queued commands.

**Field scenario:**
1. Terminal polls once (brief wifi window), Bharath taps "Send safe connection probe"
2. Wifi drops before the terminal's next poll
3. Command stuck in `queued` forever
4. Bharath retries → 409 → PWA shows "The terminal did not accept another test yet."
5. He is stuck. No explanation, no recovery button, no way forward except waiting for wifi to stabilize.

**Evidence:**
- `app/mobile_api/rrr.py` `queue_direct_adms_test_command`: `COMMAND_PENDING` 409 on any existing `queued`/`delivered` command
- `app/adms/routes.py` `getrequest`: queued → delivered only on terminal poll; no timeout
- No DELETE/cancel route for `rrr_adms_commands` exists

**Workaround:** Wait for wifi to stabilize — the terminal picks up the queued command on its next poll, then acks it, unblocking the queue. But nothing in the UI explains this.

**Fix (post-visit):** Add a "Cancel pending command" button, or auto-expire `queued` commands after N minutes.

---

## MAJOR-2: The `DEVICE_OFFLINE` guard is dead code

**What:** `queue_direct_adms_test_command` returns 409 `DEVICE_OFFLINE` ("Wait until the terminal is connected") if `integration.status != "connected"`. But `status` is set to `"connected"` on every terminal poll (`_touch` in `app/adms/routes.py`) and **is never reset to offline**. No background job marks stale integrations. No staleness check exists anywhere in the backend.

**Impact:** The guard never fires. Bharath can queue test commands for a terminal that's been offline for hours. Combined with MAJOR-1, this means queuing into the void → stuck commands → blocked commissioning.

**Evidence:**
- `app/adms/routes.py:63-64`: `_touch()` sets `status = "connected"`, never anything else
- `grep "offline\|stale" app/services/rrr_service.py app/mobile_api/rrr.py` → no results

**Fix (post-visit):** Either mark integrations stale server-side (e.g., `last_success_at < now - 10min` → treat as offline in the guard), or remove the dead guard so it doesn't imply protection that doesn't exist.

---

## MAJOR-3: Android shows "LIVE" with no staleness check

**What:** The PWA correctly computes liveness client-side: `status === 'connected'` AND `last_success_at` within 5 minutes, else shows "LAST SEEN X AGO" (`rrr-integrations.js:23-29`).

Android does not: `direct?.status === 'connected' ? 'LIVE' : 'SET UP'` (`RrrGrowthScreen.tsx:141`). No time check.

**Impact:** If Bharath uses the Android app at the gym and the X2008 drops off wifi, the screen keeps saying "LIVE" indefinitely. He'll queue test commands into a dead terminal (see MAJOR-1, MAJOR-2) without realizing it's offline.

**Fix:** Port the PWA's 5-minute `isLive()` check to Android. Small change, high value.

---

## MINOR-1: Server never syncs terminal clock

**What:** Nothing in the ADMS implementation pushes time to the X2008. `_parse_device_time` (`app/adms/routes.py:86`) assumes terminal timestamps are in the gym's timezone (default Asia/Kolkata).

**Impact:** Doesn't block commissioning. But if the X2008 clock is wrong (power cuts reset cheap terminals; wrong timezone is common on first setup), every attendance timestamp is silently wrong. A terminal set to UTC shifts all punches by 5:30.

**Mitigation at the gym:** Glance at the X2008's displayed clock before starting. If wrong, set it in the terminal menu.

---

## MINOR-2: PWA 409 message doesn't explain the stuck state

**What:** On `COMMAND_PENDING`, the PWA shows "The terminal did not accept another test yet." It doesn't say a previous command is still pending, or that waiting for the terminal to reconnect will clear it.

**Fix (post-visit):** Change to something like: "A test command is still waiting for the terminal. Wait for it to reconnect and acknowledge, then retry."

---

## CLEAR (verified safe)

| Risk | Verdict |
|---|---|
| Commands lost on wifi drop | **CLEAR.** Pull-based delivery; `getrequest` re-sends `delivered` commands until the terminal posts a result (`devicecmd`). A short outage cannot silently drop a command — the comment in code says exactly this. |
| Rate limits locking him out | **CLEAR.** `adms/commands`: 20/hour; `manual_member_access`: 30/hour; `pairing`: 10/hour. Generous for a commissioning session with retries. |
| Token expiry mid-visit | **CLEAR.** PWA `api.js` has silent token refresh with a single-flight guard (`refreshOnce`). 401 → refresh → retry, no login kick. |
| Hardcoded URLs breaking on mobile data | **CLEAR.** All hardcoded URLs point to the production Railway URL (`gym-production-910c.up.railway.app`). No localhost/127.0.0.1 in client code paths. |
| API timeouts on slow mobile data | **CLEAR.** 15s timeout on both PWA and Android with AbortController. Reasonable. |
| PWA command polling UX | **CLEAR.** Polls every 2.5s × 24 tries (60s), then shows "Still waiting — the terminal may be offline. It will pick the command up when it reconnects." Good. |
| Provision returns wrong server values | **CLEAR.** `adms_terminal_settings` computes from `PUBLIC_BASE_URL` (falling back to request host). The exact values to type into the terminal are shown. Per-integration path token makes the URL unguessable. |
| Pairing code expiry (Direct Cloud) | **CLEAR.** Not applicable — Direct Cloud uses no pairing code. Only relevant for the eBioServer fallback path. |

---

## What to tell Bharath (field guidance)

1. **"If a test command seems stuck, don't keep tapping — check the terminal's wifi first."** One pending command blocks all others. Wait for the terminal to reconnect; it'll pick up the queued command.
2. **"Use the PWA (phone browser), not Android, for commissioning."** The PWA shows "LAST SEEN X AGO" when the terminal drops; Android will lie and say "LIVE".
3. **"Glance at the X2008's clock before you start."** If it's wrong, fix it in the terminal menu — otherwise all attendance times will be off.
4. **Rate limits won't stop you.** 20 test commands/hour is plenty.
5. **Your login won't expire mid-visit.** Token refreshes silently.
