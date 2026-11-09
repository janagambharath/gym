import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessOwnerControls,
  canOpenDateRepair,
  isOwnerRole,
  rrrGrowthOwnerSections,
} from '../services/roleAccess';

// V7-L13: owner-only controls rendered for staff and 403'd with a generic
// "You do not have permission". Backend enforcement was always correct —
// this is dead-button UX only. The screens hide the controls for
// non-owners, mirroring the BulkDeactivate-link pattern.

test('only the gym_owner role counts as owner', () => {
  assert.equal(isOwnerRole('gym_owner'), true);
  assert.equal(isOwnerRole('staff'), false);
  assert.equal(isOwnerRole('gym_staff'), false);
  assert.equal(isOwnerRole(undefined), false);
  assert.equal(isOwnerRole(null), false);
  assert.equal(isOwnerRole(''), false);
});

test('staff sees no owner-only Access controls (Clear-failed, Unlock Gate, Retry All)', () => {
  assert.deepEqual(accessOwnerControls(false), {
    showClearFailed: false,
    showRemoteUnlock: false,
    showRetryAll: false,
  });
});

test('owner sees both Access controls', () => {
  assert.deepEqual(accessOwnerControls(true), {
    showClearFailed: true,
    showRemoteUnlock: true,
    showRetryAll: true,
  });
});

test('staff sees no owner-only RRR Growth sections', () => {
  assert.deepEqual(rrrGrowthOwnerSections(false), {
    showTerminalSetup: false,
    showCommissioningConsole: false,
    showBridgeControls: false,
    showThresholds: false,
  });
});

test('owner sees every RRR Growth section', () => {
  assert.deepEqual(rrrGrowthOwnerSections(true), {
    showTerminalSetup: true,
    showCommissioningConsole: true,
    showBridgeControls: true,
    showThresholds: true,
  });
});

// V8-L31: Date Repair is owner-only on the backend (scan/apply/confirm
// all 403 staff) — the Settings menu item and the Edit Member link must
// not render for staff. The Edit Member link already sat inside the
// owner-only membership block; the gate is explicit so a future move of
// the link cannot silently re-expose it.

test('Date Repair opens for owners only', () => {
  assert.equal(canOpenDateRepair(true), true);
  assert.equal(canOpenDateRepair(false), false);
});
