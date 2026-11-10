// Direct-ADMS integration actions (token rotate + serial-fallback toggle).
//
// Endpoints verified against the backend (app/mobile_api/rrr.py) and the
// PWA screen that already uses them (renewal-desk-pwa/src/screens/
// rrr-integrations.js):
//   POST /api/mobile/v1/rrr/integrations/:id/adms/rotate-token
//     — rrr.py:302 rotate_adms_token; body {}. Returns fresh
//     terminal_settings + the new token exactly once; the old token keeps
//     working for the grace window (default 7 days).
//   POST /api/mobile/v1/rrr/integrations/:id/adms/serial-fallback
//     — rrr.py:353 set_adms_serial_fallback; body { enabled: boolean }.
//     Returns the updated integration payload.
// The .exe download on the PWA is N/A on mobile and is deliberately not
// ported. The probe / Grp=100/1 test-enroll step already exists in
// RrrGrowthScreen (queue/sendTestCommand) — it is not re-added here.
//
// RN-free on purpose: the request function is injected so node:test can
// assert the exact method/path/body without a network or a RN runtime.
import type { ApiResult } from './apiClient';

export type AdmsRequest = <T>(
  path: string,
  options?: { method?: 'POST'; body?: Record<string, unknown> },
) => Promise<ApiResult<T>>;

export type AdmsTerminalSettings = {
  server_address?: string;
  server_port?: number;
  https?: boolean;
  path?: string;
  warning?: string;
};

export type RotateTokenResult = {
  integration: { id: number };
  terminal_settings: AdmsTerminalSettings;
  token: string;
  token_version?: number;
  previous_token_grace_until?: string | null;
  warning?: string;
};

export type SerialFallbackResult = {
  integration: { id: number; allow_serial_fallback: boolean };
};

export function rotateAdmsTokenUrl(integrationId: number): string {
  return `/api/mobile/v1/rrr/integrations/${integrationId}/adms/rotate-token`;
}

export function serialFallbackUrl(integrationId: number): string {
  return `/api/mobile/v1/rrr/integrations/${integrationId}/adms/serial-fallback`;
}

// ---------------------------------------------------------------------------
// G1 — Terminal replace / decommission (v11 product gap).
//
// Backend contract (coordinator state gaps-g1-g5):
//   POST /api/mobile/v1/rrr/integrations/:id/replace
//     { device_serial, device_name, confirm: true } (owner-only)
//     — decommissions the old terminal, provisions the new serial with a
//     fresh token, resets commissioning so the supervised physical test
//     must pass again before commands enable. Never replace with a
//     serial owned by another gym (existing 409 — surfaced verbatim).
//   POST /api/mobile/v1/rrr/integrations/:id/decommission
//     { confirm: true } (owner-only)
// ---------------------------------------------------------------------------

export function replaceTerminalUrl(integrationId: number): string {
  return `/api/mobile/v1/rrr/integrations/${integrationId}/replace`;
}

export function decommissionTerminalUrl(integrationId: number): string {
  return `/api/mobile/v1/rrr/integrations/${integrationId}/decommission`;
}

export type ReplaceTerminalResult = {
  integration: { id: number; status?: string };
  terminal_settings?: AdmsTerminalSettings;
};

export type DecommissionTerminalResult = {
  integration?: { id: number; status?: string };
  message?: string;
};

/** Replace the terminal: old one decommissioned, new serial provisioned. */
export async function replaceTerminal(
  request: AdmsRequest,
  integrationId: number,
  input: { device_serial: string; device_name: string },
): Promise<ApiResult<ReplaceTerminalResult>> {
  return request<ReplaceTerminalResult>(replaceTerminalUrl(integrationId), {
    method: 'POST',
    body: {
      device_serial: input.device_serial,
      device_name: input.device_name,
      confirm: true,
    },
  });
}

/** Decommission the terminal (owner-only, confirm-gated). */
export async function decommissionTerminal(
  request: AdmsRequest,
  integrationId: number,
): Promise<ApiResult<DecommissionTerminalResult>> {
  return request<DecommissionTerminalResult>(decommissionTerminalUrl(integrationId), {
    method: 'POST',
    body: { confirm: true },
  });
}

// ---------------------------------------------------------------------------
// G4 — Fingerprint restore (v11 product gap).
//
// Backend contract (coordinator state gaps-g1-g5):
//   POST /api/mobile/v1/rrr/integrations/:id/restore-fingerprints
//     (owner-only) → queues restore commands for members with stored
//     templates. Restore ONLY when the stored template's enroll resolves
//     to the same member (canonical PIN + member match at queue time AND
//     serve time); never restore onto a recycled enroll held by a
//     different member. Never render template data — the response
//     carries only a queued count.
// ---------------------------------------------------------------------------

export function restoreFingerprintsUrl(integrationId: number): string {
  return `/api/mobile/v1/rrr/integrations/${integrationId}/restore-fingerprints`;
}

export type RestoreFingerprintsResult = {
  integration?: { id: number };
  queued_count?: number;
  /** Tolerated aliases — the contract names the queued count; the UI
   * reads whichever field the backend sends. */
  count?: number;
  restored_count?: number;
};

/** The queued count to show the owner, from whichever field is present. */
export function restoreQueuedCount(data: RestoreFingerprintsResult): number {
  return data.queued_count ?? data.count ?? data.restored_count ?? 0;
}

/** Queue fingerprint restores for members with stored templates. */
export async function restoreFingerprints(
  request: AdmsRequest,
  integrationId: number,
): Promise<ApiResult<RestoreFingerprintsResult>> {
  return request<RestoreFingerprintsResult>(restoreFingerprintsUrl(integrationId), {
    method: 'POST',
    body: {},
  });
}

/** Rotate the ADMS path token. The new token is returned exactly once. */
export async function rotateAdmsToken(
  request: AdmsRequest,
  integrationId: number,
): Promise<ApiResult<RotateTokenResult>> {
  return request<RotateTokenResult>(rotateAdmsTokenUrl(integrationId), {
    method: 'POST',
    body: {},
  });
}

/** Enable/disable bare-serial ADMS login for one terminal. */
export async function setAdmsSerialFallback(
  request: AdmsRequest,
  integrationId: number,
  enabled: boolean,
): Promise<ApiResult<SerialFallbackResult>> {
  return request<SerialFallbackResult>(serialFallbackUrl(integrationId), {
    method: 'POST',
    body: { enabled },
  });
}
