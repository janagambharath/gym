# Bridge V2 Secure One-Time Pairing

## 1. Architecture & Concept
Bridge V2 eliminates manual copy-pasting of sensitive API keys by introducing an automated, one-time 6-digit numeric pairing workflow.

```
[Super Admin / Founder]                    [Gym Windows PC]                       [Renewal Desk Backend]
       │                                          │                                          │
       │── Generate Pairing Code ─────────────────┼─────────────────────────────────────────>│ (Generates OTP: 834921)
       │<── Display "834921" (Valid 24h) ────────┼──────────────────────────────────────────│
       │                                          │                                          │
       │ (Admin gives code to gym technician)     │                                          │
       │                                          │── POST /api/bridge/v2/pair ─────────────>│
       │                                          │   { "pairingCode": "834921",             │
       │                                          │     "deviceSerial": "X990-001",          │
       │                                          │     "version": "2.0.0",                  │
       │                                          │     "osInfo": "Windows 11 Pro",          │
       │                                          │     "pcName": "DESK-PC-01" }             │
       │                                          │                                          │
       │                                          │<── 201 Created ──────────────────────────│ (Code Burned / Invalidated)
       │                                          │   { "apiKey": "rdb_live_...",            │
       │                                          │     "gymId": "bridge_abc123",            │
       │                                          │     "protocolVersion": 2 }               │
       │                                          │                                          │
       │                                          │ (Bridge stores apiKey in config.json)    │
       │                                          │                                          │
       │                                          │── Outbound Heartbeat / Polling ─────────>│
       │<── Gym Dashboard shows "Bridge Paired" ──┼──────────────────────────────────────────│
```

## 2. Pairing Properties & Invariants
- **Short-Lived & One-Time Use**: Once successfully redeemed via `/api/bridge/v2/pair`, the pairing code is immediately burned (`dep.pairing_code = None`).
- **Tenant Isolation**: The pairing code is uniquely bound to a single `gym_id`. It cannot be used to pair any other tenant.
- **Hardware Binding**: The `device_serial` is recorded on the installation to prevent duplicate terminal registrations.
- **Persistent Local Credentials**: After initial pairing, the bridge never prompts for the code again upon reboot or restart.
