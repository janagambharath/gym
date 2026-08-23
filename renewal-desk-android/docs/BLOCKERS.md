# Android launch blockers

Updated: 2026-08-23 (launch-gate execution pass)

This ledger records blockers that could not be safely solved in the Android repository. No backend, database, Railway, WhatsApp, payment, or biometric Bridge system was changed.

| ID | Severity | Component and evidence | Exact issue | Safe fix applied here | Required external next action | Retest result |
| --- | --- | --- | --- | --- | --- | --- |
| B-01 | Critical | Backend `app/__init__.py`, `app/auth/routes.py` | **The backend has no mobile API implementation.** There are zero `/api/mobile/v1` routes registered or implemented. The `_register_blueprints()` function registers only web/browser blueprints and the Bridge API. The auth system uses Flask-Login browser sessions with CSRF forms — there is no JWT/token authentication endpoint. Previous reviews referenced a "source mobile contract" that does not exist in the codebase. | Built a complete Android-side API client (`src/services/apiClient.ts`) with Bearer token auth, automatic 401→refresh→retry, and typed login/logout. These will activate once the backend provides the endpoints. | **Build a mobile API on the Flask backend**: JWT auth (`/api/mobile/v1/auth/login`, `/refresh`, `/logout`), JSON dashboard, members, renewals, payments, WhatsApp, and settings endpoints with RBAC and tenant scoping. | Blocked: no mobile API exists. |
| B-02 | Critical | Production deployment | `https://gym-production-910c.up.railway.app/api/mobile/v1/health` returns HTTP 404. There is no mobile API namespace deployed because it doesn't exist in the source code. | Runtime configuration refuses to invent a production API URL, requires HTTPS, and rejects loopback URLs outside development. | Deploy the mobile API once it is built. | Blocked. |
| B-03 | Critical | Authentication, tenant isolation | No usable mobile login/refresh/logout endpoint exists. Tenant isolation, RBAC, and financial mutation tests cannot be performed. | Built login screen, session management with SecureStore (access + refresh tokens), and automatic 401 handling. These are ready to work once the backend provides JWT endpoints. | Provide JWT auth endpoints and two-gym test accounts. | Blocked. |
| B-04 | Critical | Local Android release build | JVM 8 installed on this host; Gradle 9.3.1 requires JVM 17+. No `.aab` or `.apk` can be produced. | N/A — environment constraint. | Use a release workstation with JDK 17+, Android SDK/adb, or use EAS Cloud Build. | Blocked: no production artifact exists. |
| B-05 | Critical | EAS/release signing | No authenticated Expo/EAS account or approved Android signing configuration is available. | Keystores and credentials remain ignored; none were generated or committed. | Authorize the EAS project/account or configure Play App Signing. Keep signing material outside Git. | Blocked. |
| B-06 | High | Store assets and legal configuration | No privacy-policy URL, Data Safety declaration, approved store screenshots, reviewer access, or final branding approval. | Added Play Console checklist. No fake policy or reviewer account was created. | Business/legal owner must create factual policy and Play declarations. | Unverified. |
| B-07 | High | Device and gym acceptance | No release APK, two-tenant test, offline test, or three-gym pilot has occurred. | Automated static validation completed. JS bundle export verified (834 modules, 1.9MB). | Build signed test APK, recruit real testers, execute acceptance plan. | Blocked. |
| B-08 | Medium | Dependency audit | `npm audit --omit=dev` reports 10 moderate transitive advisories in the Expo `uuid`/`xcode` chain. The only automatic suggestion is a breaking downgrade to Expo SDK 46. | Did not run `npm audit fix --force`. | Review Expo-supported upgrades before release. | Unverified pending supported remediation. |

## Fixes completed in this execution pass

### Code improvements
- **API client** (`src/services/apiClient.ts`): Full authenticated API client with Bearer token injection, automatic 401→refresh→retry (deduplicated), timeout handling, typed login/logout.
- **Session store strengthened** (`src/storage/secureSessionStore.ts`): Added `refreshToken` (required), `tenantName`, `userName`, `userRole` fields. Session now carries all data needed for the auth flow.
- **Login screen** (`src/screens/LoginScreen.tsx`): Email/password login with keyboard handling, loading states, error display, and SecureStore integration.
- **Dashboard screen** (`src/screens/DashboardScreen.tsx`): Gym stats (members, revenue), pull-to-refresh, error handling, logout. Graceful fallback when API unavailable.
- **Members screen** (`src/screens/MembersScreen.tsx`): Member list with search, status filters, pagination, and error/empty states.
- **Navigation** (`App.tsx`): React Navigation stack with conditional auth flow — Login when unauthenticated, Dashboard+Members when authenticated. Session restored from SecureStore on startup.

### Verification results
- `npm run verify`: TypeScript ✓, Expo lint ✓, 10/10 unit tests ✓
- `npx expo-doctor`: 21/21 checks passed
- `npx expo export --platform android`: 834 modules, 1.9MB Hermes bundle — passed
- Security scan: No secrets, credentials, debug output, mock data, or hardcoded member info found
- `.gitignore`: Comprehensive — excludes builds, credentials, signing materials, env files, logs
