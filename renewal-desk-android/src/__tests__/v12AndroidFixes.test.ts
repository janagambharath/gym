import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCampaignCreateBody } from '../services/campaignCreateBody';
import { extractOtpPayload, unwrapMemberEnvelope } from '../services/memberEnvelope';
import { resolveClaimOutcome } from '../services/memberClaim';
import {
  buildMemberSelfPhotoForm,
  executeMemberSelfPhotoUpload,
  memberSelfPhotoUploadPath,
  type MemberPhotoImage,
} from '../services/memberSelfPhotoUpload';
import { deriveMemberStatus } from '../services/memberStatus';
import { broadcastScope, keyForAction, scopeHash, shouldReleaseKey } from '../services/stableKey';
import type { CampaignTemplate } from '../types';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

// ── V12-D1 / V12-C1: flat OTP envelope ─────────────────────────────

test('V12-D1: flat unwrap returns the top-level payload (challenge / gym_name)', () => {
  const envelope = { success: true, challenge: 'abc.123', gym_name: 'Yodha Fitness' };
  const payload = unwrapMemberEnvelope<{ challenge: string | null; gym_name: string | null }>(
    envelope,
    'flat',
  );
  assert.equal(payload?.challenge, 'abc.123');
  assert.equal(payload?.gym_name, 'Yodha Fitness');
});

test('V12-D1: data unwrap still returns envelope.data for wrapped endpoints', () => {
  const envelope = { success: true, data: { token: 't' } };
  assert.deepEqual(unwrapMemberEnvelope<{ token: string }>(envelope, 'data'), { token: 't' });
  assert.deepEqual(unwrapMemberEnvelope<{ token: string }>(envelope), { token: 't' });
});

test('V12-D1: flat unwrap of a data-wrapped envelope would lose the payload — request-otp must use flat', () => {
  // Guard the regression shape: envelope.data is undefined on the
  // flat request-otp payload, so 'data' mode returns undefined.
  const flatEnvelope = { success: true, challenge: 'abc.123', gym_name: 'Gym' };
  assert.equal(unwrapMemberEnvelope(flatEnvelope, 'data'), undefined);
});

test('V12-D1: extractOtpPayload reads a null challenge (no account for this number)', () => {
  assert.deepEqual(
    extractOtpPayload({ success: true, challenge: null, gym_name: null }),
    { challenge: null, gym_name: null },
  );
});

test('V12-D1: extractOtpPayload never throws on a malformed envelope', () => {
  assert.equal(extractOtpPayload(null), null);
  assert.equal(extractOtpPayload(undefined), null);
  assert.deepEqual(extractOtpPayload({ success: true }), { challenge: null, gym_name: null });
});

test('V12-D1: requestOtp reads the flat envelope + the login screen guards a null challenge', () => {
  const client = readSource('../services/memberApiClient.ts');
  assert.match(client, /unwrap: 'flat'/);
  assert.match(client, /request-otp/);
  const login = readSource('../screens/member/MemberLoginScreen.tsx');
  assert.match(login, /if \(!result\.data\?\.challenge\)/);
  assert.match(login, /No member account found for this number — ask your gym\./);
});

// ── V12-D2: campaign create body keys ───────────────────────────────

const TEMPLATE: CampaignTemplate = {
  name: 'expired_member_reactivation_01',
  purpose: 'recovery',
  title: 'Expired Reactivation',
  variables: ['name', 'gym', 'price', 'link'],
  description: 'Win back expired members',
  body_preview: 'Hi {{1}}, your membership at {{2}} has expired.',
};

test('V12-D2: create body sends whatsapp_template_name, never template_name', () => {
  const body = buildCampaignCreateBody({
    name: 'Reactivate Oct',
    campaignType: 'recovery',
    promoPreset: 'special_offer',
    promoPresetDesc: 'Limited-time discount on membership plans',
    template: TEMPLATE,
    segmentType: 'all_expired',
    excludeRecent: true,
  });
  assert.equal(body.whatsapp_template_name, 'expired_member_reactivation_01');
  assert.equal('template_name' in body, false);
  assert.equal(body.segment_type, 'all_expired');
});

