# Bridge Software & Protocol Versioning

## 1. Version Semantics
Renewal Desk separates **Bridge Software Version** (the release build of the client binary) from **Bridge Protocol Version** (the wire format over HTTP).

- **Bridge Software Version (`version`)**: Standard SemVer (`1.0.0`, `2.0.0`, `2.1.0`).
- **Bridge Build Number (`build_number`)**: Monotonically increasing build integer (`100`, `2001`, `2002`).
- **Bridge Protocol Version (`bridge_protocol_version`)**: Protocol integer (`2`).

## 2. Telemetry & Heartbeat Metadata
Bridge V2 sends optional client metadata during periodic heartbeats (`POST /api/bridge/v1/heartbeat`):
```json
{
  "gymId": "bridge_7d8e9f...",
  "status": "online",
  "version": "2.0.0",
  "buildNumber": 2001,
  "osInfo": "Windows 11 x64 (Build 22631)",
  "pcName": "RECEPTION-DESK-01"
}
```

## 3. Backward Compatibility
- **V1 Clients**: When a V1 client sends a standard heartbeat without `version` or `pcName`, the backend processes the request normally without raising errors or altering installed records.
- **Protocol 2 Guarantees**: Header `X-RenewalDesk-Bridge-Protocol: 2` is honored across all V1 and V2 clients.
