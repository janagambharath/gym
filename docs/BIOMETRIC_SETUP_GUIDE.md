# Renewal Desk — Biometric Bridge Setup & Operator Guide
**Applies To:** Renewal Desk Windows Bridge (v2.1+) & eSSL / ZKTeco Biometric Terminals (X990, K90, SilkBio, MB20)  
**Target Audience:** Gym Owners, Technicians, Front-Desk Operators  

---

## 1. Overview & Architecture

Renewal Desk connects your cloud gym operations with your physical door turnstile using a lightweight Windows desktop application (**Renewal Desk Bridge**):

```
┌─────────────────────────────────────────────────────────────┐
│                 RENEWAL DESK CLOUD BACKEND                  │
│       • Tracks payments, renewals, & member expirations     │
│       • Issues durable enable_user / disable_user commands   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Outbound HTTPS Polling (Port 443)
                               │ (Zero inbound open ports / No public IP required)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             GYM WINDOWS LAPTOP / PC (DESK)                  │
│       • Renewal Desk Bridge Windows Service / App           │
│       • Runs in background / system tray                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Local Ethernet LAN / TCP Port 4370
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           eSSL / ZKTECO BIOMETRIC TERMINAL (DOOR)           │
│       • Controls electric lock relay on TimeZone Slot 50     │
│       • Retains biometric fingerprint/face templates safely  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Five-Minute Setup Checklist

### Step 1: Preflight Network Check
1. Ensure the Gym PC and the Biometric Terminal are connected to the same Local Area Network (LAN) router or switch.
2. Confirm the biometric terminal IP (e.g. `192.168.1.201`) responds to `ping`:
   ```cmd
   ping 192.168.1.201
   ```

### Step 2: Provision Bridge on Renewal Desk Web
1. Log into your Renewal Desk Web Dashboard.
2. Navigate to **Biometric** -> **Settings**.
3. Under **Bridge Provisioning**, copy your Gym Public ID and Bridge API Key (or generate a 6-digit Quick Pair code).

### Step 3: Configure `appsettings.json` on Gym PC
Open `appsettings.json` in the `RenewalDeskBridge` folder and verify:
```json
{
  "DeviceIp": "192.168.1.201",
  "DevicePort": 4370,
  "DeviceCommPassword": "",
  "MachineNumber": 1,
  "GymId": "bridge_your_gym_public_id",
  "ApiBaseUrl": "https://gym-production-910c.up.railway.app",
  "ApiKey": "rdb_live_your_secret_api_key",
  "HeartbeatIntervalSeconds": 60,
  "CommandPollIntervalSeconds": 10,
  "RetryFlushIntervalSeconds": 30,
  "MembershipDenyTimeZoneId": 50
}
```

### Step 4: Launch Bridge
Run `RenewalDeskBridge.exe` or execute `START_ONLINE_BRIDGE.cmd`.
- Look for the green indicator: **CONNECTED**.
- Terminal serial number will be read automatically.

### Step 5: Test Verification
1. On Renewal Desk Web, visit **Biometric Control Center** -> verify Bridge shows **ONLINE** with a recent heartbeat.
2. Visit any member profile with an active biometric enrollment number.
3. Tap **Sync Access** -> Verify command moves from `QUEUED` -> `LEASED` -> `SUCCESS`.
4. Test physical finger punch on door lock:
   - **Active Member:** Door unlocks immediately.
   - **Expired Member:** Access denied; door remains locked without deleting member's fingerprint.

---

## 3. Decision Tree Runbook

```
┌──────────────────────────────────────────────┐
│             Bridge Shows OFFLINE?            │
└──────────────────────┬───────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
  [PC Disconnected]           [Invalid Token]
  • Check gym internet        • Visit Web Settings
  • Restart router            • Rotate Key in appsettings
  • Check tray app            • Restart Bridge

┌──────────────────────────────────────────────┐
│         Bridge ONLINE but Device ERROR?      │
└──────────────────────┬───────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
  [LAN IP Changed]            [Terminal Powered Off]
  • Check router DHCP         • Verify terminal power supply
  • Assign Static Device IP   • Verify Ethernet cable RJ45
```
