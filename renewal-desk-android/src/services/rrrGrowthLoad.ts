/**
 * RRR Growth load-error resolution — pure helpers, free of react-native
 * imports so the failure-visibility rule can be covered by node tests.
 *
 * V8-M14: RrrGrowthScreen fired 6 parallel legs and checked each
 * `res.ok` independently, but captured no error anywhere — a total load
 * failure rendered as an empty gym (0 Members · 0% Attendance · ₹0
 * pipeline) plus the Direct Cloud card in "SET UP" state with the
 * terminal provision form, indistinguishable from "no terminal
 * configured". The dashboard and integrations legs are the critical
 * ones: the dashboard carries the members/pillars/pipeline numbers and
 * the integrations leg decides whether the Direct Cloud card shows a
 * live terminal or the provision form. A failure in either must surface
 * as a load error (ErrorState + retry when there is no data yet, stale
 * banner when previous data is on screen — the DashboardScreen
 * pattern). The remaining legs (unresolved mappings, rules, owner
 * today, settings) degrade gracefully to empty/default values and do
 * not by themselves make the screen a lie.
 */

export type RrrGrowthLegResult = {
  ok: boolean;
  error?: { message: string };
};

/**
 * First critical-leg failure message, or undefined when both critical
 * legs succeeded. The dashboard leg is checked first: its numbers are
 * the headline of the screen.
 */
export function resolveRrrGrowthLoadError(
  dashboard: RrrGrowthLegResult,
  integrations: RrrGrowthLegResult,
): string | undefined {
  if (!dashboard.ok) return dashboard.error?.message ?? 'Could not load the growth dashboard.';
  if (!integrations.ok) return integrations.error?.message ?? 'Could not load the terminal connection.';
  return undefined;
}
