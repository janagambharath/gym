// Biometric block/unblock toggle state for the member-detail screen.
//
// PWA parity (renewal-desk-pwa/src/screens/member-detail.js): the PWA
// renders the toggle for EVERY enrolled member regardless of membership
// status — its label is "Retry Block/Unblock Access" after a failed
// command, otherwise "Block/Unblock Biometric Access" from door_blocked.
// There is no active-member gate on the PWA. Android used to hide the
// toggle for active members with accessBlocked === false (V6-M8/M9 edge),
// so a failed block on an active member showed retry text with no retry
// button. The toggle is now always rendered for enrolled members; this
// helper only derives its label/action. It decides nothing about whether
// the backend allows the block — the backend still enforces its own
// rules (409 BLOCK_NOT_ALLOWED on bridge gyms; the ADMS owner-override
// B-H1 stays decision-gated and untouched).
//
// RN-free on purpose: node:test asserts the label/action matrix without
// a RN runtime (this repo has no component-render test harness).

export type BlockToggleInput = {
  accessBlocked: boolean;
  doorAccessFailed: boolean;
  doorAccessFailedAction: 'block' | 'unblock' | null;
};

export type BlockToggle = {
  /** Button label, e.g. "Block Access" / "Retry Unblock". */
  label: string;
  action: 'block' | 'unblock';
  /** True when the toggle re-issues a failed command. */
  isRetry: boolean;
};

export function resolveBlockToggle(input: BlockToggleInput): BlockToggle {
  // A failed command leaves the door state unknown — the toggle retries
  // the failed action instead of trusting the stale blocked flag.
  const retrying = input.doorAccessFailed && input.doorAccessFailedAction !== null;
  const action: 'block' | 'unblock' = retrying
    ? input.doorAccessFailedAction as 'block' | 'unblock'
    : input.accessBlocked
      ? 'unblock'
      : 'block';
  const label = retrying
    ? `Retry ${action === 'unblock' ? 'Unblock' : 'Block'}`
    : action === 'block'
      ? 'Block Access'
      : 'Unblock Access';
  return { label, action, isRetry: retrying };
}
