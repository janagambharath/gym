// Member membership-status derivation (V12-D3).
//
// Pure module, free of react-native / expo imports on purpose: the
// member screens cannot be imported under node, so the derivation
// lives here where the `tsx --test` harness can exercise it directly.
//
// The bug: MemberHomeScreen / MemberMembershipScreen derived the
// status card from `is_expired` only and never read `member.status`,
// so a PAUSED member (valid dates, door blocked) saw a green
// "Active Membership" and travelled to the gym. The backend already
// computes the right value (access.summary.access_active =
// status == "active" and not is_expired, member_api.py) and
// MemberAccessScreen in this same app reads it correctly — the home /
// membership screens just never looked. Drive the card from
// `member.status` first: PAUSED is its own tone, never green.
export type MemberStatusTone = 'active' | 'expiring' | 'expired' | 'paused';

export type MemberStatusDisplay = {
  tone: MemberStatusTone;
  /** Full label for the home status card ("Active Membership"). */
  label: string;
  /** Short label for the membership screen badge ("Active"). */
  shortLabel: string;
  icon: string;
};

export function deriveMemberStatus(input: {
  status?: string | null;
  is_expired?: boolean;
  days_left?: number | null;
}): MemberStatusDisplay {
  const status = (input.status ?? '').trim().toLowerCase();
  if (status === 'paused') {
    return { tone: 'paused', label: 'Membership Paused', shortLabel: 'Paused', icon: '⏸️' };
  }
  if (input.is_expired) {
    return { tone: 'expired', label: 'Membership Expired', shortLabel: 'Expired', icon: '⚠️' };
  }
  if (
    input.days_left !== null &&
    input.days_left !== undefined &&
    input.days_left <= 7
  ) {
    return { tone: 'expiring', label: 'Expiring Soon', shortLabel: 'Expiring Soon', icon: '⏰' };
  }
  return { tone: 'active', label: 'Active Membership', shortLabel: 'Active', icon: '✅' };
}
