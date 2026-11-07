// First-load failure message for multi-leg member screens (V9-L17).
//
// MemberRenewScreen loads plans + payment info in parallel. A failed leg
// used to be swallowed and the screen rendered "No plans available.
// Contact your gym for renewal." — indistinguishable from a gym with
// genuinely no plans. The first failed leg's message is the load error;
// the screen shows ErrorState + retry instead of the false empty state.
// Plans leg first: it is the leg whose failure fabricates the empty state.

export type LoadResult = { ok: boolean; error?: string };

/** Message of the first failed leg, or undefined when all legs succeeded. */
export function firstLoadErrorMessage(results: LoadResult[]): string | undefined {
  for (const result of results) {
    if (!result.ok && result.error) return result.error;
  }
  return undefined;
}
