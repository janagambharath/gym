# Renewal Desk Bridge: Complete Gym Laptop Setup and Access-Control Test Guide

This runbook is for the Windows computer that stays at the gym. It explains how
to connect the Renewal Desk Bridge to an eSSL X990+ID terminal and, most
importantly, how to prove that an expired membership actually leaves the
physical door locked.

> **Do not skip the physical-door test.** A successful SDK call, a green status,
> or a `SCAN:` log line does not prove that the installed lock obeys the terminal.

---

## Table of contents

1. [What the bridge does](#1-what-the-bridge-does)
2. [Safety rules and responsibilities](#2-safety-rules-and-responsibilities)
3. [Before starting](#3-before-starting)
4. [Network preflight](#4-network-preflight-mandatory)
5. [Copy the files](#5-copy-the-files)
6. [Register the eSSL SDK](#6-register-the-essl-sdk-one-time)
7. [Install/check the Mock API runtime](#7-installcheck-the-mock-api-runtime)
8. [Configure and start the software](#8-configure-and-start-the-software)
9. [Commission membership expiry safely](#9-commission-membership-expiry-safely)
10. [Test automatic Renewal Desk commands](#10-test-automatic-renewal-desk-commands)
11. [Production safeguards](#11-production-safeguards)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What the bridge does

```text
Renewal Desk backend / test Mock API
        |
        | enable_user / disable_user command
        v
RenewalDeskBridge on the gym Windows laptop
        |
        | eSSL SDK over LAN: terminal IP + TCP port 4370
        v
eSSL X990+ID biometric terminal
        |
        v
Terminal relay / installed door lock
```

The biometric terminal is on the gym LAN, so the bridge must run at the gym
where it can reach the terminal directly. The developer can use AnyDesk for
support, but AnyDesk does not replace this local network requirement.

### How expired membership is enforced

The terminal tested for this project can report a user as **disabled** while
still opening the physical door. Therefore the bridge does **not** rely on the
generic `SSR_EnableUser(false)` account flag as the membership-access rule.

Instead, the bridge uses the X990 access-control mechanism:

1. A technician reserves one unused terminal time-zone slot (normally `50`, but
   only after the gym confirms it is unused).
2. The bridge stores the slot's original definition in `access_state.db` before
   changing it.
3. It creates an all-day-deny definition in that reserved slot.
4. On expiry, it saves the member's exact current personal/group time-zone
   string, then assigns that member only the deny slot.
5. On renewal, it restores the exact saved string. It does not delete the
   fingerprint template.

The deny definition is seven repetitions of `23572356`:

```text
23572356235723562357235623572356235723562357235623572356
```

For this firmware, each `23572356` means `23:57–23:56`; an end time earlier
than the start time is an all-day access denial. A denied member receives a
personal schedule such as `50:0:0:1`.

### Do not use Cloud Server / ADMS settings

The device may show **Cloud Server Setting**, **ADMS**, a server address, and
port `8081`. This project does not use that page. Do not enter the laptop IP,
`localhost`, or a Renewal Desk URL there.

The bridge uses the device's **Ethernet IP** and **TCP COMM Port 4370** through
the eSSL SDK.

---

## 2. Safety rules and responsibilities

| Person | Responsibility |
| --- | --- |
| Developer / Renewal Desk team | Installs the bridge, checks logs, queues test commands, and records results. |
| Gym owner / manager | Authorises the installation, identifies a spare access time-zone, and chooses a safe test member. |
| Person beside the door | Confirms whether the lock physically stays locked or opens. |
| Network / lock technician | Resolves LAN isolation, Normal Open settings, relay wiring, or controller problems. |

Follow these rules every time:

- Use a normal, non-admin enrolled test member. **Never test terminal User 1
  unless the owner explicitly confirms it is safe.**
- Keep a person beside the door for every expiry/restore test.
- Do not delete users, fingerprints, groups, or global access schedules while
  testing membership expiry.
- Never overwrite time-zone `1`; it is the terminal's default always-access
  time zone.
- Never prepare a time zone until the gym owner has confirmed it is unused by
  every device user and group.
- Do not delete `access_state.db` while any expired member may later need their
  original access schedule restored.
- If a test fails, restore the safe test user when possible and stop. Do not
  mark the system ready just because a status label is green.

---

## 3. Before starting

### 3.1 Choose the gym laptop

Use a 64-bit Windows 10 or Windows 11 computer that:

- stays at the gym and can remain powered on;
- connects reliably to the gym network;
- can reach the biometric terminal on TCP port `4370`;
- has an administrator available for the one-time SDK registration;
- does not go to sleep during normal operation.

The bridge is a .NET Framework 4.8 Windows application. Visual Studio is not
needed on the client laptop.

### 3.2 Collect these details first

- biometric device Ethernet IP (device: `Menu -> COMM. -> Ethernet`);
- TCP COMM Port (normally `4370`);
- device Comm Password / Comm Key, only if it was configured;
- one safe, already fingerprint-enrolled **numeric** device Enroll Number;
- a staff member at the physical door;
- a confirmed unused time-zone slot between `2` and `50`;
- approval to change one terminal time-zone and temporarily deny the safe user.

### 3.3 IP address rule

The laptop and device need different IP addresses in the same LAN range.

```text
Laptop:  192.168.1.4
Device:  192.168.1.201
Mask:    255.255.255.0
```

Do **not** make the two addresses identical. A laptop on Wi-Fi and a device on
Ethernet can communicate if the router bridges Wi-Fi to LAN and does not isolate
clients.

---

## 4. Network preflight (mandatory)

### 4.1 Read the device address

On the terminal, open:

```text
Menu -> COMM. -> Ethernet
```

Record the IP address and TCP COMM Port. If DHCP is enabled, this address can
change after a router restart. Do not change ADMS/Cloud Server settings.

### 4.2 Check the laptop address

On the gym laptop, open Command Prompt and run:

```bat
ipconfig
```

Find the active Wi-Fi or Ethernet adapter's IPv4 address and gateway. Guest
Wi-Fi, an isolated SSID, a separate VLAN, or a second router can block device
traffic even if the addresses look similar.

### 4.3 Test the terminal port

Replace `DEVICE_IP` with the actual terminal address:

```bat
powershell -Command "Test-NetConnection -ComputerName DEVICE_IP -Port 4370 | Select-Object ComputerName,RemotePort,TcpTestSucceeded"
```

Example success:

```text
ComputerName  RemotePort TcpTestSucceeded
------------  ---------- ----------------
192.168.1.201       4370             True
```

Continue only when `TcpTestSucceeded` is `True`.

### 4.4 If the port test is false

Stop here; do not change user access or repeatedly change device IP addresses.

Ask the gym/network owner to check:

1. both ends of the terminal Ethernet cable;
2. that the cable reaches the correct LAN switch/router, not a WAN port;
3. that the laptop is on the main gym Wi-Fi, not guest Wi-Fi;
4. AP Isolation, Client Isolation, Wireless Isolation, guest isolation, and
   VLAN settings; and
5. a temporary Ethernet connection/USB-to-Ethernet adapter if diagnosis is
   needed.

---

## 5. Copy the files

Choose stable folders on the gym laptop. This guide uses the following example:

```text
C:\RenewalDeskBridge
C:\RenewalDeskMockApi
C:\eSSL-SDK\x64
```

Copy the **whole contents** of each source directory — not just the `.exe`:

| Source on developer computer | Gym laptop destination |
| --- | --- |
| `RenewalDeskBridge\bin\Debug\net48\*` | `C:\RenewalDeskBridge\` |
| `MockApi\bin\Debug\net8.0\*` | `C:\RenewalDeskMockApi\` |
| supplied eSSL SDK `...\SDK\x64\*` | `C:\eSSL-SDK\x64\` |

The bridge folder must include at least:

```text
RenewalDeskBridge.exe
RenewalDeskBridge.exe.config
appsettings.json
Interop.zkemkeeper.dll
Newtonsoft.Json.dll
System.Data.SQLite.dll
x64\SQLite.Interop.dll
```

After first use, keep these two bridge-created files with the executable:

```text
outbox.db         # queued attendance when internet is unavailable
access_state.db   # original member schedules needed to restore access safely
```

When replacing the bridge with a newer build, close the bridge first and keep
the client's existing `appsettings.json`, `outbox.db`, and `access_state.db`.
Copy the updated program DLLs/EXE around them.

Use an authorised file-transfer method such as AnyDesk file transfer, approved
cloud storage, or an approved USB drive. Do not send Wi-Fi credentials or API
keys over an unapproved public channel.

---

## 6. Register the eSSL SDK (one time)

The SDK must be registered on **every computer that runs the bridge**.
Registration on the developer computer does not apply to the gym laptop.

1. Open **Command Prompt as Administrator**.
2. Verify the copied DLL exists:

   ```bat
   dir C:\eSSL-SDK\x64\zkemkeeper.dll
   ```

3. Run the vendor script:

   ```bat
   cd /d C:\eSSL-SDK\x64
   "Register_SDK x64.bat"
   ```

4. The script should copy its x64 dependencies and register `zkemkeeper.dll`.
   Do not dismiss a RegSvr32 module-load error as success.

Optional verification:

```bat
reg query "HKLM\SOFTWARE\Classes\TypeLib\{FE9DED34-E159-408E-8490-B720A5E632C7}" /s
```

Expected output includes `ZKEMKeeper 6.0 Control` and a `win64` path pointing
to `C:\Windows\System32\zkemkeeper.dll`.

---

## 7. Install/check the Mock API runtime

The Mock API is a .NET 8 ASP.NET Core application. On the gym laptop, run:

```bat
dotnet --list-runtimes
```

It must list:

```text
Microsoft.AspNetCore.App 8.x.x
```

If it is missing, install the official **.NET 8 ASP.NET Core Runtime (x64)**,
then run the command again. The .NET SDK is not required just to run the
already-built Mock API.

---

## 8. Configure and start the software

### 8.1 Configure the bridge

Edit the `appsettings.json` beside `RenewalDeskBridge.exe`. For local mock
testing, use this shape:

```json
{
  "DeviceIp": "DEVICE_IP_FROM_TERMINAL_SCREEN",
  "DevicePort": 4370,
  "DeviceCommPassword": "",
  "MachineNumber": 1,
  "GymId": "test-gym-1",
  "ApiBaseUrl": "http://localhost:5080",
  "ApiKey": "dev-test-key",
  "HeartbeatIntervalSeconds": 60,
  "CommandPollIntervalSeconds": 10,
  "RetryFlushIntervalSeconds": 30,
  "MembershipDenyTimeZoneId": 50,
  "MembershipPolicyDeviceSerial": "",
  "MembershipAccessPolicyPrepared": false,
  "MembershipAccessPolicyPhysicallyVerified": false
}
```

Replace only `DEVICE_IP_FROM_TERMINAL_SCREEN` with the current terminal IP. If
the device uses a Comm Password, enter its known value; never guess it.

The bridge also saves the connection fields when **Connect** is clicked.

### 8.2 Start the Mock API

Open Command Prompt and run:

```bat
cd /d C:\RenewalDeskMockApi
dotnet RenewalDeskMockApi.dll
```

Expected output includes:

```text
Mock Renewal Desk API running at http://localhost:5080
```

Leave that terminal open. In the laptop browser, open:

```text
http://localhost:5080
```

### 8.3 Start and connect the bridge

Run:

```text
C:\RenewalDeskBridge\RenewalDeskBridge.exe
```

Confirm the device IP, port `4370`, Gym ID, and API URL. Click **Connect**.

Expected result:

- `Device: Connected` in green;
- `Renewal Desk: Connected` in green after a heartbeat; and
- an `Expiry policy: NOT PREPARED` message initially.

---

## 9. Commission membership expiry safely

This section is required exactly once for a terminal/bridge installation, and
again if the device is replaced or the reserved time-zone is changed.

### 9.1 Repair old test users first

Earlier development builds used the terminal's generic account availability
flag. If you previously clicked an old **Set DISABLED** button for User `1` or
another test user, use the new bridge:

1. enter that numeric Enroll Number;
2. click **Restore membership access**; and
3. wait for the log to say legacy account availability was set to enabled.

Do not use User `1` as the physical-door test member. It may be an
administrator and is not representative of normal member access.

### 9.2 Confirm the relay is really controlled by the terminal

Before changing a schedule:

1. place someone at the door;
2. click **Test Unlock Door**; and
3. confirm whether the physical lock releases.

If the lock does not respond, stop. This may mean the actual door is wired to a
separate controller, the device is not controlling the lock, or its access
control settings are not active. A membership rule cannot be proven by bridge
software in that state.

### 9.3 Reserve an unused terminal time-zone

1. Ask the gym owner/installer which slot from `2` through `50` is unused by
   all users and groups. `50` is only a suggestion; the bridge cannot safely
   infer that it is free.
2. Never select slot `1`.
3. Enter the chosen number in **Reserved deny TZ**.
4. Click **Prepare deny TZ**.
5. Read the confirmation dialog carefully and click **Yes** only after the
   owner has confirmed the slot is unused.

The bridge first saves the current global time-zone definition in
`access_state.db`, then writes the all-day deny definition and reads it back.
The status changes to:

```text
Expiry policy: TZ #NN prepared — physical door test required.
```

This does not yet permit automatic `disable_user` commands.

### 9.4 Test one safe member at the physical door

1. Choose a normal, non-admin, already enrolled member. Confirm their normal
   fingerprint currently opens the correct door.
2. Enter their exact numeric device **Enroll Number**. Do not use their
   Renewal Desk UUID, phone number, or a leading-zero form such as `008`.
3. Click **Expire / test access** and approve the warning.
4. Confirm the bridge log says the time-zone write was **read-back confirmed**.
5. Have the member scan at the physical door.

Expected test result: the terminal may recognise the fingerprint or create an
attendance event, but the door must stay locked.

#### If the door stays locked

1. Click **Mark physical test passed** and confirm only after seeing the real
   lock stay closed.
2. Click **Restore membership access** for the same member.
3. Confirm the log says the original access schedule was restored and read back.
4. Have the member scan again. Their normal access must return.

The status becomes:

```text
Expiry policy: TZ #NN PHYSICALLY VERIFIED — automatic expiry enabled.
```

#### If the door still opens

1. Do **not** click **Mark physical test passed**.
2. Click **Restore membership access** for the safe test member if the bridge
   has a saved backup; keep the bridge open until the restore is read back.
3. Stop automatic membership testing.
4. Ask the installer to inspect the terminal's Access Control settings,
   especially **Normal Open (NO) Time Period**, door mode, and lock/relay
   wiring. A normally-open configuration or an external controller can override
   individual terminal time zones.

A successful `SCAN:` entry is not evidence of a successful rejection; it only
shows that the terminal recognised a fingerprint or delivered a buffered event.

---

## 10. Test automatic Renewal Desk commands

Do this only after section 9 shows **PHYSICALLY VERIFIED**.

1. Open `http://localhost:5080` in the gym laptop browser.
2. Use the same safe member and queue a `disable_user` command.
3. Do not click the manual expiry button.
4. Wait one command-poll interval (normally about 10 seconds).
5. Confirm the bridge log says the command succeeded and reports the member's
   deny schedule read-back.
6. Have the person scan at the door. The door must remain locked.
7. Queue an `enable_user` command for the same Enroll Number.
8. Wait for the bridge log to report that the exact saved schedule was restored.
9. Have the person scan again. Normal access must return.

The mock console should print an acknowledgement for every command. If an
automatic expiry command is rejected before physical verification, that is the
intended safety behaviour.

---

## 11. Production safeguards

Before pointing the bridge at the real Renewal Desk backend:

1. retain `access_state.db` with normal backups; it contains the original
   schedules required to restore expired members;
2. keep the reserved deny time-zone unchanged on the terminal;
3. give the terminal a documented static IP or DHCP reservation;
4. prevent the laptop from sleeping and keep it connected to the gym LAN;
5. ensure each backend command includes the exact terminal Enroll Number;
6. retain a support process for device replacement, manual terminal edits, and
   user/group access-policy changes; and
7. test one safe member again after firmware, lock wiring, or access-control
   configuration changes.

If the bridge reports that an expired user's time-zone was changed directly at
the terminal, it intentionally refuses to overwrite that newer value on
renewal. Resolve that conflict before granting access; never make the bridge
guess a group or time zone.

---

## 12. Troubleshooting

### `TcpTestSucceeded : False`

This is a network problem, not an SDK-registration problem.

- Recheck the current device IP on the terminal screen and port `4370`.
- Check the Ethernet cable and switch/router path.
- Confirm main Wi-Fi rather than guest Wi-Fi.
- Ask the network owner about client/AP isolation and VLANs.
- Use a temporary Ethernet cable or USB-to-Ethernet adapter for diagnosis if
  needed.

### `Class not registered`, `zkemkeeper`, or `CZKEMClass` error

The SDK was not registered correctly on this laptop.

1. Confirm the x64 `zkemkeeper.dll` exists in the copied SDK folder.
2. Rerun `Register_SDK x64.bat` from an elevated Command Prompt.
3. Check any RegSvr32 error instead of dismissing it.
4. Use the registry query in section 6.

### Mock API will not start

- Run `dotnet --list-runtimes` and verify `Microsoft.AspNetCore.App 8.x`.
- Keep `.dll`, `.deps.json`, and `.runtimeconfig.json` together.
- Make sure another program is not already using port `5080`.

### Bridge connects but expiry button fails

- Use the exact numeric terminal Enroll Number.
- Check the log's device error code.
- Confirm the expiry policy was prepared for this exact device serial.
- Confirm its status is PHYSICALLY VERIFIED for automatic commands.
- Do not delete `access_state.db` or copy a different gym's access-state file.

### User is on the deny schedule but restore refuses

The bridge has no original schedule backup on this laptop. It refuses to guess
which group/time-zone rules to restore. Recover `access_state.db` from the
original bridge laptop/backup or restore the exact setting through the terminal
with the gym owner.

### Read-back says denied, but the door opens

Stop automatic expiry tests. This proves the terminal data changed but the
physical installation is not enforcing that member-level rule. Check:

- terminal Access Control Role / user time-period settings;
- active **Normal Open (NO)** time periods;
- whether the tested door uses the terminal relay or a separate controller;
- lock wiring, relay configuration, and fail-safe/fail-secure hardware; and
- whether the person is entering through a different door/controller.

Do not mark the physical test as passed and do not tell the gym owner that
expiry enforcement is live until the lock behaviour is physically proven.
