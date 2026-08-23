import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlatformHealth, PlatformRequestError } from '../services/platformHealth';

test('parses the actual Renewal Desk health response shape defensively', () => {
  assert.deepEqual(
    parsePlatformHealth({
      db: 'ok',
      revision: 'abc123',
      schema: 'ok',
      status: 'ok',
    }),
    {
      database: 'ok',
      revision: 'abc123',
      schema: 'ok',
      status: 'ok',
    },
  );
});

test('does not treat an unknown backend health status as healthy', () => {
  assert.deepEqual(parsePlatformHealth({ db: 'degraded', status: 'starting' }), {
    database: 'unavailable',
    schema: 'unknown',
    status: 'unavailable',
  });
});

test('rejects invalid health payloads', () => {
  assert.throws(() => parsePlatformHealth(null), PlatformRequestError);
  assert.throws(() => parsePlatformHealth(['ok']), PlatformRequestError);
});
