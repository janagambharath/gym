# RENEWAL DESK — FRONT DESK PC REPLACEMENT SOP
**Standard Operating Procedure:** Bridge PC Hardware Swap  
**Estimated Time:** < 5 Minutes | **Downtime Impact:** None (Offline Buffer & Auto-Catchup)  

---

## 1. When to Use This Procedure
- The front-desk Windows PC suffers a hardware failure (motherboard, power supply, drive crash).
- The gym upgrades or replaces their front-desk computer.
- The gym relocates their reception counter.

---

## 2. Zero-Loss Data Guarantee
- All member identities, phone numbers, plans, payment logs, and biometric enroll IDs are stored safely in the cloud database.
- Physical fingerprint and RFID card templates are stored directly on the biometric terminal's internal flash memory.
- Replacing the PC **does NOT require re-enrolling members or wiping turnstiles**.

---

## 3. Step-by-Step Replacement Workflow

### Step 1: Prepare the New Computer
1. Connect the new Windows 10/11 PC to the gym's local network (Ethernet cable or Wi-Fi).
2. Ensure the PC can reach the biometric terminal's IP address (e.g. `ping 192.168.1.201`).

### Step 2: Download & Install RenewalDesk Bridge
1. Log into the RenewalDesk Web Console on the new PC (`https://app.renewaldesk.com/auth/login`).
2. Navigate to **Biometric Desk** -> **Pairing & Config** (`/biometric/settings`).
3. Download the standalone installer: `RenewalDeskBridge_Setup.exe` / `msi`.
4. Run the installer (requires standard Windows administrator prompt).

### Step 3: Rotate & Issue New Pairing Key
1. In the Web Console (`/biometric/settings`), click **Rotate Bridge Key**.
2. Copy the newly generated 64-character secret key.
   *(Note: This automatically invalidates the old PC's access token, ensuring security).*

### Step 4: Configure the Bridge Application
1. Launch **Renewal Desk Bridge** on the new PC.
2. Enter the following parameters:
   - **Server URL:** `https://app.renewaldesk.com`
   - **Gym ID:** (Displayed on your settings page)
   - **Bridge API Key:** (Pasted from Step 3)
   - **Terminal IP Address:** `192.168.1.201` (or local device IP)
   - **Communication Port:** `4370`
3. Click **Save & Connect**.

### Step 5: Verify Connection & Operational Sync
1. The Bridge status on your Web Dashboard will immediately turn **Online (Green)** with a fresh heartbeat timestamp (< 5s ago).
2. The Bridge will automatically lease any pending access commands from the queue and stream new attendance punches to the cloud.
3. Test a physical scan at the turnstile: verify that the punch appears in the **Live Attendance Feed** at `/biometric/activity`.
