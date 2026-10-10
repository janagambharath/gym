# Android Owner-UX Overhaul — Fix Summary

**Branch:** `fix/owner-ux-overhaul` (committed, NOT pushed)
**Date:** 2026-10-10
**TypeScript:** `npx tsc --noEmit` — 0 errors
**Scope:** All P0 + P1 items from `android-ux-audit.md`. P2/P3 (reports depth, templates, notification prefs) not attempted.

## P0 fixes (broken money / broken onboarding)

1. **Access-tab dead buttons** (`App.tsx`)
   - Added `RenewMember`, `EditMember`, `RecordPayment` routes to `AccessStackParamList` and the Access stack navigator.
   - Replaced `onRenew={() => {}}` / `onEdit={() => {}}` / `onRecordPayment={() => {}}` with real navigation callbacks mirroring the Members stack. The "Renew Membership does nothing" bug is fixed.

2. **Dashboard-tab bot setup dead buttons** (`App.tsx`)
   - Added `BotSetup: undefined` to `DashboardStackParamList`, registered the `BotSetup` screen in the Dashboard stack, and wired `BotOverviewScreen`'s `onOpenSetup` to navigate to it.

3. **RRR terminal setup values** (`RrrGrowthScreen.tsx`)
   - Removed hardcoded `gym-production-910c.up.railway.app` and hardcoded `Path /iclock`.
   - The screen now reads `terminal_settings` (`server_address`, `server_port`, `https`, `path` with per-device token) from the `/adms/provision` response and from the integrations list payload, and displays those. The provision success alert also shows the real values.

4. **Identity review member picker** (`RrrGrowthScreen.tsx` + new `MemberPickerModal.tsx`)
   - Replaced "Map to {first member}" with a "Map to member…" button opening a searchable bottom-sheet member picker. The chosen member is passed to the existing map endpoint.

5. **Dashboard Upcoming Renewals Renew button** (`DashboardScreen.tsx`, `App.tsx`)
   - New optional `onRenewMember(member)` prop; the per-row Renew button now opens `RenewMember` for that member directly (falls back to the renewals list if unwired). Wired in the Dashboard stack.

## P1 fixes (owner daily-job friction)

6. **Per-member Block/Unblock Access** (`MemberDetailScreen.tsx`)
   - New "Block Access"/"Unblock Access" button in the biometric card, shown when the member has a biometric enrollment. Confirmation dialog before blocking. Calls the new backend `POST /api/mobile/v1/rrr/members/{member_id}/access` with `{"action":"block"|"unblock"}`; shows queued-command feedback and surfaces 409 DEVICE_NOT_READY errors.

7. **Edit Gym Profile** (new `EditGymProfileScreen.tsx`, `SettingsScreen.tsx`, `App.tsx`)
   - New screen with name/email/phone/address/timezone fields, PATCHes `/api/mobile/v1/settings` (owner-only). Linked via "Edit Gym Profile" button in the Settings gym-profile card; registered as `EditGymProfile` in the More stack.

8. **Renew Membership → primary** (`MemberDetailScreen.tsx`): `variant="outline"` → `variant="primary"`.

9. **WhatsApp reminder → member** (`App.tsx`)
   - Both Dashboard and More stacks now pass `onNavigateMemberDetail`, which fetches the member by id (`GET /api/mobile/v1/members/{id}`) and navigates to MemberDetail. Added missing `MemberDetail`, `RenewMember`, `EditMember` routes to the More stack so the callbacks work there too.

10. **Activity row chevrons** (`MemberDetailScreen.tsx`): removed the fake forward chevrons on the non-tappable Renewal/Payment History rows.

## Notes / caveats

- The block/unblock button tracks blocked state optimistically (local state after a successful queue); there is no server-side "currently blocked" read yet — the terminal applies the command on its next poll.
- The TCP-bridge gym's flows were not touched: no changes to bridge API routes, ADMS poll/ack paths, or attendance ingestion. Backend changes on this branch (block/unblock endpoint) are additive.
- iOS/Android native builds not run — TypeScript source only, as instructed.
