# Council Backend Review — Elite Gym Direct Cloud ADMS

**Date:** 2026-10-10
**Reviewer:** Backend council member
**Scope:** `app/` backend only. Direct Cloud ADMS path (X2008 → RRR cloud).
**Context:** `elite-onboarding-review.md` read. Plan is Direct Cloud first, eBioServer on his laptop as backup.

## Verdict: 1 MAJOR that can kill the gym visit, 1 MAJOR trap, rest CLEAR.

---

## Endpoint 1: `POST /api/mobile/v1/rrr/integrations/adms/provision`

**Rating: MAJOR** (one trap)

What I verified:
- Serial: stripped, truncated to 120 chars, 422 if empty. No format validation — accepts anything non-empty. Fine.
- Conflict: 409 if the serial is registered to a different gym. Correct.
- Idempotent: re-provisioning the same gym updates the existing row (new serial, new path token, resets status). Good — he can fix a typo'd serial by re-provisioning.
- Returns `terminal_settings` with server address/port/https/path computed from `PUBLIC_BASE_URL`. Correct.
- Auth: `token_required` + `gym_owner` role. No rate limiter — acceptable, it's idempotent and owner-only.

**The trap — serial mismatch silently drops ALL terminal traffic:**
`app/adms/routes.py::_device()` — when the terminal hits `/iclock/<token>/cdata`, the backend looks up the integration by path token, then checks `serial != row.device_serial → return None`. When it returns None, the endpoint replies "OK" (deliberately indistinguishable from healthy, to prevent serial enumeration).

Consequence: if the serial he types at provision differs by even one character from what the X2008 actually reports in its `SN` parameter (typo, sticker vs actual, case difference), the terminal will appear to "never connect." No error anywhere. The integrations screen stays on "not configured" forever. There is no "we see traffic from unknown serial" diagnostic.

**At the gym:** the serial must be copied EXACTLY from the terminal's Menu → System Info (not the box, not memory). If the terminal won't connect, re-provision with the serial re-read from the device.

---

## Endpoint 2: `POST /api/mobile/v1/rrr/integrations/<id>/adms/commands`

**Rating: CLEAR**

What I verified:
- Integration scoped to `gym_id` + `connector_type="adms_direct"`. 404 otherwise. Good.
- `DEVICE_OFFLINE` 409 if `integration.status != "connected"` — prevents queueing commands into the void. Correct.
- Action whitelist: `probe_info`, `block_test`, `unblock_test`. 422 otherwise. Good.
- `test_enroll_number` validated as 1–9 digits for block/unblock tests. Good.
- `COMMAND_PENDING` 409 if a command is already queued/delivered-unacked — prevents pile-up. Good.
- Rate limit: 20/hour. Fine for commissioning.
- Every queue is audited with actor ID. Good.

No issues found.

---

## Endpoint 3: `POST /api/mobile/v1/rrr/integrations/<id>/commission`

**Rating: CLEAR** (with one note)

What I verified — the three checks:
1. `physical_test_passed is True` → 422 otherwise. Clear message.
2. Mapped attendance: requires an `RRRAttendanceEvent` with `processing_status="processed"`, filtered by `device_serial=row.device_serial` when set. 409 with clear message otherwise. **Note:** "processed" means the punch must be MAPPED to a member via the identity-mapping flow — an unmapped test punch alone is not enough. The PWA guides this, but he must map the punch before commissioning.
3. Acked test command (adms_direct only): requires a `probe_info`/`block_test`/`unblock_test` with `status="acked"`. 409 with clear message otherwise. Correct.

