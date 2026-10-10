All claims verified against the code. Here is the consolidated final report.

---

# Security Review — Renewal Desk Flask Backend (`~/workspace/renewal-desk/app`)

Read-only review; no files edited. My own auth/authorization deep-dive plus two parallel subagent reviews (webhooks/payments/rate-limits; injection/secrets/uploads/session/mass-assignment). Every finding below was verified by reading the code. Three findings are **conditional on production env** — flagged as such, with what to check.

## TOP 10

### 1. [CRITICAL] Hardcoded founder email auto-promoted to super_admin — full platform takeover
**File:** `app/auth/routes.py:120-126`
```python
founder_emails = {
    "bharathclaude1@gmail.com",          # hardcoded literal
    default_admin_email,                 # env-derived (ok)
    os.getenv("SUPERADMIN_EMAIL", "").lower().strip(),
} - {""}
if user.email in founder_emails and user.role != "super_admin":
    user.role = "super_admin"
```
**Exploit:** Web self-registration is open (`POST /auth/login` page links to `/auth/register`, ~30/hour limit, no invite needed). `User.email` is unique. If `bharathclaude1@gmail.com` is not yet registered, an attacker registers it with a password of their choosing, logs in via the web, and this block silently promotes them to `super_admin` on login — full platform admin: every gym's data, all member PII, password resets, bridge API keys, admin routes (`@roles_required("super_admin")` becomes meaningless).
**Fix:** Delete the hardcoded email entirely. Super_admin must only come from an explicit deploy-time bootstrap (e.g., the existing `create-admin` CLI / `SUPERADMIN_EMAIL` one-time creation), never an automatic per-login promotion derived from a claimable email string.
**Check now:** is `bharathclaude1@gmail.com` already a registered user? If yes, urgency drops but the landmine must still be removed.

