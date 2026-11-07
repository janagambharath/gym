/**
 * Live Access feed / Inside-list state — pure helpers, free of react-native
 * imports so the failure-visibility rules can be covered by node tests.
 *
 * V7-M10: a feed or Inside fetch failure used to be invisible whenever the
 * summary loaded — `error` only rendered via the `error && !summary`
 * full-screen gate in AccessScreen, and the Inside tab fell back to the
 * misleading "No members are currently inside." empty state while the 15 s
 * poll kept failing silently. The list area must never present a failed
 * load as an empty room.
 */

export type AccessListView = 'loading' | 'error' | 'empty' | 'list';

/**
 * What the list area shows. A failed fetch is an error view even when the
 * list is empty — never the "nobody inside" / "no events" empty state.
 */
export function resolveAccessListView(args: {
  loading: boolean;
  error?: string;
  itemCount: number;
}): AccessListView {
  if (args.loading) return 'loading';
  if (args.error) return 'error';
  return args.itemCount === 0 ? 'empty' : 'list';
}

/**
 * Inline error banner above the list. Shown when the feed/Inside fetch
 * failed but the summary loaded (the `error && !summary` full-screen
 * ErrorState already covers the no-summary case) and there are stale rows
 * on screen. When the list is empty the error view from
 * resolveAccessListView carries the message + retry instead, so the same
 * failure is never shown twice.
 */
export function shouldShowFeedErrorBanner(args: {
  error?: string;
  summaryLoaded: boolean;
  itemCount: number;
}): boolean {
  return Boolean(args.error) && args.summaryLoaded && args.itemCount > 0;
}

/**
 * One shared tab-switch transition for AccessScreen.
 *
 * V7-M10: a feed error from the previous tab must not linger over the
 * new tab's list while its fetch is still in flight — every tab switch
 * clears the search text and the error. V8-L35: the denied-banner
 * shortcut did `setActiveTab('denied')` only, bypassing that rule, so
 * the stale error lingered until the new tab's fetch succeeded. Both
 * call sites now go through this helper, so the shortcut cannot drift
 * from the tab row again.
 */
export function switchAccessTab<Tab extends string>(nextTab: Tab): {
  activeTab: Tab;
  search: string;
  error: undefined;
} {
  return { activeTab: nextTab, search: '', error: undefined };
}