No wrong-rejection path found: the serial filter is consistent with `_device()` (mismatched serials never record attendance, so they can't cause a false "no attendance" — the failure surfaces earlier as "terminal not connecting").

---

## Endpoint 4: The ADMS terminal path (`/iclock/...`)

**Rating: MAJOR** (the biggest risk of the visit)

What I verified:
- `DIRECT_ADMS_ENABLED=true` is live in production — `/iclock/cdata` and `/iclock/registry` return 200. The terminal path is reachable.
- Routes handle `/iclock/<token>/cdata`, `/iclock/<token>/cdata.aspx`, `/iclock/<token>/registry`, `/iclock/<token>/registry.aspx` (GET+POST). Good firmware-spelling coverage.
- Command delivery: terminal GETs cdata → server replies `C:<id>:<command_text>` with `DATA UPDATE USERINFO PIN=<enroll>\tPri=1` (block) / `Pri=0` (unblock). Standard ZKTeco PUSH SDK format. Correct.
- Delivered commands are re-sent until the terminal ACKs via `/iclock/devicecmd`. Idempotent. Good.
- CSRF exempt for the ADMS blueprint (terminals can't present tokens). Correct.

**The risk — HTTPS:**
`adms_terminal_settings()` returns `https: true, port: 443` because `PUBLIC_BASE_URL` is `https://`. The X2008 (ZAM180_TFT firmware) ADMS stack is **typically HTTP-only** — community ADMS implementations document pointing the device with "HTTPS disabled." I could not confirm from eSSL docs whether this X2008 firmware build supports TLS.

If the terminal cannot do HTTPS:
- Setting https/443 as instructed → connection fails silently at the TLS handshake.
- Falling back to http/port 80 → Railway returns **301 redirect to HTTPS** (verified live), which ADMS terminals do not follow → silent failure.

**There is no plain-HTTP path to the production backend.** This is the single most likely failure at the gym.

**Mitigations for him:**
1. Check the X2008's Cloud Server Setting menu for an HTTPS/SSL toggle — some firmware builds have it. If yes, use the values exactly as the PWA shows.
2. If no HTTPS option: try anyway — some X2008 firmware does TLS. Watch the integrations screen for status → "connected".
3. If it fails: this is where the eBioServer-on-laptop (or a local reverse proxy / VPN) becomes the path. The laptop bridge is already built and ready.

**Secondary note — path token typing:** the path is `/iclock/<long-random-token>`. It must be typed exactly into the terminal. One wrong character → `_device()` returns None → silent "OK", terminal never connects. The PWA shows it copyable, but the terminal is manual entry. Photograph the screen; double-check each character.

---

## Endpoint 5: `POST /api/mobile/v1/rrr/members/<id>/access`

**Rating: CLEAR**

What I verified:
- Action whitelist (`block`/`unblock`). 422 otherwise.
- Member scoped to `gym_id`, soft-delete (`deleted_at`) checked. 404 otherwise. Good — no cross-gym access.
- `queue_manual_adms_member_command` gates on: commissioned integration (`commands_enabled`), terminal recently seen (`last_success_at`), resolvable enroll number (confirmed identity mapping → device enroll number → canonical numeric). Returns None → 409 `DEVICE_NOT_READY` with actionable message ("finish device commissioning and bind this member's enroll number first").
- Auth: `token_required` + role check on the route (inherits the blueprint's `gym_owner`/`staff` guard per the earlier security fix).
- Audited. Committed. 201 on success.

No issues found.

---

## Summary for the council

| Endpoint | Rating | One-liner |
|---|---|---|
| `POST .../adms/provision` | MAJOR | Serial typo = silent total failure; re-provision to fix |
| `POST .../adms/commands` | CLEAR | Well-validated, well-gated |
| `POST .../commission` | CLEAR | 3 checks correct; punch must be *mapped*, not just received |
| ADMS terminal path `/iclock/...` | MAJOR | Live and correct, but **X2008 may not do HTTPS** and Railway 301s plain HTTP — biggest visit risk |
| `POST .../members/<id>/access` | CLEAR | Solid auth, validation, gating |

**Tell Bharath before he walks in:**
1. Copy the terminal serial from Menu → System Info, character for character. A typo means silent failure.
2. Type the `/iclock/<token>` path character for character. Photograph it.
3. Check the X2008's Cloud Server Setting for an HTTPS toggle. If none exists, the terminal may not connect — have the laptop eBioServer bridge ready as the fallback.
4. Map the test punch to a member before hitting commission — unmapped punches don't count.
