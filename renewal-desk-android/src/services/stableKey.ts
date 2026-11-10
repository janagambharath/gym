// Stable per-action idempotency keys (V11-L32).
//
// Pure module, free of react-native imports on purpose: the screens
// cannot be imported under node, so the key-reuse / key-release rules
// live here where the `tsx --test` harness can exercise them directly.
//
// The bug it fixes: check-in, send-reminder, freeze/unfreeze and photo
// upload each minted a fresh key per apiRequest call (or per upload),
// so a timeout-retry after the server already committed re-executed
// the mutation — a second attendance punch, a second WhatsApp, a
// second stored photo. The fix mirrors the existing StaffScreen /
// AddMember pattern: one key per (action, target), held in a ref,
// reused across retries, released after success or a definitive 4xx
// (a 5xx / network failure keeps the key, so the retry replays
// instead of executing twice).

import { newIdempotencyKey } from './idempotencyKey';

/** One held key, scoped to a single action + target. */
export type StableKeySlot = { scope: string; key: string } | undefined;

/**
 * Return the key to send for this action, plus the slot to store back
 * in the ref. Same scope → reuse the held key (a retry replays);
 * different scope (a new action) → mint a fresh key.
 */
export function keyForAction(
  current: StableKeySlot,
  scope: string,
): { key: string; slot: { scope: string; key: string } } {
  if (current && current.scope === scope) {
    return { key: current.key, slot: current };
  }
  const key = newIdempotencyKey();
  return { key, slot: { scope, key } };
}

/**
 * Short deterministic hash of free text, for scoping a stable key to
 * the exact content of an action (V12-D5). Two different messages
 * must NOT share a key: a retry after an edit must execute the new
 * text, not replay the old one.
 */
export function scopeHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Stable-key scope for a WhatsApp broadcast (V12-D5): one key per
 * (audience, message text), held across retries, released after
 * success or a definitive 4xx via shouldReleaseKey. A re-send of the
 * same text to the same audience replays; an edited message mints a
 * fresh key.
 */
export function broadcastScope(audience: string, message: string): string {
  return `broadcast:${audience}:${scopeHash(message.trim())}`;
}

/**
 * True when the held key must be released after an attempt: success,
 * or a definitive client error (4xx — the server rejected this exact
 * request, so retrying it under the same key would replay the
 * rejection). A 5xx / network failure (no status) keeps the key so a
 * later retry replays the original attempt instead of executing twice.
 */
export function shouldReleaseKey(ok: boolean, status?: number): boolean {
  if (ok) return true;
  return typeof status === 'number' && status < 500;
}
