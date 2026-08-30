# RENEWAL DESK — FINAL ANDROID RELEASE REPORT

Updated: 2026-08-30
Scope: Android client and its additive `/api/mobile/v1` dependencies only.

## Release identity

| Field | Value |
| --- | --- |
| Version | `1.0.0` |
| Android version code | `2` |
| Package | `online.revorax.renewaldesk` |
| EAS build ID | Not created |
| Signed AAB | Not created |
| Release verdict | **NO-GO** |

## Local verification

| Check | Result |
| --- | --- |
| `npm.cmd run verify` | PASS — TypeScript, lint, 17 unit tests |
| `python -m pytest -q` | PASS during the release-blocker implementation audit |
| `python -m py_compile` for changed mobile API, billing, import, model, and migration files | PASS |
| `npx.cmd expo export --platform android` | PASS — JavaScript bundle export only; not an installable or signed AAB |
| `npx.cmd expo install --check` | PASS — SDK 57-compatible dependencies |
| `git diff --check` | PASS — CRLF conversion warnings only |

## EAS build gate

EAS authentication is available, but the production EAS environment has no configured variables. In particular, it lacks the controlled production API URL required by the app. A production build was deliberately not started: an AAB without this value would not be a viable production artifact.

Remote Android version lookup is also not configured for this project. The release identity above is taken from `app.json`.

## Remaining release blockers

1. Apply migration `a3b4c5d6e7f8` to a reviewed production database.
2. Set controlled production EAS values, including the API URL and required Google Play server configuration.
3. Add and test real Android Play Billing purchase-query and restore flows in a development build; activate access only after server entitlement verification.
4. Configure Play Console products and validate first purchase, pending, cancellation, grace, restore, reinstall, new device, manual customer, and RTDN on an internal track.
5. Complete Meta onboarding/coexistence and validate provider connection, delivery failures, handover, and recovery against the real provider.
6. Complete physical Android acceptance, including offline/token recovery, notification tap states, keyboard/font scaling/long content, large lists, CSV file-provider selection, and two-gym isolation.
7. Build, install, and smoke-test a signed production AAB.

## Scored assessment

| Area | Score | Basis |
| --- | --- | --- |
| Functionality | 7/10 | Core API paths and local tests exist; production end-to-end validation is outstanding. |
| UX | 6/10 | Static code review only; no physical-device acceptance. |
| Reliability | 6/10 | Local error and session handling tests pass; offline/network/device behaviour is unverified. |
| Security | 7/10 | Secure storage and source checks pass; not an external penetration test. |
| Billing | 2/10 | Server contract exists, but no real client library, console setup, or lifecycle validation. |
| WhatsApp | 4/10 | State contract exists; provider onboarding and delivery verification are outstanding. |
| Internationalisation | 7/10 | Automated locale coverage exists; device-locale validation is outstanding. |
| Performance | 4/10 | No physical-device or large-record performance evidence. |
| Release readiness | 1/10 | No configured production build or signed artifact. |

## Decision

**NO-GO.** This is a non-release implementation checkpoint. No signed AAB, Play release, or production promotion should be created from this revision.
