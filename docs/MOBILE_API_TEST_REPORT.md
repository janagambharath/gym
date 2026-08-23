# Mobile API v1 — Test Report

**Date**: 2026-08-23
**Environment**: Local development (SQLite)
**Flask Version**: 3.0.3

## Test Results

| # | Test | Status | HTTP | Result |
|---|------|--------|------|--------|
| 1 | Health check | ✅ | 200 | API reachable, DB connected |
| 2 | Login (valid) | ✅ | 200 | Tokens + user/gym info returned |
| 3 | Me endpoint | ✅ | 200 | Correct user + gym data |
| 4 | Dashboard | ✅ | 200 | Real stats from analytics_service |
| 5 | Settings GET | ✅ | 200 | Gym info + plans returned |
| 6 | Members List | ✅ | 200 | Paginated with plan data |
| 7 | Members Search | ✅ | 200 | Filter by name works |
| 8 | Create Member | ✅ | 201 | Member created with all fields |
| 9 | Get Member | ✅ | 200 | Detail with plan info |
| 10 | Update Member | ✅ | 200 | PATCH partial update works |
| 11 | Renewals List | ✅ | 200 | History with member/plan names |
| 12 | Renewals Upcoming | ✅ | 200 | Members expiring within 7 days |
| 13 | Renewals Expired | ✅ | 200 | Currently expired members |
| 14 | Renew Member | ✅ | 201 | Membership extended, history recorded |
| 15 | Payments List | ✅ | 200 | Paginated with member names |
| 16 | Create Payment | ✅ | 201 | Pending payment created |
| 17 | Get Payment | ✅ | 200 | Detail with all fields |
| 18 | Verify Payment | ✅ | 200 | Payment verified, membership extended |
| 19 | Refresh Token | ✅ | 200 | New token pair issued, old invalidated |
| 20 | Refresh Replay | ✅ | 401 | Reused token correctly rejected |
| 21 | Invalid Login | ✅ | 401 | Wrong password rejected |
| 22 | No Auth | ✅ | 401 | Unauthenticated access blocked |
| 23 | Logout | ✅ | 200 | Refresh token revoked |

**Score: 23/23 (100%)**

## Regression

| Test | Result |
|------|--------|
| Web health check (`/health`) | ✅ 200 OK |
| Web root redirect | ✅ 302 → `/auth/login` |
| CSRF still active on web routes | ✅ Confirmed |
| Mobile API CSRF-exempt | ✅ Confirmed |

## Security Checks

| Check | Result |
|-------|--------|
| No credentials in responses | ✅ |
| JSON error envelope (no HTML for API) | ✅ |
| Token expiry enforced | ✅ |
| Replay detection works | ✅ |
| Lockout on failed logins | ✅ |
| Tenant isolation | ✅ |
