# Renewal Desk final product review

Review date: 2026-08-24

## Verdict

**NOT READY**

This is an evidence-based release review. The code and automated checks below
are complete as recorded, but no signed artifact, physical-device validation,
staging migration, real WhatsApp verification, or gym-owner pilot has occurred.
Those are release gates, not paperwork.

## Architecture

```text
Expo Android client
  -> HTTPS Bearer JWT -> Flask /api/mobile/v1
                              -> tenant-scoped models and audit records
                              -> payment verification / renewal services
                              -> Meta WhatsApp service and signed webhook
                              -> AI router (OpenRouter models, then safe fallback)

Biometric PC Bridge remains separate from the Android client.
```

The Android app is a native Expo SDK 57 client. It does not use a WebView,
browser cookies, Bridge credentials, Meta credentials, payment secrets, or AI
provider credentials. The Flask backend remains the authority for pricing,
memberships, payments, entitlements, and WhatsApp delivery.

## Feature inventory

| Feature | Web | Backend / mobile API | Android | Review state |
| --- | --- | --- | --- | --- |
| Authentication and refresh-token session | Present | Present | Present | Automated coverage passes |
| Dashboard and revenue summaries | Present | Present, gym-timezone aware | Present | Automated coverage passes |
| Members: search, add, edit, deactivate, detail | Present | Present | Present | Automated coverage passes |
| Renewals | Present | Present | Present | Payment-first mobile flow plus retry-safe legacy renewal endpoint |
| Payment recording and verification | Present | Present | Present | Pending payment is not shown as paid; automated replay coverage passes |
| WhatsApp renewal reminders and history | Present | Present | Present | Code covered; live Meta delivery not retested in this review |
| Plans, staff, settings, reports | Present | Present | Present | Reports use gym-local calendar bounds |
| Entitlements | Present | Present | Bot UI observes server denial | WhatsApp Bot is default-deny without entitlement |
| WhatsApp bot overview, leads, conversations, handover | Partial web support | Present | Present | New mobile operations screens use live APIs |
| Bot configuration and test sandbox | Partial web support | Present | Present | Owner-only configuration update; FAQ is read-only on mobile |
| Bot follow-up scheduling and booking operations | Models exist | No complete management API | No complete UI | Remaining product gap |
| Notifications / push inbox | Templates exist | No dedicated mobile notification API | No inbox or push UI | Remaining product gap |
| Biometric terminal operation | Separate Bridge | Separate Bridge API | Intentionally absent | Correct boundary, not a mobile gap |

## Implemented work in this review

- Wired actual Android navigation and refresh behavior across dashboard,
  members, renewals, payments, and More. Mutation outcomes refresh the
  relevant screen rather than leaving stale data.
- Reworked mobile renewal to record a pending payment first. It no longer
  claims that membership was renewed or payment was paid before verification.
- Added optional `Idempotency-Key` replay protection to mobile payment creation
  and the legacy direct-renewal endpoint. Reusing a key with another payload is
  rejected; a matching retry returns the original response.
- Added gym-local date handling for mobile dashboard, reports, renewal lists,
  payment defaults/verification, member creation, and member expiry properties.
- Added entitlement-gated mobile Bot endpoints. A missing, disabled, expired,
  or suspended entitlement returns `FEATURE_NOT_ENABLED`; unknown WhatsApp
  senders do not start bot conversations when the feature is unavailable.
- Added real bot operations screens: overview, conversations, bounded
  conversation detail, leads, lead detail, and owner setup.
- Added `GET /bot/conversations/<id>` with tenant-scoped safe projections and
  the latest 100 messages in chronological order.
- Fixed manual staff and bot reply handling so failed WhatsApp provider calls
  are not added to visible conversation history as successfully sent messages.
  Bot events now record handover, accepted replies, and reply failure without
  retaining message-body content in the event payload.
- Hardened bot configuration validation: strict booleans, bounded text,
  HTTPS-only links, bounded trial amount, and bounded trial duration.
- Made structured model output mandatory. Malformed unstructured model output
  falls through the provider hierarchy instead of becoming an unreviewed bot
  reply. Commercial/operational facts use the database-backed responder;
  financial changes, booking confirmation, privacy requests, and prompt
  extraction attempts are deterministic safe responses.
- Corrected the Alembic chain so new migrations extend the actual existing
  migration head rather than creating a second head.
- Added `expo-font`, the required peer dependency identified by Expo Doctor.
  Android lint, type checking, and runtime tests are now clean.

## Mobile API additions and relevant contracts

- `GET /api/mobile/v1/bot/conversations/<id>`: entitlement-gated, tenant
  scoped, bounded conversation and lead summary.
- `POST /api/mobile/v1/bot/conversations/<id>/handover`: only accepts
  `take_over` or `resume_bot`; records a bot event.
- `POST /api/mobile/v1/bot/conversations/<id>/message`: only records the
  staff message after the provider accepts it; a provider failure returns
  `WHATSAPP_SEND_FAILED`.
- `POST /api/mobile/v1/payments`: supports optional idempotency keys for safe
  retry after an uncertain network result.
- `POST /api/mobile/v1/renewals/<member_id>`: supports the same retry safety
  for the existing direct-renewal workflow.

The payment verification flow remains the preferred path because it creates a
pending financial record and extends membership only on verification. The
legacy direct-renewal API still performs an immediate renewal for authorized
owner/staff workflows; its replay protection does not change that business
policy. If every renewal must be payment-verified, disable or restrict that
legacy endpoint through a separately approved policy change.

