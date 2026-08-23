# Google Play Console handoff checklist

This is a human-owned checklist. Complete it only after a signed release artifact and real mobile workflows exist. Do not guess answers from the current Android foundation.

## Required before a Play submission

- [ ] Confirm the Google Play developer-account type and the testing requirement that applies to that specific account. Many newer personal accounts require a closed test with at least 12 opted-in testers for 14 continuous days; verify the current rule in Play Console.
- [ ] Upload a signed `.aab` generated from the release environment. Do not upload a JavaScript bundle or development build.
- [ ] Configure Play App Signing and retain signing credentials only in the authorized credential system.
- [ ] Provide approved app title, descriptions, support email, category, icon, feature graphic, and sanitized screenshots.
- [ ] Publish a public, accurate privacy-policy URL that covers the final account, member, contact, membership, payment, diagnostics, and third-party data flows.
- [ ] Complete Data Safety using final app behavior and SDK inventory. Do not guess data collection or sharing answers.
- [ ] Complete App Content declarations: login/reviewer access, ads, target audience, content rating, data deletion, and applicable financial or health disclosures.
- [ ] Create a safe reviewer account only after login exists. Never share a production owner account or Bridge credentials.
- [ ] Create a real closed-test group, invitation instructions, and safe test credentials. Do not create fake tester identities.

## Acceptance evidence required before production

- [ ] Signed APK installed and launched on Android 12+ and a current Android device.
- [ ] Owner/staff login, refresh, logout, and role boundaries proven against the authorized Mobile API.
- [ ] Two-gym tenant isolation, offline behavior, retries/idempotency, payment/renewal behavior, and WhatsApp delivery tested with safe consented data.
- [ ] Three authorized gym pilots completed and launch-blocking issues resolved.

## Sources to re-check at submission time

- [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Google Play Data Safety form](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Expo Android submission guidance](https://docs.expo.dev/submit/android/)
