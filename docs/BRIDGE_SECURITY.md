# Bridge Security & Threat Model

## 1. Zero Direct Database Access
The Windows Bridge runs on gym on-premise hardware outside the cloud perimeter. It operates strictly via **outbound-polling HTTPS requests**. It possesses no direct database connection, no inbound open ports, and no administrative cloud privileges.

## 2. API Key Security & Hashing
- Raw API keys (`rdb_live_...`) are generated with 256 bits of CSPRNG entropy (`secrets.token_urlsafe(32)`).
- Keys are never stored in plaintext on the server. The database stores only the SHA-256 hash (`BridgeInstallation.api_key_hash`).
- Key verification uses constant-time string comparison (`hmac.compare_digest`) to prevent timing side-channel attacks.

## 3. Pairing Code Security
- 6-digit numeric pairing codes are short-lived (10 minutes to 24 hours max).
- Validated with strict rate limiting (`@limiter.limit("20 per minute")`) to prevent brute-force attacks.
- Immediately burned and nullified upon successful exchange.

## 4. Hardware Fingerprinting & Serial Binding
- The biometric terminal serial number (`device_serial`) is sent in the `X-Device-Serial` HTTP header on all polling requests.
- If an API key is copied to a machine attached to a different physical terminal, requests are rejected with `403 device_mismatch`.

## 5. Instant Revocation
- Super-admin revocation invalidates the key hash (`hash_bridge_api_key(...)`) and marks the installation `is_active=False, status='revoked'`.
- All subsequent heartbeats, attendance uploads, and command lease requests immediately return `401 unauthorized`.
