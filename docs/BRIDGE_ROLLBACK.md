# Bridge Rollback & Emergency Recovery

## 1. Rollback Scenarios
In the event that an upgraded bridge experiences hardware timeouts or unstable connectivity:

### Scenario A: Downgrade from V2 to V1
1. On the Gym PC:
   - Stop the Windows Bridge service: `net stop RenewalDeskBridge`.
   - Download the immutable **V1.0.0 Stable** package from **Bridge Releases** (`/admin/bridge/releases`).
   - Extract and configure the V1 executable with the existing `gymId` and `apiKey`.
   - Start the V1 service: `net start RenewalDeskBridge`.
2. On the Admin Dashboard:
   - In **Gym Detail → Biometric Tab**, execute **Upgrade Bridge** and select `v1.0.0 (STABLE)`.
   - Verify heartbeat timestamp updates to current time.

### Scenario B: Revoke & Re-Pair
If credentials were compromised or the gym PC was replaced:
1. Navigate to **Gym Detail → Biometric Tab → Revoke Bridge**.
2. Old credentials and `api_key_hash` are immediately scrambled and deactivated.
3. Click **Generate Pairing Code** to produce a fresh 6-digit OTP.
4. On the new PC, install Bridge V2, enter the 6-digit OTP, and resume hardware synchronization.
