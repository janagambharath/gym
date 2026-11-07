import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRefreshError } from '../services/memberDetailRefresh';

// V7-L14: the MemberDetail 30 s poll fired four legs and only the biometric
// leg set an error on failure — a failed member/renewal/payment leg left
// stale values on screen with no signal. The screen now surfaces the first
// non-401 leg failure as a "couldn't refresh" note with retry.

const ok = { ok: true } as const;

test('clean poll clears the staleness note', () => {
  assert.equal(
    resolveRefreshError({ member: ok, renewals: ok, payments: ok }),
    undefined,
  );
});

test('failed member leg surfaces its message', () => {
  assert.equal(
    resolveRefreshError({
      member: { ok: false, status: 500, message: 'Server error' },
      renewals: ok,
      payments: ok,
    }),
    'Server error',
  );
});

test('failed renewals leg surfaces its message when the member leg is fine', () => {
  assert.equal(
    resolveRefreshError({
      member: ok,
      renewals: { ok: false, status: 503, message: 'Could not reach the server. Check your connection.' },
      payments: ok,
    }),
    'Could not reach the server. Check your connection.',
  );
});

test('failed payments leg surfaces its message', () => {
  assert.equal(
    resolveRefreshError({
      member: ok,
      renewals: ok,
      payments: { ok: false, status: 0, message: 'Network request failed' },
    }),
    'Network request failed',
  );
});

test('first failing leg wins, in member → renewals → payments order', () => {
  assert.equal(
    resolveRefreshError({
      member: { ok: false, status: 500, message: 'member failed' },
      renewals: { ok: false, status: 500, message: 'renewals failed' },
      payments: { ok: false, status: 500, message: 'payments failed' },
    }),
    'member failed',
  );
});

test('a 401 is not a staleness signal — the session handler logs out instead', () => {
  assert.equal(
    resolveRefreshError({
      member: { ok: false, status: 401, message: 'Unauthorized' },
      renewals: ok,
      payments: ok,
    }),
    undefined,
  );
  assert.equal(
    resolveRefreshError({
      member: ok,
      renewals: { ok: false, status: 401, message: 'Unauthorized' },
      payments: { ok: false, status: 500, message: 'payments failed' },
    }),
    'payments failed',
  );
});

test('a failure with no message falls back to a generic note', () => {
  assert.equal(
    resolveRefreshError({
      member: ok,
      renewals: ok,
      payments: { ok: false, status: 500 },
    }),
    'Could not refresh member details.',
  );
});