test('V12-D2: message_template is the template body preview', () => {
  const body = buildCampaignCreateBody({
    name: 'Reactivate Oct',
    campaignType: 'recovery',
    promoPreset: 'special_offer',
    promoPresetDesc: 'Limited-time discount on membership plans',
    template: TEMPLATE,
    segmentType: 'all_expired',
    excludeRecent: true,
  });
  assert.equal(body.message_template, 'Hi {{1}}, your membership at {{2}} has expired.');
});

test('V12-D2: promotion with no body preview falls back to the preset description as offer text', () => {
  const body = buildCampaignCreateBody({
    name: 'Diwali Offer',
    campaignType: 'promotion',
    promoPreset: 'festival_offer',
    promoPresetDesc: 'Holiday and seasonal special promotions',
    template: { ...TEMPLATE, name: 'gym_special_offer_01', body_preview: '' },
    segmentType: 'all_customers',
    excludeRecent: true,
  });
  assert.equal(body.whatsapp_template_name, 'gym_special_offer_01');
  assert.equal(body.message_template, 'Holiday and seasonal special promotions');
});

test('V12-D2: campaign screen no longer sends template_name and retrySend reuses the launch key', () => {
  const screen = readSource('../screens/CampaignCreateScreen.tsx');
  assert.doesNotMatch(screen, /template_name: selectedTemplate/);
  assert.match(screen, /buildCampaignCreateBody\(/);
  assert.match(screen, /campaign-send:\$\{campaignId\}/);
  assert.match(screen, /sendKeyRef/);
});

// ── V12-D3: paused member status ────────────────────────────────────

test('V12-D3: paused member with valid dates is PAUSED, never Active', () => {
  const status = deriveMemberStatus({ status: 'paused', is_expired: false, days_left: 42 });
  assert.equal(status.tone, 'paused');
  assert.equal(status.label, 'Membership Paused');
  assert.equal(status.shortLabel, 'Paused');
});

test('V12-D3: active / expiring / expired derivations unchanged', () => {
  assert.equal(deriveMemberStatus({ status: 'active', is_expired: false, days_left: 30 }).tone, 'active');
  assert.equal(deriveMemberStatus({ status: 'active', is_expired: false, days_left: 5 }).tone, 'expiring');
  assert.equal(deriveMemberStatus({ status: 'active', is_expired: true, days_left: -3 }).tone, 'expired');
  // A paused member whose dates also lapsed still reads paused —
  // the pause is the operative reason the door is blocked and the
  // action is "ask the gym to resume", not a renewal.
  assert.equal(deriveMemberStatus({ status: 'paused', is_expired: true, days_left: -2 }).tone, 'paused');
});

test('V12-D3: home + membership screens derive from member.status via deriveMemberStatus', () => {
  // The 'Membership Paused' literal lives in the pure helper
  // (unit-tested above); the screens render memberStatus.label.
  const status = readSource('../services/memberStatus.ts');
  assert.match(status, /Membership Paused/);
  const home = readSource('../screens/member/MemberHomeScreen.tsx');
  assert.match(home, /deriveMemberStatus\(/);
  assert.match(home, /memberStatus\.label/);
  assert.match(home, /door access stays blocked until your gym resumes it/);
  const membership = readSource('../screens/member/MemberMembershipScreen.tsx');
  assert.match(membership, /deriveMemberStatus\(/);
  assert.match(membership, /memberStatus\.shortLabel/);
});

// ── V12-D4: already_pending + demand ────────────────────────────────

test('V12-D4: already_pending resolves to already-pending, not submitted', () => {
  assert.equal(resolveClaimOutcome({ ok: true, data: { already_pending: true } }), 'already-pending');
  assert.equal(resolveClaimOutcome({ ok: true, data: { already_pending: false } }), 'submitted');
  assert.equal(resolveClaimOutcome({ ok: true, data: {} }), 'submitted');
  assert.equal(resolveClaimOutcome({ ok: false }), 'failed');
});

test('V12-D4: renew screen branches on already_pending and loads the demand', () => {
  const screen = readSource('../screens/member/MemberRenewScreen.tsx');
  assert.match(screen, /resolveClaimOutcome\(/);
  assert.match(screen, /Payment Already Pending/);
  assert.match(screen, /No new payment was submitted/);
  assert.match(screen, /fetchMemberDashboard\(\)/);
  assert.match(screen, /active_renewal_demand/);
  assert.match(screen, /SPECIAL RENEWAL OFFER FROM YOUR GYM/);
  assert.match(screen, /Offer price locked by your gym/);
  const client = readSource('../services/memberApiClient.ts');
  assert.match(client, /active_renewal_demand: ActiveRenewalDemand \| null/);
});

// ── V12-D5: stable keys on unlock / broadcast / campaign retry ─────

test('V12-D5: broadcast scope is stable per (audience, message) and changes with the text', () => {
  assert.equal(broadcastScope('active', 'Hello gym!'), broadcastScope('active', 'Hello gym!'));
  assert.notEqual(broadcastScope('active', 'Hello gym!'), broadcastScope('active', 'Hello gym!!'));
  assert.notEqual(broadcastScope('active', 'Hello gym!'), broadcastScope('all', 'Hello gym!'));
  assert.equal(scopeHash('same'), scopeHash('same'));
});

test('V12-D5: keyForAction reuses the held key for the same scope (retry replays)', () => {
  const first = keyForAction(undefined, 'broadcast:active:abc');
  const second = keyForAction(first.slot, 'broadcast:active:abc');
  assert.equal(second.key, first.key);
  const other = keyForAction(first.slot, 'broadcast:active:xyz');
  assert.notEqual(other.key, first.key);
});

test('V12-D5: remote unlock + broadcast send under a stable key, released on success / 4xx only', () => {
  const access = readSource('../screens/AccessScreen.tsx');
  assert.match(access, /unlockKeyRef/);
  assert.match(access, /keyForAction\(unlockKeyRef\.current, 'remote-unlock'\)/);
  assert.match(access, /'Idempotency-Key': unlockKey/);
  const whatsapp = readSource('../screens/WhatsAppScreen.tsx');
  assert.match(whatsapp, /broadcastKeyRef/);
  assert.match(whatsapp, /broadcastScope\(broadcastAudience, broadcastMessage\)/);
  assert.match(whatsapp, /'Idempotency-Key': broadcastKey/);
  assert.equal(shouldReleaseKey(true), true);
  assert.equal(shouldReleaseKey(false, 400), true);
  assert.equal(shouldReleaseKey(false, 500), false);
  assert.equal(shouldReleaseKey(false, undefined), false);
});

// ── V12-D6 / V12-D7 ─────────────────────────────────────────────────

test('V12-D6: enroll toast reads device_enroll_number (the key the backend sends)', () => {
  const screen = readSource('../screens/MemberDetailScreen.tsx');
  assert.match(screen, /device_enroll_number: string/);
  assert.match(screen, /res\.data\.device_enroll_number/);
  assert.doesNotMatch(screen, /res\.data\.enroll_number/);
});

test('V12-D7: PaymentSetup PUT is typed as the unwrapped PaymentSettingsData', () => {
  const screen = readSource('../screens/PaymentSetupScreen.tsx');
  assert.match(screen, /apiRequest<PaymentSettingsData>/);
  assert.doesNotMatch(screen, /\{ message: string; data: PaymentSettingsData \}/);
});

// ── V12-M7: sign-out revokes the server session ─────────────────────

test('V12-M7: member logout POSTs /api/member/v1/auth/logout with the refresh token, local clear as fallback', () => {
  const client = readSource('../services/memberApiClient.ts');
  assert.match(client, /logoutMemberSession/);
  assert.match(client, /\/api\/member\/v1\/auth\/logout/);
  assert.match(client, /refresh_token: refreshToken/);
  const app = readSource('../../App.tsx');
  assert.match(app, /await logoutMemberSession\(\)/);
  // The profile screen must NOT clear the session before the logout
  // POST — the stored refresh token is what the POST revokes.
  const profile = readSource('../screens/member/MemberProfileScreen.tsx');
  assert.doesNotMatch(profile, /await clearMemberSession\(\)/);
});

// ── V12-M1: rejected payment reason ─────────────────────────────────

test('V12-M1: payment type carries rejected_reason / rejected_at and history renders reason + next step', () => {
  const client = readSource('../services/memberApiClient.ts');
  assert.match(client, /rejected_reason: string \| null/);
  assert.match(client, /rejected_at: string \| null/);
  const screen = readSource('../screens/member/MemberPaymentHistoryScreen.tsx');
  assert.match(screen, /item\.rejected_reason/);
  assert.match(screen, /Please re-submit your payment or contact your gym for help\./);
});

// ── V12-L7: member photo + profile edit ─────────────────────────────

test('V12-L7: member photo upload posts multipart photo to the member endpoint', () => {
  assert.equal(memberSelfPhotoUploadPath(), '/api/member/v1/profile/photo');
  const form = buildMemberSelfPhotoForm({
    uri: 'file:///cache/cropped123.jpg',
    name: 'profile.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(form.has('photo'), true);
});

test('V12-L7: member photo upload parses success and re-sends the same key on 401-refresh retry', async () => {
  const IMAGE: MemberPhotoImage = {
    uri: 'file:///cache/cropped123.jpg',
    name: 'profile.jpg',
    mimeType: 'image/jpeg',
  };
  type CapturedCall = { url: string; init: { headers?: Record<string, string> } };
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string, init: CapturedCall['init']) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ success: false, error: 'x' }), { status: 401 });
    }
    return new Response(
      JSON.stringify({ success: true, data: { profile_photo_url: 'https://cdn.test/p.jpg' } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const result = await executeMemberSelfPhotoUpload({
    baseUrl: 'https://api.test',
    image: IMAGE,
    token: 'old-token',
    idempotencyKey: 'key-1',
    fetchImpl,
    refreshAccessToken: async () => ({ ok: true as const, token: 'new-token' }),
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.test/api/member/v1/profile/photo');
  assert.equal(calls[0].init.headers?.['Idempotency-Key'], 'key-1');
  assert.equal(calls[1].init.headers?.['Idempotency-Key'], 'key-1');
  assert.equal(calls[1].init.headers?.Authorization, 'Bearer new-token');
});

test('V12-L7: transient refresh failure on photo upload is a connection error, not an expiry', async () => {
  const IMAGE: MemberPhotoImage = {
    uri: 'file:///cache/cropped123.jpg',
    name: 'profile.jpg',
    mimeType: 'image/jpeg',
  };
  const fetchImpl = (async () => {
    return new Response(JSON.stringify({ success: false }), { status: 401 });
  }) as unknown as typeof fetch;
  const result = await executeMemberSelfPhotoUpload({
    baseUrl: 'https://api.test',
    image: IMAGE,
    token: 'old-token',
    idempotencyKey: 'key-1',
    fetchImpl,
    refreshAccessToken: async () => ({ ok: false as const, failure: 'transient' as const }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.message, /Check your connection/);
    assert.equal(result.error.status, undefined);
  }
});

test('V12-L7: profile screen offers photo upload + email/address/gender edit via the member client', () => {
  const screen = readSource('../screens/member/MemberProfileScreen.tsx');
  assert.match(screen, /launchImageLibraryAsync/);
  assert.match(screen, /uploadMemberPhoto\(/);
  assert.match(screen, /removeMemberPhoto\(\)/);
  assert.match(screen, /updateMemberProfile\(/);
  assert.match(screen, /Change photo/);
  assert.match(screen, /Edit Details/);
  const client = readSource('../services/memberApiClient.ts');
  assert.match(client, /updateMemberProfile/);
  assert.match(client, /\/api\/member\/v1\/profile\/photo/);
  assert.match(client, /profile_photo_url: string \| null/);
});
