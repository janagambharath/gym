# ADMS device-auth hardening — rollout & commissioning guide (deploy batch #3, LAST)

**Status:** server-side implementation + regression tests. This batch deploys
only with its backward compatibility verified (see "Backward-compatibility
proof" below). Nothing in this batch touches production data, member
biometrics, or `renewal-desk-pwa/dist/`.

**What changed (findings C1, H7, H1, M10, M9, L1, L3):**

- ADMS path tokens are stored **only as SHA-256 hashes**
  (`rrr_integrations.adms_token_hash`). The plaintext token is returned
  exactly once — at provision or rotation — and never stored again.
- **Rotation** (`POST /api/mobile/v1/rrr/integrations/<id>/adms/rotate-token`,
  gym_owner, `{"grace_days": 0–30, default 7}`): the previous token keeps
  working until `adms_token_grace_until`, then is rejected outright.
  The URL-token mechanism itself is **unchanged** — terminals that cannot
  send a custom path cannot use it; rotation + gating (not removal) is
  the fix, because devices cannot change.
- **Serial-fallback gate** (`rrr_integrations.allow_serial_fallback`,
  toggled at `POST .../adms/serial-fallback {"enabled": true|false}`):
  OFF = a bare-serial request gets an indistinguishable `OK` and changes
  nothing (no ingest, no commands, no acks, no online touch). ON =
  legacy behaviour, warning-logged, and never error-clearing.
- **Commissioning gate (H1):** for fallback-OFF integrations, a punch
  satisfies commissioning only if its provenance (`rrr_attendance_events.
  auth_method`) is `token`/`token_prev`, or NULL (recorded before
  provenance existed — post-hardening ingest always stamps a method, so
  NULL cannot be manufactured through the device API). A `serial`
  punch never satisfies it.
- **Online/error state (M10):** only a token-valid exchange clears
  `last_error` and marks the integration `connected`. A `registry` ping
  is seen-only even for token devices. A legacy serial data push may
  mark the integration `connected` (so the legacy commissioning flow
  still works) but never clears `last_error`.
- **Salted secrets (M9/L1):** new bridge pairing codes and bridge API
  keys are stored as per-record salt + SHA-256. Legacy unsalted values
  (salt NULL) keep verifying until they expire, are burned, or are
  rotated. Bridge auth resolves by unique device serial first (O(1)
  hot path) and only scans by key on authentication failure.
- **Rate limits (L3):** every ADMS endpoint now carries the existing
  per-IP limit **plus** a per-device limit keyed on the hashed
  token/serial. Limitation: the per-device key is derived from the
  unauthenticated token/serial string (limiting runs before auth), so
  an attacker who knows a real serial shares that device's bucket —
  per-device keying stops cross-device exhaustion and IP spraying, not
  a targeted serial DoS. Defence there is token auth + fallback OFF.
  With the default `memory://` limiter storage, buckets are per-process;
  production must set `REDIS_URL` so limits are shared across workers.

## Backward-compatibility proof (why existing gyms keep working)

The hardening migration (`f7a8b9c0d1e2`, extends the ADMS chain head
`c3d4e5f6a7b8`) does three backfills, all nullable/no-flag-day:

1. Existing plaintext `adms_path_token` values are hashed into
   `adms_token_hash` and the plaintext column is cleared. Devices keep
   sending the **same token** and now match by hash — no terminal change.
2. Existing `adms_direct` rows get `allow_serial_fallback = TRUE`
   (legacy grace). New rows default to FALSE.
3. New salt columns are NULL for existing rows, which the verifiers
   treat as "legacy unsalted hash — still valid".

Tests proving this (`tests/test_adms_device_auth.py`):
`test_legacy_serial_fallback_still_works`,
`test_legacy_plaintext_token_migrates_to_hash_on_first_use`,
`test_legacy_unsalted_pairing_code_still_pairs`,
bridge legacy-key heartbeat test, plus the pre-existing
`test_adms_serial_only_requests_are_inert` (new integrations) which
**failed on the base branch and passes with this batch**.

## Rollout steps for existing devices (Elite / Yodha-era terminals)

**Step 0 — deploy, change nothing.** After deploy, existing terminals
keep working exactly as before (token path by hash, or serial with the
flag ON). Verify with `/health` and by watching one ATTLOG push land
per gym. Do NOT rotate anything yet.

**Step 1 — for a terminal that CAN send a custom path** (any terminal
whose ADMS menu accepts a server URL path):
1. Owner: `POST .../adms/rotate-token {"grace_days": 7}`. Copy the
   returned token **once** (never into screenshots/support packages).
2. Enter the new server URL `https://<host>/iclock/<new-token>` in the
   terminal's ADMS menu.
3. Confirm a token-authenticated push lands (attendance appears, and
   the integration's `adms_token_version` incremented).
4. Owner: `POST .../adms/serial-fallback {"enabled": false}`.
5. After the grace window passes, the old token stops working on its
   own. Re-commissioning from here on requires a token punch (H1).

**Step 2 — for an X2008-class terminal that CANNOT send a custom path**
(it always posts to `/iclock/cdata`):
- There is **no device-side step that enables token auth** — this is
  the firmware limitation recorded in track B. Keep
  `allow_serial_fallback = true` for that gym and accept the residual
  risk (serial is printed on hardware; sessions are warning-logged and
  never clear error state). Do NOT flip the flag off for such a
  terminal: it would stop all attendance ingestion and command polling
  with no way to re-enable it from the device side.
- **Needs decision (not implemented here):** a compensating control for
  path-less terminals (e.g. an allowlisted source network for the gym,
  or moving the gym to a bridge/connector path where the bridge API
  key — now salted — is the credential). Until that decision is made,
  serial-fallback-ON is the supported configuration for X2008 gyms.

**Step 3 — bridges (no device change needed).** Paired bridges keep
working on their existing keys. The next key rotation (owner/admin
rotate-key, or re-pairing) stores the new key salted automatically.
New pairing codes are salted automatically; in-flight legacy codes
keep working until expiry/burn.

## Migration note for the coordinator

This migration extends the ADMS chain head `c3d4e5f6a7b8`. The repo
has multiple migration heads; before applying to production, confirm
the production database's actual head(s) — do not rebase this revision
onto a different head without checking the ADMS chain first.
Downgrade warning: the upgrade clears `adms_path_token` plaintext,
which is unrecoverable — after a downgrade, owners must re-provision
ADMS integrations to obtain a new token (devices themselves need no
change beyond entering the new token path, where applicable).
