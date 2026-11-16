/**
 * Live Access feed dedupe + page-merge — pure helpers, free of
 * react-native imports so the search-refill rules can be covered by
 * node tests (same pattern as accessFeedState.ts).
 *
 * BUG 2 (2026-11-16, Arun gym, Android only): after typing in the
 * search box the list kept refilling/duplicating until the search was
 * cleared — V.Sandeep's 8:17 AM ENTRY rendered twice. Root cause:
 * the old `dedupeEvents` key was hand-built from
 * `device_name:member_id|enroll:timestamp:type:direction`, and it
 * never used the backend's `punch_key`, although the backend sends it
 * in both feed legs. The backend's `_punch_key` deliberately excludes
 * `member_id` — it changes from None to the member when the punch is
 * linked, and the punch is still the same punch — which is exactly
 * what the old Android key included. So a punch whose identity
 * changed between fetches (linked, or projected `"adms-<id>"` -> int
 * id) survived dedupe as two rows. The 15 s poll replaces page 1
 * while `onEndReached` appends, so the rows re-fed every poll cycle
 * while a search was active; clearing the search forced a fresh
 * unfiltered replace, which is why the refilling stopped. The PWA
 * already dedupes by `punch_key` (access.js, V7-L19) — this mirrors
 * it.
 */

import type { AccessEvent } from '../types';

/** A feed query: the filter tab + the settled (trimmed) search text. */
export type FeedQuery = {
  tab: string;
  search: string;
};

/**
 * Stable identity for one feed row.
 *
 * Prefer the backend's `punch_key` (`enroll | full-precision
 * timestamp | event_type | direction`): it is stable across linking
 * and across projection (`"adms-<id>"` -> int id), which is exactly
 * when the old hand-built key changed and let the same punch render
 * twice. Two genuinely distinct punches have different punch_keys
 * (different full-precision timestamps), so they still stay distinct
 * — never collapse real punches.
 *
 * Fallback (older backend without `punch_key`): the previous
 * hand-built key, unchanged. It keeps `device_name` as the terminal
 * discriminator — the event payload carries no device serial/terminal
 * ID, so two terminals reporting the same member at the same second
 * must not collapse into one row — and it keeps the event kind, so
 * an ENTRY and an EXIT for the same member at the same second stay
 * distinct (V4-L24).
 */
export function eventKey(event: AccessEvent): string {
  if (event.punch_key) return `pk:${event.punch_key}`;
  return `${event.device_name ?? ''}:${event.member_id ?? event.device_enroll_number}:${event.event_timestamp}:${event.event_type}:${event.direction ?? ''}`;
}

/** Drop duplicate rows, keeping the first occurrence of each key. */
export function dedupeEvents(events: AccessEvent[]): AccessEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = eventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Two feed queries match when both the tab and the settled search text match. */
export function sameFeedQuery(a: FeedQuery, b: FeedQuery): boolean {
  return a.tab === b.tab && a.search === b.search;
}

/**
 * Merge one fetched feed page into the current list.
 *
 * - Replace (`append: false`): the incoming page becomes the list.
 * - Append (`append: true`): the incoming page is merged after the
 *   current rows, deduped by `punch_key`.
 *
 * A stale append — fetched for a query the screen has already moved
 * on from (tab switched, search settled to a new value) — is dropped
 * entirely: the caller's list is returned unchanged (same reference),
 * so the caller can also skip applying the stale page's pagination.
 * The sequence guard drops stale *responses* only when a newer fetch
 * started; an append that started after the replace can still land
 * first carrying the old query, so the tag is the second layer.
 */
export function applyFeedPage(
  prev: AccessEvent[],
  incoming: AccessEvent[],
  opts: {
    append: boolean;
    queryAtCall: FeedQuery;
    currentQuery: FeedQuery;
  },
): AccessEvent[] {
  if (opts.append && !sameFeedQuery(opts.queryAtCall, opts.currentQuery)) {
    return prev;
  }
  return opts.append ? dedupeEvents([...prev, ...incoming]) : dedupeEvents(incoming);
}
