// OTP resend cooldown for MemberLoginScreen (V9-L18).
//
// Pure helpers, free of react-native / expo imports so the cooldown rule
// can be covered by node tests.
//
// V9-L18: the Resend button had no cooldown — every tap minted a new
// OTP challenge + WhatsApp message (bounded only by the backend 5/min
// per-IP cap). After a successful send the button stays disabled for
// OTP_RESEND_COOLDOWN_MS with a countdown label.

/** Resend cooldown after a successful OTP send. */
export const OTP_RESEND_COOLDOWN_MS = 30_000;

/** Whole seconds left on the cooldown, 0 when expired / never started. */
export function resendCooldownRemainingSeconds(
  cooldownUntilMs: number | null,
  nowMs: number,
): number {
  if (!cooldownUntilMs) return 0;
  return Math.max(0, Math.ceil((cooldownUntilMs - nowMs) / 1000));
}

/** True while the resend button must stay disabled for cooldown. */
export function isResendCoolingDown(
  cooldownUntilMs: number | null,
  nowMs: number,
): boolean {
  return resendCooldownRemainingSeconds(cooldownUntilMs, nowMs) > 0;
}
