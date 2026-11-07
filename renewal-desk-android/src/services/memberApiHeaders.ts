/**
 * Member-side request headers — pure helpers, free of react-native /
 * expo imports so the idempotency-key rule can be covered by node tests.
 *
 * V8-L32: the member client built its headers without an
 * Idempotency-Key on any mutation, unlike the owner client
 * (apiClient.ts generates one fresh key per non-GET apiRequest call via
 * newIdempotencyKey and re-sends the SAME key on the 401-refresh retry).
 * The key is generated once per memberApiRequest call and handed here;
 * the builder only places it — so a retry after the server already
 * committed replays instead of executing twice, once the backend
 * honours the key.
 *
 * BACKEND STATUS (verified 2026-11-07 against app/mobile_api/member_api.py):
 * NONE of the three member mutations honours Idempotency-Key today —
 * the file contains no `Idempotency-Key` / `begin_idempotency` /
 * `find_replay` reference at all (idempotency lives only in the owner
 * blueprints: members.py, payments.py, campaigns.py, etc.). Sending
 * the key is harmless (the backend ignores the unknown header) and
 * future-proofs the client, but until the backend adds support the key
 * provides NO replay protection on these endpoints — the live guards
 * remain the server-side ones: claim returns `already_pending` when a
 * pending/processing payment exists, verify-otp is bounded by the
 * per-challenge guess budget, and a second delete 401s because the
 * refresh families are already revoked. Do not claim replay safety for
 * member mutations until a backend change lands.
 */

import { newIdempotencyKey } from './idempotencyKey';

/** One fresh key per member mutation, or undefined for reads. */
export function memberMutationIdempotencyKey(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
): string | undefined {
  return method === 'GET' ? undefined : newIdempotencyKey();
}

export function buildMemberRequestHeaders(args: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  hasBody: boolean;
  idempotencyKey?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (args.hasBody) headers['Content-Type'] = 'application/json';
  // GETs never carry a key; mutations carry the key generated once per
  // memberApiRequest call (reused across the 401-refresh retry).
  if (args.method !== 'GET' && args.idempotencyKey) {
    headers['Idempotency-Key'] = args.idempotencyKey;
  }
  if (args.token) headers.Authorization = `Bearer ${args.token}`;
  return headers;
}
