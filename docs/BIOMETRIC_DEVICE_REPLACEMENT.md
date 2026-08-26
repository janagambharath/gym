# RENEWAL DESK — BIOMETRIC TERMINAL REPLACEMENT SOP
**Standard Operating Procedure:** Physical Biometric Hardware Swap  
**Applicable Devices:** ZKTeco K40 / IN01 / MB20 / Uface / eSSL SilkBio / X990 series  

---

## 1. When to Use This Procedure
- A physical turnstile reader or wall-mounted biometric device fails.
- The gym upgrades from an older terminal to a newer model (e.g. fingerprint to facial recognition).
- The gym installs an additional entrance terminal.

---

## 2. Hardware Preparation & Network Configuration

1. **Unpack & Mount New Device:** Secure the new terminal near the turnstile or entrance gate.
2. **Network Connection:** Connect the terminal to the gym's LAN switch via RJ45 Ethernet cable.
3. **Configure Terminal IP Settings (on Device Menu):**
   - **Menu** -> **Comm.** -> **Ethernet**
   - **IP Address:** `192.168.1.201` (match previous device IP to avoid PC reconfiguration)
   - **Subnet Mask:** `255.255.255.0`
   - **Gateway:** `192.168.1.1`
   - **Port:** `4370` (Default Standalone Port)
4. **Configure All-Day Deny TimeZone Slot 50:**
   - **Menu** -> **Access Control** -> **Time Zones** -> Select **Slot 50**
   - Set start/end schedule to `23:57 - 23:56` for all 7 days (`2357235623572356...`).
   - This ensures expired members are rejected immediately without deleting their enrolled templates.

---

## 3. Web & Bridge Re-Synchronization

1. Open Web Console (`/biometric/settings`).
2. Update the **Device Serial Number** if changed.
3. Click **Re-sync All Member Permissions**.
4. The backend queues `enable_user` and `disable_user` commands for all registered members based on their active membership status.
5. The Bridge polls the commands and sets user access groups on the new hardware in bulk.

---

## 4. Physical Testing & Verification

1. **Active Member Test:** Ask an active member to punch/scan -> Terminal displays green verification and triggers door unlock relay.
2. **Expired Member Test:** Punch with an expired member ID -> Terminal displays red cross ("Invalid Time Zone" / "Access Denied") -> Relay remains locked.
3. **Web Punch Log:** Confirm both scan events appear under `/biometric/activity`.
