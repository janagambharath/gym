import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSettingsLoadView } from '../services/settingsLoadGate';

// V9-M8 / V9-M9: a settings GET failure used to render the form with
// blank defaults, and Save then wiped the stored values (email/phone/
// address → null, timezone forced to Asia/Kolkata, UPI ID cleared).
// The form must not exist until the GET has succeeded.

test('initial load → loading view (no editable form)', () => {
  assert.equal(
    resolveSettingsLoadView({ loading: true, loaded: false }),
    'loading',
  );
});

test('failed load, never loaded → error view (no form, no Save)', () => {
  assert.equal(
    resolveSettingsLoadView({
      loading: false,
      loaded: false,
      loadError: 'Could not reach the server. Check your connection.',
    }),
    'error',
  );
});

test('failed load still in flight (retry) → loading, not error', () => {
  assert.equal(
    resolveSettingsLoadView({ loading: true, loaded: false, loadError: 'stale' }),
    'loading',
  );
});

test('successful load → form view', () => {
  assert.equal(
    resolveSettingsLoadView({ loading: false, loaded: true }),
    'form',
  );
});

test('loaded stays form even if a later refresh fails', () => {
  assert.equal(
    resolveSettingsLoadView({
      loading: false,
      loaded: true,
      loadError: 'Could not reach the server.',
    }),
    'form',
  );
});
