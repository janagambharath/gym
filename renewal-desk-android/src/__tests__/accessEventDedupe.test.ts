import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFeedPage,
  dedupeEvents,
  eventKey,
  sameFeedQuery,
  type FeedQuery,
} from '../services/accessEventDedupe';
import type { AccessEvent } from '../types';

// 2026-11-16 (Bug 2): the Live Access list refilled/duplicated while
// searching because dedupe keyed on member_id (which changes None ->
// member when a punch is linked) instead of the backend's stable
// punch_key. The PWA already dedupes by punch_key (V7-L19).

function makeEvent(overrides: Record<string, unknown> = {}): AccessEvent {
  return {
    id: 1,
    event_type: 'ENTRY',
    direction: 'IN',
    event_timestamp: '2026-11-16T08:17:05+05:30',
    member_id: 103,
    member_name: 'V.Sandeep',
    profile_photo_url: null,
    membership_status: 'active',
    device_name: 'Arun Gym Entry',
    device_enroll_number: '25',
    biometric_user_id: '25',
    punch_key: '25|2026-11-16T08:17:05+05:30|ENTRY|IN',
    is_invalid: false,
    verify_method: 1,
    ...overrides,
  } as AccessEvent;
}

const ALL: FeedQuery = { tab: 'all', search: '' };
const SEARCH_SAN: FeedQuery = { tab: 'all', search: 'san' };

test('eventKey prefers punch_key: same punch, different member_id and id, one key', () => {
  const unlinked = makeEvent({ id: 'adms-5', member_id: null, member_name: null });
  const linked = makeEvent({ id: 42, member_id: 103, member_name: 'V.Sandeep' });
  assert.equal(eventKey(unlinked), eventKey(linked));
  assert.equal(eventKey(unlinked), 'pk:25|2026-11-16T08:17:05+05:30|ENTRY|IN');
});

test('same punch renders once when it links between fetches (member_id null -> member)', () => {
  // The exact 2026-11-16 shape: the RRR leg row ("adms-5", unlinked)
  // and the projected AccessEvent row (int id, linked) are one punch.
  // The old key split them on member_id; punch_key unifies them.
  const unlinked = makeEvent({ id: 'adms-5', member_id: null, member_name: null });
  const linked = makeEvent({ id: 42, member_id: 103, member_name: 'V.Sandeep' });
  const out = dedupeEvents([unlinked, linked]);
  assert.equal(out.length, 1);
  assert.equal(out[0], unlinked); // first occurrence wins
});

test('two distinct punches in the same minute both render (different punch_keys)', () => {
  // V.Sandeep may have punched twice at 8:17 — a real double read.
  // Different full-precision timestamps => different punch_keys => two rows.
  const first = makeEvent({
    id: 11,
    event_timestamp: '2026-11-16T08:17:05+05:30',
    punch_key: '25|2026-11-16T08:17:05+05:30|ENTRY|IN',
  });
  const second = makeEvent({
    id: 12,
    event_timestamp: '2026-11-16T08:17:42+05:30',
    punch_key: '25|2026-11-16T08:17:42+05:30|ENTRY|IN',
  });
  assert.equal(dedupeEvents([first, second]).length, 2);
});

test('ENTRY and EXIT at the same second stay distinct (V4-L24)', () => {
  const entry = makeEvent({ id: 21, event_type: 'ENTRY', direction: 'IN' });
  const exit = makeEvent({
    id: 22,
    event_type: 'EXIT',
    direction: 'OUT',
    punch_key: '25|2026-11-16T08:17:05+05:30|EXIT|OUT',
  });
  assert.equal(dedupeEvents([entry, exit]).length, 2);
});

test('fallback without punch_key collapses exact duplicates (older backend)', () => {
  const a = makeEvent({ id: 31, punch_key: null });
  const b = makeEvent({ id: 31, punch_key: null });
  assert.equal(dedupeEvents([a, b]).length, 1);
});

test('fallback without punch_key still keeps ENTRY and EXIT at the same second distinct', () => {
  const entry = makeEvent({ id: 41, punch_key: null, event_type: 'ENTRY', direction: 'IN' });
  const exit = makeEvent({ id: 42, punch_key: null, event_type: 'EXIT', direction: 'OUT' });
  assert.equal(dedupeEvents([entry, exit]).length, 2);
});

