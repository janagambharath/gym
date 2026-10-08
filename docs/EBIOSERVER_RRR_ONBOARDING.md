# Elite Gym eBioServer onboarding

RRR uses the licensed eBioServer installed on the gym PC as a local connector.
The mobile app talks only to the RRR API; it never receives eBioServer login
credentials and it never connects to the gym LAN directly.

## Before visiting the gym

- Deploy the API migration: `flask --app app:create_app db upgrade`.
- Set `MOBILE_API_ENABLED=true` and a strong `MOBILE_API_TOKEN_SECRET` in the
  deployed API environment.
- Build and copy `eBioServerBridge` to the same Windows PC as eBioServer.
- Keep the X2008's current ADMS destination unchanged. Do not delete terminal
  data or change the ADMS address as part of this setup.

## Pair from the owner mobile app

1. Open **RRR → Integrations → eSSL eBioServer** and generate a pairing code.
2. On the gym PC, set the non-secret values in `appsettings.json`. Leave
   `DeviceSerial` blank to let the connector discover the first available
   eBioServer device for pairing; the owner can select the intended X2008 in
   RRR after the paired PC reports its inventory.

   ```json
   {
     "eBioServerUrl": "http://localhost:8081",
     "eBioServerSoapEndpoint": "/WebService.asmx",
     "RenewalDeskApiBaseUrl": "https://YOUR-RRR-DOMAIN",
     "DeviceSerial": "",
     "DeviceName": "",
     "PairingCode": "six-digit-code-from-mobile"
   }
   ```

3. For first launch only, enter the local eBioServer service user/password in
   the configuration on the gym PC (never in Git, screenshots, mobile, or
   cloud settings). The bridge moves them, the cloud key, and gym ID to
   `bridge_secrets.dat`, encrypted with Windows DPAPI for that PC user, then
   clears the plaintext fields from `appsettings.json`.
4. Start the bridge. It discovers the local device, exchanges the short-lived
   pairing code, reports sanitized device inventory, and starts outbound HTTPS
   polling. RRR never receives local eBioServer credentials.
5. In RRR, select the discovered X2008 and make a real fingerprint punch with
   a mapped Elite Gym member. RRR must show that attendance before the
   integration is considered verified.

## Controlled access commands

Block/unblock remains read-only-disabled until all of these are true:

1. The connector is healthy and paired.
2. A mapped real attendance event was received.
3. The owner completed a supervised physical-door test in RRR.

Use the Integration screen to pause commands immediately if anything is
unexpected. An HTTP response alone is not evidence that the terminal changed;
check the command result and physical device state.

## Operational notes

- eBioServer logins, API keys, and pairing codes must never be committed,
  placed in screenshots, or sent over WhatsApp.
- RRR retains unknown punches for review. Map an external biometric ID once;
  prior unresolved events are then replayed to that member.
- The initial rollout status is **controlled POC only** until the live Elite
  Gym punch path and supervised access test are both verified.
