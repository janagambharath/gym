// G5 — "Active member, door blocked" detector (v11 product gap).
//
// Backend contract (coordinator state gaps-g1-g5):
//   GET /api/mobile/v1/rrr/blocked-active
//   → { members: [{ id, name, phone, enroll_number, membership_end }] }
// Detection ONLY — never auto-block or auto-unblock anyone. The
// dashboard card renders ONLY when the list is non-empty and offers
// no block/unblock action; tapping a row opens the existing member
// detail flow (where the owner can act deliberately).
//
// RN-free on purpose so node:test can assert the show/hide rule without
// a RN runtime.

export type BlockedActiveMember = {
  id: number;
  name: string;
  phone: string | null;
  enroll_number: string | number | null;
  membership_end: string | null;
};

export type BlockedActiveResponse = {
  members: BlockedActiveMember[];
};

export function buildBlockedActiveUrl(): string {
  return '/api/mobile/v1/rrr/blocked-active';
}

/** The card renders ONLY when the list is non-empty. */
export function hasBlockedActiveMembers(
  members: BlockedActiveMember[] | null | undefined,
): boolean {
  return (members?.length ?? 0) > 0;
}

export function blockedActiveCount(
  members: BlockedActiveMember[] | null | undefined,
): number {
  return members?.length ?? 0;
}
