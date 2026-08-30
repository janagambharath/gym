# Renewal Desk — WhatsApp Business App Coexistence Architecture

## 1. Coexistence vs Dedicated Number

Renewal Desk supports two operational modes for gym WhatsApp integration:

### Mode A: Coexistence (Cloud API + WhatsApp Business App)
- **Use Case**: Gym owners who want to keep using the physical WhatsApp Business App on their mobile phone while Renewal Desk handles automated renewal reminders and AI replies in the background.
- **Requirements**:
  - Meta Cloud API Coexistence feature enabled.
  - WhatsApp Business App version updated to latest release.
  - Number linked via Embedded Signup with Cloud API permissions.
- **Behavior**:
  - Outgoing automated renewal reminders and AI inquiries appear in the WhatsApp Business App conversation history.
  - Gym staff can jump in and type manual replies directly from the WhatsApp Business App on their phone or Renewal Desk mobile app.

### Mode B: Dedicated Automation Number
- **Use Case**: Gyms with high inquiry volume preferring a separate official desk SIM dedicated to automated 24/7 reception and member management.
- **Requirements**: Dedicated phone number / virtual SIM.

## 2. Handover & Conflict Resolution
- When a customer types "talk to human", Renewal Desk flags the lead as `handover_requested`.
- AI receptionist enters a 1-hour cooldown window.
- Staff can reply directly inside Renewal Desk or via WhatsApp Business App.
- Coexistence ensures zero message drops between the mobile phone app and cloud backend.
