// Staff edit API — parity with the PWA staff screen.
//
// Endpoint verified against the backend (app/mobile_api/staff.py):
//   PATCH /api/mobile/v1/staff/<user_id>  (gym_owner only)
//   Accepts: full_name, role ("staff" | "gym_owner"), is_active.
//   The PWA action modal only uses this endpoint for is_active; the PWA
//   has no edit UI, so Android adds the edit form on top of the same
//   endpoint instead of inventing a new one.
//
// PHONE IS DELIBERATELY NOT EDITABLE HERE: the backend User model
// (app/models/user.py) has no phone column and PATCH ignores unknown
// fields — create_staff() only uses `phone` to build the WhatsApp invite
// URL, it is never stored. Sending a phone in the PATCH body would be
// silently dropped, so the edit form covers name + role only.

import type { ApiResult, apiRequest } from './apiClient';

/** Injectable request function — screens pass the real `apiRequest`. */
export type StaffRequestFn = typeof apiRequest;

export type StaffRole = 'staff' | 'gym_owner';

export type StaffEditFields = {
  full_name: string;
  role: StaffRole;
};

export type UpdatedStaffMember = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
};

export function staffEditPath(staffId: number): string {
  return `/api/mobile/v1/staff/${staffId}`;
}

/** Build the PATCH body: trimmed name + role, nothing the backend drops. */
export function buildStaffEditBody(fields: StaffEditFields): { full_name: string; role: StaffRole } {
  return {
    full_name: fields.full_name.trim(),
    role: fields.role,
  };
}

/** PATCH /api/mobile/v1/staff/<id> with the edited name + role. */
export async function updateStaffMember(
  staffId: number,
  fields: StaffEditFields,
  request: StaffRequestFn,
): Promise<ApiResult<UpdatedStaffMember>> {
  return request<UpdatedStaffMember>(staffEditPath(staffId), {
    method: 'PATCH',
    body: buildStaffEditBody(fields),
  });
}
