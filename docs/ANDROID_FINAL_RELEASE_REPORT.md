# RENEWAL DESK — FINAL EAS PRODUCTION BUILD REPORT

## BUILD STATUS

**PASS**

## PACKAGE

`online.revorax.renewaldesk`

## VERSION

`1.0.0`

## VERSION CODE

`10`

## EAS

**PASS**

| Field | Value |
|-------|-------|
| EAS Build ID | `b0962a4f-d1b7-451d-a7ef-d49717df690a` |
| EAS Profile | `production` |
| Platform | Android |
| Distribution | `store` |
| SDK Version | `57.0.0` |
| Commit | `d9ef6a733d8ca4e1accf06454640c35e4dc15324` |
| Fingerprint | `b1f8313be1bd3be36928b984b5488dab6c4c3003` |
| Started at | 1 Sep 2026, 7:46:31 PM IST |
| Finished at | 1 Sep 2026, 8:52:26 PM IST |
| Build Logs | https://expo.dev/accounts/bharath1818/projects/renewal-desk-android/builds/b0962a4f-d1b7-451d-a7ef-d49717df690a |

## AAB

**PASS**

| Field | Value |
|-------|-------|
| Artifact | Android App Bundle (.aab) |
| Artifact Type | AAB |
| Artifact URL | https://expo.dev/artifacts/eas/w0Z2ui7NI1l5YqHWKyYX07ncn-0Gyf2Q3nPghDJjag8.aab |

## SIGNING

**PASS**

- Keystore: Build Credentials `llqtEX6xll` (EAS-managed, remote)
- Signing performed server-side by EAS Build infrastructure

## PRODUCTION CONFIG

**PASS**

| Field | Value |
|-------|-------|
| API | `https://gym-production-910c.up.railway.app` (production) |
| Environment | `production` |
| EXPO_PUBLIC_API_BASE_URL | Set in EAS production environment ✅ |
| EXPO_PUBLIC_APP_ENV | `production` (from eas.json env block) ✅ |
| HTTPS enforced | Yes (runtime guard rejects non-HTTPS outside dev) |
| No localhost/127.0.0.1 | Confirmed (blocked in production by runtime config) |
| No hardcoded secrets | Confirmed |
| No AI provider keys in bundle | Confirmed |
| No Meta tokens in bundle | Confirmed |

## AUTOMATED TESTS & QUALITY GATES

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ PASS (0 errors) |
| `npm run lint` | ✅ PASS (0 warnings) |
| `npm run test` | ✅ PASS (17/17 mobile unit tests passed) |
| `npx expo-doctor` | ✅ PASS (21/21 checks passed) |
| `python -m pytest -q` | ✅ PASS (183 passed, 42 legacy warnings in 62.02s) |
| `npm audit --omit=dev` | ⚠️ 18 moderate severity (framework transitive deps; zero direct vulnerabilities) |
| `git diff --check` | ✅ PASS (clean whitespace & formatting) |

## UI/UX & NEW CAPABILITIES INCLUDED

- **Member Import & AI Document Scanner**: Unified 3-option onboarding hub (`ImportMembersScreen.tsx`), multimodal OpenRouter vision OCR pipeline, interactive inline-editable candidate table (`MemberScanReviewScreen.tsx`), atomic batch creation.
- **Revenue at Risk & Renewal Rate**: Real-time financial health analytics displayed on Mobile Dashboard and Reports screen.
- **Google Play Data Safety Compliance**: In-app account deletion flow in `SettingsScreen.tsx`, backend `DELETE /api/mobile/v1/auth/account`, and public web deletion page at `/delete-account`.
- **Streamlined AI Receptionist Setup**: 4-step onboarding checklist for Meta WhatsApp connection.

## SECURITY

**PASS**

| Check | Result |
|-------|--------|
| No API keys in client bundle | ✅ |
| No OpenAI/OpenRouter/Anthropic keys | ✅ |
| No Meta/WhatsApp tokens | ✅ |
| No passwords/credentials | ✅ |
| No localhost/127.0.0.1 in production path | ✅ |
| HTTPS enforced for production | ✅ |
| Tokens stored in SecureStore | ✅ |
| .env gitignored | ✅ |

## FINAL VERDICT

### READY FOR GOOGLE PLAY CONSOLE DEPLOYMENT

The production AAB has been successfully built, signed with production keystore `llqtEX6xll`, and verified against all automated quality gates.

**Download Production AAB:**
https://expo.dev/artifacts/eas/w0Z2ui7NI1l5YqHWKyYX07ncn-0Gyf2Q3nPghDJjag8.aab
