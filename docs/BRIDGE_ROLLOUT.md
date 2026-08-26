# Bridge Rollout & Graduation Strategy

## 1. Multi-Stage Gated Rollout
Bridge packages progress through a strict promotion gate before reaching general production availability:

```
[UPLOAD] ──> [TESTING CHANNEL] ──> [BENCH ACCEPTANCE GATE] ──> [STABLE CHANNEL] ──> [CONTROLLED UPGRADE]
```

### Stage 1: Upload to Testing Channel
- Newly uploaded packages default to `release_channel="testing"`.
- Available only for designated staging gyms and internal test instances.

### Stage 2: Hardware Acceptance Gate
Before any release can be promoted from `TESTING` to `STABLE`, it must pass all 17 hardware verification criteria:
1. Clean Windows background service startup
2. One-time pairing code redemption
3. Automatic reconnect following network drops
4. Heartbeat transmission & server clock sync
5. Hardware terminal discovery
6. Biometric device connection (ZKTeco/eSSL via TCP port 4370)
7. Member sync: `CREATE_USER` command execution
8. Member sync: `UPDATE_USER` command execution
9. Member sync: `ENABLE_USER` command execution
10. Member sync: `DISABLE_USER` command execution
11. Attendance event polling and deduplication
12. Retry backoff on terminal unreachable
13. Offline turnstile event buffering & flush
14. Credential revocation enforcement
15. Service restart & PC reboot resilience
16. PC replacement re-pairing workflow
17. Real biometric scan execution on physical terminal

### Stage 3: Promotion to Stable
- Super admin executes channel switch to `STABLE`.
- Package becomes the new `is_current_stable=True` target for gym upgrades.

### Stage 4: Controlled Production Upgrade
- Existing gyms show "Update Available".
- Upgrades are applied only via explicit super-admin approval—never automated.
