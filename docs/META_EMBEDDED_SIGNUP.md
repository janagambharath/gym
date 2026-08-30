# Renewal Desk — Meta Embedded Signup & WhatsApp Cloud API

## 1. Overview
Meta Embedded Signup allows gym owners to onboard their WhatsApp Business Account (WABA) and phone numbers directly into Renewal Desk with single-tap OAuth permissions.

## 2. Onboarding Workflow
1. **Config Retrieval**:
   - Client fetches Meta App ID & Config ID from `GET /api/mobile/v1/whatsapp/onboarding-config`.
2. **Meta OAuth Session**:
   - App opens Meta Embedded Signup dialog (`https://www.facebook.com/v19.0/dialog/oauth`).
   - Owner logs in with Facebook credentials and selects/creates their WABA.
3. **Token & ID Exchange**:
   - Meta returns `phone_number_id`, `waba_id`, and business token.
   - Client sends credentials to `POST /api/mobile/v1/whatsapp/connect-waba`.
4. **Backend Webhook Registration**:
   - Backend registers webhook subscription for message status & incoming lead events.
   - Updates `Gym.phone_number_id`, `Gym.whatsapp_business_account_id`, `Gym.business_phone_number`.

## 3. WhatsApp Profile Management
- **Endpoint**: `GET /api/mobile/v1/whatsapp/profile` and `PATCH /api/mobile/v1/whatsapp/profile`
- Allows gym owners to update:
  - Business About / Description
  - Physical Gym Address
  - Email & Contact details
- Updates are pushed directly to Meta Cloud API graph endpoints.
