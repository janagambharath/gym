// Parity-gap tests (GAP 3 staff edit, GAP 5 WhatsApp recent-message log).
//
// Screens are React Native components and cannot render under node:test,
// so the tests cover the exact API contract the screens call through the
// service modules: endpoint path, HTTP method, request body, and the
// last-15 slicing / display fallbacks the PWA uses. The request function
// is injected, so no network or native modules are involved.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaffEditBody,
  staffEditPath,
  updateStaffMember,
} from '../services/staffApi';
import {
  fetchRecentWhatsAppMessages,
  logDisplayName,
  logDisplayTemplate,
  recentMessages,
  whatsappLogsPath,
  type WhatsAppLogEntry,
} from '../services/whatsappLogApi';

// --- GAP 3: staff edit -------------------------------------------------

test('staff edit targets PATCH /api/mobile/v1/staff/<id>', () => {
  assert.equal(staffEditPath(42), '/api/mobile/v1/staff/42');
});

test('staff edit body carries the edited name (trimmed) and role only', () => {
  assert.deepEqual(
    buildStaffEditBody({ full_name: '  Vikram Singh  ', role: 'gym_owner' }),
    { full_name: 'Vikram Singh', role: 'gym_owner' },
  );
  // No phone/email keys: the backend User model has no phone column and
  // PATCH silently drops unknown fields, so they must never be sent.
  assert.deepEqual(
    Object.keys(buildStaffEditBody({ full_name: 'Asha', role: 'staff' })).sort(),
    ['full_name', 'role'],
  );
});

test('staff edit calls PATCH with the edited fields', async () => {
  const calls: { path: string; options: unknown }[] = [];
  const fakeRequest = (async (path: string, options: unknown) => {
    calls.push({ path, options });
    return {
      ok: true,
      data: {
        id: 42,
        full_name: 'Vikram Singh',
        email: 'vikram@example.com',
        role: 'gym_owner',
        is_active: true,
        last_login_at: null,
        created_at: null,
      },
    };
  }) as Parameters<typeof updateStaffMember>[2];

  const res = await updateStaffMember(
    42,
    { full_name: 'Vikram Singh', role: 'gym_owner' },
    fakeRequest,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/staff/42');
  assert.deepEqual(calls[0].options, {
    method: 'PATCH',
    body: { full_name: 'Vikram Singh', role: 'gym_owner' },
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.full_name, 'Vikram Singh');
    assert.equal(res.data.role, 'gym_owner');
  }
});

test('staff edit surfaces a backend error without retrying', async () => {
  let callCount = 0;
  const fakeRequest = (async () => {
    callCount += 1;
    return { ok: false, error: { message: 'Staff member not found.' } };
  }) as Parameters<typeof updateStaffMember>[2];

  const res = await updateStaffMember(999, { full_name: 'Ghost', role: 'staff' }, fakeRequest);
  assert.equal(callCount, 1);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.message, 'Staff member not found.');
  }
});

// --- GAP 5: WhatsApp recent-message log --------------------------------

const makeLog = (id: number, overrides: Partial<WhatsAppLogEntry> = {}): WhatsAppLogEntry => ({
  id,
  member_id: id,
  member_name: `Member ${id}`,
  phone: `+9199999999${String(id).padStart(2, '0')}`,
  template: 'renewal_reminder',
  message_type: 'whatsapp',
  status: 'sent',
  sent_at: '2026-11-06T10:00:00Z',
  created_at: '2026-11-06T10:00:00Z',
  ...overrides,
});

test('WhatsApp log fetches GET /api/mobile/v1/whatsapp/logs?page_size=20', () => {
  assert.equal(whatsappLogsPath(), '/api/mobile/v1/whatsapp/logs?page_size=20');
});

test('recent log keeps only the last 15 messages, newest first', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => makeLog(i + 1));
  const shown = recentMessages(twenty);
  assert.equal(shown.length, 15);
  assert.deepEqual(
    shown.map((l) => l.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  );
  assert.equal(recentMessages([]).length, 0);
  assert.equal(recentMessages(null).length, 0);
  assert.equal(recentMessages(undefined).length, 0);
});

test('log fetch returns the last 15 messages from the endpoint', async () => {
  const twenty = Array.from({ length: 20 }, (_, i) => makeLog(i + 1));
  const calls: string[] = [];
  const fakeRequest = (async (path: string) => {
    calls.push(path);
    return { ok: true, data: { logs: twenty } };
  }) as Parameters<typeof fetchRecentWhatsAppMessages>[0];

  const res = await fetchRecentWhatsAppMessages(fakeRequest);
  assert.deepEqual(calls, ['/api/mobile/v1/whatsapp/logs?page_size=20']);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.length, 15);
    assert.equal(res.data[0].member_name, 'Member 1');
    assert.equal(res.data[14].member_name, 'Member 15');
  }
});

test('log fetch accepts the PWA `messages` fallback key', async () => {
  const fakeRequest = (async () => ({
    ok: true,
    data: { messages: [makeLog(7)] },
  })) as Parameters<typeof fetchRecentWhatsAppMessages>[0];

  const res = await fetchRecentWhatsAppMessages(fakeRequest);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].id, 7);
  }
});

test('log fetch surfaces a backend error', async () => {
  const fakeRequest = (async () => ({
    ok: false,
    error: { message: 'Could not reach the server.' },
  })) as Parameters<typeof fetchRecentWhatsAppMessages>[0];

  const res = await fetchRecentWhatsAppMessages(fakeRequest);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.message, 'Could not reach the server.');
  }
});

test('log display falls back like the PWA: name → phone → Unknown, template → type → Message', () => {
  assert.equal(logDisplayName(makeLog(1, { member_name: 'Asha' })), 'Asha');
  assert.equal(logDisplayName(makeLog(1, { member_name: null })), '+919999999901');
  assert.equal(logDisplayName(makeLog(1, { member_name: null, phone: null })), 'Unknown');
  assert.equal(logDisplayTemplate(makeLog(1, { template: 'renewal_reminder' })), 'renewal_reminder');
  assert.equal(logDisplayTemplate(makeLog(1, { template: null })), 'whatsapp');
  assert.equal(
    logDisplayTemplate(makeLog(1, { template: null, message_type: null })),
    'Message',
  );
});
