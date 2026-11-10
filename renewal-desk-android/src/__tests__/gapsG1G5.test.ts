import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAuditLogsUrl,
  formatAuditAction,
  formatAuditMetadata,
  formatAuditResource,
  hasMoreAuditLogs,
  mergeAuditLogPage,
  type AuditLogItem,
} from '../services/auditLog';
import {
  decommissionTerminal,
  decommissionTerminalUrl,
  replaceTerminal,
  replaceTerminalUrl,
  restoreFingerprints,
  restoreFingerprintsUrl,
  restoreQueuedCount,
  type AdmsRequest,
} from '../services/admsIntegration';
import {
  blockedActiveCount,
  buildBlockedActiveUrl,
  hasBlockedActiveMembers,
  type BlockedActiveMember,
} from '../services/blockedActive';
import { getTerminalOffline, hasTerminalOffline } from '../services/terminalOffline';
import { canOpenAuditLog, rrrGrowthOwnerSections } from '../services/roleAccess';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function fakeRequest(calls: { path: string; options?: unknown }[]): AdmsRequest {
  return (async (path, options) => {
    calls.push({ path, options });
    return { ok: true, data: {} };
  }) as AdmsRequest;
}

// ---------------------------------------------------------------------------
// G1 — Terminal replace / decommission call the exact contract endpoints.
// ---------------------------------------------------------------------------

test('G1: replace posts serial + name + confirm:true to the replace endpoint', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  const result = await replaceTerminal(fakeRequest(calls), 42, {
    device_serial: 'CUB7262300999',
    device_name: 'New entry terminal',
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/rrr/integrations/42/replace');
  assert.deepEqual(calls[0].options, {
    method: 'POST',
    body: { device_serial: 'CUB7262300999', device_name: 'New entry terminal', confirm: true },
  });
});

test('G1: replace URL builder matches the backend route', () => {
  assert.equal(replaceTerminalUrl(7), '/api/mobile/v1/rrr/integrations/7/replace');
});

test('G1: decommission posts confirm:true to the decommission endpoint', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  const result = await decommissionTerminal(fakeRequest(calls), 42);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/rrr/integrations/42/decommission');
  assert.deepEqual(calls[0].options, { method: 'POST', body: { confirm: true } });
});

test('G1: decommission URL builder matches the backend route', () => {
  assert.equal(decommissionTerminalUrl(7), '/api/mobile/v1/rrr/integrations/7/decommission');
});

// ---------------------------------------------------------------------------
// G4 — Fingerprint restore queues restores and reports the queued count.
// ---------------------------------------------------------------------------

test('G4: restore-fingerprints posts an empty body to the contract endpoint', async () => {
  const calls: { path: string; options?: unknown }[] = [];
  const result = await restoreFingerprints(fakeRequest(calls), 42);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/mobile/v1/rrr/integrations/42/restore-fingerprints');
  assert.deepEqual(calls[0].options, { method: 'POST', body: {} });
});

test('G4: restore URL builder matches the backend route', () => {
  assert.equal(restoreFingerprintsUrl(7), '/api/mobile/v1/rrr/integrations/7/restore-fingerprints');
});

test('G4: queued count reads queued_count first, then aliases, then 0', () => {
  assert.equal(restoreQueuedCount({ queued_count: 12 }), 12);
  assert.equal(restoreQueuedCount({ count: 5 }), 5);
  assert.equal(restoreQueuedCount({ restored_count: 3 }), 3);
  assert.equal(restoreQueuedCount({}), 0);
});

// ---------------------------------------------------------------------------
// G2 — Audit log: URL builder, filters, human-readable rows, pagination.
// ---------------------------------------------------------------------------

test('G2: audit-logs URL defaults to page 1, 20 per page', () => {
  assert.equal(buildAuditLogsUrl(), '/api/mobile/v1/audit-logs?page=1&per_page=20');
});

test('G2: audit-logs URL encodes page + action + date filters, omits blanks', () => {
  const url = buildAuditLogsUrl({ page: 2, per_page: 50, action: 'member_blocked', from: '2026-11-01', to: '2026-11-10' });
  assert.equal(
    url,
    '/api/mobile/v1/audit-logs?page=2&per_page=50&action=member_blocked&from=2026-11-01&to=2026-11-10',
  );
  assert.equal(buildAuditLogsUrl({ action: '  ', from: '', to: '' }), '/api/mobile/v1/audit-logs?page=1&per_page=20');
});

