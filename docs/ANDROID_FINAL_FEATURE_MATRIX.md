# Renewal Desk — Android Final Feature Matrix

Status words are evidence-based: **IMPLEMENTED** means code exists, **TESTED** means automated tests passed, and **NOT VERIFIED/BLOCKED** means no corresponding live evidence exists.

| Feature | Status | Evidence / release condition |
|---|---|---|
| Login, token refresh, logout | TESTED | Backend suite passes. |
| Self-service signup | TESTED | Canonical `/auth/register` plus safe legacy `/auth/signup` adapter tested. |
| Signup locale/session contracts | TESTED | Country, currency, timezone, initial billing state, and duplicate email tests pass. |
| Members, payments, renewals, CSV import | TESTED | Backend suite passes their API and idempotency contracts. |
| Manual/founder billing | TESTED | Canonical entitlement is server-backed; Play actions suppressed. |
| Plan catalog | TESTED | Three exact subscription IDs are in the canonical catalog. Actual Play product availability is unverified. |
| Native Play Billing client | IMPLEMENTED | `expo-iap` plugin and native flow added; a custom dev/release build is required. |
| Server-side purchase verification | IMPLEMENTED, TESTED (negative path) | Unconfigured verification refuses invented tokens; live Google verification is unverified. |
| Restore and subscription management | IMPLEMENTED | Requires Internal Test verification. |
| RTDN reconciliation | IMPLEMENTED | Requires deployed Pub/Sub/OIDC configuration and provider test. |
| Subscription UI lifecycle statuses | IMPLEMENTED | Pending, grace, cancelled, payment-failed, active, and expired labels are handled. |
| WhatsApp | NOT VERIFIED | Do not infer delivery from local UI or automated mocks. |
| Meta Embedded Signup/coexistence | BLOCKED | Requires Meta business/app approval and real callback validation. |
| AI and human takeover | NOT VERIFIED | Provider-backed production validation was not run. |
| Push notifications | IMPLEMENTED, NOT VERIFIED | Requires physical Android tests for permission and navigation scenarios. |
| Accessibility and UI/UX | PARTIALLY REVIEWED | Billing controls include labels/live feedback and 44dp targets; complete device review is outstanding. |
| Internationalization | TESTED | Mobile date/currency formatting tests pass; native store prices come from Google Play. |
| Tenant isolation and roles | TESTED | Backend suite passes scoped access contracts. |
| Security | PARTIALLY TESTED | HTTPS runtime validation and server-side billing verification are in place; deployed-secret audit remains required. |
| Production runtime configuration | BLOCKED | EAS production currently contains no variables. |
| Signed production AAB | NOT VERIFIED | No artifact exists. |
| Google Play release | BLOCKED | Requires completed AAB, Console access, listing/content declarations, and track eligibility. |
