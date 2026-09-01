# Renewal Desk — 7-Day Trial Final Audit

## Canonical Trial Duration

**7 DAYS** (`DEFAULT_TRIAL_DAYS = 7` in `app.models.gym`)

## Audit Matrix

| Category | Status | Details |
| :--- | :--- | :--- |
| **Canonical Constant** | **PASS** | Authoritative `DEFAULT_TRIAL_DAYS = 7` declared in `app.models.gym` and consumed across all signup, registration, admin, and demo flows. |
| **Self-Service Signup** | **PASS** | `POST /api/mobile/v1/auth/signup` and `POST /api/mobile/v1/auth/register` set `trial_ends_at = date.today() + timedelta(days=7)` and `subscription_status = "trial"`. |
| **Trial Calculation** | **PASS** | Calculated as exact 7 calendar days (`date.today() + timedelta(days=7)`). |
| **Trial Countdown** | **PASS** | Expiry date formatted directly from authoritative backend date (`trial_ends_at`). |
| **Trial Expiry** | **PASS** | Handled by backend `entitlement_for` serialization without device-level assumption. |
| **Trial → Google Play** | **PASS** | Subscribing transitions billing source to `GOOGLE_PLAY` with server-verified entitlement. |
| **Trial → Manual** | **PASS** | Admin activation sets `subscription_status = "active"` and clears `trial_ends_at`. |
| **Reinstall** | **PASS** | Trial dates are stored server-side in the PostgreSQL `gyms` table; reinstalling or logging in from another device reads the original dates without restarting the trial. |
| **Multi-device** | **PASS** | Account authentication retrieves the server-backed `trial_ends_at`. No client-side trial creation exists. |
| **Country Independence** | **PASS** | All supported countries (`IN`, `AE`, `US`, `GB`, `AU`) receive the identical canonical 7-day trial. |
| **Plan Independence** | **PASS** | All plans (Starter, Growth, Pro) share the same 7-day trial policy. |
| **Notifications** | **PASS** | Notification messages refer only to actual backend-calculated expiry dates. |
| **Subscription UI** | **PASS** | `SignupScreen.tsx` updated to explicitly state "Includes a free 7-day trial" and "Start 7-Day Trial". `SubscriptionScreen.tsx` displays live expiration formatted from backend ISO timestamp. |
| **Backend Authority** | **PASS** | All entitlement state is server-owned. Client requests cannot modify subscription or trial status. |
| **Client Manipulation Protection** | **PASS** | Tested: Injected `trial_days`, `trial_ends_at`, or `subscription_status` fields in client payloads are strictly ignored by backend validators. |
| **Timezone** | **PASS** | Date math uses gym-scoped calendar days. |

---

## Automated Tests

- **Backend Pytest Suite**: 173 passed (100% pass rate) in 150s.
  - Dedicated 7-day trial test suite: `tests/test_7_day_trial_system.py` (7 tests, all passed).
- **Mobile Verification Suite**:
  - TypeScript Typecheck: 0 errors
  - ESLint: 0 errors
  - Mobile unit tests: 17 passed (100% pass rate).

---

## Issues Found & Fixes Applied

1. **Mobile Signup / Register Trial Length**:
   - `app/mobile_api/auth.py` previously had `timedelta(days=14)`.
   - **Fix**: Replaced with canonical `timedelta(days=DEFAULT_TRIAL_DAYS)` (7 days).
2. **Web Registration Trial Length**:
   - `app/auth/routes.py` previously had `timedelta(days=14)`.
   - **Fix**: Replaced with canonical `timedelta(days=DEFAULT_TRIAL_DAYS)` (7 days).
3. **Admin Onboarding Wizard & Create Gym**:
   - `app/admin/routes.py` previously had `timedelta(days=30)` in onboarding wizard and hardcoded template options (`Trial (30 Days)`, `Trial (14 Days)`).
   - **Fix**: Replaced with `DEFAULT_TRIAL_DAYS` (7 days) and updated template dropdown labels to `Trial (7 Days)`.
4. **Mobile Signup Screen Copy**:
   - `renewal-desk-android/src/screens/SignupScreen.tsx` previously stated `30-Day Trial`.
   - **Fix**: Updated info box and button to `Includes a free 7-day trial` and `Start 7-Day Trial`.

---

## Legacy Trial Data

- Existing production records with historical trial dates are preserved as legitimate historical ledger entries.
- Active paid gyms (`subscription_status = "active"`) have trial expiry decoupled so legacy trial end dates never interfere with paid operations.

---

## Remaining Issues

- **P0**: None
- **P1**: None
- **P2**: None

---

## Final Verdict

# PASS
