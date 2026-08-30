# Renewal Desk — Meta WhatsApp Cloud API Onboarding Specification

## 1. Overview & Architecture

Renewal Desk integrates with the **Meta WhatsApp Cloud API** to deliver automated membership renewal reminders, broadcast announcements, and 24/7 AI-driven prospective member inquiry handling.

### End-to-End Onboarding Flow:
```
[Gym Owner in Android App]
          │
          │ 1. Taps "Connect WhatsApp" / Setup Banner
          ▼
[WhatsAppOnboardingModal.tsx]
          │
          │ 2. Selects Mode (Coexistence or Dedicated SIM)
          │ 3. Fetches Meta Config from GET /whatsapp/onboarding-config
          │ 4. Launches Meta OAuth Dialog (Embedded Signup)
          ▼
[Meta Embedded Signup Dialog (Facebook OAuth)]
          │
          │ 5. Gym owner logs in, selects/creates WABA, registers Phone Number
          │ 6. Meta exchanges authorization code & token with callback URL
          ▼
[Renewal Desk Backend (whatsapp.py)]
          │
          │ 7. POST /api/mobile/v1/whatsapp/connect-waba
          │ 8. Verifies WABA ID, Phone Number ID, and Webhook Subscription
          │ 9. Saves IDs to Gym record & updates bot configuration
          ▼
[Android App]
          │
          │ 10. Refreshes connection status to CONNECTED
          ▼
[Live WhatsApp Integration Active]
```

---

## 2. WhatsApp Connection State Machine

The client status badge strictly renders the server-authoritative state returned by `GET /api/mobile/v1/whatsapp/connection-status`:

| Status | Definition | Client UI Indicator |
| :--- | :--- | :--- |
| **`NOT_CONNECTED`** | No WABA or Phone Number ID registered for the gym. | Grey badge — "Not Connected — Tap to Setup" |
| **`PENDING`** | Meta Embedded Signup initiated, awaiting phone verification OTP. | Amber badge — "Verification Pending" |
| **`ACTION_REQUIRED`**| Meta Business verification required or payment method missing on WABA. | Red badge — "Action Required in Meta Business Suite" |
| **`CONNECTED`** | Active WABA, verified phone ID, active webhook subscription. | Green badge — "Integration Active & Connected" |
| **`FAILED`** | Invalid phone token or webhook handshake failure. | Red badge — "Connection Failed — Retry Setup" |
| **`DISCONNECTED`** | Owner explicitly disconnected the number or Meta revoked token. | Grey badge — "Disconnected" |

---

## 3. Meta App Review & Required Permissions

For the live production deployment, the Renewal Desk Meta App requires official approval for the following permissions in Meta Developer Console:

1. **`whatsapp_business_messaging`**: Enables sending automated renewal reminders, broadcast announcements, and AI replies.
2. **`whatsapp_business_management`**: Enables querying WABA status, managing phone numbers, and updating business profile metadata.

### Production Readiness Status:
- **Client Wizard & UI Endpoints**: **VERIFIED**
- **Backend Handshake & Webhook Engine**: **VERIFIED**
- **Live Meta App Review**: **PENDING / EXTERNAL DEPENDENCY** (Requires submitting production screencast and business documentation to Meta).
