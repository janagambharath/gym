# Renewal Desk — Biometric Integration & Hardware Plan
**Architecture:** Protocol Version 2 (Strict Backward Compatibility with Yodha Fitness)  
**Hardware Support:** ZKTeco ZKEMKeeper / eSSL X990, K90, SilkBio, MB20  

---

## 1. Hardware Abstraction & Vendor Independence

```
┌─────────────────────────────────────────────────────────────┐
│                 RENEWAL DESK CLOUD BACKEND                  │
│       • Generates vendor-agnostic access commands           │
│       • command_type: "enable_user" / "disable_user"        │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Leased JSON Payload)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             RENEWAL DESK BRIDGE (C# .NET)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Biometric Hardware Adapter Layer            │  │
│  │  • ZKTeco / eSSL Adapter (zkemkeeper COM wrapper)     │  │
│  │  • Real-time attendance pull / event dispatcher       │  │
│  │  • Local SQLite outbox & access_state store           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Command Lifecycle State Machine

```
[ PENDING ]
     │
     ▼ (Leased by Bridge during GET /commands/pending)
[ LEASED ] (Includes 120s Lease Token to prevent concurrent execution)
     │
     ├──────────────────────────┐
     ▼ (Execution Succeeded)    ▼ (Execution Failed / Device Offline)
[ ACKED / SUCCESS ]        [ RETRY / FAILED ]
                           (Exponential backoff: 1m -> 5m -> 15m -> 1hr)
```

---

## 3. Preservation Rules for Yodha Fitness Deployment

1. **Protocol Header:** `X-RenewalDesk-Bridge-Protocol: 2` remains mandatory.
2. **Device Serial Binding:** `X-Device-Serial` verified against `bridge_installations.device_serial`.
3. **Access Schedule Preservation:** TimeZone slot 50 all-day-deny definition (`23572356...`) is maintained.
4. **Zero Re-enrollment:** Fingerprints are never deleted upon membership expiration; only access time schedules are toggled.
