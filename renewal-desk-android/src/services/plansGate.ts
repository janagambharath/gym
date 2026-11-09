// Plans-load gate (V10-M8 / V10-L27 / V11-M3).
//
// Pure module, free of react-native imports on purpose: the screens
// cannot be imported under node, so the "may this member be created /
// renewed?" decision lives here where the `tsx --test` harness can
// exercise it directly.
//
// V10-M8/L27 gated submit on load *failure* only. The zero-plans leg
// was left open: a gym with no plans at all loads successfully with
// `plans: []`, the plan section vanished silently, and submit created
// a plan-less member with a fabricated 30-day span (AddMember) or a
// ₹0 30-day renewal (RenewMember). Load success with zero plans is a
// blocking state, same as load failure.

export type PlansGateState = 'loading' | 'ready' | 'no-plans' | 'load-failed';

/**
 * Resolve the plans gate from a load attempt. `loaded` is true once
 * the settings leg has resolved either way; before that the screen is
 * still loading and must not block (or flash a no-plans banner).
 */
export function plansGateState(args: {
  loaded: boolean;
  plansCount: number;
  error?: string | null;
}): PlansGateState {
  if (!args.loaded) return 'loading';
  if (args.error) return 'load-failed';
  if (args.plansCount === 0) return 'no-plans';
  return 'ready';
}

/**
 * True when submit/renew must be blocked: the plans leg resolved
 * empty or failed AND no plan is resolved for this member. A member
 * WITH a plan (AddMember: a chip selected; RenewMember: member.plan
 * fallback) proceeds even when the fetch failed — the V10-L27
 * carve-out — because the renewal still has a plan to anchor on.
 */
export function plansBlockSubmit(state: PlansGateState, hasPlan: boolean): boolean {
  return (state === 'no-plans' || state === 'load-failed') && !hasPlan;
}

export type NamedPlan = { id: number; name: string };

/**
 * V11-L31: a member whose plan was soft-deleted keeps `planId` set to
 * the deleted id, but the plan grid renders only active plans — so no
 * chip is selected and the member reads as plan-less. When the
 * member's current plan is known by name yet absent from the active
 * list, return it so the screen can render a disabled
 * "<name> (deleted)" chip instead of silence. Returns null when the
 * member has no plan, when the plan is still active, or when the
 * plans leg failed (a failed load must not be read as "deleted").
 */
export function resolveDeletedPlan(
  currentPlan: NamedPlan | null | undefined,
  activePlans: NamedPlan[],
  plansLoadFailed: boolean,
): NamedPlan | null {
  if (!currentPlan || plansLoadFailed) return null;
  if (activePlans.some((p) => p.id === currentPlan.id)) return null;
  return currentPlan;
}
