import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureDisplayPreferences,
  dedupeByKey,
  formatTime,
  formatDateTime,
  gymLocalInputToIso,
  toGymLocalInput,
} from './utils.js';

// V5-M11 / V6-L32: paginated appends dedupe by id.
test('dedupeByKey keeps the first occurrence and drops later duplicates', () => {
  const rows = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'a-dup' }, { id: 3, n: 'c' }, { id: 2, n: 'b-dup' }];
  const out = dedupeByKey(rows, (r) => r.id);
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
  assert.equal(out[0].n, 'a');
});

test('dedupeByKey tolerates null/undefined input and key-less rows', () => {
  assert.deepEqual(dedupeByKey(null, (r) => r.id), []);
  const rows = [{ punch_time: 't1', direction: 'entry' }, { punch_time: 't1', direction: 'entry' }];
  assert.equal(dedupeByKey(rows, (p) => `${p.punch_time}|${p.direction}`).length, 1);
});

// V5-L24 / V5-L25: times render in the gym timezone, not the device's.
test('formatTime and formatDateTime use the configured gym timezone', () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  // 12:00 UTC == 17:30 IST.
  assert.match(formatTime('2026-11-06T12:00:00Z'), /5:30/);
  const dt = formatDateTime('2026-11-06T12:00:00Z');
  assert.match(dt, /6 Nov 2026/);
  assert.match(dt, /5:30/);
});

// V6-L29: a datetime-local wall time is read as gym-local, not device-local.
test('gymLocalInputToIso interprets wall time in the gym timezone', () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  // 18:30 IST == 13:00 UTC.
  assert.equal(gymLocalInputToIso('2026-10-09T18:30'), '2026-10-09T13:00:00.000Z');
  assert.equal(gymLocalInputToIso('2026-10-09T18:30:45'), '2026-10-09T13:00:45.000Z');
  assert.equal(gymLocalInputToIso(''), null);
  assert.equal(gymLocalInputToIso(null), null);
  assert.equal(gymLocalInputToIso('not a date'), null);
  assert.equal(gymLocalInputToIso('2026-13-09T18:30'), null);
});

test('gymLocalInputToIso follows the gym timezone when it changes', () => {
  configureDisplayPreferences({ country: 'US', currency: 'USD', timezone: 'America/New_York' });
  // 18:30 EDT (UTC-4) == 22:30 UTC.
  assert.equal(gymLocalInputToIso('2026-10-09T18:30'), '2026-10-09T22:30:00.000Z');
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
});

test('toGymLocalInput formats a Date as gym-local wall time', () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  assert.equal(toGymLocalInput(new Date('2026-10-09T13:00:00.000Z')), '2026-10-09T18:30');
  // Round-trip with gymLocalInputToIso.
  const iso = gymLocalInputToIso(toGymLocalInput(new Date('2026-10-09T13:00:00.000Z')));
  assert.equal(iso, '2026-10-09T13:00:00.000Z');
});
