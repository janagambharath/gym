# Renewal Desk Bridge: Complete Gym Laptop Setup and Test Guide

This guide is for the Windows computer that will run at the gym. It explains
how to prepare the laptop, connect it to the eSSL X990+ID device, and prove the
important membership-access behaviour on real hardware.

> **Goal:** when a Renewal Desk membership expires, its enrolled fingerprint
> must be rejected at the door. When the membership becomes active again, that
> same fingerprint must be accepted.

This is a developer/test procedure. It is not an installer guide or a final
handover document for the gym owner.

---

## Table of contents

1. [How the bridge works](#1-how-the-bridge-works)
2. [Who does what](#2-who-does-what)
3. [Before starting](#3-before-starting)
4. [Network preflight](#4-network-preflight-mandatory)
5. [Files to copy to the gym laptop](#5-files-to-copy-to-the-gym-laptop)
6. [Install the eSSL SDK](#6-install-the-essl-sdk-one-time)
7. [Check the mock API runtime](#7-check-the-mock-api-runtime)
8. [Configure the bridge](#8-configure-the-bridge)
9. [Start the mock API and bridge](#9-start-the-mock-api-and-bridge)
10. [Run the six real-hardware checks](#10-run-the-six-real-hardware-checks)
11. [Troubleshooting](#11-troubleshooting)
12. [After the test phase](#12-after-the-test-phase)

---

## 1. How the bridge works

```text
Renewal Desk cloud
        |
        | membership command: enable_user / disable_user
        v
RenewalDeskBridge on a Windows PC at the gym
        |
        | direct eSSL SDK connection: device IP + TCP port 4370
        v
eSSL X990+ID biometric device
        |
        v
Physical door lock and fingerprint access
```

The bridge is deliberately local because the biometric device is on the gym's
LAN. The gym laptop must be able to reach the device directly over TCP port
`4370`.

### Do not use the device's Cloud Server / ADMS screen

The device may show **Cloud Server Setting**, **ADMS**, a server address, and
port `8081`. Those settings are not used by this project. Do not place the
laptop IP, `localhost`, or a Renewal Desk URL into that screen.

This bridge uses the device's **Ethernet IP** and **TCP COMM Port 4370** through
the supplied eSSL SDK. The included Mock API is not an ADMS server.

---

## 2. Who does what

| Person | Responsibility |
| --- | --- |
| Developer / Renewal Desk team | Installs the bridge, configures it, runs the test commands, and watches the logs. |
| Gym owner / staff | Provides a suitable Windows computer, administrator approval, device IP/Comm Password, and a safe test member. |
| Person at the door | Physically confirms door unlocks and whether the test fingerprint is accepted or rejected. |
| Network owner / technician | Helps only if the gym laptop cannot reach the biometric device. |

The gym owner does not need to learn the software. They do need to approve the
one-time administrator setup and physically verify the access result.

---

## 3. Before starting

### 3.1 Choose the gym laptop

Use a Windows 10 or Windows 11 **64-bit** computer that:

- stays at the gym and can remain powered on;
- has a stable connection to the gym network;
- can reach the biometric device's network;
- has an administrator available for one-time SDK registration;
- has enough disk space for the bridge, SDK, and local `outbox.db` queue;
- does not go to sleep during testing or normal operation.

The bridge targets .NET Framework 4.8, which Windows 10/11 normally includes.
**Do not install Visual Studio on the gym laptop.**

### 3.2 Have these details ready

Before touching the bridge, obtain:

- device Ethernet IP address (from the device: `Menu -> COMM. -> Ethernet`);
- device TCP COMM Port (normally `4370`);
- device Comm Password / Comm Key, only if one was configured;
- one safe, already fingerprint-enrolled **test Enroll Number**;
- a staff member who can stand at the door during the test;
- permission to temporarily disable and re-enable that safe test user.

Use a non-critical test member. Do not perform the first disable test on a
busy gym member or a staff member who needs access during the test.

### 3.3 Important IP rule

The laptop and device need addresses in the same network range, but they must
have **different** IP addresses.

Example:

```text
Laptop:  192.168.1.4
Device:  192.168.1.201
Mask:    255.255.255.0
```

Never give both the laptop and device the same address. Never change the
device's address just to match the laptop exactly.

---

## 4. Network preflight (mandatory)

Do this before launching the bridge. A successful build does not help if the
gym laptop cannot reach the biometric device.

### 4.1 Record the device's current address

On the biometric device, open:

```text
Menu -> COMM. -> Ethernet
```

Record the displayed IP and TCP COMM Port. If DHCP is enabled, the device IP
may change after a router restart, so use the value currently shown on screen.

Do not change the Cloud Server / ADMS settings.

### 4.2 Inspect the gym laptop network

On the gym laptop, open Command Prompt and run:

```bat
ipconfig
```

Note the active Wi-Fi or Ethernet adapter IPv4 address, subnet mask, and
gateway.

Wi-Fi for the laptop and Ethernet for the device can work together if both are
bridged by the same router/switch. Guest Wi-Fi, a separate VLAN, or AP/client
isolation can block device access even if the numbers look similar.

### 4.3 Test the actual device port

Replace `DEVICE_IP` with the IP currently shown on the biometric device:

```bat
powershell -Command "Test-NetConnection -ComputerName DEVICE_IP -Port 4370 | Select-Object ComputerName,RemotePort,TcpTestSucceeded"
```

Example:

```bat
powershell -Command "Test-NetConnection -ComputerName 192.168.0.101 -Port 4370 | Select-Object ComputerName,RemotePort,TcpTestSucceeded"
```

Expected result:

```text
ComputerName  RemotePort TcpTestSucceeded
------------  ---------- ----------------
192.168.x.x        4370             True
```

Only continue if `TcpTestSucceeded` is `True`.

### 4.4 If the port test is false

Stop here. Do not try unlock, enable, disable, or attendance tests.

Check these items with the gym/network owner:

1. The device's Ethernet cable is firmly connected at both ends.
2. The device cable goes to a LAN port on the correct router/switch, not to a
   WAN/Internet port or an unrelated router.
3. The laptop is on the main gym network, not guest Wi-Fi.
4. The router does not have **AP Isolation**, **Client Isolation**, **Wireless
   Isolation**, or guest isolation blocking Wi-Fi-to-LAN traffic.
5. If the laptop has no Ethernet socket, use a USB-to-Ethernet adapter and a
   temporary LAN cable to a spare port on the same switch/router as the device.

Do not repeatedly change the biometric device IP while the network path is
unknown. The test must succeed before software troubleshooting can begin.

---

## 5. Files to copy to the gym laptop

Create these folders on the gym laptop:

```text
C:\RenewalDeskBridge
C:\RenewalDeskMockApi
C:\eSSL-SDK\x64
```

Copy the **entire contents** of each source folder, including every DLL and
subfolder. Do not copy only the `.exe` file.

| Source on developer computer | Destination on gym laptop |
| --- | --- |
| `RenewalDeskBridge\bin\Debug\net48\*` | `C:\RenewalDeskBridge\` |
| `MockApi\bin\Debug\net8.0\*` | `C:\RenewalDeskMockApi\` |
| `Communication Protocol SDK...\SDK\x64\*` | `C:\eSSL-SDK\x64\` |

The bridge folder must contain, at minimum:

```text
RenewalDeskBridge.exe
RenewalDeskBridge.exe.config
appsettings.json
Interop.zkemkeeper.dll
Newtonsoft.Json.dll
System.Data.SQLite.dll
x64\SQLite.Interop.dll
```

The `appsettings.json` file must be next to `RenewalDeskBridge.exe`; it holds
the device and API settings. The bridge creates `outbox.db` next to the EXE
when it needs to queue attendance offline.

### File-transfer options

Use a method approved by the client, such as:

- AnyDesk file transfer;
- an approved cloud-storage link; or
- a USB drive used by authorised gym staff.

Do not send client credentials, Wi-Fi passwords, or API keys through an
unapproved public channel.

---

## 6. Install the eSSL SDK (one time)

The SDK registration must happen on **every computer that runs the bridge**.
Registering it on the developer's laptop does not register it on the gym
laptop.

### 6.1 Verify the copied SDK files

Open Command Prompt and run:

```bat
dir C:\eSSL-SDK\x64\zkemkeeper.dll
```

If it says the file cannot be found, the SDK was not copied to the expected
folder. Correct that before continuing.

### 6.2 Run the vendor registration script as administrator

1. Open **Command Prompt as Administrator**.
2. Run:

   ```bat
   cd /d C:\eSSL-SDK\x64
   "Register_SDK x64.bat"
   ```

3. The vendor batch should copy its x64 dependency DLLs and register
   `zkemkeeper.dll`.
4. If a RegSvr32 dialog appears, read it before clicking OK. A successful
   registration must not show a module-load error.

The vendor script copies SDK DLLs into `C:\Windows\System32`. Run it only with
the gym owner's permission and only from the supplied x64 eSSL SDK folder.

### 6.3 Optional registration verification

In a normal Command Prompt, run:

```bat
reg query "HKLM\SOFTWARE\Classes\TypeLib\{FE9DED34-E159-408E-8490-B720A5E632C7}" /s
```

A successful registration reports **ZKEMKeeper 6.0 Control** and points to
`C:\Windows\System32\zkemkeeper.dll`.

The already-built bridge includes the generated interop DLL. Do not add a COM
reference manually on the gym laptop and do not install Visual Studio for this
test procedure.

---

## 7. Check the Mock API runtime

The Mock API is a .NET 8 ASP.NET Core application. On the gym laptop, run:

```bat
dotnet --list-runtimes
```

Look for:

```text
Microsoft.AspNetCore.App 8.x.x
```

If it is missing, install the official **.NET 8 ASP.NET Core Runtime (x64)**,
then rerun the command. The .NET SDK also works, but it is not required merely
to run the already-built Mock API.

---

## 8. Configure the bridge

Edit this file on the gym laptop:

```text
C:\RenewalDeskBridge\appsettings.json
```

For the local test phase, use this shape:

```json
{
  "DeviceIp": "DEVICE_IP_FROM_DEVICE_SCREEN",
  "DevicePort": 4370,
  "DeviceCommPassword": "",
  "MachineNumber": 1,
  "GymId": "test-gym-1",
  "ApiBaseUrl": "http://localhost:5080",
  "ApiKey": "dev-test-key",
  "HeartbeatIntervalSeconds": 60,
  "CommandPollIntervalSeconds": 10,
  "RetryFlushIntervalSeconds": 30
}
```

Replace only `DEVICE_IP_FROM_DEVICE_SCREEN` with the actual current device IP.

If the biometric device has a Comm Password/Comm Key, enter it in
`DeviceCommPassword`. Otherwise, leave it empty. Do not invent or guess a
password.

The bridge window also lets you edit these fields. Clicking **Connect** saves
the displayed values back into `appsettings.json`.

---

## 9. Start the Mock API and bridge

### 9.1 Start the Mock API first

Open a Command Prompt and run:

```bat
cd /d C:\RenewalDeskMockApi
dotnet RenewalDeskMockApi.dll
```

Expected output includes:

```text
Mock Renewal Desk API running at http://localhost:5080
```

Keep that window open. In a browser on the gym laptop, open:

```text
http://localhost:5080
```

The page is a developer-only test panel for queuing commands.

### 9.2 Start the bridge

Run:

```text
C:\RenewalDeskBridge\RenewalDeskBridge.exe
```

Confirm the bridge window shows:

- Device IP: the current device address;
- Port: `4370`;
- Gym ID: `test-gym-1`;
- API URL: `http://localhost:5080`.

Click **Connect**.

If the device does not connect, capture the exact device error code from the
bridge log. Do not call the test complete based only on a green Mock API label.

---

## 10. Run the six real-hardware checks

### Safety rules

- Perform tests when someone is physically beside the door.
- Use a non-critical, already-enrolled test user.
- Tell the person at the door before any unlock/disable action.
- Stop at the first failure; do not proceed to later checks.
- A button click or `true` response is not proof. Physical behaviour is the
  source of truth for unlock and enable/disable.

### Check 1: Device connection

1. In the bridge, click **Connect**.
2. Confirm the status changes to **Device: Connected** in green.
3. Record any device error code if it fails.

**Pass condition:** green device connection status.

### Check 2: Mock API connection

1. Leave the Mock API console running.
2. Wait for a heartbeat from the bridge.
3. Confirm **Renewal Desk: Connected** turns green in the bridge.
4. Confirm a `[heartbeat]` line appears in the Mock API console.

**Pass condition:** bridge and Mock API both show successful heartbeat traffic.

### Check 3: Physical door unlock

1. Tell the person at the door you are about to test the lock.
2. In the bridge, click **Test Unlock Door**.
3. Have them confirm that the physical lock clicked open.

**Pass condition:** the door/lock physically unlocks. A success message alone
does not pass this check.

### Check 4: Membership-style enable/disable

1. Enter the test user's **device Enroll Number** in the bridge.
2. Click **Set DISABLED**.
3. Confirm the log says **device read-back confirmed** before scanning. A green
   button result by itself is not proof.
4. Have the person scan the test fingerprint.
5. Confirm the device rejects it and the door remains locked.
6. Click **Set ENABLED**.
7. Confirm the log says **device read-back confirmed**, then have the person
   scan again.
8. Confirm the device accepts the fingerprint and access works normally.

**Pass condition:** physically rejected when disabled and physically accepted
when enabled. This is the most important check.

### Check 5: Attendance event

1. With the user enabled, have them scan their fingerprint.
2. Confirm a `SCAN:` line appears in the bridge log.
3. Confirm an `[attendance]` line appears in the Mock API console.

**Pass condition:** both logs show the same scan reaching the Mock API.

### Check 6: Automatic command queue

1. Open `http://localhost:5080` on the gym laptop.
2. Queue a `disable_user` command for the same test Enroll Number.
3. Do not click a manual disable button in the bridge.
4. Wait for the command poll interval (normally about 10 seconds).
5. Confirm the bridge log reports that it processed the command.
6. Have the person at the door scan the fingerprint.
7. Confirm it is physically rejected.

**Pass condition:** the automatic cloud-style command reaches the device and
causes the physical access result without a manual bridge action.

After Check 6, queue or click **Set ENABLED** again so the safe test member is
not accidentally left disabled.

---

## 11. Troubleshooting

### `TcpTestSucceeded : False`

This is a network problem. The bridge cannot solve it in code.

- Confirm the current device IP from the device screen.
- Confirm port `4370`.
- Check both ends of the device Ethernet cable.
- Verify the laptop is on the main gym network, not a guest network.
- Check router AP/client isolation settings with the network owner.
- Use a temporary Ethernet cable/USB-to-Ethernet adapter if necessary.

### Device is on DHCP and its address changed

Update `DeviceIp` in `appsettings.json` or the bridge UI to match the device
screen, then reconnect. For a permanent deployment, the network owner should
use a DHCP reservation or a documented static IP, rather than relying on a
changing address.

### `Class not registered`, `zkemkeeper`, or `CZKEMClass` error

The SDK registration on the **gym laptop** is missing or failed.

1. Confirm `C:\eSSL-SDK\x64\zkemkeeper.dll` exists.
2. Rerun `Register_SDK x64.bat` as Administrator.
3. Check the RegSvr32 result rather than dismissing an error dialog.
4. Verify the registry command from section 6.3.

### Mock API will not start

- Run `dotnet --list-runtimes` and verify `Microsoft.AspNetCore.App 8.x`.
- Check that `RenewalDeskMockApi.dll`, `.deps.json`, and `.runtimeconfig.json`
  were copied together.
- If port 5080 is already used, stop the other local program before retrying.

### Bridge connects but user update fails

- Confirm the Enroll Number is exactly the device user ID, not a Renewal Desk
  UUID or a phone number unless it is actually the device ID.
- Use an already-enrolled fingerprint user for the first test.
- Check the Comm Password/Comm Key if one is configured on the device.
- Record the bridge log/error and do not assume the physical access state
  changed.

### Device changes work manually but not through the mock queue

- Confirm the Mock API is still running at `http://localhost:5080`.
- Confirm the bridge uses the same `GymId` as the mock test panel (`test-gym-1`).
- Wait at least one command poll interval (normally 10 seconds).
- Check bridge and Mock API console logs for the command and acknowledgement.

---

## 12. After the test phase

Do not hand the bridge to the gym owner as a finished production system until
all six hardware checks pass.

After that separate decision, the next work is:

1. Replace the local Mock API with the real Renewal Desk backend implementing
   the same bridge endpoints.
2. Give each gym a stable device IP or DHCP reservation.
3. Provide a supported deployment package/installer.
4. Decide whether the bridge should become a managed background service.
5. Establish support, monitoring, backup, and credential-rotation procedures.

Until then, this document remains a controlled development/test runbook.
