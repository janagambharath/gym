import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRrrGrowthLoadError } from '../services/rrrGrowthLoad';

// V8-M14: a failed RrrGrowthScreen load rendered as an empty gym
// (0 Members · 0% Attendance · ₹0 pipeline) with the Direct Cloud card
// in "SET UP" state — indistinguishable from "no terminal configured".
// The dashboard and integrations legs are the critical ones: their
// failure must surface as a load error instead of zeros.

test('both critical legs ok → no load error', () => {
  assert.equal(
    resolveRrrGrowthLoadError({ ok: true }, { ok: true }),
    undefined,
  );
});

test('dashboard failure → its message is the load error', () => {
  assert.equal(
    resolveRrrGrowthLoadError(
      { ok: false, error: { message: 'Could not reach the server. Check your connection.' } },
      { ok: true },
    ),
    'Could not reach the server. Check your connection.',
  );
});

test('integrations failure → its message is the load error', () => {
  assert.equal(
    resolveRrrGrowthLoadError(
      { ok: true },
      { ok: false, error: { message: 'Request failed (500).' } },
    ),
    'Request failed (500).',
  );
});

test('dashboard failure wins over integrations failure (headline numbers first)', () => {
  assert.equal(
    resolveRrrGrowthLoadError(
      { ok: false, error: { message: 'dashboard down' } },
      { ok: false, error: { message: 'integrations down' } },
    ),
    'dashboard down',
  );
});

test('a leg that failed without a message still yields a load error, never undefined', () => {
  const error = resolveRrrGrowthLoadError({ ok: false }, { ok: true });
  assert.equal(typeof error, 'string');
  assert.ok((error as string).length > 0);
});
