import assert from 'node:assert/strict';
import test from 'node:test';
import { hasIdempotencyKeyHeader, newIdempotencyKey } from '../services/idempotencyKey';

test('newIdempotencyKey returns a fresh, unique key per action', () => {
  const keys = new Set(Array.from({ length: 1000 }, () => newIdempotencyKey()));
  assert.equal(keys.size, 1000);
  for (const key of keys) {
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0);
    // Either a UUID v4 (crypto.randomUUID) or the req-<ts>-<random>
    // fallback for runtimes without it.
    assert.match(key, /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|req-\d+-[a-z0-9]+)$/);
  }
});

test('hasIdempotencyKeyHeader detects an explicit key case-insensitively', () => {
  assert.equal(hasIdempotencyKeyHeader(undefined), false);
  assert.equal(hasIdempotencyKeyHeader({}), false);
  assert.equal(hasIdempotencyKeyHeader({ 'Idempotency-Key': 'abc' }), true);
  assert.equal(hasIdempotencyKeyHeader({ 'idempotency-key': 'abc' }), true);
  assert.equal(hasIdempotencyKeyHeader({ 'Content-Type': 'application/json' }), false);
});
