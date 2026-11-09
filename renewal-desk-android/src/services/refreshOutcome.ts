// Token-refresh outcome classification (V11-M5).
//
// Pure module, free of react-native imports on purpose: apiClient.ts
// cannot be imported under node, so the "is this refresh failure a real
// expiry or a transient blip?" decision lives here where the `tsx
// --test` harness can exercise it directly.
//
// The bug it fixes: attemptRefresh used to return `undefined` for BOTH
// a definitive 401/403 (refresh token truly dead) AND a transient
// network blip / 5xx (session deliberately kept) — and apiRequest
// collapsed both into `{ message: 'Session expired…', status: 401 }`,
// so ~31 call sites ran onLogout() and destroyed a still-valid session
// on flaky gym Wi-Fi. Callers must only log out on definitive expiry.

/** What a failed refresh means for the local session. */
export type RefreshFailureKind = 'expired' | 'transient';

/**
 * Classify a refresh HTTP status. `null` = the request never reached
 * the server (network error / timeout / non-JSON body). Only a
 * definitive 401/403 means the refresh token is dead; anything else
 * (5xx, unreachable) is transient and the session must be kept.
 */
export function classifyRefreshFailure(status: number | null): RefreshFailureKind {
  return status === 401 || status === 403 ? 'expired' : 'transient';
}

/**
 * The ApiError apiRequest returns when the refresh fails and no retry
 * is possible. The expired case keeps the old 401 shape so every
 * `error.status === 401 → onLogout()` call site still fires; the
 * transient case deliberately carries NO status, so no caller logs the
 * owner out — they surface "could not reach the server" instead.
 */
export function refreshFailureError(kind: RefreshFailureKind): {
  message: string;
  status?: number;
} {
  if (kind === 'expired') {
    return { message: 'Session expired. Please sign in again.', status: 401 };
  }
  return { message: 'Could not reach the server. Check your connection and try again.' };
}
