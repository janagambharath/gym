# ADMS X2008 — Fixes Report (2026-10-24)

Branch: **`adms-fixes`** (local only). Investigation source of truth:
`ADMS_X2008_INVESTIGATION.md` (33 findings: 2 Critical, 8 High, 12 Medium,
6 Low, 5 Info). Portal track: §6 below (full text preserved at
`.adms-investigation/portal-re-section.md` + `portal-re-verdicts.json`).

**Read the LIVE vs READY split carefully.** Two batches are live in
the gyms today. Two batches are finished and tested and ready, but are
NOT switched on in the live gyms yet, because the live system has
stopped picking up new updates (see §2). Nothing in this report claims
a held batch is live.

---

## 1. WHAT WORKS NOW / WHAT'S NEW — in plain words

### Already working in your gyms today

1. **A test button can no longer delete a paying member's fingerprint.** Before, the test buttons sent the same "remove this person" order as a real block, and the safety check did not cover them. So a test could wipe out a member who had paid and was active. Now every remove order — real or test — goes through the same safety check first.
2. **An old "open the door" order can no longer let a finished member back in.** If an old unlock order was still waiting in line, it used to go through even after the member's plan had ended. Now an unlock only goes through for a member whose plan is active and has not ended.
3. **Door orders typed in by hand are checked before they join the line.** If someone types a member number into the door settings screen, the system now checks that the number belongs to a real member of that gym before accepting it.
4. **A member from one gym can no longer affect another gym.** The system now refuses any door order that points to a member of a different gym.
5. **New fingerprints registered at the machine now link to members on their own.** Before, signing up a new fingerprint at the machine broke the system's record-keeping, so automatic linking never actually worked. That is fixed. (We will only know it works for real when the next member signs up at a gym that uses this kind of machine — the test gym's machine has been quiet.)

### Finished and tested, but not switched on yet

The improvements below are finished and tested and ready to go. But the live gyms have not picked them up yet, because the live system has stopped picking up new updates. Your gyms keep running fine on the current version in the meantime. Nothing below is live until the update problem is fixed and the switch-on is confirmed.

6. **Each fingerprint machine gets its own secret code.** Today a machine proves who it is with just its machine number, which anyone who knows the number could copy. Soon each machine will have its own secret code, stored scrambled so no one can read it back, and the code can be changed when needed. Old machines keep working exactly as today until they are set up again. New machines get no shortcut at all — a machine number on its own will change nothing.
7. **Saved fingerprints are locked.** Fingerprint copies saved in the system are now scrambled, and they are only unscrambled when they need to go back to a machine. The message sent to the machine itself must stay readable, because that is the only form the machine understands. Old saved copies still work, and they get locked the next time they are saved.
8. **Blocking a member now comes with a clear warning, and every door order is written down.** The screen now says plainly that blocking removes the member from the machine, so the member must place their finger again when they return. Every door order the system sends is now recorded.
9. **A machine saying "already gone" is no longer written down as a simple success.** When the system tells a machine to remove someone who is already gone, that is now recorded as its own result, so no one mistakes it for a normal success.
10. **Dangerous one-click buttons now ask for confirmation, and only the owner can open a door from far away.** Clearing the machine's records, restarting it, or opening the door from the phone now need a clear "yes, do it" first. Opening a door from far away is now owner-only — staff accounts can no longer do it.
11. **Private details no longer appear in the system's written records.** The system used to write out full machine records, including member numbers and names. It no longer does.
12. **A surprise machine upload can no longer plant strangers or overwrite the gym's list.** If a machine sends a member list when no list was asked for, it is ignored. It can never replace the gym's own list or add fingerprints for people who are not members.
13. **A name typed at the machine only links on its own when it matches exactly.** Before, a close-but-not-exact name would link on its own. Now only an exact match links on its own; close matches go to the owner to check, with the match score shown.
14. **Member names can no longer break door orders.** Names with odd hidden characters in them are cleaned up before they go into a machine order.
15. **Removing finished members now uses the gym's own date, and it never changes a member's plan first.** Before, the system marked members as finished and then asked the safety check — which then read the changed mark. Now only members who are truly finished are queued, and removing one member by hand refuses if that member is still active.
16. **The "scan for members" button now refuses gyms that have not finished setup.** Gyms that have not finished their setup checks get a clear refusal instead of a scan order sitting in line. Very large uploads from the gym computer are also limited, so one huge upload cannot jam the system.
17. **One waiting time for stuck orders everywhere: 10 minutes.** Before, different parts of the system waited different times for a machine to answer. Now every part waits 10 minutes, so a slow machine cannot block the line forever, and a failed order is never sent again.
18. **Machines reported by the gym computer appear only as unpicked suggestions until the owner picks one.** When the gym computer reports a machine it sees, that machine shows up as a suggestion only — it opens no doors and changes nothing until the owner picks it.

