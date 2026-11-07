import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuickAssignBody, resolveAccessRowTap } from '../services/accessRowTap';

// V9-L25: Android Live Access feed rows were not tappable at all;
// tap-to-assign was PWA-only. Named rows open the member, Unknown rows
// open the assign flow, rows with neither do nothing.

test('named row → open the member with its id, name and status', () => {
  assert.deepEqual(
    resolveAccessRowTap({
      member_id: 42,
      member_name: 'Arun Kumar',
      membership_status: 'active',
      biometric_user_id: '15',
      device_enroll_number: '15',
    }),
    {
      kind: 'member',
      member: { id: 42, full_name: 'Arun Kumar', status: 'active' },
    },
  );
});

test('named row wins over the terminal ID when both are present', () => {
  const tap = resolveAccessRowTap({
    member_id: 7,
    member_name: null,
    membership_status: null,
    biometric_user_id: '99',
    device_enroll_number: '99',
  });
  assert.equal(tap.kind, 'member');
  if (tap.kind === 'member') assert.equal(tap.member.full_name, 'Unknown Member');
});

test('unknown row with biometric_user_id → assign flow for that ID', () => {
  assert.deepEqual(
    resolveAccessRowTap({
      member_id: null,
      member_name: null,
      membership_status: null,
      biometric_user_id: '2061',
      device_enroll_number: '2061',
    }),
    { kind: 'assign', bioId: '2061' },
  );
});

test('unknown row falls back to device_enroll_number when no biometric id', () => {
  assert.deepEqual(
    resolveAccessRowTap({
      member_id: null,
      member_name: null,
      membership_status: null,
      device_enroll_number: '144',
    }),
    { kind: 'assign', bioId: '144' },
  );
});

test('row with no member and no terminal ID → nothing to open', () => {
  assert.deepEqual(
    resolveAccessRowTap({
      member_id: null,
      member_name: null,
      membership_status: null,
      device_enroll_number: '',
    }),
    { kind: 'none' },
  );
});

test('quick-assign body links one terminal ID to one member (bulk-resolve shape)', () => {
  assert.deepEqual(buildQuickAssignBody('2061', 42), {
    mappings: [{ external_id: '2061', member_id: 42 }],
  });
});
