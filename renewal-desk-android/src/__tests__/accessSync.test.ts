import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearFailedSyncs,
  clearFailedSyncsWithConfirm,
  reconcileMembers,
  type AccessSyncRequest,
  type AccessSyncResult,
} from '../services/accessSync';

type Call = { path: string; method: string };

function mockRequest(
  calls: Call[],
  result: AccessSyncResult<{ queued_count: number; cleared_count: number; message: string }>,
): AccessSyncRequest {
  return (async <T>(path: string, options: { method: 'POST' }) => {
    calls.push({ path, method: options.method });
    return result as unknown as AccessSyncResult<T>;
  }) as AccessSyncRequest;
}

test('reconcileMembers POSTs to /api/mobile/v1/access/reconcile', async () => {
  const calls: Call[] = [];
  const res = await reconcileMembers(
    mockRequest(calls, {
      ok: true,
      data: { queued_count: 12, cleared_count: 0, message: 'Re-sync queued for 12 enrolled member(s).' },
    }),
  );
  assert.deepEqual(calls, [{ path: '/api/mobile/v1/access/reconcile', method: 'POST' }]);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.message, 'Re-sync queued for 12 enrolled member(s).');
});

test('clearFailedSyncs POSTs to /api/mobile/v1/access/clear-failed', async () => {
  const calls: Call[] = [];
  const res = await clearFailedSyncs(
    mockRequest(calls, {
      ok: true,
      data: { queued_count: 0, cleared_count: 3, message: 'Cleared 3 failed command(s).' },
    }),
  );
  assert.deepEqual(calls, [{ path: '/api/mobile/v1/access/clear-failed', method: 'POST' }]);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.cleared_count, 3);
});

test('clearFailedSyncsWithConfirm does NOT touch the backend when the operator cancels', async () => {
  const calls: Call[] = [];
  const res = await clearFailedSyncsWithConfirm({
    confirm: async () => false,
    request: mockRequest(calls, {
      ok: true,
      data: { queued_count: 0, cleared_count: 0, message: 'Cleared 0 failed command(s).' },
    }),
  });
  assert.equal(res, null);
  assert.deepEqual(calls, []);
});

test('clearFailedSyncsWithConfirm calls clear-failed only after the operator confirms', async () => {
  const calls: Call[] = [];
  const res = await clearFailedSyncsWithConfirm({
    confirm: async () => true,
    request: mockRequest(calls, {
      ok: true,
      data: { queued_count: 0, cleared_count: 2, message: 'Cleared 2 failed command(s).' },
    }),
  });
  assert.deepEqual(calls, [{ path: '/api/mobile/v1/access/clear-failed', method: 'POST' }]);
  assert.equal(res?.ok, true);
  if (res?.ok) assert.equal(res.data.cleared_count, 2);
});
