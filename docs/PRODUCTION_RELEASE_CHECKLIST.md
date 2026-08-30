# Renewal Desk — Production Release Checklist

## 1. Code Quality & Automated Tests
- [x] Working repository clean (`git status` clean, no uncommitted files)
- [x] TypeScript compiler check passed (`tsc --noEmit` — 0 errors)
- [x] Linter passed (`expo lint` — 0 warnings, 0 errors)
- [x] Mobile unit & integration tests passed (`tsx --test` — 10/10 passed)
- [x] Backend automated test suite passed (`python -m pytest` — 140/140 passed)
- [x] Dependency audit verified (`npm audit` — 0 runtime bundle vulnerabilities)

---

## 2. Environment & Build Configuration
- [x] Production API endpoint configured (`https://gym-production-910c.up.railway.app`)
- [x] Package identifier verified (`online.revorax.renewaldesk`)
- [x] Version string verified (`1.0.0`)
- [x] Version code bumped for release (`versionCode: 6`)
- [x] Remote keystore and signing credentials configured on EAS
- [x] Release Candidate APK built and verified (`Build ID: c04e1295-9cd5-4fdd-9a8f-4c9983737758`)
- [ ] Next EAS cloud AAB build execution (Awaiting free-tier quota reset on Sep 01 2026 or EAS plan upgrade)

---

## 3. Core Functional Capabilities
- [x] Self-service account signup with conflict detection (`POST /auth/signup`)
- [x] Founder manual customer mode (`billing_source: MANUAL`) bypassing paywalls
- [x] Standardized 3-tier subscription catalog (Starter, Growth [Recommended], Pro)
- [x] Server-authoritative Google Play purchase verification & restoration
- [x] 8-step setup checklist progress card on Dashboard
- [x] CSV bulk member import with schema preview and validation
- [x] Internationalization across 7 currencies with timezone-aware calculations
- [x] WhatsApp status state machine (`NOT_CONNECTED` → `CONNECTED`)
- [x] Meta Embedded Signup wizard and profile management endpoints
- [x] Grounded AI receptionist inquiries with 1-hour human takeover cooldown
- [x] Android 13+ push notification permissions and allowlisted routing

---

## 4. Security & Compliance
- [x] Multi-tenant isolation verified (cross-gym requests strictly return 403/404)
- [x] Role-based access control verified (server-enforced role boundaries)
- [x] Zero API keys, private credentials, or auth tokens committed to git
- [x] Encrypted session storage at rest via `expo-secure-store`
- [x] HTTPS transport strictly enforced for all non-local API calls

---

## 5. Physical Device & External Platforms
- [x] Physical Android 13/14 device testing (UI layout, safe insets, keyboard avoidance)
- [ ] Google Play Console Closed Testing track upload (Awaiting Play Console developer credentials)
- [ ] Google Play 20-tester / 14-day closed testing requirement (Pending external Play Console milestone)
- [ ] Meta Business Manager App Review for WhatsApp permissions (Pending external Meta review)
