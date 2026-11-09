import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemberPhotoForm,
  executeMemberPhotoUpload,
  memberPhotoUploadPath,
  type MemberPhotoImage,
} from '../services/memberPhotoUpload';

// Member photo (§5.3): uploadMemberPhoto posts multipart `photo` + a
// fresh Idempotency-Key, with the 401-refresh retry re-sending the SAME
// key. apiClient.ts cannot be imported under node (its chain pulls in
// react-native), so these tests exercise the fetch half in
// memberPhotoUpload.ts with a mocked fetch — apiClient.uploadMemberPhoto
// is a thin wrapper supplying config, session and refresh around it.
//
// NOTE: under node, FormData stringifies the RN { uri, name, type }
// part object, so the multipart body can only assert the field name
// (`photo`) — the uri/name/type payload shape is RN-native and is
// covered by tsc + the device build, not here.

const IMAGE: MemberPhotoImage = {
  uri: 'file:///cache/cropped123.jpg',
  name: 'profile.jpg',
  mimeType: 'image/jpeg',
};

const BASE_URL = 'https://api.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type CapturedCall = {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: unknown };
};

function mockFetch(responses: Response[]): { calls: CapturedCall[]; fetchImpl: typeof fetch } {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string, init: CapturedCall['init']) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('mock fetch: no response left');
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('endpoint path is POST /api/mobile/v1/members/<id>/photo', () => {
  assert.equal(memberPhotoUploadPath(42), '/api/mobile/v1/members/42/photo');
});

test('form body carries the `photo` multipart field', () => {
  const form = buildMemberPhotoForm(IMAGE);
  assert.equal(form.has('photo'), true);
});

test('happy path posts multipart + Idempotency-Key + Bearer, returns the URL', async () => {
  const { calls, fetchImpl } = mockFetch([
    jsonResponse({ success: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } }),
  ]);
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE_URL}/api/mobile/v1/members/42/photo`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers?.['Idempotency-Key'], 'key-1');
  assert.equal(calls[0].init.headers?.Authorization, 'Bearer tok-1');
  assert.equal(calls[0].init.headers?.Accept, 'application/json');
  // Multipart body encodes the `photo` field.
  const bodyText = await new Response(calls[0].init.body as FormData).text();
  assert.match(bodyText, /name="photo"/);
});

test('no token → no Authorization header', async () => {
  const { calls, fetchImpl } = mockFetch([
    jsonResponse({ success: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } }),
  ]);
  await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    idempotencyKey: 'key-1',
    fetchImpl,
  });
  assert.equal('Authorization' in (calls[0].init.headers ?? {}), false);
  assert.equal(calls[0].init.headers?.['Idempotency-Key'], 'key-1');
});

test('401 → refresh → retry re-sends the SAME Idempotency-Key with the new token', async () => {
  const { calls, fetchImpl } = mockFetch([
    jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }, 401),
    jsonResponse({ success: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } }),
  ]);
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl,
    refreshAccessToken: async () => 'tok-2',
  });

  assert.deepEqual(result, { ok: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers?.['Idempotency-Key'], 'key-1');
  assert.equal(calls[1].init.headers?.['Idempotency-Key'], 'key-1');
  assert.equal(calls[0].init.headers?.Authorization, 'Bearer tok-1');
  assert.equal(calls[1].init.headers?.Authorization, 'Bearer tok-2');
});

test('401 with failed refresh → session-expired 401, no second upload', async () => {
  const { calls, fetchImpl } = mockFetch([
    jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }, 401),
  ]);
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl,
    refreshAccessToken: async () => undefined,
  });

  assert.deepEqual(result, {
    ok: false,
    error: { message: 'Session expired. Please sign in again.', status: 401 },
  });
  assert.equal(calls.length, 1);
});

test('backend error envelope → backend message + status', async () => {
  const { fetchImpl } = mockFetch([
    jsonResponse({ success: false, error: { code: 'BAD_IMAGE', message: 'choose a JPEG, PNG, or WebP image under 3 MB' } }, 400),
  ]);
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl,
  });
  assert.deepEqual(result, {
    ok: false,
    error: { message: 'choose a JPEG, PNG, or WebP image under 3 MB', code: 'BAD_IMAGE', status: 400 },
  });
});

test('non-JSON 500 → controlled upload-failed error, never a throw', async () => {
  const { fetchImpl } = mockFetch([new Response('boom', { status: 500 })]);
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl,
  });
  assert.deepEqual(result, {
    ok: false,
    error: { message: 'Upload failed (500).', status: 500 },
  });
});

test('network failure → controlled connection error, never a throw', async () => {
  const failingFetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  const result = await executeMemberPhotoUpload({
    baseUrl: BASE_URL,
    memberId: 42,
    image: IMAGE,
    token: 'tok-1',
    idempotencyKey: 'key-1',
    fetchImpl: failingFetch,
  });
  assert.deepEqual(result, {
    ok: false,
    error: { message: 'Could not upload the member photo. Check your connection and try again.' },
  });
});
