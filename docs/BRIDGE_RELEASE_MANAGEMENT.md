# Bridge Release Management Guide

## 1. Overview
The Renewal Desk Bridge Release Management system provides an enterprise-grade distribution, verification, and rollout pipeline for on-premise Windows Turnstile Bridges (e.g. ZKTeco X990, eSSL, Realtime).

## 2. Release Channels
| Channel | Target Environment | Update Policy | Safety Gates |
| :--- | :--- | :--- | :--- |
| `STABLE` | Production gyms (e.g. **Yodha Fitness**) | Standard production baseline | Requires full hardware test verification passing |
| `TESTING` | Staging gyms & test benches | Pilot testing only | Blocked for auto-rollout or production gym upgrades |
| `DEPRECATED` | End-of-life builds | Disallowed for new pairing | Triggers warning on active dashboards |

## 3. Package Upload & Integrity Verification
1. **Upload Pipeline**:
   - Access **Super Admin → Bridge Releases → + Upload New Bridge**.
   - Accepts `.zip`, `.exe`, or `.msi` installers up to 200MB.
   - Requires semantic version (e.g. `2.0.0`) and monotonically increasing build integer (e.g. `2001`).
2. **Cryptographic Checksum**:
   - SHA-256 is computed dynamically on upload and persisted in `BridgeRelease.sha256_checksum`.
   - Installers and gym admins can verify package integrity against the dashboard checksum before local execution.
3. **Protected Storage**:
   - Packages are stored outside the public static directory in `uploads/bridge_releases/`.
   - Downloads are authenticated and rate-limited via `/admin/bridge/releases/<id>/download`.

## 4. Preservation of V1.0.0 Production Baseline
- The existing production package (`RenewalDeskBridge-client-online-v1.zip`) is registered as Version `1.0.0` (Build `100`, Channel `STABLE`).
- **Invariant**: V1.0.0 is never overwritten, modified, or deleted when new releases (such as V2.0.0) are published.
