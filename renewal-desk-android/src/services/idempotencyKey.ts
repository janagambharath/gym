// Idempotency keys for mutating mobile API requests.
//
// Dependency-free on purpose: the apiRequest client cannot be imported
// under node (its chain pulls in react-native), so the key generator
// lives here where the `tsx --test` harness can exercise it directly.
// apiClient.ts imports this and attaches one fresh key per mutation.

/** Fresh idempotency key for one new action. */
export function newIdempotencyKey(): string {
  // Call randomUUID as a method of crypto: extracting it first loses
  // its `this` binding (ERR_INVALID_THIS under node).
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Hermes / older runtimes without crypto.randomUUID.
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** True when the caller already supplied an Idempotency-Key header. */
export function hasIdempotencyKeyHeader(
  headers?: Record<string, string>,
): boolean {
  return Object.keys(headers ?? {}).some(
    (name) => name.toLowerCase() === 'idempotency-key',
  );
}
