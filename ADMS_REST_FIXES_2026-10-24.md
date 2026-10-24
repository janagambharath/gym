# ADMS remaining-findings fixes — 2026-10-24 (branch `adms-fix-rest`)

Fixes for the Track B findings NOT covered by the guard, auth, or OPERLOG
tracks. Standing invariant preserved throughout: a disable serves only
for a proven-blockable member; no fix below weakens the fail-safe guard.
Nothing here touches production, `renewal-desk-pwa/dist/`, or the guard
predicate. Deploy in risk order: core batch first, H2 next, M7 last
(see the per-finding deployment notes).

## Per-finding status

| Finding | Status | What was done |
|---|---|---|
| H2 templates in plaintext | **Fixed** (with legacy grandfathering, see below) | `app/services/template_crypto.py` (Fernet, `enc1:` prefix); capture encrypts on write, restore decrypts on use; dedicated `TEMPLATE_ENCRYPTION_KEY` config with `SECRET_KEY` fallback (same derivation as `token_encryption`). Wire `TMP=` stays plaintext — the terminal requires it; that is inherent to classic ADMS, not a storage gap. |
| H3 block is destructive DELETE | **Fixed** | Destructive label in owner responses (manual block, advanced `delete_user`, bulk/single remove) + `destructive: true` + note in the queue audit metadata (`ADMS_BLOCK_DESTRUCTIVE_NOTE` in `bridge_service.py`). |
| H4 fake-ack suppression | **Fixed, no migration** | DELETE `-1`/`-2` keeps status `acked` (end state achieved; scheduler reconciliation keys on status) but records distinct `result_code = ACKED_ABSENT` + audit entry. No new status value, so no CHECK migration is needed or justified. |
| H5 one-click destructives + staff unlock | **Fixed** | Advanced ADMS + bridge-settings `clear_log`/`reboot`/`restart`/`unlock_door` require `confirm: true`; `access/remote-unlock` is now owner-only (was owner-or-staff) with an optional audited `reason`. No confirm flag was added to `remote-unlock` itself because the PWA unlock button posts only `delay_seconds` — see PWA follow-ups below. |
| M3 sensitive logging | **Fixed** | `USERINFO_RAW` block deleted entirely; OPERLOG log line is enroll-number-only (name dropped). |
| M4 stray USERINFO upload | **Fixed** | Upload applies only with an outstanding (`queued`/`delivered`) `sync_users` command for that integration; templates captured only for enroll numbers resolving to a gym member; oversized snapshots are rejected, not truncated. |
| M5 auto-link at ≥90% | **Partially fixed (safe subset)** | Auto-link now requires a normalized-exact match (confidence 100) only; 90–99% matches go to owner review (`skipped` + `auto_linkable` flag on suggestions + confidence in the audit record). Module docstring contradiction fixed. **Remains a product decision:** whether any inexact band should ever auto-link again, and whether serial-only-session links need an extra confirmation step. |
| M6 names interpolated raw | **Fixed** | Shared `sanitize_terminal_name()` (strips all control chars incl. tab/CR/LF, truncates) used by ADMS `create_user`/`unblock` and the bridge-settings `member_name` path. |
| M7 no unique serial constraint | **Fixed in code + migration (deploy last)** | Partial unique index `uq_rrr_integration_adms_serial` (adms_direct + non-null serial) in the model + migration `e7f8a9b0c1d2` (down_revision `c3d4e5f6a7b8`, the ADMS-line tip) + `_device()` fails closed (returns None) on duplicates instead of `.first()`. Migration ABORTS with the duplicate serials listed if any exist — it never deletes or merges rows. |
| M8 bulk UTC today + mutate-before-queue | **Fixed** | Bulk uses gym-local `today_for_gym`; the in-loop `status = "expired"` mutation is removed; only proven-blockable members are queued, the rest are reported as `skipped_not_blockable`. Single-remove refuses `active` members with a clear error instead of queueing an enable. |
| M11 no serve audit | **Fixed** | Audit entries for ADMS `getrequest` serves, ADMS `devicecmd` acks, bridge leases, and bridge acks (each with session type / outcome metadata). |
| M12 enroll_scan gate + bridge JSON cap | **Fixed** | Mobile + web enroll-scan now require `commands_enabled` + `connected` (403 / flash + no queue otherwise). Bridge JSON bodies over 256 KB are rejected with 413 before parsing (chunked bodies without `Content-Length` remain a documented residual). |
| L2 settings commands for inactive bridges | **Fixed** | Settings queue endpoint now filters `is_active=True` and returns 404 when no active bridge exists. |
| L4 heartbeat invents inventory | **Fixed** | Heartbeat updates only existing `RRRDevice` rows; unknown serials are counted in `unknown_devices_skipped` and never stored. |
| L5 timeout disagreement | **Fixed (aligned)** | Both the getrequest reaper and the owner test endpoint now share `ADMS_DELIVERED_TIMEOUT_MINUTES = 10`. Previously the test endpoint freed a delivered command after 5 min while the terminal could still hold it. |
| L6 getrequest re-sends delivered | **Fixed by documentation + bound** | No semantic change needed: re-sends were already bounded by the 10-min stuck timeout (a delivered command is failed, never re-served, after it). This is now stated in the getrequest comment and covered by a regression test. |
| I1 CHECK/"cancelled" analysis | **Verified, no action** | Model CHECKs re-read: ADMS status `queued/delivered/acked/failed`, bridge status `pending/leased/acked/failed` — no `cancelled` value exists, so `failed` + `CANCELLED_STALE_STATE` remains the correct migration-free terminal state. |
| I2 tenant-isolation sweep | **Verified, no action** | All changed paths remain gym/integration-scoped; no new unscoped identifier-accepting query was added. |
| I3 bridge lease/ack sound | **Verified, no action** | Lease tokens (`token_urlsafe(32)`, `compare_digest`, expiry, terminal-state immutability) unchanged and relied on, not reworked. |
| I4 CSRF exemptions justified | **Verified, no action** | Exemptions re-read in `app/__init__.py`: ADMS (no browser token possible), bridge (API-key machine API), mobile API (Bearer) — each independently authenticated. |
| I5 vendor client DPAPI | **Verified, no action** | Both `LocalSecretStore.cs` files exist as described. The Python connector's at-rest protection remains unverified (as the investigation noted) — open, not closed by this batch. |
| A10 stale docs/tests | **Fixed** | `adms-e2e-review.md` Pri=1 block corrected to DELETE + Name-bearing unblock; drift tests corrected where the code was right: block DELETE text, unblock Name, sync `PIN=ALL`, integration status `active` → `connected` (+ token + commissioned seed for the enroll-scan test). No code was changed to match a stale test. |

