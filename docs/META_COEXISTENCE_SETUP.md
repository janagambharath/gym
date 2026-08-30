# Renewal Desk — WhatsApp Business App Coexistence Architecture

## 1. Coexistence Overview

Meta Cloud API Coexistence allows a gym's existing mobile **WhatsApp Business App** to operate concurrently with the **Renewal Desk Cloud API** integration on the same registered phone number.

```
                  ┌──────────────────────────────────────────────┐
                  │           Gym's Business Phone Number        │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │ WhatsApp Business App     │                   │ Renewal Desk Cloud API    │
   │ (Physical Mobile Device)  │                   │ (Automated SaaS Engine)   │
   ├───────────────────────────┤                   ├───────────────────────────┤
   │ • Manual 1-on-1 chats     │                   │ • Automated renewals      │
   │ • Status stories          │                   │ • 24/7 AI Receptionist    │
   │ • Catalog browsing        │                   │ • Payment receipt PDFs    │
   │ • Direct voice calls      │                   │ • Bulk segment broadcast  │
   └───────────────────────────┘                   └───────────────────────────┘
```

---

## 2. Feature Support & Verification Status

| Capability | Status | Implementation Details |
| :--- | :--- | :--- |
| **Coexistence Option in Mobile UI** | **SUPPORTED / VERIFIED** | `WhatsAppOnboardingModal.tsx` provides dedicated Coexistence selection card |
| **Backend Phone & WABA Binding** | **SUPPORTED / VERIFIED** | `app/mobile_api/whatsapp.py` links phone numbers with Cloud API endpoints |
| **AI Cooldown on Staff Intervention** | **SUPPORTED / VERIFIED** | 1-hour suppression window stops automated AI replies upon human response |
| **WhatsApp Business Profile Sync** | **SUPPORTED / VERIFIED** | `PATCH /api/mobile/v1/whatsapp/profile` updates About text and physical address |
| **Live Cloud API Coexistence Webhook** | **SUPPORTED BY META (External)**| Requires eligible phone number on Meta Cloud API with active WABA permissions |

---

## 3. Disconnection & Offboarding Behavior

- **Disconnect from Renewal Desk**:
  - If a gym owner disconnects the WhatsApp integration inside Renewal Desk, the Cloud API webhook is deregistered.
  - The gym's physical WhatsApp Business App continues functioning normally without interruption.
- **Ineligible Numbers**:
  - If a number is currently registered on standard personal WhatsApp (not WhatsApp Business), the owner is guided to migrate to WhatsApp Business or register a dedicated secondary number.