test('G2: audit-logs URL includes actor_id when given', () => {
  assert.equal(
    buildAuditLogsUrl({ actor_id: 9 }),
    '/api/mobile/v1/audit-logs?page=1&per_page=20&actor_id=9',
  );
});

test('G2: action labels are human-readable', () => {
  assert.equal(formatAuditAction('member_blocked'), 'Member Blocked');
  assert.equal(formatAuditAction('terminal_replaced'), 'Terminal Replaced');
  assert.equal(formatAuditAction('fingerprint_restore_queued'), 'Fingerprint Restore Queued');
});

test('G2: resource renders as type + id, or a dash with no resource', () => {
  const item = (over: Partial<AuditLogItem>): AuditLogItem => ({
    id: 1, created_at: null, actor_name: 'Owner', action: 'member_blocked',
    resource_type: null, resource_id: null, metadata: null, ...over,
  });
  assert.equal(formatAuditResource(item({ resource_type: 'member', resource_id: 42 })), 'member #42');
  assert.equal(formatAuditResource(item({ resource_type: 'integration', resource_id: null })), 'integration');
  assert.equal(formatAuditResource(item({})), '—');
});

test('G2: metadata summary renders key/value pairs, never raw objects', () => {
  assert.equal(formatAuditMetadata(null), '—');
  assert.equal(formatAuditMetadata('plain note'), 'plain note');
  assert.equal(formatAuditMetadata({ serial: 'CUB1', reason: 'swap' }), 'serial: CUB1 · reason: swap');
  assert.equal(formatAuditMetadata({}), '—');
});

test('G2: pagination — hasMore is false once all rows are loaded', () => {
  assert.equal(hasMoreAuditLogs(40, 20), true);
  assert.equal(hasMoreAuditLogs(40, 40), false);
  assert.equal(hasMoreAuditLogs(0, 0), false);
});

test('G2: merging a page de-duplicates by id', () => {
  const row = (id: number): AuditLogItem => ({
    id, created_at: null, actor_name: null, action: 'x', resource_type: null, resource_id: null, metadata: null,
  });
  assert.deepEqual(mergeAuditLogPage([row(1), row(2)], [row(2), row(3)]).map((r) => r.id), [1, 2, 3]);
});

test('G2: audit log is owner-only — staff never get the entry', () => {
  assert.equal(canOpenAuditLog(true), true);
  assert.equal(canOpenAuditLog(false), false);
});

test('G2: terminal lifecycle controls are owner-only on the RRR screen', () => {
  assert.equal(rrrGrowthOwnerSections(true).showTerminalLifecycle, true);
  assert.equal(rrrGrowthOwnerSections(false).showTerminalLifecycle, false);
});

// ---------------------------------------------------------------------------
// G3 — Terminal-offline: card shown/hidden purely by the payload flag.
// ---------------------------------------------------------------------------

test('G3: offline card shows when the access summary carries terminal_offline', () => {
  const summary = { terminal_offline: { since: '2026-11-10T05:00:00Z', last_success_at: '2026-11-10T04:58:00Z' } };
  assert.equal(hasTerminalOffline(summary), true);
  assert.deepEqual(getTerminalOffline(summary), summary.terminal_offline);
});

test('G3: offline card hides when the field is absent or null (polling resumed)', () => {
  assert.equal(hasTerminalOffline({}), false);
  assert.equal(hasTerminalOffline({ terminal_offline: null }), false);
  assert.equal(hasTerminalOffline(null), false);
  assert.equal(hasTerminalOffline(undefined), false);
  assert.equal(getTerminalOffline({}), null);
});

// ---------------------------------------------------------------------------
// G5 — Blocked-active: card renders ONLY when non-empty.
// ---------------------------------------------------------------------------

test('G5: blocked-active URL matches the contract endpoint', () => {
  assert.equal(buildBlockedActiveUrl(), '/api/mobile/v1/rrr/blocked-active');
});

