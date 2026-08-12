# Connect a Gym Laptop to Live Renewal Desk

Use this only after deploying the updated `gym-main` backend and the current
`RenewalDeskBridge.exe`. This setup connects the gym laptop to your live
Railway service:

```text
https://gym-production-910c.up.railway.app
```

The app dashboard URL (`/app/dashboard`) is for people in a browser. The
bridge uses the base URL above; it appends its own protected API path.

```text
RenewalDeskBridge on gym laptop
    -- outbound HTTPS --> Railway Renewal Desk
    -- local TCP 4370 --> eSSL terminal
```

No router port forwarding, public biometric IP address, ADMS/cloud-server
setting, or inbound connection to the gym is required.

## 1. Deploy the updated backend to the same Railway service

The live service does not receive these API routes until the updated contents
of the local `gym-main` folder are deployed to the Railway project that serves
the URL above.

1. Put the updated `gym-main` source into the repository/source used by the
   existing Railway service.
   The Railway build root must be the folder that contains `app/`,
   `migrations/`, `requirements.txt`, and `railway.json`. If this source is
   committed beneath a parent repository as `gym-main/`, set that Railway
   service's **Root Directory** to `gym-main`.
2. Before deploying, verify the existing Railway web service has these
   variables. Keep its existing database/Redis values; do not create a second
   empty database for this change.

   ```text
   FLASK_ENV=production
   PUBLIC_BASE_URL=https://gym-production-910c.up.railway.app
   DATABASE_URL=<the existing Railway PostgreSQL reference>
   REDIS_URL=<the existing Railway Redis reference>
   SECRET_KEY=<the existing strong production secret>
   ```

   `FLASK_ENV=production` is important because this service uses it to enable
   production-only security checks. `PUBLIC_BASE_URL` is the value printed into
   the laptop configuration when the one-time bridge credential is created.
3. As a migration preflight, run this in the current Railway web-service Shell:

   ```bash
   flask --app app:create_app db current
   ```

   The supplied bridge migration follows `f2a1b3c4d5e7`. The current service
   should report that revision before the first bridge deployment (or
   `a3c4d5e6f7a8` if it was already deployed). If it reports a different
   Alembic history, stop: merge the bridge changes into the matching production
   source and reconcile the migration history first. Do not use `db stamp` to
   force it.
4. Deploy it normally through that service's connected Git repository or
   Railway deployment workflow.
5. Wait for the deployment to finish successfully. Its `railway.json` runs
   `flask --app app:create_app db upgrade` before starting, so it creates the
   bridge tables safely.
6. In Railway, open the **Shell** for the web application service (not the
   PostgreSQL service), then verify the deployed database reached the
   biometric-bridge migration:

   ```bash
   flask --app app:create_app db current
   ```

   It must report `a3c4d5e6f7a8 (head)`. If it does not, stop and resolve the
   deployment/migration failure before creating a bridge key.
7. Open the health endpoint to confirm the app started:

   ```text
   https://gym-production-910c.up.railway.app/health
   ```

Do not place an API key in source code, Git, WhatsApp, or a screenshot.

## 2. Read the terminal serial number first

On the gym laptop, install the latest bridge build and the eSSL SDK as described
in [CLIENT_LAPTOP_SETUP.md](CLIENT_LAPTOP_SETUP.md).

1. Start `RenewalDeskBridge.exe`.
2. Enter the terminal IP/port, for example `192.168.1.201` / `4370`.
3. Click **Connect** even if the Bridge ID and API key fields are empty.
4. In the live log, copy the exact value shown after:

   ```text
   Device serial: ...
   ```

5. Click **Disconnect**.

The server will bind the credential to this serial. Copying the same laptop
configuration to another biometric terminal will then be rejected.

## 3. Create the one-time live bridge credential

In the Railway **web-service Shell** (or from a Railway CLI session linked to
that service), first list gyms if you do not know the gym slug:

```bash
flask --app app:create_app bridge-list
```

Create one bridge only for that gym, replacing the values below:

```bash
flask --app app:create_app bridge-create --gym-slug YOUR_GYM_SLUG --device-serial "SERIAL_FROM_STEP_2"
```

The command prints three values:

