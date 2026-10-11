# ADMS (Direct Cloud) End-to-End Review

**Date:** 2026-10-11 | **Scope:** Complete ADMS chain for Renewal Desk pre-Elite Gym visit
**Verdict:** ✅ Chain is fully wired. No blockers found.

---

## Chain Overview

```
X2008 terminal --(HTTP:80)--> GCP VM 136.87.19.164 (nginx) --(HTTPS:443)--> Railway
                                                                          gym-production-910c.up.railway.app
                                                                          /iclock/<token>/cdata|getrequest|devicecmd
```

---

## 1. Backend ADMS Endpoints — ✅ Wired

**File:** `app/adms/routes.py`

| Endpoint | Handler | Status |
|---|---|---|
| `GET/POST /iclock[/<token>]/cdata` | Registration + ATTLOG ingest | ✅ |
| `GET/POST /iclock[/<token>]/registry` | Device registry | ✅ |
| `GET /iclock[/<token>]/getrequest` | Command polling (PUSH delivery) | ✅ |
| `GET/POST /iclock[/<token>]/devicecmd` | Command acknowledgement | ✅ |

**Blueprint registration:** `app/__init__.py:268,298` — registered, CSRF-exempt ✅
**Feature flag:** `DIRECT_ADMS_ENABLED=true` in production config (`app/config.py:180`) ✅

**Auth design** (`routes.py:36-54`):
- Token-first: per-integration path token (`/iclock/<token>/`) authenticates directly
- Serial fallback: matches `device_serial` for non-token URLs
- Serial mismatch with valid token → rejected (prevents cross-gym confusion)
- Unknown devices get indistinguishable "OK" (no serial enumeration)

**ATTLOG ingest** (`routes.py:113-147`):
- Handles both raw body and form-encoded `data=` payloads
- Parses tab-separated PIN/timestamp/status/verify fields
- Timezone-aware (gym timezone → UTC)
- Deduplicates via `normalize_attendance`, tracks unmapped records

**Command delivery** (`routes.py:194-218`):
- Returns `C:<id>:<command_text>` PUSH SDK format
- Re-sends "delivered" commands until acked (survives Wi-Fi drops)
- "queued" → "delivered" on first poll

**Command acknowledgement** (`routes.py:225-252`):
- Parses `ID` and `Return` params
- `Return=0` → "acked", else "failed"
- Records timestamp and detail

## 2. Provisioning — ✅ Wired

**Endpoint:** `POST /api/mobile/v1/rrr/integrations/adms/provision` (`app/mobile_api/rrr.py:200`)

- Validates serial, checks cross-gym conflicts (409)
- Generates unguessable `adms_path_token` (backfilled for legacy rows)
- Returns `terminal_settings` computed from `ADMS_PUBLIC_URL`

**PWA:** `rrr-integrations.js:112` → POSTs `{device_serial, device_name}` ✅
**PWA display:** `rrr-integrations.js:140-153` shows server address, port, HTTPS, path ✅

## 3. ADMS_PUBLIC_URL — ✅ Correct

**Config:** `app/config.py:61` reads `ADMS_PUBLIC_URL` env var
**Railway:** Set to `http://136.87.19.164` ✅
**Logic:** `adms_terminal_settings()` (`app/services/rrr_service.py:341`)

With the current setting, terminals receive:
- `server_address`: `136.87.19.164`
- `server_port`: `80`
- `https`: `false`
- `path`: `/iclock/<per-integration-token>`

This is exactly what an HTTP-only X2008 needs.

## 4. Proxy — ✅ Live and Forwarding

**VM:** GCP e2-micro, external IP `136.87.19.164`
**nginx:** HTTP:80 → HTTPS → `gym-production-910c.up.railway.app`

**Live verification (2026-10-11):**
- `curl http://136.87.19.164/health` → `{"db":"ok","revision":"29fc98f09713",...}` ✅
- `curl https://gym-production-910c.up.railway.app/health` → same revision ✅

The proxy correctly forwards to Railway. Both return identical responses.

## 5. Device Commands (Block/Unblock) — ✅ Wired

**Wire format** (`app/services/bridge_service.py:67-85`):
```
Block:   DATA UPDATE USERINFO PIN=<enroll>\tPri=1
Unblock: DATA UPDATE USERINFO PIN=<enroll>\tPri=0
```
Pri=1 is the vendor's inactive-user value. Deletion is never used (preserves biometric templates).

**Manual block/unblock:**
- Backend: `POST /api/mobile/v1/rrr/members/<id>/access` (`app/mobile_api/rrr.py:388`)
- PWA: `member-detail.js:268` → POSTs `{action: 'block'|'unblock'}` ✅
- Android: `MemberDetailScreen.tsx:186` → same endpoint ✅

**Safety gates** (`bridge_service.py:209-256`):
- Requires `commands_enabled` (supervised commissioning)
- Requires `last_success_at` (terminal actually connected)
- Requires bound enroll number (identity mapping)

## 6. Commissioning Flow — ✅ Complete

1. **Provision** → status `not_configured`, `commands_enabled=false`
2. **Terminal connects** → `_touch()` sets status `connected`, creates RRRDevice record
3. **Test command** → owner queues `probe_info`/`block_test`/`unblock_test` from integrations screen
4. **Terminal acks** → `devicecmd` records `acked` status
5. **Enable commands** → requires acked test + mapped attendance event → `commands_enabled=true`
6. **Block/unblock live** → manual + automatic (on membership expiry/renewal)

**Rate limits:** 180/min on cdata/getrequest/devicecmd (sufficient for terminal polling), 20/hour on test command queue, 30/hour on manual access.

---

## Findings

### No blockers found.

### Minor observations (non-blocking):

1. **cdata GET response is minimal** (`routes.py:171`):
   Returns only `~SerialNumber` and `~DeviceName`. Some eSSL firmware expects additional options (e.g., `~ServerVersion`, `~PushVersion`). If the X2008 doesn't register on first try, this is the first place to expand. **Severity:** 🟡 Low — core flow should work; monitor at Elite Gym.

2. **No HTTPS on proxy** — by design (X2008 can't do HTTPS). The path token provides authentication. **Severity:** 🟢 By design.

3. **Setup doc references Oracle Cloud** (`~/workspace/your_files/oracle-adms-proxy-setup.md`) but the live VM is GCP. The nginx config concept is identical, but the doc's Part 2 (VM creation) doesn't match the actual GCP setup. **Severity:** 🟡 Low — doc drift; update if someone needs to rebuild the proxy.

4. **Terminal polling interval** — not configurable server-side. If the X2008 polls getrequest too aggressively, the 180/min limiter could throttle it. Typical eSSL default is 30-60s polling, well within limits. **Severity:** 🟢 Low.

---

## Pre-Visit Checklist (for Elite Gym)

- [x] Railway backend healthy (revision 29fc98f)
- [x] Proxy VM healthy and forwarding
- [x] ADMS_PUBLIC_URL set to http://136.87.19.164
- [x] DIRECT_ADMS_ENABLED=true in production
- [x] Provisioning endpoint working
- [x] Block/unblock wired on PWA + Android
- [ ] **At gym:** Read X2008 serial (Menu → System Info)
- [ ] **At gym:** Provision via PWA → enter serial
- [ ] **At gym:** Type proxy values into terminal (136.87.19.164:80, HTTP, /iclock/&lt;token&gt;)
- [ ] **At gym:** Verify terminal shows "connected" in PWA
- [ ] **At gym:** Run test command → verify ack
- [ ] **At gym:** Door test: block → verify blocked → unblock → verify access
