# Android Release Matrix

Updated: 2026-08-30
Status terms: **VERIFIED** means locally tested in this workspace. **NOT VERIFIED** means no device/deployed-provider evidence. **BLOCKED** requires external configuration or a missing native integration.

| Area | Local implementation evidence | Release status |
| --- | --- | --- |
| Login, refresh, logout | Versioned mobile API and SecureStore session flow; automated client checks | NOT VERIFIED on device/expired production session |
| Self-service account creation | Registration API validates owner, gym, phone, password, locale, and duplicates; Android onboarding is present | VERIFIED locally; NOT VERIFIED in deployed environment |
| Dashboard, members, renewals, payments | API-backed screens with loading/error/empty handling and local contract coverage | NOT VERIFIED against a production backend or two-gym UI test |
| Member CSV import | Device file selection, validation preview, and atomic API import contract | VERIFIED locally; NOT VERIFIED with real Android file providers |
| Entitlement display | Server-owned plan, source, status, dates, grace and management data | VERIFIED locally; NOT VERIFIED with production data |
| Manual/founder billing | `MANUAL` entitlement renders without Play controls | VERIFIED locally; NOT VERIFIED for a production founder gym |
| Google Play purchase and restore | Server verification, encrypted token persistence, RTDN and reconciliation contracts | **BLOCKED** — native Billing client, Console products, credentials, configuration, and test-track validation absent |
| WhatsApp state and broadcasts | Backend state map; client enables broadcast only for `CONNECTED` | VERIFIED locally; NOT VERIFIED with Meta/provider delivery |
| AI receptionist and handover | Conversation, lead, config, test and handover screens are present | NOT VERIFIED with a real provider or end-to-end handover |
| Notifications | Android channel/client registration and allow-listed navigation paths | NOT VERIFIED on a physical Android device |
| Locale, currency, time zone | API/session values and automated INR, AED, GBP, AUD, USD format coverage | VERIFIED locally; NOT VERIFIED on device locales |
| Tenant isolation/idempotency | Altered-ID and payment/renewal idempotency API coverage | VERIFIED locally; NOT VERIFIED through black-box Android deep links/stale cache |
| Biometrics | No direct mobile access to the separate Bridge/hardware | Out of Android client scope |
| Signed release artifact | EAS project/config exists; Android JavaScript export passes | **BLOCKED** — no production EAS variables and no signed AAB |

The matrix supports a **NO-GO** release decision until every BLOCKED and release-critical NOT VERIFIED item has evidence from the required external environments.