test('G5: card hidden when empty, shown with members', () => {
  assert.equal(hasBlockedActiveMembers([]), false);
  assert.equal(hasBlockedActiveMembers(null), false);
  assert.equal(hasBlockedActiveMembers(undefined), false);
  const member: BlockedActiveMember = {
    id: 1, name: 'Safi', phone: '9999999999', enroll_number: '15', membership_end: '2026-11-13',
  };
  assert.equal(hasBlockedActiveMembers([member]), true);
  assert.equal(blockedActiveCount([member, member]), 2);
  assert.equal(blockedActiveCount([]), 0);
});

// ---------------------------------------------------------------------------
// Wiring — the screens/surfaces exist and call the contract endpoints.
// ---------------------------------------------------------------------------

test('G1/G4: RRR screen has replace / decommission / restore buttons with confirm flows', () => {
  const src = readSource('../screens/RrrGrowthScreen.tsx');
  assert.match(src, /Replace terminal/);
  assert.match(src, /Decommission terminal/);
  assert.match(src, /Restore fingerprints/);
  assert.match(src, /replaceTerminal\(apiRequest, direct\.id/);
  assert.match(src, /decommissionTerminal\(apiRequest, direct\.id/);
  assert.match(src, /restoreFingerprints\(apiRequest, direct\.id/);
  assert.match(src, /Replace this terminal\?/);
  assert.match(src, /Decommission this terminal\?/);
  assert.match(src, /Restore fingerprints\?/);
  assert.match(src, /supervised physical door test must pass again/);
  assert.match(src, /Commissioning: \{direct\.commissioning_status/);
  assert.match(src, /showTerminalLifecycle/);
  // No template data is ever rendered by the restore flow.
  assert.doesNotMatch(src, /template_data|fingerprint_template/);
});

test('G2: AuditLog screen fetches /audit-logs with pagination + filters and is wired in navigation', () => {
  const screen = readSource('../screens/AuditLogScreen.tsx');
  assert.match(screen, /buildAuditLogsUrl\(/);
  assert.match(screen, /formatAuditAction\(item\.action\)/);
  assert.match(screen, /formatAuditMetadata\(item\.metadata\)/);
  assert.match(screen, /hasMoreAuditLogs\(total, items\.length\)/);
  assert.match(screen, /Filter by action/);
  assert.match(screen, /From YYYY-MM-DD/);
  const app = readSource('../../App.tsx');
  assert.match(app, /AuditLogScreen/);
  assert.match(app, /name="AuditLog"/);
  assert.match(app, /onNavigateAuditLog/);
  const settings = readSource('../screens/SettingsScreen.tsx');
  assert.match(settings, /onNavigateAuditLog/);
  assert.match(settings, /label="Audit Log"/);
  // Owner-only gate on the entry point.
  assert.match(settings, /\{isOwner \? \(\s*<MenuItem icon="document" label="Audit Log"/);
});

test('G3: inbox renders terminal_offline distinctly with serial + last-seen', () => {
  const src = readSource('../screens/NotificationsScreen.tsx');
  assert.match(src, /key: 'terminal_offline', label: 'Terminal'/);
  assert.match(src, /case 'terminal_offline':/);
  assert.match(src, /terminalOfflineCard/);
  assert.match(src, /Terminal \$\{terminalSerial\}/);
  assert.match(src, /last seen \$\{formatTimeAgo\(terminalLastSeen\)\}/);
});

test('G3/G5: dashboard renders the offline card from the payload and the blocked-active card only when non-empty', () => {
  const src = readSource('../screens/DashboardScreen.tsx');
  assert.match(src, /getTerminalOffline\(data\?\.access_summary\)/);
  assert.match(src, /Terminal offline since \{formatDateTime\(terminalOffline\.since\)\}/);
  assert.match(src, /View Live Access/);
  assert.match(src, /Check terminal/);
  assert.match(src, /hasBlockedActiveMembers\(blockedActive\)/);
  assert.match(src, /Active members blocked at door/);
  assert.match(src, /buildBlockedActiveUrl\(\)/);
  assert.match(src, /\/api\/mobile\/v1\/members\/\$\{member\.id\}/);
  // Detection only — no block/unblock action on the dashboard: the
  // G5 tap only fetches the member and opens the existing detail flow.
  assert.doesNotMatch(src, /Block Access|Unblock Access/);
  assert.doesNotMatch(src, /\/access\/(block|unblock|remote-unlock)/);
});
