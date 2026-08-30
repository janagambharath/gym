# Renewal Desk — Mobile Self-Service Registration Architecture

## 1. Overview
The self-service registration system enables prospective gym owners downloading Renewal Desk from the Google Play Store to create a complete, isolated tenant account without human intervention.

## 2. API Contract
- **Endpoint**: `POST /api/mobile/v1/auth/signup`
- **Authentication**: Public (no token required)
- **Request Payload**:
  ```json
  {
    "full_name": "Rajesh Kumar",
    "email": "owner@ironpulse.com",
    "phone": "+919876543210",
    "password": "SecurePassword123",
    "gym_name": "Iron Pulse Fitness",
    "country": "India",
    "currency": "INR",
    "timezone": "Asia/Kolkata"
  }
  ```
- **Response Payload (201 Created)**:
  ```json
  {
    "ok": true,
    "user": {
      "id": 14,
      "email": "owner@ironpulse.com",
      "full_name": "Rajesh Kumar",
      "role": "gym_owner"
    },
    "gym": {
      "id": 12,
      "name": "Iron Pulse Fitness",
      "slug": "iron-pulse-fitness",
      "currency": "INR",
      "subscription_status": "TRIAL",
      "plan_tier": "growth"
    },
    "tokens": {
      "access_token": "eyJhbGciOi...",
      "refresh_token": "eyJhbGciOi...",
      "expires_in": 86400
    }
  }
  ```

## 3. Provisioning Sequence
1. **Validation**: Enforces email uniqueness, valid phone format, and minimum 6-character password hash (`scrypt` via Werkzeug).
2. **Gym Creation**: Provisions a new `Gym` record with unique slugification, user timezone, currency, and initializes `subscription_status = 'TRIAL'`.
3. **Owner Creation**: Creates a `gym_owner` `User` bound to `gym_id`.
4. **Default Plan Seeding**: Automatically seeds standard localized membership plans (1 Month, 3 Months, 6 Months, 1 Year) with localized pricing in the gym's currency.
5. **Trial Entitlements**: Provisions complete 30-day feature entitlements (`renewal_desk`, `whatsapp_bot`, `biometric`, `advanced_reports`, `ai_receptionist`).
6. **Token Issuance**: Generates dual JWT tokens (`access_token` and `refresh_token`) allowing immediate authenticated dashboard access.

## 4. Error Handling
- `400 Bad Request`: Missing mandatory fields or malformed payload.
- `409 Conflict`: Email or phone already registered with an existing account.
- `500 Server Error`: Transaction rollback on unexpected database failure.
