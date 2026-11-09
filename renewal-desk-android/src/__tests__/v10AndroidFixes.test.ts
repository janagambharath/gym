import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupRetrySkips,
  retrySkippedSummary,
  retrySkipLabel,
  type RetrySkip,
} from '../services/retrySkipReasons';
import {
  configureDisplayPreferences,
  getEffectiveTimezone,
  getInvalidStoredTimezone,
} from '../types';

// V10-M6 — Retry All keeps the backend's skip breakdown instead of
// discarding it into a 3.5 s banner, with explicit plurals per reason.

test('V10-M6: groupRetrySkips groups by reason, preserving first-seen order', () => {
  const skipped: RetrySkip[] = [
    { command_id: 1, reason: 'test_action' },
    { command_id: 2, reason: 'unlock_door' },
    { command_id: 3, reason: 'test_action' },
  ];
  assert.deepEqual(groupRetrySkips(skipped), [
    { reason: 'test_action', count: 2, label: 'test command', plural: 'test commands' },
    { reason: 'unlock_door', count: 1, label: 'door unlock', plural: 'door unlocks' },
  ]);
});

test('V10-M6: retrySkippedSummary uses explicit plurals (never the PWA naive +s)', () => {
  // The PWA's naive `label + 's'` garbled exactly these three
  // (V10-L14): "2 commands disableds", "2 terminal never connecteds",
  // "2 could not re-queues".
  const skipped: RetrySkip[] = [
    { command_id: 1, reason: 'commands_disabled' },
    { command_id: 2, reason: 'commands_disabled' },
    { command_id: 3, reason: 'terminal_never_polled' },
    { command_id: 4, reason: 'terminal_never_polled' },
    { command_id: 5, reason: 'requeue_failed' },
    { command_id: 6, reason: 'requeue_failed' },
    { command_id: 7, reason: 'test_action' },
  ];
  assert.equal(
    retrySkippedSummary(skipped),
    '2 commands disabled, 2 terminals never connected, 2 could not re-queue, 1 test command',
  );
});

test('V10-M6: new V10-L8 skip reasons have the task-specified labels', () => {
  assert.deepEqual(retrySkipLabel('no_terminal_identity'), {
    label: 'No terminal identity',
    plural: 'No terminal identities',
  });
  assert.deepEqual(retrySkipLabel('not_enableable'), {
    label: 'Member not eligible',
    plural: 'Members not eligible',
  });
  assert.equal(
    retrySkippedSummary([
      { command_id: 1, reason: 'no_terminal_identity' },
      { command_id: 2, reason: 'no_terminal_identity' },
      { command_id: 3, reason: 'not_enableable' },
    ]),
    '2 No terminal identities, 1 Member not eligible',
  );
});

test('V10-M6: unknown reasons fall back to other command; empty list is empty', () => {
  assert.deepEqual(retrySkipLabel('something_new'), {
    label: 'other command',
    plural: 'other commands',
  });
  assert.equal(retrySkippedSummary([]), '');
  assert.equal(retrySkippedSummary(undefined), '');
  assert.deepEqual(groupRetrySkips(null), []);
});

// V10-L34 — invalid stored gym timezone is remembered (not just
// console-warned) and the effective zone falls back to Asia/Kolkata
// explicitly, mirroring the PWA V9-L12.

test('V10-L34: invalid stored timezone is remembered with Asia/Kolkata effective', () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'india' });
  assert.equal(getInvalidStoredTimezone(), 'india');
  assert.equal(getEffectiveTimezone(), 'Asia/Kolkata');
});

test('V10-L34: a valid stored timezone clears the invalid marker', () => {
  configureDisplayPreferences({ country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' });
  assert.equal(getInvalidStoredTimezone(), null);
  assert.equal(getEffectiveTimezone(), 'Asia/Dubai');
  // Leave the shared display preferences in the default state for any
  // test that runs after this file in the same process.
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  assert.equal(getInvalidStoredTimezone(), null);
  assert.equal(getEffectiveTimezone(), 'Asia/Kolkata');
});
