# Renewal Desk mobile feature coverage

Updated: 2026-08-24

| Feature | Mobile support | Status |
| --- | --- | --- |
| Environment configuration | HTTPS-only public API URL by build environment | Implemented |
| Secure session | Login, rotating refresh token, logout, SecureStore | Implemented |
| Dashboard | Live statistics, revenue overview, renewals, payments, quick actions | Implemented |
| Members | Search, filters, pagination, detail, add, edit, deactivate | Implemented |
| Renewals | Upcoming/expired lists and payment-first renewal | Implemented |
| Payments | Record, inspect, verify, reject, retry-safe creation | Implemented |
| WhatsApp | Renewal reminders, history, controlled sending | Implemented; real provider test required before launch |
| Settings, plans, staff, reports | Live API-backed owner/staff workflows | Implemented |
| WhatsApp Bot | Entitlement-aware overview, leads, conversations, handover, setup, test | Implemented |
| Bot follow-up scheduling / booking management | Backend models exist but no complete management workflow | Product gap |
| Push notification inbox | No dedicated API or native inbox | Product gap |
| Biometric terminal control | Remains a separate backend/PC Bridge concern | Deliberately out of scope |

All operational content is API-backed. The app does not use mock member,
payment, renewal, or bot data and does not use a WebView or browser cookies.

## Launch caveat

"Implemented" means the source and automated tests support the workflow. It
does not replace the required staging, installed-device, WhatsApp-provider,
and gym pilot verification listed in [FINAL_LAUNCH_GATE.md](FINAL_LAUNCH_GATE.md).
