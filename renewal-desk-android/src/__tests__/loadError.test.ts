import assert from 'node:assert/strict';
import test from 'node:test';
import { firstLoadErrorMessage } from '../services/loadError';

// V9-L17: MemberRenewScreen swallowed both legs' failures and rendered
// "No plans available. Contact your gym for renewal." —
// indistinguishable from a gym with genuinely no plans. The first
// failed leg's message is the load error; the screen shows ErrorState
// + retry instead of the false empty state.

test('both legs ok → no load error', () => {
  assert.equal(
    firstLoadErrorMessage([{ ok: true }, { ok: true }]),
    undefined,
  );
});

test('plans leg fails → its message is the load error', () => {
  assert.equal(
    firstLoadErrorMessage([
      { ok: false, error: 'Could not reach the server. Check your connection.' },
      { ok: true },
    ]),
    'Could not reach the server. Check your connection.',
  );
});

test('payment leg fails → its message is the load error', () => {
  assert.equal(
    firstLoadErrorMessage([
      { ok: true },
      { ok: false, error: 'Request failed (500).' },
    ]),
    'Request failed (500).',
  );
});

test('both legs fail → plans leg wins (it fabricates the empty state)', () => {
  assert.equal(
    firstLoadErrorMessage([
      { ok: false, error: 'Plans failed.' },
      { ok: false, error: 'Payment info failed.' },
    ]),
    'Plans failed.',
  );
});

test('failed leg with no message → no load error surfaced', () => {
  assert.equal(firstLoadErrorMessage([{ ok: false }]), undefined);
});
