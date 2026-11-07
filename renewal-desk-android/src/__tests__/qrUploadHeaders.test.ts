import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQrUploadHeaders } from '../services/qrUploadHeaders';

// V9-L16: uploadPaymentQrImage sent no Idempotency-Key, and the
// 401-refresh retry re-POSTed the same FormData keyless. The backend
// honours the key for QR uploads since v8 — one fresh key per upload,
// re-sent unchanged on retry.

test('attaches the Idempotency-Key alongside Accept and Authorization', () => {
  assert.deepEqual(
    buildQrUploadHeaders({ token: 'tok-1', idempotencyKey: 'key-1' }),
    {
      Accept: 'application/json',
      'Idempotency-Key': 'key-1',
      Authorization: 'Bearer tok-1',
    },
  );
});

test('same key on retry builds identical headers (replay, not re-execute)', () => {
  const first = buildQrUploadHeaders({ token: 'tok-1', idempotencyKey: 'key-1' });
  const retry = buildQrUploadHeaders({ token: 'tok-2', idempotencyKey: 'key-1' });
  assert.equal(retry['Idempotency-Key'], first['Idempotency-Key']);
});

test('no key → no Idempotency-Key header (never sends an empty key)', () => {
  const headers = buildQrUploadHeaders({ token: 'tok-1' });
  assert.equal('Idempotency-Key' in headers, false);
});

test('no token → no Authorization header', () => {
  const headers = buildQrUploadHeaders({ idempotencyKey: 'key-1' });
  assert.equal('Authorization' in headers, false);
  assert.equal(headers['Idempotency-Key'], 'key-1');
});
