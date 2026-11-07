/**
 * Owner-only control gating — pure helpers, free of react-native imports so
 * the role rules can be covered by node tests.
 *
 * V7-L13: owner-only controls rendered for staff and 403'd with a generic
 * "You do not have permission". Backend enforcement was always correct
 * (no privilege issue) — this is dead-button UX only. The screens hide the
 * controls for non-owners, mirroring the existing BulkDeactivate-link
 * pattern (`isOwner && …`).
 *
 * Backend role map (verified against app/mobile_api/):
 *   owner-only — PUT /rrr/rules, POST /rrr/integrations/:id/select-device,
 *     POST /rrr/ebio/pair, POST /rrr/integrations/:id/provision-direct,
 *     POST /rrr/integrations/:id/rotate-token,
 *     POST /rrr/integrations/:id/serial-fallback,
 *     POST /rrr/integrations/:id/test-command,
 *     POST /rrr/integrations/:id/commission,
 *     POST /access/remote-unlock, POST /access/clear-failed.
 *   staff-allowed — GET /rrr/dashboard, GET+PATCH /rrr/opportunities,
 *     GET /rrr/rules, GET /rrr/integrations, GET /rrr/mappings/unresolved,
 *     POST /rrr/mappings/bulk-resolve, POST /rrr/enroll-scan,
 *     GET /rrr/enroll-matches, POST /rrr/enroll-matches/confirm,
 *     GET /access/summary, GET /access/events, GET /access/inside,
 *     POST /access/checkin, POST /access/retry-sync.
 * So identity-review mapping, scan/confirm, and the opportunities
 * Action/Recovered buttons stay visible for staff; only the controls
 * listed above are gated.
 */

export function isOwnerRole(role: string | undefined | null): boolean {
  return role === 'gym_owner';
}

/**
 * V8-L31: Date Repair entry points are owner-only on the backend
 * (scan/apply/confirm all reject staff with 403) — the Settings menu
 * item and the Edit Member link must not render for staff, same
 * V7-L13 pattern as the controls above. The Edit Member link already
 * sat inside the owner-only membership block, but the gate is stated
 * explicitly here so a future move of the link cannot silently
 * re-expose it to staff.
 */
export function canOpenDateRepair(isOwner: boolean): boolean {
  return isOwner;
}

/** AccessScreen: which owner-only buttons render. */
export type AccessOwnerControls = {
  /** POST /access/clear-failed — the Clear button in the failed-commands banner. */
  showClearFailed: boolean;
  /** POST /access/remote-unlock — the Unlock Gate button. */
  showRemoteUnlock: boolean;
};

export function accessOwnerControls(isOwner: boolean): AccessOwnerControls {
  return { showClearFailed: isOwner, showRemoteUnlock: isOwner };
}

/** RrrGrowthScreen: which owner-only sections render. */
export type RrrGrowthOwnerSections = {
  /** Provision form, Rotate token, serial-fallback toggle. */
  showTerminalSetup: boolean;
  /** Probe / group test commands / commission console. */
  showCommissioningConsole: boolean;
  /** Device select, pairing-code generation, bridge commission. */
  showBridgeControls: boolean;
  /** Signal-threshold inputs + Save thresholds. */
  showThresholds: boolean;
};

export function rrrGrowthOwnerSections(isOwner: boolean): RrrGrowthOwnerSections {
  return {
    showTerminalSetup: isOwner,
    showCommissioningConsole: isOwner,
    showBridgeControls: isOwner,
    showThresholds: isOwner,
  };
}
