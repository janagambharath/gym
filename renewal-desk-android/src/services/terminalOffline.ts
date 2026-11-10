// G3 — Terminal-offline alert (v11 product gap).
//
// Backend contract (coordinator state gaps-g1-g5):
//   `terminal_offline: { since, last_success_at }` in the access-summary
//   payload (app/services/access_event_service.py:get_access_summary —
//   the same payload the dashboard embeds as `access_summary` and
//   /api/mobile/v1/access/summary returns). Threshold: 60 minutes
//   without a poll. The UI only renders the payload: the card appears
//   when the field is present and disappears automatically when polling
//   resumes and the backend drops the field.
//
// RN-free on purpose so node:test can assert the show/hide rule without
// a RN runtime; DashboardScreen formats the timestamps with the shared
// formatDateTime helper.

export type TerminalOfflineInfo = {
  since: string;
  last_success_at: string | null;
};

/** The access-summary shape the dashboard already receives. */
export type AccessSummaryWithOffline = {
  terminal_offline?: TerminalOfflineInfo | null;
};

/**
 * The offline card renders ONLY when the payload carries a
 * terminal_offline object. Absent / null / undefined → no card, no
 * stale warning — the dashboard must never warn from a missing field.
 */
export function getTerminalOffline(
  summary: AccessSummaryWithOffline | null | undefined,
): TerminalOfflineInfo | null {
  return summary?.terminal_offline ?? null;
}

export function hasTerminalOffline(
  summary: AccessSummaryWithOffline | null | undefined,
): boolean {
  return getTerminalOffline(summary) !== null;
}