- `ApiBaseUrl`
- `GymId` (this is a generated `bridge_...` ID, not the gym's database ID)
- `ApiKey` (shown once only)

If an existing key must be replaced, use:

```bash
flask --app app:create_app bridge-rotate-key --gym-slug YOUR_GYM_SLUG
```

Update the gym laptop immediately after a rotation; the old key stops working.

## 4. Configure the gym laptop for production

Edit the `appsettings.json` beside `RenewalDeskBridge.exe`. Keep the device
settings and replace only the three cloud values with those from step 3:

```json
{
  "DeviceIp": "192.168.1.201",
  "DevicePort": 4370,
  "DeviceCommPassword": "",
  "MachineNumber": 1,
  "GymId": "bridge_REPLACE_WITH_GENERATED_ID",
  "ApiBaseUrl": "https://gym-production-910c.up.railway.app",
  "ApiKey": "rdb_live_REPLACE_WITH_ONE_TIME_KEY",
  "HeartbeatIntervalSeconds": 60,
  "CommandPollIntervalSeconds": 10,
  "RetryFlushIntervalSeconds": 30,
  "EnableLiveAttendanceEvents": false,
  "EnableCloudCommandPolling": false
}
```

Do not use:

- `http://localhost:5080` (that is only the local Mock API);
- `dev-test-key`;
- the browser dashboard path `/app/dashboard`; or
- the device's ADMS/Cloud Server page.

Stop the Mock API when switching to production. It is not needed for the live
connection. Start the bridge, click **Connect**, and wait for both statuses to
be green:

```text
Device: Connected
Renewal Desk: Connected
```

If Renewal Desk stays red, check that the laptop has internet access, the
Railway deployment is live, the `bridge_...` ID/key are correct, and the serial
in the live log exactly matches the serial used during `bridge-create`.

### Enable automatic membership commands only after the physical-door test

The X990 package deliberately starts with cloud command polling **off**. It is
safe to connect and send heartbeats, but it cannot automatically change a
member's terminal access until the physical-door test has succeeded.

After a safe normal member has been denied at the real door, the test has been
marked passed, and that member has been restored, close the bridge and run
`ENABLE_ONLINE_MEMBERSHIP_COMMANDS.cmd` from the same folder as the EXE. The
script refuses to continue unless this exact laptop has the recorded prepared
and physically verified policy. It keeps live attendance scan capture off for
this X990 because its vendor COM callback is not stable on this model.

Then start `START_ONLINE_BRIDGE.cmd` (without the test-mode shortcut) and wait
for both connection statuses to be green. Preserve these local files when
upgrading the bridge:

- `appsettings.json` â€” credential and commissioning state;
- `access_state.db` â€” each expired member's original access schedule; and
- `outbox.db` â€” durable command/attendance delivery records.

## 5. Bind a member only after their fingerprint is enrolled

Do not type biometric Enroll Numbers into the Renewal Desk web form or import
CSV. That could attach an old terminal fingerprint to the wrong person.

For each member:

1. On the online Renewal Desk member page, copy the numeric **Renewal Desk
   Member ID**.
2. On the terminal, enroll that person's fingerprint under a new, unused,
   normal (non-administrator) numeric Enroll Number.
3. On the connected gym laptop bridge, enter the terminal Enroll Number and
   the Renewal Desk Member ID.
4. Click **Confirm enrollment**.
5. Read the terminal-user details in the confirmation dialog and approve only
   if they are the correct member.

The bridge reads the terminal user before the server saves the binding. A
biometric Enroll Number remains reserved even if a member is later soft-deleted;
do not reuse it unless an audited terminal deletion and fresh fingerprint
enrollment process is completed.

For an already-active new member, the first online `enable_user` command is a
safe no-op when this laptop has never denied that terminal user. The bridge
does not guess or overwrite the existing terminal schedule. Once that member
later expires, the bridge records their original schedule before denying them;
a subsequent renewal restores that saved schedule.

## 6. Membership automation

After [the physical-door commissioning test](CLIENT_LAPTOP_SETUP.md#9-commission-membership-expiry-safely)
has passed:

- a payment renewal / active membership queues `enable_user`;
- an automatic expiry, pause, or soft deletion queues `disable_user`;
- the laptop applies the terminal access-time-zone policy locally; and
- the laptop acknowledges the result to Railway.

This X990 release manages membership access only. Live attendance upload stays
off until the terminal's real-time SDK event path has been hardened and proven
stable; it does not affect fingerprint verification or door access control.

Commands are leased and idempotent. Attendance has a durable event ID. If a
temporary device/network operation fails, the server issues a bounded delayed
retry with a new command ID; use `bridge-reconcile` after fixing a persistent
problem:

```bash
flask --app app:create_app bridge-reconcile --gym-slug YOUR_GYM_SLUG
```

Never mark the physical test as passed when the actual door still opens. In
that case the terminal schedule is not controlling the lock, and the installer
must check Normal Open settings, relay wiring, and any external controller.
