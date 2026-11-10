// Member self-service profile photo — the fetch half of the member
// photo upload (V12-L7).
//
// Pure module, free of react-native / expo imports on purpose: the
// memberApiClient chain pulls in expo-secure-store, so the multipart
// build + fetch + 401-refresh retry lives here where the `tsx --test`
// harness can exercise it with a mocked fetch. Mirrors the owner flow
// (services/memberPhotoUpload.ts) with the member contract instead:
// POST /api/member/v1/profile/photo (multipart field `photo`,
// response { success: true, data: { profile_photo_url } }), DELETE
// for remove. Backend honours Idempotency-Key with scope
// `profile_photo_upload` (app/mobile_api/member_api.py,
// member_profile_photo).

import { buildQrUploadHeaders } from './qrUploadHeaders';

export type MemberPhotoImage = {
  uri: string;
  name: string;
  mimeType: string;
};

export type MemberPhotoUploadResult = {
  profile_photo_url: string | null;
};

export type MemberPhotoUploadOutcome =
  | { ok: true; data: MemberPhotoUploadResult }
  | { ok: false; error: { message: string; code?: string; status?: number } };

/** Member photo endpoint path (self-service, token-scoped). */
export function memberSelfPhotoUploadPath(): string {
  return '/api/member/v1/profile/photo';
}

/**
 * Multipart body for the upload. Field name is `photo` (the backend
 * contract); the { uri, name, type } part shape is the React Native
 * FormData convention — the same shape the owner photo upload appends.
 */
export function buildMemberSelfPhotoForm(image: MemberPhotoImage): FormData {
  const form = new FormData();
  form.append('photo', {
    uri: image.uri,
    name: image.name,
    type: image.mimeType,
  } as never);
  return form;
}

type BackendEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
};

/**
 * POST the member's own photo, with the same 401 → refresh-once →
 * retry path as the owner upload: the retry re-sends the SAME
 * Idempotency-Key, so a retried upload replays instead of executing
 * twice. `fetchImpl` / `refreshAccessToken` are injectable for tests;
 * production callers pass the global fetch and a refresh that returns
 * the fresh access token (or the failure kind when refresh fails).
 * V11-M5: a transient refresh failure reports "could not reach the
 * server" (no 401) so the caller does not log the member out on a
 * network blip; only definitive expiry reports "Session expired".
 */
export async function executeMemberSelfPhotoUpload(args: {
  baseUrl: string;
  image: MemberPhotoImage;
  token?: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
  refreshAccessToken?: () => Promise<
    | { ok: true; token: string }
    | { ok: false; failure: 'expired' | 'transient' }
  >;
}): Promise<MemberPhotoUploadOutcome> {
  const fetchFn = args.fetchImpl ?? fetch;
  const path = memberSelfPhotoUploadPath();

  const makeUpload = async (token?: string): Promise<Response> => {
    // Fresh FormData per attempt — a consumed multipart body cannot
    // be re-sent on the 401-refresh retry.
    return fetchFn(`${args.baseUrl}${path}`, {
      method: 'POST',
      headers: buildQrUploadHeaders({ token, idempotencyKey: args.idempotencyKey }),
      body: buildMemberSelfPhotoForm(args.image),
    });
  };

  const parseResult = async (response: Response): Promise<MemberPhotoUploadOutcome> => {
    let envelope: BackendEnvelope<MemberPhotoUploadResult>;
    try {
      envelope = (await response.json()) as BackendEnvelope<MemberPhotoUploadResult>;
    } catch {
      return { ok: false, error: { message: `Upload failed (${response.status}).`, status: response.status } };
    }
    if (!response.ok || !envelope.success || !envelope.data) {
      return {
        ok: false,
        error: {
          message: envelope.error?.message ?? `Upload failed (${response.status}).`,
          code: envelope.error?.code,
          status: response.status,
        },
      };
    }
    return { ok: true, data: envelope.data };
  };

  try {
    let response = await makeUpload(args.token);
    if (response.status === 401 && args.refreshAccessToken) {
      const refreshed = await args.refreshAccessToken();
      if (refreshed.ok) {
        response = await makeUpload(refreshed.token);
      } else if (refreshed.failure === 'transient') {
        // V11-M5: transient refresh failure — the session is still
        // valid, so this is a connection error, not an expiry.
        return { ok: false, error: { message: 'Could not upload the member photo. Check your connection and try again.' } };
      } else {
        return { ok: false, error: { message: 'Session expired. Please sign in again.', status: 401 } };
      }
    }
    return await parseResult(response);
  } catch {
    return { ok: false, error: { message: 'Could not upload the member photo. Check your connection and try again.' } };
  }
}