## H2 key rotation / migration path (read before rotating anything)

- New captures are `enc1:`-prefixed Fernet ciphertext. Rows written before
  this change (bare plaintext) still restore through `decrypt_template`
  and are re-encrypted automatically on the next template capture.
- Rotating `TEMPLATE_ENCRYPTION_KEY` (or `SECRET_KEY` when no dedicated
  key is set) orphans `enc1:` rows: decrypt raises `ValueError` and the
  restore path skips that finger rather than shipping ciphertext to a
  terminal. Rotation procedure: decrypt every row with the old key,
  encrypt with the new key, and only then switch the config value.
  Production should set a dedicated `TEMPLATE_ENCRYPTION_KEY` so a
  `SECRET_KEY` rotation does not orphan templates.
- Deliberately NOT done: encrypting the wire `TMP=` value (the terminal
  cannot decrypt it — that would need a device-side change), and a bulk
  re-encryption migration (Alembic cannot derive the Flask key config;
  re-capture covers it).

## M7 deployment warning (deploy last, verify first)

- The migration graph already has six heads. This migration chains onto
  `c3d4e5f6a7b8` (the ADMS-line tip). The coordinator must confirm
  production's actual migration head before deploying it; if production
  is not on the ADMS line, this migration must be re-based, not forced.
- If the migration aborts on duplicates, resolve them by hand (reassign
  or retire the wrong integration) and re-run. Never delete rows to
  satisfy the index.

## PWA / client follow-ups (NOT done here — out of scope, no dist touched)

- Staff users will now get 403 from `access/remote-unlock`; the PWA
  unlock button needs an owner-only UX treatment (and a confirm dialog
  is recommended) in a separate client change.
- Gyms with an uncommissioned ADMS integration will now get 403 from
  `rrr/enroll-scan` instead of a queued scan; the PWA enroll-match
  screen should surface the commissioning message.

## Known pre-existing failures NOT owned by this batch

- `test_adms_fake_device.py` OPERLOG tests (2): fail on the
  `operlog_snapshot` CHECK constraint — the OPERLOG track's fix.
  Verified identical on the clean tree; this batch's M5 change is
  compatible (both tests use exact names, confidence 100).
- `test_security_fixes_2026_10_13.py::test_adms_device_requires_path_token`:
  expects serial-only `_device()` to return None, but the shipped code
  deliberately allows the serial fallback (the X2008 cannot send a
  custom path; see finding C1). Verified failing on the clean tree too.
  Changing the code to token-only would break X2008 production
  terminals; changing the test belongs to the C1/auth track's decision,
  not to this batch — left untouched.
