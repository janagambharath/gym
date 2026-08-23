# Release status

## App identity

| Field | Value |
| --- | --- |
| App name | Renewal Desk |
| Android package ID | `online.revorax.renewaldesk` |
| Version name | `1.0.0` |
| Version code | `1` |
| Target SDK | Determined by the installed Expo SDK at native build time; verify the current Google Play requirement immediately before release. |

## Current status

This is an Android foundation, not a release candidate. It builds a JavaScript bundle and has passing type/lint/unit validation, but it cannot truthfully produce `renewal-desk-release.aab` yet.

## Release blockers

1. A separately authorized and documented mobile owner/staff API contract.
2. Native Android SDK/JDK build environment or approved EAS Build project credentials.
3. Release signing/Google Play App Signing configuration—never committed to Git.
4. Approved Renewal Desk launcher and splash artwork. The Expo template images are not final branding.
5. Public, accurate privacy-policy URL and Google Play Data Safety declaration based on the final app behavior.
6. Real-device, multi-account, network-failure, and designated real-gym acceptance tests.

## 2026-08-23 launch-gate addendum

The launch-gate verdict is recorded in `FINAL_LAUNCH_GATE.md`; the complete external-dependency ledger is in `BLOCKERS.md`. The repository now has a validated production Expo config and an Internet-only Android permission policy, but it remains an Android foundation rather than an owner/staff mobile application.
