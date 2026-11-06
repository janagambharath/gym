import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rotateAdmsToken,
  rotateAdmsTokenUrl,
  serialFallbackUrl,
  setAdmsSerialFallback,
  type AdmsRequest,
} from '../services/admsIntegration';
import { resolveBlockToggle } from '../services/memberAccess';

// ---------------------------------------------------------------------------
// GAP 4 — RRR integrations: token rotate + serial-fallback toggle call the
// exact backend endpoints the PWA uses (verified in app/mobile_api/rrr.py:
// rotate-token at :302, serial-fallback at :353).
// ---------------------------------------------------------------------------

function fakeRequest(calls: { path: string; options?: unknown }[]): AdmsRequest {
  return (async (path, options) => {
    calls.push({ path, options });
    return { ok: true, data: {} };
  }) as AdmsRequest;
}

test('rotate token posts an empty body to the PWA rotate-token endpoint', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  const result = await rotateAdmsToken(fakeRequest(calls), 42);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/rrr/integrations/42/adms/rotate-token');
  assert.deepEqual(calls[0].options, { method: 'POST', body: {} });
});

test('rotate-token URL builder matches the backend route', () => {
  assert.equal(
    rotateAdmsTokenUrl(7),
    '/api/mobile/v1/rrr/integrations/7/adms/rotate-token',
  );
});

test('serial-fallback toggle posts { enabled: true } to the backend endpoint', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  const result = await setAdmsSerialFallback(fakeRequest(calls), 42, true);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/rrr/integrations/42/adms/serial-fallback');
  assert.deepEqual(calls[0].options, { method: 'POST', body: { enabled: true } });
});

test('serial-fallback toggle posts { enabled: false } when turning serial login off', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  await setAdmsSerialFallback(fakeRequest(calls), 42, false);
  assert.deepEqual(calls[0].options, { method: 'POST', body: { enabled: false } });
});

test('serial-fallback URL builder matches the backend route', () => {
  assert.equal(
    serialFallbackUrl(7),
    '/api/mobile/v1/rrr/integrations/7/adms/serial-fallback',
  );
});

// ---------------------------------------------------------------------------
// GAP 9 (V6-M8/M9) — block toggle label/action. PWA parity: the toggle is
// rendered for every enrolled member, including an active member with
// accessBlocked === false, so the resolver must yield a Block action there
// (previously the toggle never rendered in that state, and a failed block
// showed retry text with no retry button).
// ---------------------------------------------------------------------------

test('active member, not blocked: toggle offers Block', () => {
  assert.deepEqual(
    resolveBlockToggle({ accessBlocked: false, doorAccessFailed: false, doorAccessFailedAction: null }),
    { label: 'Block Access', action: 'block', isRetry: false },
  );
});

test('blocked member: toggle offers Unblock', () => {
  assert.deepEqual(
    resolveBlockToggle({ accessBlocked: true, doorAccessFailed: false, doorAccessFailedAction: null }),
    { label: 'Unblock Access', action: 'unblock', isRetry: false },
  );
});

test('failed block: toggle retries Block, not the stale blocked flag', () => {
  assert.deepEqual(
    resolveBlockToggle({ accessBlocked: false, doorAccessFailed: true, doorAccessFailedAction: 'block' }),
    { label: 'Retry Block', action: 'block', isRetry: true },
  );
});

test('failed unblock: toggle retries Unblock', () => {
  assert.deepEqual(
    resolveBlockToggle({ accessBlocked: true, doorAccessFailed: true, doorAccessFailedAction: 'unblock' }),
    { label: 'Retry Unblock', action: 'unblock', isRetry: true },
  );
});

test('failed flag with no failed action falls back to the blocked flag', () => {
  assert.deepEqual(
    resolveBlockToggle({ accessBlocked: false, doorAccessFailed: true, doorAccessFailedAction: null }),
    { label: 'Block Access', action: 'block', isRetry: false },
  );
});
