# Feature parity status

Updated: 2026-08-23 (execution pass)

| Feature | Web support | Android support | Status |
| --- | --- | --- | --- |
| Production environment configuration | Yes | Yes | ✅ Implemented — HTTPS enforcement, env-only URL config |
| Safe service health check | Yes (`/health`) | Yes | ✅ Implemented and tested |
| Secure native session storage | N/A | Yes | ✅ Implemented — access + refresh tokens in SecureStore |
| Login screen | Browser session | Yes | ✅ Implemented — email/password, error handling, keyboard support. Awaiting backend JWT endpoint. |
| API client with auth | Browser session | Yes | ✅ Implemented — Bearer token, 401→refresh→retry, timeout. Awaiting backend JWT endpoint. |
| Navigation with auth guard | Browser redirects | Yes | ✅ Implemented — React Navigation with conditional auth flow |
| Dashboard | Yes (HTML) | Yes (screen built) | ⚠️ Screen implemented but awaiting backend `/api/mobile/v1/dashboard` endpoint |
| Members list/search/filter | Yes (HTML) | Yes (screen built) | ⚠️ Screen implemented but awaiting backend `/api/mobile/v1/members` endpoint |
| Member detail/create/edit | Yes (HTML) | No | ❌ Screens not built; backend endpoint does not exist |
| Renewals/bulk renew | Yes (HTML) | No | ❌ Not implemented; backend endpoint does not exist |
| Payments | Yes (HTML) | No | ❌ Not implemented; backend endpoint does not exist |
| WhatsApp reminders/announcements | Yes (HTML) | No | ❌ Not implemented; backend endpoint does not exist |
| Settings/staff/plans | Yes (HTML) | No | ❌ Not implemented; backend endpoint does not exist |
| Biometric status/actions | Partial (web/Bridge) | No | ❌ Must remain backend-proxied; direct Bridge access prohibited |

No screen uses mock member, payment, or renewal data. The app does not scrape web HTML/forms or load the browser UI in a WebView.