### Still needs your decision

- Fixing the update problem (see the note at the end of this report) — this is what holds back items 6–18.
- A rule that says "one machine number, one gym" — the safety check for this is ready, but the record-keeping change for it must wait until the update problem is fixed, because it has to be added in the right order.
- Machines that cannot use a secret code at all (they always send to the same fixed address) — for these, the supported setup is to keep the old machine-number shortcut switched on, with a warning written in the records. A stronger protection (for example, only accepting machines from known internet addresses, or moving the gym to the gym computer's connection) is still undecided.
- Whether a close-but-not-exact name should ever link on its own again.
- How to change the lock code for saved fingerprints without locking out old saved copies.
- Two small fixes in the gym owner's phone app: the far-away door button must become owner-only (staff accounts currently get an error), and gyms that have not finished setup need a clear message on the scan button instead of an error.

---

## 2. Deploy batches — revisions and status

| Batch | Contents | GitHub main | Production `/health` | Status |
|---|---|---|---|---|
| 1 — guard extension | C2, H8, H6 safe subset, M2 | `35fa4a82f037` | flipped to `35fa4a82f037` | **LIVE** |
| 2 — OPERLOG | M1 (CHECK + migration) | `b19917b7fc41` | flipped to `b19917b7fc41`, db/schema ok | **LIVE** |
| 3 — auth hardening | C1, H1, H7, M9, M10, L1, L3 | `9596839c` (+ trigger `fcea2b23`) | stayed on `b19917b7fc41` across ~9 min and both pushes | **HELD — not served** |
| 4 — rest track | H2, H3, H4, H5, M3–M6, M8, M11, M12, L2, L4 (corrected), L5, L6, I1–I5, A10 | `dc3f12b0` (M7 migration **excluded**) | stayed on `b19917b7fc41` after ~7.5 min | **HELD — not served** |

**Stop rule applied:** per Bharath's "don't hold" order, a batch that fails
verification is stopped, not forced. No further trigger pushes were made
after batch 4's push. Production is unaffected and keeps serving the
batch-2 release (db/schema ok).

**What unblocks batches 3 + 4:** the Railway deploy log for the stalled
releases — it distinguishes the two hypotheses (pre-deploy migration
failure on prod data vs a Railway-side deploy stall). Leading hypothesis
(not established): the auth migration's unique index on
`adms_token_hash`, backfilled from plaintext tokens, fails if two prod
integrations share the same plaintext token (duplicate digests violate
uniqueness). Checkable by someone with prod DB access:
duplicate-plaintext-token count before re-attempting. If the log instead
shows a build/stall failure, a re-push once the stall clears is the fix.

**Root cause CONFIRMED 2026-10-29 (supersedes the hypothesis above):**
Bharath pasted the Railway log for the 2026-10-27 20:39 IST deploy of
`e765efd` — Railway DID attempt the deploy; the new container died in
the release phase at `upgrade 16912c2a3121 -> f7a8b9c0d1e2` with
`psycopg.errors.DatatypeMismatch: column "allow_serial_fallback" is of
type boolean but expression is of type integer`
(`UPDATE rrr_integrations SET allow_serial_fallback = 1 ...`). The old
instance kept serving, which is why `/health` never moved. Fix (local,
2026-10-29): backfill now uses `TRUE`/`FALSE` literals (valid on both
Postgres and SQLite), and the held M7 migration `e7f8a9b0c1d2` was moved
to `migrations/held/` so `upgrade heads` cannot apply it before
Bharath's one-machine-one-gym decision.

**Note on batch 4's push:** GitHub main now contains auth + rest together
(minus the M7 migration). When the deploy block clears, production will
receive batches 3 and 4 in one release. That is the verified tree
(394 passed / 3 pre-existing failures, §7) — it is not a shortcut around
the hold; it is the same code, waiting on the same log.

**M7 migration (held separately):** `e7f8a9b0c1d2_unique_adms_serial`
chains onto the auth head `f7a8b9c0d1e2`. It is on the branch but was
deliberately left out of the batch-4 push: it must ship only after batch
3 lands (rebase if the head moves), and prod must be checked for
duplicate serials first — the migration aborts on duplicates and never
deletes. The runtime fail-closed duplicate check in `_resolve_device`
(the part that protects live traffic) IS in the batch-4 push.

---

## 3. Per-finding status (by investigation ID)

Status key: **FIXED-LIVE** = in production now. **FIXED-HELD** = code
complete and tested, on GitHub main, awaiting the deploy block clearing.
**PARTIAL** = safe subset fixed, remainder needs a decision.
**VERIFY** = investigated and confirmed as designed/no action.

### Critical

| ID | Finding | Status | Files / evidence |
|---|---|---|---|
| C2 | `block_test` bypasses the fail-safe guard (identical DELETE wire bytes, test endpoint took any enroll number) | **FIXED-LIVE** | `app/services/bridge_service.py` (expanded `ADMS_DISABLE_ACTIONS`: `block_test`, `delete_biodata_test`, `delete_fingertmp_test` + all raw probe DELETE actions; wire-text fallback `adms_command_is_delete` at getrequest), `app/adms/routes.py`, `app/mobile_api/{settings,access}`, `app/admin/routes.py`, `app/biometric/routes.py`, `app/services/{reminder_scheduler,rrr_service}.py`; 7 new tests in `tests/test_stale_disable_guard.py` (13 guard tests pass) |
| C1 | Device auth is a bare serial number; URL path token never rotated | **FIXED-HELD** | `app/adms/routes.py` (`_resolve_device`: token / token_prev / gated serial), `app/models/rrr.py` (hash-only tokens, rotation, grace window, per-integration fallback flag), `app/mobile_api/rrr.py` (provision hash-only, rotate-token + serial-fallback endpoints, commissioning gate), `docs/ADMS_DEVICE_AUTH_ROLLOUT.md`; 18 new tests in `tests/test_adms_device_auth.py` |

### High

| ID | Finding | Status | Files / evidence |
|---|---|---|---|
| H1 | Forged punches can satisfy the commissioning gate | **FIXED-HELD** | Auth track: for fallback-OFF integrations, commissioning requires a token/token_prev punch; `serial` provenance never satisfies it (NULL provenance from pre-column punches still counts only because post-hardening ingest always stamps a method) |
| H2 | Fingerprint templates stored/shipped in plaintext | **FIXED-HELD** (grandfathered) | `app/services/template_crypto.py` (new, Fernet `enc1:`), `app/config.py` (`TEMPLATE_ENCRYPTION_KEY`), `app/services/bridge_service.py` (decrypt on restore); wire `TMP=` necessarily stays plaintext; legacy rows restore + re-encrypt on next capture; 3 tests in `tests/test_adms_template_crypto.py` |
| H3 | Block is DELETE with no template backup (irreversible without re-enroll) | **FIXED-HELD** | Destructive label in responses + audit metadata (`ADMS_DESTRUCTIVE_ACTIONS`, `ADMS_BLOCK_DESTRUCTIVE_NOTE`); the X2008 behavior itself cannot change — mitigation is label + audit + confirm path |
| H4 | `devicecmd` fake-ack suppression (DELETE −1/−2 marked success) | **FIXED-HELD** | Distinct `ACKED_ABSENT` result code; status stays `acked` (desired end state achieved) but no longer silently a plain success; no migration needed (no new status CHECK value) |
| H5 | One-click destructive commands + staff remote unlock | **FIXED-HELD** | Confirm flag on advanced/settings `clear_log`/`reboot`/`restart`/`unlock_door`; remote unlock owner-only + optional audited reason (`app/mobile_api/access.py`) |
| H6 | Bridge settings commands queue arbitrary enroll numbers / unvalidated member_ids | **FIXED-LIVE** (safe subset) | Queue-time validation in `app/mobile_api/settings.py` (canonical enroll, integer member_id, existing non-deleted same-gym member, id↔enroll match). NO queue-time blockable check added deliberately — serve/lease-time guard remains the decider, preserving the manual-block flow |
| H7 | ADMS path token is a bearer secret in a URL, never rotated, defeated by serial fallback | **FIXED-HELD** | Rotation endpoint + token versioning + grace window (default 7d, 0–30d, 0 = immediate revocation); URL-token mechanism intentionally NOT removed (devices cannot change); serial fallback now gated per integration |
| H8 | Only disables revalidated at serve time; stale enables can re-open doors | **FIXED-LIVE** | Serve/lease/retry revalidation for enables with distinct marker `CANCELLED_STALE_ENABLE` (ADMS `unblock`, `unblock_test`, `create_user`, `restore_template`; bridge `enable_user`, `create_user`, `set_valid_date`); rule: member exists, not deleted, `status == "active"`, `membership_end >=` gym-local today, else cancel |

### Medium

| ID | Finding | Status | Files / evidence |
|---|---|---|---|
| M1 | OPERLOG CHECK break (`operlog_snapshot` not in CHECK → every enrollment POST fails at flush) | **FIXED-LIVE** | CHECK addition (15 → 16 actions) chosen over a dedicated table — the marker tests and `get_adms_snapshot()` already read `action='operlog_snapshot'` rows, snapshot rows are inert `acked` rows `getrequest` never serves, and no prod rows exist to migrate (inserts always failed). `app/models/rrr.py`, `app/services/enroll_match_service.py` (SAVEPOINT flush: bad row expunged, caller commit survives), migrations `b87640da5a46` (merge of the 2 real heads `b1c2d3e4f5a6` + `c3d4e5f6a7b8` — the investigation's "six heads" did not match this checkout) + `16912c2a3121` (CHECK); 2 new tests; fake-device suite 15/15 |
| M2 | Two member-resolution helpers don't verify gym membership | **FIXED-LIVE** | `resolve_bridge_command_member` (cross-gym → None, fails safe), `rrr_service._mapped_member` gym check; `resolve_adms_member` was already gym-checked (documented + tested) |
| M3 | Sensitive logging (raw USERINFO lines, per-enrollment PIN+name) | **FIXED-HELD** | `USERINFO_RAW` log block deleted; OPERLOG log is PIN-only |
| M4 | Stray USERINFO upload can ack/overwrite sync snapshot / plant templates | **FIXED-HELD** | Uploads ignored unless a `queued`/`delivered` sync is outstanding; templates only for gym-member enroll numbers; oversized snapshots rejected, not truncated |
| M5 | Auto-link trusts device-typed names at ≥90% with no owner confirmation | **PARTIAL-HELD** | Safe subset fixed: auto-link now requires normalized-exact (confidence 100) only; 90–99% goes to owner review with an `auto_linkable` flag and audited confidence. **Decision remains:** whether any inexact band should ever auto-link again, and whether serial-only-session links need extra confirmation |
| M6 | Member names interpolated into command text with truncation only | **FIXED-HELD** | `sanitize_terminal_name()` (strips tab/CR/LF/control chars) applied at every interpolation site |
| M7 | No unique constraint on ADMS serials (`_device()` picks `.first()` arbitrarily) | **FIXED-HELD (code) / MIGRATION HELD** | Runtime fail-closed `_resolve_device` (duplicate serial → no session, warning-logged) is in the batch-4 push; partial unique index + migration `e7f8a9b0c1d2` held for post-batch-3 deploy (see §2) |
| M8 | Bulk removal uses UTC "today" and mutates member status before the guard reads it | **FIXED-HELD** | Gym-local today; no status mutation; only proven-blockable queued; single-remove refuses active members |
| M9 | Bridge pairing codes 6 digits, unsalted SHA-256, per-IP rate limit | **FIXED-HELD** (transition) | Per-record salt + SHA-256 for new codes; legacy unsalted values keep verifying while salt is NULL until expiry/burn/rotation; existing paired bridges unaffected |
| M10 | Any serial/token hit marks device online and clears error state | **FIXED-HELD** | Tiered `_touch()`: only token-valid real exchanges clear `last_error`/mark `connected`; registry pings are seen-only; legacy serial pushes may mark `connected` but never clear `last_error`; unauthenticated hits never touch anything |
| M11 | Device-served commands have no audit-log entry | **FIXED-HELD** | Serve + ack audit on ADMS and bridge (lease/ack) paths |
| M12 | `enroll_scan` bypasses the commissioning gate; bridge JSON payloads have no size cap | **FIXED-HELD** | Enroll-scan commissioning gate on both paths (web + mobile); 256 KB bridge JSON cap (413) |

### Low

| ID | Finding | Status | Files / evidence |
|---|---|---|---|
| L1 | Bridge API keys unsalted SHA-256 | **FIXED-HELD** (transition) | Same salted transition as M9 (`api_key_salt`, salted `create_for_gym()`/`rotate_key()`); legacy keys verify until rotation |
| L2 | Bridge settings commands queueable for inactive/revoked bridges | **FIXED-HELD** | Active-bridge filter at queue time in settings endpoint |
| L3 | ADMS rate limits per-IP, not per-device | **FIXED-HELD** (documented limitation) | Per-device limit (hashed token/serial key) stacked under the per-IP limit on all 4 endpoints. Limitation: the key derives from the unauthenticated token/serial string, so an attacker who knows a real serial shares that device's bucket — stops cross-device exhaustion and IP spraying, not targeted serial DoS; defence there is token auth + fallback OFF. Also `memory://` limiter storage is per-process — production needs `REDIS_URL` for shared limits |
| L4 | Authenticated bridge heartbeat can invent device inventory rows | **FIXED-HELD** (corrected — see §5) | Heartbeat-reported serials are stored as inert discovery rows (unselected; selection is owner-gated) — NOT skipped. The first implementation skipped unknown serials entirely and broke the real discovery flow; the coordinator corrected it |
| L5 | Stuck-command timeouts disagree (10 min ADMS vs 5 min test guard) | **FIXED-HELD** | Single shared `ADMS_DELIVERED_TIMEOUT_MINUTES = 10` used by ADMS reaper + owner test endpoint |
| L6 | `getrequest` re-sends delivered commands until ack | **FIXED-HELD** (bound + documented) | Re-sends were already bounded by the 10-min stuck timeout (failed rows never re-served); now stated in code and regression-tested; no semantic change |

### Info (verified, no action)

| ID | Finding | Status |
|---|---|---|
| I1 | CHECK/"cancelled" analysis confirming the hotfix workaround | **VERIFY** — CHECKs confirm no `cancelled` value exists; markers ride on `failed` + message |
| I2 | Tenant-isolation sweep | **VERIFY** — changed paths stay gym-scoped |
| I3 | Bridge lease/ack design sound | **VERIFY** — untouched |
| I4 | CSRF exemptions justified for machine APIs | **VERIFY** — re-read and justified |
| I5 | In-repo vendor client code (server-trust assumptions explicit; C# clients protect secrets with DPAPI) | **VERIFY** — both DPAPI files exist; Python connector at-rest protection still unverified, as the investigation noted |

### Assumption A10 (stale docs/tests)

**FIXED-HELD.** `Pri=1` block corrected to DELETE + Name-bearing unblock
in `adms-e2e-review.md`; drift tests corrected where code was right
(block DELETE, unblock Name, sync `PIN=ALL`, integration status
`active`→`connected`, plus a real token + commissioned seed for the
enroll-scan test). No code was changed to match a stale test. This fix
also closed the 5 pre-existing drift failures (see §7).

---

## 4. Guard invariant

**Unweakened, and extended.** The 2026-10-23 fail-safe rule ("active
members must never be blocked") now also covers every test/delete path
(C2), the mirror-image enable path (H8), bridge settings queue time
(H6 subset), cross-gym references (M2), and duplicate-serial sessions
(M7 runtime check). The guard suite is 13/13 green, and the full suite
shows zero new failures (§7).

---

## 5. Coordinator corrections (things the merge changed, stated openly)

1. **L4 corrected (regression caught by the suite, not by review).**
   The rest track's first L4 implementation skipped unknown heartbeat
   serials entirely. That broke
   `test_ebio_reports_devices_and_owner_selection_reaches_connector_config`
   — a legitimate product flow (paired bridge reports a device → owner
   selects it → bridge config picks it up), and it contradicts the
   `RRRDevice` model's own docstring ("device inventory reported by a
   paired gym-PC connector"). The coordinator restored heartbeat
   creation of reported serials as **inert discovery rows**
   (unselected; `integration.device_serial` unchanged) and replaced the
   rest test with an inertness test. Selection remains the owner-gated
   trust step. Net effect: L4's real concern (no auto-trust from a
   heartbeat) is kept; the discovery flow is not killed.
2. **Merge conflicts (2 files, resolved by keeping both sides).**
   `app/adms/routes.py`: auth's `_resolve_device` kept, with the M7
   duplicate-serial fail-closed check folded into its serial branch
   (the rest track's old-shape `_device` replacement was superseded by
   auth's rework). `app/services/bridge_service.py`: guard's expanded
   disable/enable sets kept, rest's new constants (`ADMS_DESTRUCTIVE_ACTIONS`,
   `ADMS_DELIVERED_TIMEOUT_MINUTES`, `ACKED_ABSENT`, `BRIDGE_MAX_JSON_BYTES`,
   `sanitize_terminal_name`) added; the rest track's narrow disable set
   was discarded (the guard superset wins). A line-join slip in the
   first resolution was caught by compile check and fixed before any
   test run.
3. **Branch hygiene note.** The rest-merge commit pulled in
   pre-existing working-tree state via `git add -A`: the 158
   `renewal-desk-pwa/dist/` deletions that predated the investigation,
   plus the investigation track docs. Those were **excluded from every
   push** (push lists are explicit per file), so GitHub main is
   unaffected. Do not merge `adms-fixes` into main wholesale without
   first reverting those deletions from the branch.

---

## 6. Portal-RE track (Bharath's scope addition)

**Method:** search + page-text fetch only, ordinary browsing rates. No
repo file touched, no firmware binary downloaded, no login-gated page
accessed, no credential used. No live-browser visit is claimed.

**Headline result: NEGATIVE.** The official eSSL portal yields **no
ADMS/push protocol specification, no X2008 manual, no X2008 datasheet,
and no X2008 firmware release notes**. It yields two official middleware
manuals that bear indirectly on several assumptions — strong enough to
sharpen the open questions, not strong enough to close any wire-level
assumption. **Portal verdicts: 0 closed, 0 contradicting, 23 still open,
2 unchanged** (A11 stays corroborated from the classic doc; A10 stays
stale/contradicted from in-repo evidence — neither was moved by portal
evidence). **New confirmed findings: none.**

### Documents found (official portal only)

- **D1 — eBioServerNew Web API Manual v2.7, March 2025, doc v1.3, 34pp**
  (`media.esslsecurity.com/media/3rd_Party_Integrations/eBioServerNew-Web_API-Manual.pdf`,
  linked from the official eBioServerNew page). A **middleware SOAP API**,
  NOT the device ADMS wire protocol. Contents used:
  `UpdateEmployeewithExpiryDates` / `UpdateEmployeeEx` (employee validity
  dates exist in the middleware API — a third validity channel, proving
  nothing about X2008 enforcement or ADMS PUSH, so A25 gains a channel
  but is not promoted); `DeviceCommand_ResetOPStamp` (eSSL's own user
  re-sync is stamp-driven, not query-driven);
  `DeviceCommand_ResetTransactionStamp` (punch re-sync analogue);
  `DeviceCommand_BlockUnBlockUser` is **listed on the product page but
  has NO section in the manual** (zero full-text hits). No `Return`
  codes, no −1/−2, no USERINFO/ATTLOG/OPERLOG/FINGERTMP tables, no
  TransFlag, no PushProtVer, no GET OPTIONS, no command timeout, no
  getrequest ordering anywhere.
- **D2 — eBioServerNew Web Hook Manual v1.2, 2025-03-25, 5pp**
  (`media.esslsecurity.com/media/3rd_Party_Integrations/eBioserverNew-Web-Hook_Manual.pdf`).
  Middleware JSON punch fields: Direction, DeviceDirection, WorkCode,
  VerificationType (Finger/Face/Card/Password), wall-clock LogDate with
  no offset. Corroborates direction/verification-type as distinct punch
  attributes in eSSL's own data model; says nothing about ADMS tab-cell
  order.
- **D3 — F18 User Manual V1.0 (sibling model, eSSL-hosted): zero ADMS
  hits in full-text search — negative evidence only.**
- **Downloads page** (`esslsecurity.com/software`, no login gate):
  eTimeTrackLite 12.2, BIO-Server 3.0, ePush Server — ePush is binary
  downloads only, no manual or release-notes link (not fetched, per the
  no-binary boundary); several official-page links point off-domain
  (Drive/MediaFire). Catalogue PDFs exist for K90, I_Clock_990, X990,
  F18 — all confirm "Push data" as a marketed capability; none is a
  protocol doc.
- **NOT found anywhere on the portal:** no ADMS/push protocol spec
  (either dialect), no X2008 product page, catalogue PDF, manual,
  datasheet, or firmware release notes — consistent with X2008 being a
  discontinued/dealer-only model.

### What stayed gated (precise)

Only `https://www.esslservices.com/support` (eSSL Support Management
System) — login form only ("Login to your account / Enter your
credentials below", Remember Me, New Registration, Forgot Password); no
content visible without sign-in; no login attempted. It unlocks with a
**registered support account (Registered User ID & Password, per the
official brochure, via the eSSL Support Management app; contact
services@esslsecurity.com)**. Whether an X2008 manual hides behind it is
unknown — the single highest-value follow-up, needing an account the
track does not hold. Everything else on the portal was NOT gated, so the
missing spec is a genuine public-portal absence, not a gating artefact.
The eBioServer demo server was not pursued (live interactive account
use beyond page-text research, and middleware, not device protocol).

### Per-assumption status updates

None of the 5 prior partials (A1, A4, A6, A15, A25) was promoted. A6
strengthened at the middleware layer only. A25 gains a third validity
channel (middleware expiry) proving nothing about X2008 enforcement or
ADMS PUSH. Full 25-verdict table:
`.adms-investigation/portal-re-verdicts.json`.

### Portal-supported risk (explicitly NOT a contradiction)

eSSL's own user re-sync is stamp-driven (`ResetOPStamp`), while Renewal
Desk's ADMS path is stamp-blind and relies on `DATA QUERY USERINFO`,
which has no official-portal backing anywhere. Proposed follow-up
(parent's call, no code touched): on next real-X2008 access, run the
Track A closing tests for A5/A10/A24 together plus a stamp probe (record
OPERLOGStamp/ATTLOGStamp from the terminal's initial GET OPTIONS request
— currently ignored — and test whether returning stamps changes
re-upload behaviour); until then, do not rely on `sync_users` for
template backup.

### How portal findings fed back into the fixes

- Confirmed → evidence-backed: none (no assumption closed).
- Contradicting → new confirmed finding: none.
- Silent → conservative: all open assumptions stayed unverified, and
  their fixes stayed conservative (notably M5 exact-only auto-link and
  the M7 migration hold).

---

## 7. Test evidence

**Final full suite on the merged tree (`adms-fixes` @ `19ee498`):
394 passed, 3 failed.** All 3 failures are pre-existing, proven
identical on the pre-fix tree (`43f50c9`, investigation tests only):

- `tests/test_mobile_gym_owner_management.py::test_mobile_remote_unlock_and_sync`
- `tests/test_rrr_growth_system.py::test_unmapped_event_is_retained_then_resolved`
- `tests/test_rrr_growth_system.py::test_direct_adms_test_queue_delivers_and_records_terminal_ack`

**Zero new failures.** The 7 other pre-existing failures from the
10-failure baseline are FIXED by this work (5 drift failures via A10
test corrections + 2 OPERLOG CHECK failures via M1).

**New tests added:** guard 7, OPERLOG 2, auth 18, rest 26 (21 rest-fixes
+ 3 template-crypto + 2 serial-unique; the L4 test was replaced, not
removed, by the coordinator correction). Total suite grew from ~331 to
397 tests.

**Per-track verification (before merge):** guard suite 13 passed +
adjacent 42 passed / 7 pre-existing; OPERLOG fake-device 15/15 + wider
sweep 27 passed; auth new suite 18/18 + neighbours 71 passed + 13
tenant/enroll passed; rest targeted 70 passed / 2 pre-existing (OPERLOG,
since fixed) + wider 46 passed / 1 pre-existing (token-only `_device`
expectation, superseded by the auth track's deliberate serial fallback);
merged guard+operlog 41 passed / 5 drifts; merged guard+operlog+auth
77 passed / 5 drifts. Merged tree boots clean locally (`BOOT OK`).

**Not proven by `/health`:** `/health` proves release + schema check,
not a live OPERLOG insert or a live device auth exchange — functional
proof awaits the next real enrollment / device exchange at an ADMS gym.

---

## 8. Needs Bharath's decision (with reasons)

1. **Railway deploy log for main (`9596839c` → `dc3f12b0`).** Blocks
   batches 3 + 4 going live. Cannot be obtained from this environment
   (no Railway dashboard/CLI access). Leading hypothesis: auth
   migration unique-index backfill vs duplicate plaintext tokens.
2. **M7 migration deploy order.** Ships after batch 3 lands (rebase if
   the head moves); prod duplicate-serial check first (migration aborts
   on duplicates, never deletes).
3. **Path-less X2008-class terminals and token auth.** No device-side
   route to token auth exists for terminals that always POST
   `/iclock/cdata`. Supported config today: serial-fallback ON
   (warning-logged, never error-clearing). Compensating control
   undecided: source-network allowlist vs moving the gym to a
   bridge/connector path. Turning fallback OFF for these terminals
   would stop all their ingestion/polling with no device-side recovery.
4. **M5 inexact auto-link band.** 90–99% matches stay owner-review.
   Whether any inexact band should ever auto-link again is a product
   call; likewise whether serial-only-session links need extra
   confirmation.
5. **H2 key rotation.** Rotating `TEMPLATE_ENCRYPTION_KEY` without
   re-encrypting orphans rows (restore skips them loudly). A dedicated
   key is recommended; the rotation procedure is documented in
   `ADMS_REST_FIXES_2026-10-24.md`.
6. **PWA follow-ups from the rest batch.** Staff remote-unlock now 403
   (button needs owner-only UX + ideally a confirm dialog);
   uncommissioned gyms now get 403 from enroll-scan (needs UX copy).
   No PWA files were touched.
7. **eSSL support account.** The only route to a possible X2008 manual
   behind `esslservices.com/support` needs a registered account the
   team does not hold.
8. **Bridge snapshot path observation (not fixed, out of scope).**
   `app/bridge/routes.py` calls `upsert_terminal_snapshot(integration.id,
   …)` where the first parameter is `gym_id`, and looks up
   `connector_type='adms_direct'` for bridge/ebioserver integrations —
   that bridge snapshot path looks effectively dead. Flagged so it
   isn't mistaken for part of the OPERLOG fix.
9. **Three pre-existing test failures (§7).** Unrelated to this work
   (they fail on the clean tree too); left alone, not papered over.

---

## 9. File inventory (branch `adms-fixes`)

- Worker branches (merged, never pushed except via the deploy pushes
  in §2): `adms-fix-guard` (`c4a4a07`), `adms-fix-operlog` (`343cbc4`),
  `adms-fix-auth` (`ec9b295`), `adms-fix-rest` (`d7e8164` + `dc50ca5`).
- Merge commits: guard `e854dbd`, operlog `1f2dd9f`, auth rebase,
  rest `c90b4a3`, L4 correction `19ee498`.
- Migrations: merge `b87640da5a46`, CHECK `16912c2a3121` (both LIVE
  via batch 2), auth `f7a8b9c0d1e2` (on main, not served), M7
  `e7f8a9b0c1d2` (branch only, held).
- Notes: `ADMS_REST_FIXES_2026-10-24.md` (rest worker's per-finding
  notes, H2 rotation path, M7 deploy warning, PWA follow-ups),
  `docs/ADMS_DEVICE_AUTH_ROLLOUT.md` (auth rollout/commissioning guide),
  `.adms-investigation/` (protocol/security/tests tracks + portal
  section + verdicts).
- No real member biometrics, PINs, credentials, or production data in
  code, tests, or this report — synthetic fixtures only.

---

## 10. Reconciliation with the live system (checked 2026-10-24)

- **Live check this session:** production `/health` reports revision
  `b19917b7fc41` (the batch-2 release), db ok, schema ok. It has not
  moved since the batch-4 push.
- **Why that revision is "not in this checkout":** deploys reach
  production through snapshot pushes, which create fresh commits on
  GitHub main that have no matching commit in this checkout. Verified:
  `git cat-file -t b19917b7fc41` fails locally, and the local `main`
  ref (`4113d78`) is far older than GitHub main. **The local `main`
  must not be used as the base for any update.** Reconciliation is
  therefore by file content, not by commit ancestry.
- **GitHub main HEAD confirmed via connector read:** `dc3f12b0`
  (the batch-4 push); nothing has landed on main since.
- **Content comparison (git blob SHA, main vs branch):** byte-identical
  for `app/adms/routes.py`, `app/models/rrr.py`,
  `app/services/bridge_service.py`, `app/bridge/routes.py`,
  `tests/test_stale_disable_guard.py`, `tests/test_adms_fake_device.py`,
  migrations `b87640da5a46` and `16912c2a3121` (batch 2), and migration
  `f7a8b9c0d1e2` (batch 3, on main, not served). README.md is identical
  on both sides.
- **Intended differences only:**
  - Branch-only (correctly absent from main): the M7 migration
    `e7f8a9b0c1d2` (held, §2) and this report file (workspace
    deliverable, not a system file). The `.adms-investigation/` docs
    were likewise never pushed.
  - Main-only: the `renewal-desk-pwa/dist/` files — verified present
    on main, so the deletions recorded in this branch's merge commit
    (§5.3) never propagated.
- **Conclusion:** GitHub main's content is exactly the branch's content
  minus the intended holds above. Branch and main are reconciled at the
  content level.
- **Standing precondition for ANY future deploy:** push from this
  reconciled content, then confirm production `/health` shows the new
  main revision. If it does not flip within about 10 minutes, stop —
  do not push again to force it. Last checked live revision:
  `b19917b7fc41`.
