// Live Access re-sync actions — the PWA's "Re-sync Members" and
// "Clear failed syncs" buttons, ported to Android.
//
// The request function is injected (the screen passes `apiRequest`) so
// these stay unit-testable without React Native: the node test runner
// cannot import the real apiClient (it pulls in SecureStore).
//
// Backend (app/mobile_api/access.py, blueprint /api/mobile/v1):
//   POST /access/reconcile    — re-sync all active members to the device.
//     Roles: gym_owner, staff. 200 { queued_count, message }.
//     403 NOT_COMMISSIONED when Direct ADMS is not commissioned.
//   POST /access/clear-failed — permanently delete failed bridge commands.
//     Role: gym_owner only. 200 { cleared_count, message }.
//     409 DIRECT_ADMS_ACTIVE when Direct ADMS is authoritative.
//   Both take no body.

export type AccessSyncResult<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: { message: string; code?: string; status?: number } };

export type AccessSyncRequest = <T>(
  path: string,
  options: { method: 'POST' },
) => Promise<AccessSyncResult<T>>;

export type ReconcileResponse = {
  queued_count: number;
  message: string;
};

export type ClearFailedResponse = {
  cleared_count: number;
  message: string;
};

/** POST /api/mobile/v1/access/reconcile — queue a full member re-sync. */
export function reconcileMembers(
  request: AccessSyncRequest,
): Promise<AccessSyncResult<ReconcileResponse>> {
  return request<ReconcileResponse>('/api/mobile/v1/access/reconcile', {
    method: 'POST',
  });
}

/** POST /api/mobile/v1/access/clear-failed — delete failed bridge commands. */
export function clearFailedSyncs(
  request: AccessSyncRequest,
): Promise<AccessSyncResult<ClearFailedResponse>> {
  return request<ClearFailedResponse>('/api/mobile/v1/access/clear-failed', {
    method: 'POST',
  });
}

/**
 * Clear failed syncs, but only after the operator confirms — the delete is
 * permanent: cleared commands were never delivered and can never be
 * retried afterwards. Returns null when the operator cancels, without
 * touching the backend at all.
 */
export async function clearFailedSyncsWithConfirm(deps: {
  confirm: () => Promise<boolean>;
  request: AccessSyncRequest;
}): Promise<AccessSyncResult<ClearFailedResponse> | null> {
  const confirmed = await deps.confirm();
  if (!confirmed) return null;
  return clearFailedSyncs(deps.request);
}
