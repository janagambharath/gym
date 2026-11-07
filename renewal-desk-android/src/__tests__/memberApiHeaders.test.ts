import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemberRequestHeaders,
  memberMutationIdempotencyKey,
} from '../services/memberApiHeaders';

// V8-L32: the member-side client sent no Idempotency-Key on any mutation,
// unlike the owner client. Mutations now carry one fresh key per
// memberApiRequest call (reused across the 401-refresh retry).
//
// Backend status (verified 2026-11-07): no member endpoint honours the
// key yet (app/mobile_api/member_api.py has no Idempotency-Key /
// begin_idempotency reference), so these tests prove the client sends
// the key — not that the server replays on it.

test('GET mutations never get a key', () => {
  assert.equal(memberMutationIdempotencyKey('GET'), undefined);
});

test('POST, PUT and DELETE each get a fresh, unique key', () => {
  const keys = new Set([
    memberMutationIdempotencyKey('POST'),
    memberMutationIdempotencyKey('PUT'),
    memberMutationIdempotencyKey('DELETE'),
    memberMutationIdempotencyKey('POST'),
  ]);
  assert.equal(keys.size, 4);
  for (const key of keys) {
    assert.equal(typeof key, 'string');
    assert.ok((key as string).length > 0);
  }
});

test('mutation headers carry the supplied key', () => {
  const headers = buildMemberRequestHeaders({
    method: 'POST',
    token: 'tok',
    hasBody: true,
    idempotencyKey: 'key-123',
  });
  assert.equal(headers['Idempotency-Key'], 'key-123');
  assert.equal(headers.Authorization, 'Bearer tok');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('GET headers never carry a key even if one is supplied', () => {
  const headers = buildMemberRequestHeaders({
    method: 'GET',
    hasBody: false,
    idempotencyKey: 'key-123',
  });
  assert.equal('Idempotency-Key' in headers, false);
});

test('a mutation without a key sends no header (caller generates it)', () => {
  const headers = buildMemberRequestHeaders({ method: 'DELETE', hasBody: false });
  assert.equal('Idempotency-Key' in headers, false);
});

test('anonymous requests carry no Authorization header', () => {
  const headers = buildMemberRequestHeaders({
    method: 'POST',
    hasBody: true,
    idempotencyKey: 'key-123',
  });
  assert.equal('Authorization' in headers, false);
  assert.equal(headers['Idempotency-Key'], 'key-123');
});
