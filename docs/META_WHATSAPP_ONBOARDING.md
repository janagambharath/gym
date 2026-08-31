# Renewal Desk — Meta WhatsApp Onboarding

## Status: BLOCKED — Meta external dependency

The repository contains WhatsApp connection-state and profile-management contracts. This document does not certify a production Meta Embedded Signup flow because no real Meta callback, WABA mapping, or business authorization has been exercised in this release effort.

## Required real flow

```text
Android Connect WhatsApp action
  -> supported, secure Meta authorization flow
  -> user grants access to WABA and phone number
  -> validated callback/deep link
  -> backend validates state, tenant, WABA, and phone mapping
  -> backend persists connection
  -> Android reads backend-confirmed CONNECTED state
```

## Requirements before release

- Use server-held Meta credentials only; never include app secrets or access tokens in Android configuration.
- Validate callback state, redirect/deep-link parameters, and tenant ownership before persisting any WABA/phone mapping.
- Confirm connection state with the provider/backend; a local UI action is not CONNECTED evidence.
- Test send, receive, duplicate webhook, provider failure, retry, AI handover, and resumed AI with an approved test account.
- Complete any required Meta Business verification, App Review, and permission approval truthfully.

## Evidence boundary

Automated tests can mock a provider acceptance to cover local route behavior. They are not evidence of WhatsApp delivery, Meta approval, Embedded Signup, or production coexistence.
