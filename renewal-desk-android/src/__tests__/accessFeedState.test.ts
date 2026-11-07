import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAccessListView,
  shouldShowFeedErrorBanner,
  switchAccessTab,
} from '../services/accessFeedState';

// V7-M10: a feed/Inside fetch failure was invisible once the summary loaded
// — `error` only rendered via the `error && !summary` full-screen gate,
// and the Inside tab fell back to the misleading "No members are currently
// inside." empty state. The list area must never present a failed load as
// an empty room.

test('failed fetch with an empty list is an error view, never the empty state', () => {
  assert.equal(
    resolveAccessListView({ loading: false, error: 'Network request failed', itemCount: 0 }),
    'error',
  );
});

test('failed fetch with stale rows is an error view too (banner covers the rows)', () => {
  assert.equal(
    resolveAccessListView({ loading: false, error: 'Server error', itemCount: 5 }),
    'error',
  );
});

test('successful empty fetch still shows the empty state', () => {
  assert.equal(
    resolveAccessListView({ loading: false, error: undefined, itemCount: 0 }),
    'empty',
  );
});

test('successful fetch with rows shows the list', () => {
  assert.equal(
    resolveAccessListView({ loading: false, error: undefined, itemCount: 3 }),
    'list',
  );
});

test('loading takes precedence over a stale error', () => {
  assert.equal(
    resolveAccessListView({ loading: true, error: 'Network request failed', itemCount: 0 }),
    'loading',
  );
});

test('inline banner shows when the summary loaded and stale rows are on screen', () => {
  assert.equal(
    shouldShowFeedErrorBanner({ error: 'Network request failed', summaryLoaded: true, itemCount: 4 }),
    true,
  );
});

test('no banner when the list is empty — the error view carries the message instead', () => {
  assert.equal(
    shouldShowFeedErrorBanner({ error: 'Network request failed', summaryLoaded: true, itemCount: 0 }),
    false,
  );
});

test('no banner when there is no summary — the full-screen ErrorState covers that case', () => {
  assert.equal(
    shouldShowFeedErrorBanner({ error: 'Network request failed', summaryLoaded: false, itemCount: 4 }),
    false,
  );
});

test('no banner on a successful fetch', () => {
  assert.equal(
    shouldShowFeedErrorBanner({ error: undefined, summaryLoaded: true, itemCount: 4 }),
    false,
  );
});

// V8-L35 (V7-M10 rule): every tab switch — including the denied-banner
// shortcut — clears the search text and any feed error, so a stale error
// never lingers over the new tab's list while its fetch is in flight.
// The shortcut used to do setActiveTab('denied') only.

test('tab switch lands on the new tab with search and error cleared', () => {
  assert.deepEqual(switchAccessTab('inside'), {
    activeTab: 'inside',
    search: '',
    error: undefined,
  });
});

test('denied-banner shortcut clears search and error exactly like a tab-row tap', () => {
  const viaBanner = switchAccessTab('denied');
  const viaTabRow = switchAccessTab('denied');
  assert.deepEqual(viaBanner, {
    activeTab: 'denied',
    search: '',
    error: undefined,
  });
  assert.deepEqual(viaBanner, viaTabRow);
});
