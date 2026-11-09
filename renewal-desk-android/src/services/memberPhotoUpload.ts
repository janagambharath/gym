// Owner-set member profile photo — the fetch half of uploadMemberPhoto.
//
// Pure module, free of react-native / expo imports on purpose: apiClient.ts
// cannot be imported under node (its chain pulls in react-native via
// expo-secure-store), so the multipart build + fetch + 401-refresh retry
// lives here where the `tsx --test` harness can exercise it with a mocked
// fetch. Same reason idempotencyKey.ts / qrUploadHeaders.ts exist.
// apiClient.uploadMemberPhoto is a thin wrapper supplying the real config,
// session token and refresh; the backend contract is
// POST /api/mobile/v1/members/<id>/photo (multipart field `photo`,
// response { success: true, data: { profile_photo_url } }), DELETE for
// remove (no idempotency key — naturally idempotent, like the member
// DELETE). Backend honours Idempotency-Key with scope
// `owner_member_photo_upload` (spec §5.1.3).

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

/** Owner photo endpoint path for a member. */
export function memberPhotoUploadPath(memberId: number): string {
  return `/api/mobile/v1/members/${memberId}/photo`;
}

/**
 * Multipart body for the upload. Field name is `photo` (the backend
 * contract); the { uri, name, type } part shape is the React Native
 * FormData convention — the same shape uploadPaymentQrImage appends as
 * `qr_image`.
 */
export function buildMemberPhotoForm(image: MemberPhotoImage): FormData {
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
 * POST the photo, with the same 401 → refresh-once → retry path as the
 * JSON client and the QR upload: the retry re-sends the SAME
 * Idempotency-Key, so a retried upload replays instead of executing
 * twice. `fetchImpl` / `refreshAccessToken` are injectable for tests;
 * production callers pass the global fetch and a refresh that returns
 * the fresh access token (or undefined when refresh fails / no session).
 */
export async function executeMemberPhotoUpload(args: {
  baseUrl: string;
  memberId: number;
  image: MemberPhotoImage;
  token?: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
  refreshAccessToken?: () => Promise<string | undefined>;
}): Promise<MemberPhotoUploadOutcome> {
  const fetchFn = args.fetchImpl ?? fetch;
  const path = memberPhotoUploadPath(args.memberId);

  const makeUpload = async (token?: string): Promise<Response> => {
    // Fresh FormData per attempt — a consumed multipart body cannot
    // be re-sent on the 401-refresh retry.
    return fetchFn(`${args.baseUrl}${path}`, {
      method: 'POST',
      headers: buildQrUploadHeaders({ token, idempotencyKey: args.idempotencyKey }),
      body: buildMemberPhotoForm(args.image),
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
      const refreshedToken = await args.refreshAccessToken();
      if (refreshedToken) {
        response = await makeUpload(refreshedToken);
      } else {
        return { ok: false, error: { message: 'Session expired. Please sign in again.', status: 401 } };
      }
    }
    return await parseResult(response);
  } catch {
    return { ok: false, error: { message: 'Could not upload the member photo. Check your connection and try again.' } };
  }
}
