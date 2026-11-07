/**
 * Notification mark-as-read state transitions — pure helpers, free of
 * react-native imports so the optimistic-update / revert rule can be
 * covered by node tests.
 *
 * V8-L33: tapping an unread notification used to fire
 * POST /notifications/:id/read fire-and-forget (`void apiRequest(...)`)
 * while immediately marking the item read locally and decrementing the
 * unread count. If the POST failed (offline), the server stayed unread
 * while the UI said read until the next poll restored it. The screen
 * now awaits the POST and reverts the optimistic update on failure;
 * these helpers are the exact list transitions it applies, so the
 * revert is provably the inverse of the optimistic step.
 */

export type ReadableNotification = {
  id: number;
  is_read: boolean;
};

/** Optimistic step: mark one item read. Returns whether the unread count should drop. */
export function applyMarkRead<T extends ReadableNotification>(
  items: T[],
  id: number,
): { items: T[]; decremented: boolean } {
  const target = items.find((item) => item.id === id);
  if (!target || target.is_read) return { items, decremented: false };
  return {
    items: items.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
    decremented: true,
  };
}

/** Revert step: put one item back to unread (the exact inverse of applyMarkRead). */
export function revertMarkRead<T extends ReadableNotification>(items: T[], id: number): T[] {
  return items.map((item) => (item.id === id ? { ...item, is_read: false } : item));
}

/** Mark-all-read step: every item read. */
export function applyMarkAllRead<T extends ReadableNotification>(items: T[]): T[] {
  return items.map((item) => (item.is_read ? item : { ...item, is_read: true }));
}
