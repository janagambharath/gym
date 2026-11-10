// Member claim outcome (V12-D4 / V12-H1).
//
// Pure module, free of react-native / expo imports on purpose: the
// renew screen cannot be imported under node, so the branch rule
// lives here where the `tsx --test` harness can exercise it directly.
//
// The bug: POST /api/member/v1/renew/claim returns
// {"payment_id": existing.id, "already_pending": true} when a
// pending/processing claim already exists — i.e. NO new payment was
// created — but MemberRenewScreen went to the "Payment Submitted! 🎉"
// success screen on any `result.ok` and never read `already_pending`
// (typed in ClaimResult, never read anywhere). A member who already
// had a payment pending re-claimed and was celebrated for a payment
// they never made.
export type ClaimOutcome = 'submitted' | 'already-pending' | 'failed';

export function resolveClaimOutcome(result: {
  ok: boolean;
  data?: { already_pending?: boolean } | null;
}): ClaimOutcome {
  if (!result.ok) return 'failed';
  if (result.data?.already_pending) return 'already-pending';
  return 'submitted';
}
