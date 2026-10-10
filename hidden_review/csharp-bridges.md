# C# Bridges Review (subagent, 2026-10-10) — 5,251 lines
## 1. HIGH — eBioServer block/unblock acked on SOAP queue, not device delivery — FAIL-OPEN (Program.cs:388-400, EBioServerClient.cs:152-201)
## 2. HIGH — Attendance watermark drops punches when LogIds not globally monotonic (Program.cs:229-242)
## 3. HIGH — RenewalDeskBridge API key + comm password in plaintext appsettings.json, rewritten on every save (BridgeConfig.cs:100-104, BridgeForm.cs:104-125)
## 4. HIGH — No terminal reconnect; _isConnected goes stale (DeviceConnection.cs:36, BridgeForm.cs:137-168)
## 5. HIGH — No sleep/wake handling (zero PowerModeChanged refs)
## 6. MEDIUM-HIGH — COM calls marshal to STA UI thread; hung terminal freezes app (DeviceConnection.cs:33, BridgeForm.cs:697-716)
## 7. MEDIUM — Single-threaded loop, no ReadWriteTimeout, 5-min stalls (EBioServerClient.cs:407-430)
## 8. MEDIUM — Console.ReadKey() on config errors hangs headless VM forever (Program.cs:43,51)
## 9. MEDIUM — HttpClient leak per reconnect (BridgeForm.cs:229)
## 10. MEDIUM — Corrupt outbox.db/access_state.db → bridge won't start (LocalOutbox.cs:26-32, AccessStateStore.cs:17-23)
Honorable: no command-receipt store (crash→duplicate exec), DPAPI CurrentUser footgun, IsConnected() Contains(">1<"), XXE (XmlResolver null missing), no lease-token check in eBioServerBridge, hardcoded versions, delete_user destructive no backup, manual update story wipes risk, MockApi head-of-line blocking.
Access-control core (MembershipAccessService) verified careful: backup-before-write, read-back, fail-closed.
