// Onboarding checklist role gating (V11-L30).
//
// Pure module, free of react-native imports on purpose: the card
// cannot be imported under node, so the step-visibility rule lives
// here where the `tsx --test` harness can exercise it directly.
//
// The bug it fixes: the Dashboard checklist showed the
// `member_payments` step ("Collect member payments" → PaymentSetup)
// to staff, but the PUT /settings/payment write is owner-only, so
// staff followed the step, filled in UPI details, and hit a 403 on
// Save. Backend enforcement was always correct — the dead end was
// Android-only. Non-owners simply never see the step.

import type { OnboardingStep } from './apiClient';

/** Onboarding step ids that only the gym owner may act on. */
const OWNER_ONLY_STEP_IDS = new Set(['member_payments']);

/** Steps this role may see (and act on) in the checklist. */
export function visibleOnboardingSteps(
  steps: OnboardingStep[],
  isOwner: boolean,
): OnboardingStep[] {
  if (isOwner) return steps;
  return steps.filter((step) => !OWNER_ONLY_STEP_IDS.has(step.id));
}
