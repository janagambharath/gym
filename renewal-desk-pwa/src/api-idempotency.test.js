import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from './api.js';

// Idempotency-Key auto-attach: every mutation carries a fresh key
// unless the caller supplied its own; GETs never carry one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function installFetchStub(capture) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capture.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    };
  };
  return () => { globalThis.fetch = original; };
}

test('apiRequest attaches a fresh uuid Idempotency-Key to POST mutations', async () => {
  const capture = [];
  const restore = installFetchStub(capture);
  try {
    const res = await apiRequest('/api/mobile/v1/payments/1/verify', { method: 'POST' });
    assert.equal(res.ok, true);
    assert.equal(capture.length, 1);
    const key = capture[0].options.headers['Idempotency-Key'];
    assert.match(key, UUID_RE);
  } finally { restore(); }
});

test('apiRequest sends a different key per call', async () => {
  const capture = [];
  const restore = installFetchStub(capture);
  try {
    await apiRequest('/api/mobile/v1/rrr/mappings/bulk-resolve', { method: 'POST', body: { mappings: [] } });
    await apiRequest('/api/mobile/v1/rrr/mappings/bulk-resolve', { method: 'POST', body: { mappings: [] } });
    assert.equal(capture.length, 2);
    const [first, second] = capture.map((c) => c.options.headers['Idempotency-Key']);
    assert.match(first, UUID_RE);
    assert.match(second, UUID_RE);
    assert.notEqual(first, second);
  } finally { restore(); }
});

test('apiRequest keeps a caller-supplied Idempotency-Key untouched', async () => {
  const capture = [];
  const restore = installFetchStub(capture);
  try {
    await apiRequest('/api/mobile/v1/members', {
      method: 'POST',
      body: { full_name: 'Test' },
      headers: { 'Idempotency-Key': 'stable-per-form-key-001' },
    });
    assert.equal(capture[0].options.headers['Idempotency-Key'], 'stable-per-form-key-001');
  } finally { restore(); }
});

test('apiRequest attaches a key to PATCH/PUT/DELETE and never to GET', async () => {
  const capture = [];
  const restore = installFetchStub(capture);
  try {
    await apiRequest('/api/mobile/v1/members/1', { method: 'PATCH', body: { full_name: 'A' } });
    await apiRequest('/api/mobile/v1/rrr/rules', { method: 'PUT', body: { rules: {} } });
    await apiRequest('/api/mobile/v1/payments/1', { method: 'DELETE' });
    await apiRequest('/api/mobile/v1/members', { method: 'GET' });
    assert.equal(capture.length, 4);
    for (const entry of capture.slice(0, 3)) {
      assert.match(entry.options.headers['Idempotency-Key'], UUID_RE);
    }
    assert.equal(capture[3].options.headers['Idempotency-Key'], undefined);
  } finally { restore(); }
});
