// Notifications pagination helpers (V11-L29).
//
// Pure module, free of react-native imports on purpose: the screen
// cannot be imported under node, so the page-merge rule lives here
// where the `tsx --test` harness can exercise it directly.
//
// The bug it fixes: NotificationsScreen fetched only page 1
// (page_size 50) and never read `pagination`, so a gym past 50
// notifications could never reach older ones in-app.

import type { AppNotificationItem } from '../types';

/** Append a fetched page, de-duplicated by id (pages can overlap). */
export function mergeNotificationPage(
  prev: AppNotificationItem[],
  next: AppNotificationItem[],
): AppNotificationItem[] {
  const seen = new Set(prev.map((item) => item.id));
  return [...prev, ...next.filter((item) => !seen.has(item.id))];
}

/** True when the server reports more notifications than are shown. */
export function hasMoreNotifications(total: number, shown: number): boolean {
  return total > shown;
}
