# META WHATSAPP BUSINESS APP + CLOUD API COEXISTENCE

## 1. Concept
Meta Cloud API Coexistence allows a business phone number to be actively used inside the standard **WhatsApp Business Mobile App** (for owner manual chats) while simultaneously granting **Cloud API access** to Renewal Desk (for automated renewal reminders, broadcast announcements, and AI Receptionist messages).

---

## 2. Technical Prerequisites
1. **WhatsApp Business App** installed and registered on the gym owner's phone.
2. **Meta Embedded Signup** integrated with `whatsapp_business_management` and `whatsapp_business_messaging` permissions.
3. **Webhook Subscriptions** configured for message status and inbound message ingestion.

---

## 3. Human Staff Takeover Interaction
When an inbound message arrives from a gym member or prospective lead:
1. The **AI Receptionist** responds automatically if the conversation state is active.
2. If the user explicitly asks for human support ("talk to human", "call trainer") or if gym staff taps **Staff Takeover** inside Renewal Desk:
   - AI response is paused (`handover_status = "human_requested"`).
   - High-priority push notification is dispatched to staff Android devices.
   - Staff can reply directly inside Renewal Desk or inside the native WhatsApp Business App.
   - Tapping **Resume AI** returns the thread to automated receptionist handling.
