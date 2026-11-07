/**
 * MemberDetail refresh staleness — pure helper, free of react-native imports
 * so the failure rule can be covered by node tests.
 *
 * V7-L14: the 30 s poll in MemberDetailScreen fired four parallel legs and
 * only the biometric leg set an error on failure. A failed member, renewal,
 * or payment leg left the previous values on screen with no signal that
 * they were stale — the member could have renewed, been paused, or been
 * deactivated elsewhere while the profile still showed the old state.
 * The screen now surfaces the first non-401 leg failure as a
 * "couldn't refresh — showing last saved details" note with a retry,
 * mirroring the biometric leg's error handling.
 */

export type RefreshLeg = {
  ok: boolean;
  /** HTTP status of a failed leg, when known. */
  status?: number;
  message?: string;
};

/**
 * First non-401 leg failure wins. 401s are not a staleness signal — the
 * session handler logs the user out instead. Returns undefined when every
 * leg succeeded (or only 401'd), so a successful poll clears the note.
 * The biometric leg is deliberately excluded: it already has its own
 * error display on the punch-history card.
 */
export function resolveRefreshError(legs: {
  member: RefreshLeg;
  renewals: RefreshLeg;
  payments: RefreshLeg;
}): string | undefined {
  for (const leg of [legs.member, legs.renewals, legs.payments]) {
    if (!leg.ok && leg.status !== 401) {
      return leg.message || 'Could not refresh member details.';
    }
  }
  return undefined;
}
