# Feature parity status

The following status is deliberately conservative. "Blocked" means the source backend does not expose a supported owner/staff mobile API for the operation; it does **not** mean that the operation is absent from the web product.

| Feature | Web support | Android support | Status |
| --- | --- | --- | --- |
| Production environment configuration | Yes | Yes | Implemented foundation |
| Safe service health check | Yes (`/health`) | Yes | Implemented and tested |
| Secure native session storage boundary | N/A | Yes | Implemented; awaits authorized token contract |
| Login/session restoration/logout | Browser and source mobile contract | No | Android flow missing; source contract is not deployed publicly |
| Dashboard | Yes and source mobile contract | No | Android screen missing; source contract is not deployed publicly |
| Members/search/details/create/edit | Yes and source mobile contract | No | Android screens missing; source contract is not deployed publicly |
| Renewals/bulk renew | Yes and source mobile contract | No | Android flow missing; durable-write production gate remains open |
| Payments | Yes and source mobile contract | No | Android flow missing; durable-write production gate remains open |
| WhatsApp reminders/announcements | Yes and source mobile contract | No | Android flow missing; consent and durable-write gates remain required |
| Settings/staff/plans | Yes and source mobile contract | No | Android screens missing; source contract is not deployed publicly |
| Biometric status/action visibility | Partial web/Bridge and source mobile contract | No | Must remain backend-proxied; direct Bridge access is prohibited |

No screen uses mock member, payment, or renewal data. The app also does not scrape web HTML/forms or load the browser UI in a WebView as a fake native implementation.
