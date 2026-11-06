/**
 * RRR opportunities — pure helpers shared by RrrGrowthScreen (preview) and
 * RrrOpportunitiesScreen (full list). Kept free of react-native imports so
 * the request shapes and filtering can be covered by node tests.
 *
 * Backend contract (app/mobile_api/rrr.py):
 *   GET   /api/mobile/v1/rrr/opportunities?pillar=<revenue|retain|recover>
 *         — status defaults to "open"; omit pillar for all pillars.
 *   PATCH /api/mobile/v1/rrr/opportunities/<id>
 *         — body { status: "open" | "actioned" | "closed" | "dismissed" };
 *           "closed" also requires outcome_revenue (finite, >= 0).
 *   This mirrors the PWA (renewal-desk-pwa/src/screens/rrr-list.js).
 */

export type RrrPillar = 'revenue' | 'retain' | 'recover';
export type PillarFilter = 'all' | RrrPillar;

export const PILLAR_ORDER: RrrPillar[] = ['revenue', 'retain', 'recover'];

export const PILLAR_LABELS: Record<RrrPillar, string> = {
  revenue: 'Revenue Opportunities',
  retain: 'At Risk Members',
  recover: 'Inactive / Expired Members',
};

export const PILLAR_SHORT_LABELS: Record<RrrPillar, string> = {
  revenue: 'Revenue',
  retain: 'Retain',
  recover: 'Recover',
};

export type OpportunityStatus = 'open' | 'actioned' | 'closed' | 'dismissed';

export type RrrOpportunity = {
  id: number;
  pillar: string;
  status: string;
  priority?: string;
  reason: string;
  potential_revenue: string;
  outcome_revenue?: string;
  member: { id?: number; name: string; phone?: string };
};

const VALID_STATUSES: ReadonlySet<string> = new Set(['open', 'actioned', 'closed', 'dismissed']);

/** List URL the PWA uses: open opportunities, optionally one pillar. */
export function opportunitiesUrl(pillar: PillarFilter): string {
  return pillar === 'all'
    ? '/api/mobile/v1/rrr/opportunities'
    : `/api/mobile/v1/rrr/opportunities?pillar=${encodeURIComponent(pillar)}`;
}

/** Client-side pillar filter (for a list already fetched without a pillar). */
export function filterOpportunities(
  items: RrrOpportunity[],
  pillar: PillarFilter,
): RrrOpportunity[] {
  if (pillar === 'all') return items;
  return items.filter((item) => item.pillar === pillar);
}

/** Request shape for PATCH /rrr/opportunities/:id. Throws on an invalid status. */
export function updateOpportunityRequest(
  id: number,
  status: OpportunityStatus,
  outcomeRevenue?: string,
): { path: string; method: 'PATCH'; body: Record<string, string> } {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid opportunity status: ${status}`);
  }
  if (status === 'closed' && outcomeRevenue === undefined) {
    throw new Error('outcome_revenue is required when closing an opportunity.');
  }
  return {
    path: `/api/mobile/v1/rrr/opportunities/${id}`,
    method: 'PATCH',
    body:
      status === 'closed'
        ? { status, outcome_revenue: outcomeRevenue as string }
        : { status },
  };
}

/** Dismiss — the same PATCH the PWA's rrr-list.js sends for its Dismiss button. */
export function dismissOpportunityRequest(id: number) {
  return updateOpportunityRequest(id, 'dismissed');
}
