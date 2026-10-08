# Elite Gym eBioServer onboarding

RRR uses the licensed eBioServer as a connector between an eSSL terminal and
RRR. The connector can be installed either on a Windows PC at the gym or on an
**approved hosted Windows Server VM**. The latter removes the need for a
physical laptop or PC at Elite Gym.

The mobile app talks only to the RRR API; it never receives eBioServer login
credentials and it never connects to the gym LAN directly.

## Choose the deployment before changing the terminal

| Option | eBioServer and bridge run on | Gym hardware | Suitable for |
| --- | --- | --- | --- |
| Local | a Windows PC at the gym | always-on PC required | private-LAN-only deployments |
| Hosted | a dedicated Windows Server VM | no PC/laptop at the gym | Elite Gym's no-laptop deployment |

The hosted option still needs an always-on Windows **server**, SQL, IIS, a
stable public address or DNS name, and written confirmation from eSSL that the
licence may be activated on that VM. Do not move a live licence before that
confirmation. eSSL documents eBioServer as deployable on an MS Windows web
server with SQL and exposes the block/unblock API; its documentation does not
state that every licence is transferable to a VM.

## Hosted Windows Server VM (no gym laptop)

1. Provision one dedicated, supported Windows Server VM in a region close to
   the gym. Give it a static public IP or DNS name. It must remain online.
2. Install SQL Server and eBioServer on that VM, activate eBioServer using the
   vendor-approved licence, and verify that its web UI and `WebService.asmx`
   work **from the VM** at `http://127.0.0.1:8081` (or the vendor-configured
   local IIS binding).
3. Install `eBioServerBridge` on the same VM. The bridge must use the loopback
   address, not the public address, for eBioServer:

   ```json
   {
     "eBioServerUrl": "http://127.0.0.1:8081",
     "eBioServerSoapEndpoint": "/WebService.asmx",
     "RenewalDeskApiBaseUrl": "https://YOUR-RRR-DOMAIN",
     "DeviceSerial": "",
     "DeviceName": "",
     "PairingCode": "six-digit-code-from-mobile"
   }
   ```

4. Do not publish SQL Server, the SOAP service, RDP, or the eBioServer web UI
   openly to the internet. Restrict administrator access to VPN or approved
   fixed IPs. Expose only the minimum eBioServer ADMS listener required by the
   terminal, and restrict it to Elite Gym's egress IP where practical.
5. In the X2008 **Cloud Server Setting / ADMS** menu, photograph the existing
   settings first. Enter the hosted server DNS name or public IP and the ADMS
   port supplied by the eBioServer installer. Some firmware asks separately
   for server host and port; do not paste `/iclock` or `http://` into a field
   that accepts only a host/IP. Do not guess the port. Confirm the exact values
   with eSSL for this device firmware and server installation.
6. Make one test punch. It must appear in eBioServer's device/attendance log
   before pairing RRR. If it does not, restore the photographed terminal
   settings and diagnose the eBioServer/ADMS connection before continuing.

Do not expose a legacy HTTP-only ADMS endpoint directly to the public internet
without an eSSL-approved network design. If the terminal cannot use HTTPS,
use a router/site-to-cloud VPN or obtain an eSSL-supported hosted deployment
design. The terminal has no RRR API key and must never be pointed at the RRR
API domain as though it were an eBioServer endpoint.

## Before commissioning Elite Gym

- Deploy the API migration: `flask --app app:create_app db upgrade`.
- Set `MOBILE_API_ENABLED=true` and a strong `MOBILE_API_TOKEN_SECRET` in the
  deployed API environment.
- Build and copy `eBioServerBridge` to the same Windows host as eBioServer.
- For an existing production terminal, retain the current ADMS destination
  until the hosted server is installed, reachable, and rollback values are
  recorded. Do not delete terminal data.

## Pair from the owner mobile app

1. Open **RRR → Integrations → eSSL eBioServer** and generate a pairing code.
2. On the Windows connector host, set the non-secret values in `appsettings.json`. Leave
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
   the configuration on the Windows connector host (never in Git, screenshots, mobile, or
   cloud settings). The bridge moves them, the cloud key, and gym ID to
   `bridge_secrets.dat`, encrypted with Windows DPAPI for that PC user, then
   clears the plaintext fields from `appsettings.json`.
4. Start the bridge. It discovers the eBioServer device, exchanges the short-lived
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
