# Renewal Desk — Biometric Support & Operational Runbook

---

## 1. Quick Diagnostic Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Is Bridge showing ONLINE in Renewal Desk Web?            │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
              YES                              NO
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ 2. Is Device showing         │ │ • Check if Gym PC is on.     │
│    CONNECTED?                │ │ • Check internet connection. │
└──────────────┬───────────────┘ │ • Verify Bridge app is       │
               │                 │   running in system tray.    │
        ┌──────┴──────┐          │ • Check appsettings.json     │
       YES            NO         │   ApiBaseUrl & ApiKey.       │
        │             │          └──────────────────────────────┘
        ▼             ▼
┌──────────────┐ ┌──────────────────────────────────────────────┐
│ Healthy      │ │ • Ping device IP (e.g. ping 192.168.1.201).  │
│ System Ready │ │ • Verify Ethernet cable is plugged in.       │
│              │ │ • Check TCP port 4370 is not blocked locally.│
│              │ │ • Restart terminal power cycle.              │
└──────────────┘ └──────────────────────────────────────────────┘
```

---

## 2. Common Scenarios & Remediation

### Scenario A: Member renewed on Web, but door lock did not unlock
1. Check **Biometric Control Center** -> **Command Queue**.
2. If command is `PENDING`: Bridge will pick it up on next poll (within 10s).
3. If command is `FAILED`: Check `last_error`. Tap **Retry Sync**.
4. Verify member's `device_enroll_number` matches the numeric ID registered on the terminal.

### Scenario B: Member expired, but door opened
1. Verify terminal time-zone slot 50 has all-day-deny schedule (`23572356...`).
2. Run `START_X990_ACCESS_TEST.cmd` on Gym PC to confirm lock obedience.
3. Check if door lock has a mechanical bypass switch or battery override engaged.
