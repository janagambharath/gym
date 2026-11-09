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
//   POST /access/clear-failed — clear failed biometric commands.
//     Role: gym_owner only. 200 { cleared_count, message }.
//     Bridge gyms DELETE the rows; Direct ADMS gyms CANCEL them
//     (status='cancelled', result_code='owner_cleared' — history kept,
//     never deleted). There is NO 409 DIRECT_ADMS_ACTIVE on this
//     endpoint — the 9a6ee314 fix made Clear work for ADMS gyms, so a
//     comment claiming that 409 used to live here (V10-M7) was stale
//     and has been removed.
//   POST /access/adms-commands/<id>/cancel — cancel one queued Direct
//     ADMS command (V9-L14). Role: gym_owner only. 200 on success;
//     409 COMMAND_NOT_QUEUED when the row is no longer queued.
//   All take no body (cancel takes none either).

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

export type CancelAdmsCommandResponse = {
  command_id: number;
  action: string;
  status: string;
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
 * permanent for bridge gyms (cleared commands were never delivered and
 * can never be retried afterwards); for Direct ADMS gyms the rows are
 * marked cleared and their history is kept. The screen branches the
 * confirm wording on summary.adms_integration_id (V10-M7). Returns
 * null when the operator cancels, without touching the backend at all.
 */
export async function clearFailedSyncsWithConfirm(deps: {
  confirm: () => Promise<boolean>;
  request: AccessSyncRequest;
}): Promise<AccessSyncResult<ClearFailedResponse> | null> {
  const confirmed = await deps.confirm();
  if (!confirmed) return null;
  return clearFailedSyncs(deps.request);
}

/**
 * POST /api/mobile/v1/access/adms-commands/<id>/cancel — owner-cancel
 * one queued Direct ADMS command (V10-L33). A stuck queued unlock
 * wedges the whole ADMS pipe via the COMMAND_PENDING guards, and until
 * now no client surfaced it. Only `queued` rows can be cancelled
 * (409 COMMAND_NOT_QUEUED otherwise).
 */
export function cancelQueuedAdmsCommand(
  request: AccessSyncRequest,
  commandId: number,
): Promise<AccessSyncResult<CancelAdmsCommandResponse>> {
  return request<CancelAdmsCommandResponse>(
    `/api/mobile/v1/access/adms-commands/${commandId}/cancel`,
    { method: 'POST' },
  );
}
