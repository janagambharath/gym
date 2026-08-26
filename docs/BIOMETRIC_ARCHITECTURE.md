# Renewal Desk — Biometric Architecture & System Design
**Document ID:** RD-BIO-ARCH-2026  
**Classification:** Technical & Operational Specification  

---

## 1. System Topology

```
                  ┌───────────────────────────────┐
                  │      RENEWAL DESK CLOUD       │
                  │   PostgreSQL + SQLAlchemy     │
                  │   Flask Backend (Port 443)    │
                  └──────────────┬────────────────┘
                                 │
                 Outbound HTTPS  │ Heartbeats, Leases,
                 (TLS 1.3 / JSON)│ Punches, & Status
                                 ▼
                  ┌───────────────────────────────┐
                  │    GYM WINDOWS LAPTOP / PC    │
                  │     Renewal Desk Bridge       │
                  │  (WinForms / System Tray App) │
                  └──────────────┬────────────────┘
                                 │
                     Ethernet /  │ TCP Port 4370
                     Local LAN   │ ZKTeco Standalone SDK
                                 ▼
                  ┌───────────────────────────────┐
                  │  eSSL / ZKTECO TERMINAL       │
                  │   X990 / K90 / SilkBio        │
                  │  Relay -> Door Magnetic Lock  │
                  └───────────────────────────────┘
```

---

## 2. Key Design Principles

1. **Unidirectional Trust Boundary:** The biometric hardware is never exposed to the public internet. No dynamic DNS, static public IPs, port forwarding, or firewall punch-holes are ever required.
2. **Authoritative Cloud State:** Cloud PostgreSQL database is the sole authority for membership status. The biometric hardware is an access-control projection.
3. **Lease Concurrency Safety:** Every command leased to the bridge carries a cryptographic `lease_token` with an expiration window (default 120s) preventing duplicate executions.
4. **Non-Destructive Access Denial:** The terminal's biometric templates are preserved permanently in device memory. Expiration updates schedule slot 50 to deny door access without forcing re-enrollment when the member renews.
