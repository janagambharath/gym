import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelQueuedAdmsCommand,
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

// V10-L33: cancel one queued Direct ADMS command (owner-only endpoint).
test('cancelQueuedAdmsCommand POSTs to /api/mobile/v1/access/adms-commands/<id>/cancel', async () => {
  const calls: Call[] = [];
  const res = await cancelQueuedAdmsCommand(
    mockRequest(calls, {
      ok: true,
      data: { command_id: 42, action: 'unlock_door', status: 'cancelled', message: 'Queued Direct ADMS command cancelled.' },
    } as unknown as AccessSyncResult<{ queued_count: number; cleared_count: number; message: string }>),
    42,
  );
  assert.deepEqual(calls, [{ path: '/api/mobile/v1/access/adms-commands/42/cancel', method: 'POST' }]);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.command_id, 42);
});
