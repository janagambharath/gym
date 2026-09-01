# Renewal Desk — Member Import & AI Document Scanner

## Overview

The Member Import & AI Document Scanner provides a low-friction onboarding bridge for gym owners to bring their existing members (50–500+) into Renewal Desk without manual entry fatigue.

Gym owners choose between three clear activation paths:
1. **Import CSV** — Upload member spreadsheets from Excel, Google Sheets, or previous gym management software.
2. **Scan Member Records** — AI-assisted multimodal document extraction from photos of paper registers, membership forms, fee receipts, or printed rosters.
3. **Add Manually** — Fast single-entry flow for individual members.

---

## Architecture & Data Flow

```
[Gym Owner] (Camera / Gallery / File)
      │
      ▼
[React Native / Expo Client]
      │  (HTTPS POST /api/mobile/v1/members/scan with image base64)
      ▼
[Renewal Desk Backend] ── (Zero client secret leakage)
      │
      ├── [Image Pre-Flight Validation] (MIME, max 5 MB / page, max 5 pages)
      ├── [OpenRouter Multi-Tier AI Vision Gateway]
      │     ├── Primary: google/gemini-2.0-flash-exp:free (or configured vision model)
      │     └── Fallback: meta-llama/llama-3.2-11b-vision-instruct:free
      │
      ├── [Server-Side Normalization & Validation]
      │     ├── Phone normalization -> E.164 (+91...)
      │     ├── Date normalization -> ISO YYYY-MM-DD
      │     ├── Active Plan Matching (case-insensitive fuzzy match against Gym's plans)
      │     ├── Duplicate Detection (active member phone & name matching)
      │     └── Confidence Level (HIGH >= 0.85, MEDIUM 0.60-0.84, LOW < 0.60)
      │
      ▼
[Candidate Records (JSON)] ─── (NO database mutation)
      │
      ▼
[Mobile Review Table Screen]
      │  (Owner reviews, fixes warnings, selects records)
      │
      ▼ (Owner taps [Confirm Import])
[Atomic Batch Import Endpoint] (POST /api/mobile/v1/members/batch-create)
      │
      ├── Capacity Check (enforces Gym.max_members with row locking)
      ├── Database Transaction (creates Member entities atomically)
      ├── Audit Log (action: mobile_ai_scan_import_members)
      └── Cache Invalidation (refreshes live dashboard metrics)
      │
      ▼
[Instant ROI & Renewal Discovery]
      └── Displays: "119 members imported · 17 upcoming renewals · ₹42,500 revenue at risk"
```

---

## Server Configuration

The AI scanner is configured exclusively on the backend:

| Key | Default / Fallback | Description |
|:---|:---|:---|
| `OPENROUTER_API_KEY` | Reuses `BOT_AI_API_KEY` | Server-only OpenRouter API token. Never sent to mobile clients. |
| `OPENROUTER_VISION_MODEL_PRIMARY` | `google/gemini-2.0-flash-exp:free` | Primary verified free vision-capable model. |
| `OPENROUTER_VISION_MODEL_FALLBACK` | `meta-llama/llama-3.2-11b-vision-instruct:free` | Fallback vision model on rate limit or timeout. |
| `DOCUMENT_SCAN_MAX_IMAGES` | `5` | Maximum pages allowed per scan request. |
| `DOCUMENT_SCAN_MAX_IMAGE_SIZE_MB` | `5` | Maximum decoded file size per page. |
| `DOCUMENT_SCAN_TIMEOUT_SECONDS` | `25` | Request timeout for multimodal inference. |

---

## Security, Privacy & Retention

1. **Zero Client Secrets**: Mobile source code and application bundles contain zero AI API keys or provider URLs.
2. **Ephemeral Document Processing**: Document images are parsed in-memory and immediately discarded after OCR extraction. No raw documents or customer photo scans are permanently stored on disk.
3. **Zero PII Logging**: Operational logs, telemetry, and error reporting redact personal member details (names, phone numbers, addresses, financial amounts).
4. **Tenant Isolation**: All scan requests and batch creations are locked to `g.gym_id` derived from verified JWT session tokens. Cross-gym extraction or creation is strictly blocked.
5. **Role-Based Authorization**: Protected by `@roles_required("gym_owner", "staff")`.

---

## Graceful Degradation & Fallbacks

- If OpenRouter is not configured or both vision models fail, the app displays a clear, friendly fallback:  
  `"AI scanning is temporarily unavailable. You can import CSV or add members manually."`
- The core CRM, manual member creation, CSV imports, renewals tracking, payments, and WhatsApp automation remain fully operational independently of AI status.