test('sameFeedQuery matches only when tab and search both match', () => {
  assert.equal(sameFeedQuery(ALL, { tab: 'all', search: '' }), true);
  assert.equal(sameFeedQuery(SEARCH_SAN, { tab: 'all', search: 'san' }), true);
  assert.equal(sameFeedQuery(ALL, SEARCH_SAN), false);
  assert.equal(sameFeedQuery(SEARCH_SAN, { tab: 'entry', search: 'san' }), false);
  // Trimming happens when the query is tagged, not in the comparison.
  assert.equal(sameFeedQuery(SEARCH_SAN, { tab: 'all', search: 'san ' }), false);
});

test('search + scroll through two polls: stale append dropped, polls do not grow the list', () => {
  const searchPage1 = [
    makeEvent({ id: 51, punch_key: 'k1', member_name: 'V.Sandeep' }),
    makeEvent({ id: 52, punch_key: 'k2', member_name: 'Sandeep R' }),
  ];
  // An append fetched for the old unfiltered query lands after the
  // search replace: dropped entirely (same reference, no growth).
  const afterStaleAppend = applyFeedPage(
    searchPage1,
    [makeEvent({ id: 53, punch_key: 'k3', member_name: 'M.Ajay' })],
    { append: true, queryAtCall: ALL, currentQuery: SEARCH_SAN },
  );
  assert.equal(afterStaleAppend, searchPage1);
  assert.equal(afterStaleAppend.length, 2);
  // First 15 s poll replace with the same search page: no growth.
  const afterPoll = applyFeedPage(searchPage1, searchPage1, {
    append: false,
    queryAtCall: SEARCH_SAN,
    currentQuery: SEARCH_SAN,
  });
  assert.equal(afterPoll.length, 2);
  // Second poll replace again: still 2 rows, no unfiltered rows mixed in.
  const afterPoll2 = applyFeedPage(afterPoll, searchPage1, {
    append: false,
    queryAtCall: SEARCH_SAN,
    currentQuery: SEARCH_SAN,
  });
  assert.equal(afterPoll2.length, 2);
  assert.deepEqual(
    afterPoll2.map((e) => e.punch_key),
    ['k1', 'k2'],
  );
});

test('append for the current query merges and dedupes (no growth on re-fetch)', () => {
  const page1 = [makeEvent({ id: 61, punch_key: 'k1' })];
  const page2 = [
    makeEvent({ id: 61, punch_key: 'k1' }), // already on page 1
    makeEvent({ id: 62, punch_key: 'k2' }),
  ];
  const merged = applyFeedPage(page1, page2, {
    append: true,
    queryAtCall: ALL,
    currentQuery: ALL,
  });
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((e) => e.punch_key),
    ['k1', 'k2'],
  );
});

test('X-clear returns to unfiltered page 1 exactly once (no search rows left)', () => {
  const searchRows = [makeEvent({ id: 71, punch_key: 'k1', member_name: 'V.Sandeep' })];
  const unfilteredPage1 = [
    makeEvent({ id: 72, punch_key: 'k9', member_name: 'M.Ajay' }),
    makeEvent({ id: 73, punch_key: 'k10', member_name: 'Shivashankar' }),
  ];
  // Clearing settles the search to '' and replaces the list.
  const cleared = applyFeedPage(searchRows, unfilteredPage1, {
    append: false,
    queryAtCall: ALL,
    currentQuery: ALL,
  });
  assert.equal(cleared.length, 2);
  assert.deepEqual(
    cleared.map((e) => e.punch_key),
    ['k9', 'k10'],
  );
  // A late append for the old search query is dropped, not merged in.
  const afterLateSearchAppend = applyFeedPage(cleared, searchRows, {
    append: true,
    queryAtCall: SEARCH_SAN,
    currentQuery: ALL,
  });
  assert.equal(afterLateSearchAppend, cleared);
});

test('replace is not gated on the query tag (sequence guard owns replaces)', () => {
  const oldList = [makeEvent({ id: 81, punch_key: 'k-old' })];
  const fresh = [makeEvent({ id: 82, punch_key: 'k-new' })];
  const out = applyFeedPage(oldList, fresh, {
    append: false,
    queryAtCall: ALL,
    currentQuery: SEARCH_SAN,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].punch_key, 'k-new');
});
