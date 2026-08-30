# Renewal Desk — Billing, Multi-Currency & Entitlements Specification

## 1. Central Plan Catalog

Renewal Desk standardizes on 3 tiers with multi-currency pricing:

```json
{
  "starter": {
    "name": "Starter",
    "tagline": "Essential member renewals & attendance tracking",
    "member_limit": 150,
    "pricing": {
      "INR": 999,
      "AED": 99,
      "USD": 19,
      "GBP": 15,
      "AUD": 29,
      "EUR": 19,
      "SAR": 79
    }
  },
  "growth": {
    "name": "Growth",
    "tagline": "Automated renewal recovery + 24/7 AI Desk",
    "recommended": true,
    "member_limit": 500,
    "pricing": {
      "INR": 1499,
      "AED": 199,
      "USD": 39,
      "GBP": 29,
      "AUD": 59,
      "EUR": 39,
      "SAR": 149
    }
  },
  "pro": {
    "name": "Pro",
    "tagline": "Unlimited members, biometric syncing & advanced reports",
    "member_limit": 999999,
    "pricing": {
      "INR": 2499,
      "AED": 299,
      "USD": 59,
      "GBP": 49,
      "AUD": 89,
      "EUR": 59,
      "SAR": 229
    }
  }
}
```

## 2. Feature Entitlements Matrix

| Feature Flag | Starter Tier | Growth Tier *(Recommended)* | Pro Tier |
| :--- | :--- | :--- | :--- |
| `renewal_desk` | ✅ Included | ✅ Included | ✅ Included |
| `whatsapp_bot` | ⚠️ Basic Reminders | ✅ Full Lead Bot | ✅ Full Lead Bot |
| `ai_receptionist` | ❌ | ✅ 24/7 AI Reception | ✅ 24/7 AI Reception |
| `biometric` | ❌ | ❌ | ✅ Real-time Bridge Sync |
| `advanced_reports` | ❌ | ✅ Retention Analytics | ✅ Complete Financials |

## 3. Account Lifecycle States
- `TRIAL`: 30-day all-inclusive trial provisioned on registration.
- `ACTIVE`: Active paid subscription verified via Google Play or Manual Billing.
- `PAST_DUE`: Payment renewal failed; 3-day grace period before feature restriction.
- `CANCELLED` / `EXPIRED`: Read-only access to historical member records; automated sending paused.
