// Member envelope unwrapping (V12-D1 / V12-C1).
//
// Pure module, free of react-native / expo imports on purpose:
// memberApiClient.ts cannot be imported under node (its chain pulls in
// expo-secure-store via the session store), so the unwrap rule lives
// here where the `tsx --test` harness can exercise it directly.
//
// The contract mismatch: POST /api/member/v1/auth/request-otp returns
// a FLAT payload — {"success": true, "challenge": "<hmac>" | null,
// "gym_name": ...} with NO `data` key (app/mobile_api/member_api.py,
// request_otp returns jsonify(resp_payload) on both branches) — while
// every other member endpoint wraps its payload in `data`. The generic
// memberApiRequest unwrapped `envelope.data` for every call, so for
// request-otp `data` was always `undefined` and MemberLoginScreen
// threw on `result.data.challenge` on every OTP tap, spinner stuck
// forever. The fix: requestOtp reads the flat envelope via
// unwrapMemberEnvelope(..., 'flat'). The verify-otp half DOES wrap in
// `data` (member_api.py verify-otp), so it keeps the default mode.
export type MemberEnvelopeMode = 'data' | 'flat';

export type MemberEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  // Flat-envelope fields (request-otp only). Kept loose on purpose:
  // the flat payload carries challenge / gym_name at top level.
  challenge?: unknown;
  gym_name?: unknown;
};

/**
 * Unwrap a member-API envelope. 'data' mode returns envelope.data
 * (the standard shape); 'flat' mode returns the envelope itself as
 * the payload (request-otp — the top-level challenge / gym_name ARE
 * the payload, there is no `data` key to unwrap).
 */
export function unwrapMemberEnvelope<T>(
  envelope: MemberEnvelope<T>,
  mode: MemberEnvelopeMode = 'data',
): T | undefined {
  if (mode === 'flat') {
    return envelope as unknown as T;
  }
  return envelope.data;
}

/**
 * Read the OTP payload out of a request-otp flat envelope. Returns
 * null when the envelope is not a usable OTP response (never throws —
 * callers must not crash on a malformed payload).
 */
export function extractOtpPayload(
  envelope: MemberEnvelope<unknown> | null | undefined,
): { challenge: string | null; gym_name: string | null } | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const challenge = envelope.challenge;
  const gymName = envelope.gym_name;
  return {
    challenge: typeof challenge === 'string' ? challenge : null,
    gym_name: typeof gymName === 'string' ? gymName : null,
  };
}
