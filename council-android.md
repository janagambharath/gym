# Council Review — Android (Elite Gym Go-Live)

**Date:** 2026-10-10 ~17:30 IST
**Reviewer:** Android council seat
**Scope:** `renewal-desk-android/src/` — Direct Cloud priority path, new eBioServer commissioning UI, member block/unblock, API field mismatches, tsc.

## Verdict: CLEAR (after 1 MAJOR fixed during review)

`npx tsc --noEmit`: **0 errors** (before and after fix).

## MAJOR (found & fixed)

### M1: Android could NOT finish Direct Cloud commissioning — FIXED
The newly-added commission UI (`doorConfirmed` + `commissionBridge`) only covered the **eBioServer** bridge. Direct Cloud — the stated priority path for Elite Gym — had provision + test commands but **no "Enable automatic block/unblock" button**. Android could never complete the priority onboarding.

**Fix applied** (`RrrGrowthScreen.tsx`):
- Generalized `commissionBridge()` → `commissionIntegration(integration, confirmed)` covering both connector types.
- Added door-test checkbox + "4. Enable automatic block/unblock" button to the Direct Cloud commissioning console card (numbered to follow the 1-probe / 2-block / 3-unblock steps).
- Added `commands_enabled` / `commissioning_status` to the `Integration` type (backend already returns them); button now reads "Automatic block/unblock is ON" when enabled instead of silently re-submitting.
- `tsc --noEmit` clean after fix. Committed.

## Verified working (no issues)

1. **New eBioServer commissioning UI** — `commissionBridge()` posts `{physical_test_passed: true}` to `/rrr/integrations/{id}/commission`; endpoint, method, body all match backend (`rrr.py: commission_integration`). Checkbox gating works; error path surfaces backend message.
2. **Direct Cloud provision** — posts `{device_serial, device_name}` to `/rrr/integrations/adms/provision`; reads `result.data.integration` + `result.data.terminal_settings`. Matches backend response shape exactly.
3. **Terminal settings display** — reads `terminal_settings.server_address/server_port/https/path`; backend `adms_terminal_settings()` returns all four. The `/iclock` default path matches.
4. **Test commands** — `queue('probe_info'|'block_test'|'unblock_test')` posts `{action, test_enroll_number}`; Android pre-validates enroll number with the same regex the backend enforces (`^[1-9][0-9]{0,8}$`). 409 DEVICE_OFFLINE / COMMAND_PENDING errors surface via alert.
5. **Member block/unblock** — `MemberDetailScreen.handleToggleAccess` posts `{action: 'block'|'unblock'}` to `/rrr/members/{id}/access`; matches `manual_member_access` exactly. Confirm dialog + optimistic state + error toast all present.
6. **API envelope** — `apiClient` correctly unwraps `{success, data}`; no double-unwrap bugs found in reviewed screens.
7. **eBioServer pairing** — posts to `/rrr/integrations/ebioserver/pairing`, displays code + expiry. Device select posts `{device_id}` to `/integrations/{id}/device`. Both match backend.
8. **Onboarding checklist** — `OnboardingChecklistCard` → `getOnboardingProgress()` → backend `/onboarding/progress` exists.
9. **WhatsApp status** — reads `state` + `checklist` (correct; PWA had the bug, Android didn't).

## MINORs (not blocking, noted)

1. **Commission UI hidden when bridge is `degraded`** — shows only on `status === 'connected'`. A paired-but-degraded bridge hides the enable button. Server-side commission would 409 on missing attendance anyway, so impact is cosmetic.
2. **`doorConfirmed` not reset after success** — re-tapping Enable (before refresh) skips the checkbox. `load()` refreshes the list but local state persists. Cosmetic; backend is idempotent.
3. **No acked-test-command hint for eBioServer** — matches backend behavior (eBioServer skips the test-command check), but the UI doesn't tell the owner to manually test block/unblock at the door first. The checkbox label covers it ("I stood at the door and verified").
4. **PWA checks `['connected','paired']`, Android checks `'connected'` only** — 'paired' isn't a real DB status (valid: not_configured/pairing/connected/degraded/disconnected/needs_attention), so PWA's extra value is dead code. No behavioral difference.

## Recommendation to council

Android is **go for Elite Gym** as backup device. The priority Direct Cloud path is now fully completable on Android: provision → terminal settings → probe → test block/unblock → enable. PWA remains the primary (larger screen for the terminal-settings transcription step).
