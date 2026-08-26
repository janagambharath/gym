# RENEWAL DESK — DISASTER RECOVERY & BUSINESS CONTINUITY PLAN
**Document ID:** RD-SOP-DR-001  
**Classification:** Production Operations Runbook  
**Target RTO:** < 15 Minutes | **Target RPO:** < 5 Minutes  

---

## 1. Overview & Data Resilience Architecture

Renewal Desk employs a multi-tiered disaster recovery strategy designed for high resilience against cloud provider outages, local hardware failures, and front-desk laptop crashes:

```
[ Cloud PostgreSQL + S3 WAL ] <── Automated Daily Dumps & Real-Time WAL
             │
   [ Flask App Instances ]
             ▲
             │ Unidirectional HTTPS (Outbound Only)
             ▼
[ Local Gym Bridge SQLite Buffer ]
             ▲
             │ ZKTeco Standalone TCP/IP (Port 4370)
             ▼
[ Biometric Device Flash Memory ]
```

---

## 2. Backup Schedules & Retention Policies

| Data Layer | Storage Technology | Frequency | Retention Policy | Storage Location |
| :--- | :--- | :--- | :--- | :--- |
| **Relational Database** | PostgreSQL 16 | Full snapshot every 6 hours | 30 Days Daily, 12 Months Monthly | Encrypted S3 Bucket (`ap-south-1`) |
| **Continuous Archiving**| PostgreSQL WAL | Continuous streaming | 7 Days Point-in-time recovery | S3 WAL-G repository |
| **Local Bridge Buffer** | SQLite (`bridge.db`)| Continuous transaction write | 90 Days local roll-over | Front Desk PC (`%LOCALAPPDATA%`) |
| **Audit Event Trail** | PostgreSQL `audit_logs`| Write on every mutate | Permanent / Immutable | Append-only database partition |

---

## 3. Disaster Scenarios & Step-by-Step Recovery

### Scenario A: Cloud Database Server Failure / Data Corruption

1. **Provision New Database Node:**
   ```bash
   # Spin up target PostgreSQL instance
   export PGPASSWORD="<master_db_password>"
   createdb -h <new_host> -U postgres renewaldesk_prod
   ```
2. **Restore Snapshot:**
   ```bash
   # Fetch latest clean dump from S3
   aws s3 cp s3://rd-production-backups/latest-snapshot.sql.gz ./
   gunzip < latest-snapshot.sql.gz | psql -h <new_host> -U postgres -d renewaldesk_prod
   ```
3. **Execute Pending Migrations:**
   ```bash
   flask db upgrade
   ```
4. **Switch Database Connection String:**
   Update `DATABASE_URL` in production `.env` and restart web services:
   ```bash
   systemctl restart renewaldesk-web
   ```
5. **Recovery Verification:**
   - Log in as Super Admin (`/admin`).
   - Confirm active gym list and total member count match pre-disaster metrics.
   - Connected bridges will automatically resume polling and ack pending commands.

---

### Scenario B: Front Desk Gym PC Crash / Hard Drive Death

1. **Procure Any Windows 10/11 PC.**
2. **Install RenewalDesk Bridge Service:**
   - Run `RenewalDeskBridgeInstaller.msi` (no developer tools or runtime dependencies required).
3. **Generate New Bridge Pairing Key:**
   - Gym Owner logs into Web Panel (`/biometric/settings`).
   - Click **Rotate Bridge Key**. Copy the newly generated 64-character token.
4. **Enter Credentials on Bridge UI:**
   - Input Server URL: `https://app.renewaldesk.com`
   - Input Gym ID & Bridge Key.
   - Enter Biometric Terminal LAN IP (e.g. `192.168.1.201`).
5. **Click Connect & Test:**
   - Bridge establishes HTTPS session, fetches all active member access rules, and resumes syncing door punches immediately.
   - **Zero member profiles, fingerprints, or payment records are lost.**

---

### Scenario C: Biometric Terminal Hardware Failure / Replacement

1. Connect new ZKTeco / eSSL terminal to gym LAN switch.
2. Set device IP address to match the existing LAN configuration (e.g. `192.168.1.201`, Subnet `255.255.255.0`).
3. Set TimeZone slot 50 on device to all-day deny: `2357235623572356...`.
4. In Web Panel (`/biometric/settings`), update the **Device Serial Number** if changed.
5. In Web Panel (`/members/`), click **Re-sync All Biometric Access** or trigger individual sync on member profiles.
6. The Bridge will automatically populate access permissions on the new hardware.

---

## 4. Routine Backup Verification Drills

- **Automated Verification:** Staging database is refreshed weekly from production sanitised backups to prove restore script validity.
- **Runbook Review:** Engineering conducts quarterly simulated disaster drills to ensure recovery time remains under 15 minutes.