### 2. [HIGH] Any gym staff can read members' live OTPs → member account takeover
**Files:** `app/mobile_api/members.py:331-337` (disclosure), `app/mobile_api/member_api.py:91-106` (in-memory OTP store)
**Exploit:** `GET /api/mobile/v1/members/<id>` (allowed for `staff` role) embeds `recent_otp` — the member's current live 6-digit code — in the response. Attack chain for any staff user: (1) read member's phone from the member list, (2) call unauthenticated `POST /api/member/v1/auth/request-otp` with that phone (populates `_RECENT_MEMBER_OTPS[member.id]`), (3) `GET` member detail, read `recent_otp`, (4) `POST /auth/verify-otp` → signed member JWT → full impersonation (payment claims, UPI renewals, history). The "staff assist" feature intent breaks OTP as an auth factor. (Store is per-gunicorn-worker so it's flaky across workers, but reliably exploitable with retries.)
**Fix:** Remove `recent_otp` from the API response. If staff-assist is genuinely needed, restrict to `gym_owner` role on a separate audited endpoint that never reveals the code (e.g., "resend code to member's WhatsApp").

### 3. [HIGH] Password-reset link (30-min bearer token) written to application logs
**File:** `app/auth/routes.py:253-256`
```python
current_app.logger.info("Password reset link for %s: %s", user.email, reset_url)
```
**Exploit:** Anyone with log access (Railway logs, log drains, on-call staff) opens the URL and resets any user's password — including gym owners. Combined with finding #10 (reusable token), the window is generous.
**Fix:** Log only that a reset was requested (email/user id), never the token/URL. Deliver the link via the existing WhatsApp/email path instead of the TODO.

### 4. [HIGH — conditional] Reviewer bypass: fixed OTP `123456` backdoor
**Files:** `app/mobile_api/member_api.py:73-76` (gate), `:303-304` (fixed OTP), `:421-433` (`"test_otp": otp` echoed in response), `:461-463` (challenge-free verify), `:263-280` (auto-creates member)
**Exploit:** If `ENABLE_REVIEWER_BYPASS=true` (env or app config; **not** in `config.py`, default off): `request_otp` sets OTP `"123456"` for phones ending `9999999999`/`7995854994` **and echoes it in the JSON response**; `verify_otp` accepts it with no HMAC challenge via an unscoped cross-gym phone-suffix lookup → member JWT. `request_otp` with `9999999999` also **creates a "Google Play Reviewer" member row in the first active gym** — unauthenticated write into a real gym's table.
**Fix:** Delete the bypass (Play-review artifact) or gate strictly behind `TESTING` only; never echo OTPs; add a production boot check refusing to start when the flag is set.
**Check now:** is `ENABLE_REVIEWER_BYPASS` set in the Railway production env?

### 5. [HIGH — conditional] ADMS device webhook: serial-number-only authentication
**File:** `app/adms/routes.py` — `_device()` (51-57), `cdata` (138), `registry` (157), `getrequest` (169), `devicecmd` (198)
**Exploit:** Auth is `filter_by(connector_type="adms_direct", device_serial=serial)` with `serial` from the unauthenticated `SN` query param, gated only by `DIRECT_ADMS_ENABLED` (default false). When enabled: anyone who knows/guesses a terminal serial can POST forged `ATTLOG` lines (fake attendance/access events via `normalize_attendance`), flip device status to "online" (masking real outages), and ACK queued test commands (`Return=0` → marked `acked` with no real terminal). The 200-vs-404 responses give a serial-enumeration oracle.
**Fix:** Keep default off; add a per-integration shared secret issued once at provisioning, sent as a query param and compared with `hmac.compare_digest`; rotate on re-provision; alert on anomalous punch volume per device.
**Check now:** is `DIRECT_ADMS_ENABLED=true` in production? (Note: this path was just built for Elite Gym onboarding.)

### 6. [HIGH — conditional] Google OAuth audience check skipped when client IDs unconfigured
**File:** `app/mobile_api/auth.py:208-218` — `if configured_client_ids and google_data.get("aud") not in configured_client_ids:`
**Exploit:** If `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_ANDROID_CLIENT_ID` are empty (the shipped default), the `aud` claim is never validated — any genuine Google ID token for *any* OAuth client is accepted (only `email_verified` checked). Enables token-substitution/phishing replay: victim "Signs in with Google" on an attacker's site, token is replayed here.
**Fix:** Fail closed — reject with 401/503 when no client IDs are configured instead of skipping the check.

### 7. [MEDIUM] Password changes don't revoke mobile refresh tokens — stolen tokens survive reset
**Files:** `app/auth/routes.py:270-293` (`reset_password`), `:196-230` (`change_password`), `app/mobile_api/staff.py:173-210` (`reset_staff_password`)
**Exploit:** All three call `set_password()` and commit but never `revoke_all_user_tokens()`; tokens carry no password version (access JWT = HMAC of `sub/gym_id/role/exp` only). A 30-day refresh token stolen before the victim resets their password keeps working — `rotate_refresh_token` keeps issuing new access tokens. The standard "reset password to kick out an attacker" remediation silently fails.
**Fix:** Call `revoke_all_user_tokens(user.id)` in all three paths, and/or add a `password_version` claim incremented on `set_password`.

### 8. [MEDIUM] Bridge v2 pairing codes: `random.randint`, plaintext in DB, 24h window → permanent API key
**Files:** `app/admin/routes.py:117-118` (`f"{random.randint(100000, 999999)}"`), `app/models/gym_deployment.py:36-37` (plaintext `pairing_code` column), `app/bridge/routes.py:497-651` (exchange)
**Exploit:** 6-digit codes (non-crypto RNG), stored plaintext, valid 24h; unauthenticated `/api/bridge/v2/pair` at 20/min/IP ≈ 28.8k guesses/day ≈ 3%/day/IP against a 900k space. A successful pair returns a permanent `rdb_live_*` bridge API key → forged attendance as that gym. Any DB/backup/log read of the plaintext code also wins immediately. (The newer `RRRIntegration` path is fine: `secrets`-generated, SHA-256-hashed, 10-min expiry.)
**Fix:** Migrate `GymDeployment` codes to the hashed + ≤10-min model, generate with `secrets`, stop logging plaintext codes in admin timeline events, add per-gym attempt caps.

### 9. [MEDIUM] Bearer token in URL + unescaped reflection → token leak + XSS on embedded-signup page
**File:** `app/mobile_api/whatsapp.py:359-381` (unauthenticated `GET /api/mobile/v1/whatsapp/embedded-signup-page`), `:774-777`, `:836`, `:916`
**Exploit (leak):** The 15-min gym-owner JWT travels as `?token=<JWT>` — lands in Railway/proxy access logs, WebView history, `Referer` headers; page JS then uses it as `Authorization: Bearer`.
**Exploit (XSS):** `meta_app_id`, `config_id`, `feature_type`, `token` are reflected unescaped into single-quoted JS strings. A crafted link `...?config_id=x';alert(document.domain)//` executes JS on the app's own domain — this page is the Meta OAuth signup flow, a ready-made credential-phishing primitive, reachable unauthenticated.
**Fix:** Stop passing the Bearer token in the URL — mint a short-lived, single-use, scope-limited handshake token from the authenticated onboarding-config endpoint; HTML/JS-escape every reflected param (or whitelist `^[A-Za-z0-9_-]+$`).

### 10. [MEDIUM] Password-reset tokens are reusable and not bound to password state
**File:** `app/auth/routes.py:268-293` — itsdangerous timed token (`max_age` 30 min, correct) but payload is only `user_id`: no single-use marker, not bound to the current password hash.
**Exploit:** A leaked/logged token (see #3) can be reused repeatedly within 30 minutes and stays valid even after the victim changes their password.
**Fix:** Bind the token to the password hash (include a hash prefix in the signed payload, reject on mismatch) or a per-user `password_reset_version` incremented on every password change.

---

## Also verified (real issues, just below the top-10 cut)
- **OTP via `random` not `secrets`** — `app/mobile_api/member_api.py:86-87` (`random.choices(string.digits, k=6)`); same weak primitive in `_generate_pairing_code`. Low practical exploitability (5/min + 10/min limits blunt brute force), but wrong primitive for auth secrets → swap to `secrets`.
- **`DELETE /api/mobile/v1/auth/account` has no step-up auth or rate limit** — `app/mobile_api/auth.py` (`delete_account`, after line 523): one request with a valid token permanently deletes the entire gym and all data. No password confirmation. → require password re-entry + limiter.
- **Staff password reset** (`app/mobile_api/staff.py:173-210`): returns the new plaintext password in the API response **and** embeds it in a `wa.me` invite URL (`text` param — logged by intermediaries); 6-char minimum vs 12 for owners; old sessions not revoked.
- **Member phone lookup by 10-digit suffix, no gym scoping** (`app/mobile_api/member_api.py:303-309`): `Member.phone.endswith(phone[-10:])` across all gyms, `.first()` — cross-tenant nondeterminism and cross-country-code collision surface.

## Verified clean (checked, not vulnerable)
- **SQL injection:** none — ORM/`select()` with bound params throughout; `sort` params whitelisted; no interpolated raw SQL.
- **OS command injection:** no `os.system`/`subprocess`/`eval`/`exec` anywhere.
- **CSRF:** `CSRFProtect` global; web forms use Flask-WTF; no `@csrf.exempt` on cookie-authenticated routes (exemptions are only independently-authenticated machine APIs).
- **CORS:** no `flask_cors` / no `Access-Control-Allow-Origin` anywhere.
- **Mass assignment:** none — member/staff/settings endpoints use explicit field allowlists; staff invite hardcodes `role="staff"`.
- **File uploads:** `secure_filename`, magic-byte content checks, uuid filenames, tenant-scoped serving; CSV import is in-memory with 5MB cap.
- **Token service:** HMAC-SHA256 + `compare_digest`, hashed opaque refresh tokens, replay detection with family invalidation, `secrets`-based generation — solid.
- **WhatsApp webhook:** `X-Hub-Signature-256` verified with constant-time compare, fails closed when secret unset.
- **Google Play RTDN + purchase verify:** OIDC bearer validation with audience + service-account allowlist, server-side purchase re-verification, no client-supplied amounts.
- **Login hardening:** dummy-hash on unknown emails (no enumeration timing), account lockout, rate limits on web (10/min;60/hr) and mobile (5/min) login, `_is_safe_redirect` against open redirects.
- **Production boot guards** (`app/__init__.py:182-187`): refuses to boot unless `SECRET_KEY` ≥32 chars, `DATABASE_URL` is Postgres, and Redis is real (no silent in-memory rate limiting) — the weak-dev-default concern is mitigated in prod.
- **IDOR spot-checks:** member/staff/payment/renewal mobile endpoints consistently filter by `g.gym_id`; admin routes enforce `@roles_required("super_admin")`; staff invite hardcodes role.

## Recommended immediate actions for the parent
1. **Check prod env now:** `ENABLE_REVIEWER_BYPASS`, `DIRECT_ADMS_ENABLED` — findings #4 and #5 are live-or-not based on these.
2. **Check whether `bharathclaude1@gmail.com` is a registered user** — determines whether #1 is actively exploitable vs. a landmine.
3. Suggested fix order: #1 (one-line-ish, highest blast radius) → #2 → #3 → #4/#5 (env checks) → #9 → #7/#10 → #8 → #6.
4. Note: the `adms_direct` path (finding #5) is the brand-new Elite Gym onboarding surface built in the last 48h — worth hardening before the first real terminal connects.