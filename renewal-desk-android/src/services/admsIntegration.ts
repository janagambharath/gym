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