## Database changes and deployment sequence

New migration chain head: `1e5f6a7b8c9d`.

1. `0d4e5f6a7b8c_add_bot_entitlement_tables.py`
   - Extends `8623a65211ec`.
   - Adds feature entitlements, bot configuration, FAQs, knowledge items,
     conversations, messages, leads, follow-ups, booking requests, and bot
     events.
2. `1e5f6a7b8c9d_add_mobile_idempotency_keys.py`
   - Adds tenant/user/scoped request replay records for mobile mutations.

Required deployment sequence:

1. Back up the target database and record the current Alembic revision.
2. Apply the migrations in a staging copy through the normal deployment
   workflow; application startup never applies them automatically.
3. Run mobile API, webhook, payment, and entitlement smoke tests against that
   staging environment.
4. Review performance and rollback impact, then schedule a production window.
5. Apply the migration once, verify the Alembic revision and health endpoint,
   then enable individual bot entitlements deliberately.

The migrations have downgrade functions, but a downgrade drops new tables and
therefore destroys bot/idempotency data. Treat production rollback as a
backup-and-restore decision, not an automatic remediation.

## Bot and AI strategy

The hierarchy is deterministic safety and grounded data first, followed by an
OpenRouter primary model, two configured fallback models, a deterministic
conversational responder, and human handover. The model key exists only in
backend environment configuration. The Android app carries only a public API
base URL.

The model is required to return structured JSON. A response is rejected if it
is malformed, lacks a valid text response, contains known prompt/provider
leaks, claims payment verification, or claims a confirmed booking. Database
records, not model text, provide plans, prices, trials, hours, location,
facilities, and FAQs. Unconfigured facts produce a transparent handover
response rather than a guessed answer.

## Security and tenant isolation

- Mobile tokens use the existing short-lived access and rotating refresh-token
  design; Android stores the session through SecureStore.
- Mobile routes scope data to the authenticated `gym_id`; the conversation
  detail test proves an entitled tenant cannot retrieve another tenant's
  conversation.
- Owner/staff role checks protect the mobile API. Only a gym owner can update
  bot configuration.
- Entitlements are checked server-side at every mobile Bot endpoint and before
  unknown-sender bot processing.
- Payment and direct-renewal retry keys are bound to gym, user, endpoint scope,
  and a stable request fingerprint.
- Provider/API/Bridge/payment secrets were not added to Android sources. The
  tracked backend `.env` placeholder was removed from Git's index; the local
  file is preserved and ignored.
- Webhook signature validation and known-member WhatsApp opt-in flows remain
  in place.

## Verification evidence

| Check | Result |
| --- | --- |
| Full backend suite | `103 passed` |
| Focused payment/bot/AI/timezone suite | `43 passed` |
| Python compile and diff whitespace check | Passed |
| Alembic topology | `flask db heads` reports only `1e5f6a7b8c9d (head)` |
| Android `npm run verify` | Passed: TypeScript, Expo lint, 10 runtime tests |
| Expo Doctor | `21/21 checks passed` after adding `expo-font` |
| Android JS bundle export | Completed; Android Metro bundle and 36 assets generated in ignored `dist/` |
| Production dependency audit | 10 moderate findings in Expo's transitive `uuid` / config-plugin chain; the offered automatic fix would force an incompatible Expo downgrade and was not applied |

Automated tests cannot prove real provider delivery, device lifecycle behavior,
or actual gym workflow usability.

## Performance notes

- Conversation detail returns at most 100 messages.
- Tenant and date filtering use existing/query-backed indexes; new event and
  idempotency records include lookup indexes/unique scopes.
- This review did not run a production load test, Redis failure drill, or
  multi-worker webhook throughput test.

## Artifact and store readiness

- EAS project authentication exists for the configured owner.
- EAS `preview` and `production` environments currently contain no variables.
  In particular, neither has `EXPO_PUBLIC_API_BASE_URL`.
- No preview APK was submitted because it would have no API endpoint and could
  not execute the required login/member/payment/WhatsApp checks.
- No production AAB was submitted. It must follow a successful installed
  preview build and test cycle.
- No device installation, physical-device test, gym-owner pilot, privacy
  policy review, Google Play Data Safety form, store listing, screenshots, or
  reviewer access package was produced in this review.

## Exact release blockers

1. Configure a non-production `EXPO_PUBLIC_API_BASE_URL` in the EAS `preview`
   environment and the approved production URL in the EAS `production`
   environment. Do not put secrets in either value.
2. Apply and validate the two new Alembic migrations in staging under the
   deployment team's backup and rollback procedure.
3. Configure/verify staging backend secrets and service connectivity for mobile
   JWT, Redis, Meta WhatsApp, and any intentionally enabled OpenRouter bot.
   Set `MOBILE_API_ENABLED=true` plus a distinct production-strength
   `MOBILE_API_TOKEN_SECRET`; the local runtime currently reports the mobile
   routes as disabled, which is the safe default.
4. Submit a preview EAS APK only after item 1; install it on a physical Android
   device and test login, offline/slow-network behavior, member mutations,
   payment recording and verification, reminders, bot handover, logout, and
   account switching.
5. Complete a real gym owner/staff pilot with real WhatsApp delivery and a
   deliberate bot entitlement.
6. Resolve or formally accept the 10 moderate transitive dependency audit
   findings through an Expo-compatible upgrade plan; do not use the suggested
   force downgrade.
7. Complete Play Console assets, policy, Data Safety, support/reviewer access,
   and a signed production AAB after the preview/device/pilot gates pass.
