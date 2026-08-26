# RENEWAL DESK — SUPPORT DIAGNOSTICS & TELEMETRY GUIDE
**For Technical Support Specialists & Platform Engineers**  

---

## 1. Support Diagnostics Architecture

Renewal Desk provides a secure, sanitized support telemetry view for diagnosing gym operational anomalies without exposing PII, passwords, biometric templates, or Meta API secrets.

```
[ Web Console: /biometric/support-package ]
               │
               ▼
 Sanitized Diagnostics JSON Export
 ├── App Version & Commit SHA
 ├── Database Connectivity & Migration Level
 ├── Bridge Installation Metadata (ID, Serial, Firmware, Last Heartbeat)
 ├── Biometric Command Queue Metrics (Pending, Leased, Acked, Failed)
 ├── WhatsApp Integration Status & Recent Failure Codes
 └── Recent Sanitized Audit Event Identifiers
```

---

## 2. Redaction & PII Safety Rules

The diagnostic package strictly redacts:
- **Zero Raw Passwords or Hashes**
- **Zero Biometric Fingerprint / Face Templates**
- **Zero WhatsApp Access Tokens or Webhook Secret Keys**
- **Zero Full Credit Card / UPI Account Numbers**
- **Masked Phone Numbers (e.g. `+91987654****`)**

---

## 3. Interpreting Support Telemetry Data

### A. Bridge Heartbeat Age
- `< 30 seconds`: **Healthy (Real-Time Online)**
- `30 - 120 seconds`: **Slow Polling / Network Latency**
- `> 120 seconds`: **Bridge Offline / PC Sleeping / LAN Disconnected**

### B. Command Status Codes
- `pending`: Command queued in database, waiting for next bridge poll.
- `leased`: Leased by bridge worker with active token (lease window = 60s).
- `acked`: Successfully executed on physical device and confirmed.
- `failed`: Device communication error (e.g. timeout, invalid enroll ID). Includes `last_error` message and retry counter.

### C. Live Export Endpoint
- **URL:** `GET /biometric/support-package`
- **Access Level:** Restricted to `gym_owner` and `super_admin` roles.
- **Format:** Application/JSON file download (`renewaldesk_support_package_gym_<id>.json`).
