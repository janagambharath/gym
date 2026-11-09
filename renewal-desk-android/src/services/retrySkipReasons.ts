// Retry All skip reasons — mirrors the PWA's RETRY_SKIP_LABELS
// (renewal-desk-pwa/src/screens/access.js:45-61) for the Live Access
// "Retry All" result card (V10-M6).
//
// The PWA pluralizes naively (`label + 's'`), which garbles 3 of the 7
// reasons ("2 commands disableds", "2 terminal never connecteds",
// "2 could not re-queues" — PWA V10-L14). Every label here carries an
// explicit plural, so Android never inherits that bug.
//
// Two reasons are NEW in this fix-all (backend V10-L8 split of the old
// catch-all `requeue_failed`): `no_terminal_identity` and
// `not_enableable`. Their labels are the ones named in the v10 task —
// if the backend crew lands different reason strings, add them here
// with the same { label, plural } shape.
//
// Dependency-free on purpose: the node test harness can exercise this
// directly, like idempotencyKey.

export type RetrySkip = {
  command_id: number;
  reason: string;
};

/** Full Retry All response shape (app/mobile_api/access.py:101-181). */
export type RetrySyncResult = {
  retried_count: number;
  skipped_count: number;
  skipped: RetrySkip[];
  message: string;
};

export type RetrySkipLabel = {
  label: string;
  plural: string;
};

export const RETRY_SKIP_LABELS: Record<string, RetrySkipLabel> = {
  test_action: { label: 'test command', plural: 'test commands' },
  unlock_door: { label: 'door unlock', plural: 'door unlocks' },
  unresolvable_member: { label: 'unknown member', plural: 'unknown members' },
  requeue_failed: { label: 'could not re-queue', plural: 'could not re-queue' },
  unsupported_action: { label: 'other command', plural: 'other commands' },
  commands_disabled: { label: 'commands disabled', plural: 'commands disabled' },
  terminal_never_polled: { label: 'terminal never connected', plural: 'terminals never connected' },
  // V10-L8 new reasons — the member simply has no terminal identity, or
  // is not currently eligible for the command (e.g. a failed enrollment
  // for a member who has since left / is paused).
  no_terminal_identity: { label: 'No terminal identity', plural: 'No terminal identities' },
  not_enableable: { label: 'Member not eligible', plural: 'Members not eligible' },
};

const FALLBACK_LABEL: RetrySkipLabel = { label: 'other command', plural: 'other commands' };

export function retrySkipLabel(reason: string): RetrySkipLabel {
  return RETRY_SKIP_LABELS[reason] ?? FALLBACK_LABEL;
}

export type GroupedRetrySkip = {
  reason: string;
  count: number;
  label: string;
  plural: string;
};

/** Group a skipped list by reason, preserving first-seen order. */
export function groupRetrySkips(skipped: RetrySkip[] | undefined | null): GroupedRetrySkip[] {
  const groups: GroupedRetrySkip[] = [];
  for (const s of skipped ?? []) {
    const { label, plural } = retrySkipLabel(s.reason);
    const existing = groups.find((g) => g.reason === s.reason);
    if (existing) {
      existing.count += 1;
    } else {
      groups.push({ reason: s.reason, count: 1, label, plural });
    }
  }
  return groups;
}

/** "2 test commands, 1 door unlock" — the Skipped line of the result card. */
export function retrySkippedSummary(skipped: RetrySkip[] | undefined | null): string {
  return groupRetrySkips(skipped)
    .map((g) => `${g.count} ${g.count > 1 ? g.plural : g.label}`)
    .join(', ');
}
