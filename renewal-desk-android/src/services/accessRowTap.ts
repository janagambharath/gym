// Live Access feed row taps (V9-L25) — pure routing + link payload.
//
// V9-L25: Android feed rows were not tappable at all; tap-to-assign was
// PWA-only. The routing decision lives here (node-testable) so the
// screen only renders it:
//
// - Named row (member_id present) → open the member, same destination
//   Live Access navigates to via onNavigateMemberDetail.
// - Unknown row (no member_id, terminal ID present) → open the assign
//   flow: MemberPickerModal + POST /api/mobile/v1/rrr/mappings/bulk-resolve
//   with the body below — the same endpoint the PWA quick-assign sheet
//   and the RrrGrowthScreen mapping picker use.
// - Row with neither (no member, no terminal ID) → nothing to open.

export type AccessRowTapInput = {
  member_id: number | null;
  member_name: string | null;
  membership_status: string | null;
  biometric_user_id?: string | null;
  device_enroll_number: string;
};

export type AccessRowTap =
  | {
      kind: 'member';
      member: { id: number; full_name: string; status: string | null };
    }
  | { kind: 'assign'; bioId: string }
  | { kind: 'none' };

export function resolveAccessRowTap(event: AccessRowTapInput): AccessRowTap {
  if (event.member_id) {
    return {
      kind: 'member',
      member: {
        id: event.member_id,
        full_name: event.member_name ?? 'Unknown Member',
        status: event.membership_status,
      },
    };
  }
  const bioId = event.biometric_user_id || event.device_enroll_number;
  if (bioId) return { kind: 'assign', bioId };
  return { kind: 'none' };
}

/** bulk-resolve body linking one terminal ID to one member. */
export function buildQuickAssignBody(
  bioId: string,
  memberId: number,
): { mappings: { external_id: string; member_id: number }[] } {
  return { mappings: [{ external_id: bioId, member_id: memberId }] };
}
