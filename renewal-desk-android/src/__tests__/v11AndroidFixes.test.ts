import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAppVersion } from '../services/appVersionInfo';
import { hasMoreNotifications, mergeNotificationPage } from '../services/notificationPagination';
import { visibleOnboardingSteps } from '../services/onboardingSteps';
import { plansBlockSubmit, plansGateState, resolveDeletedPlan } from '../services/plansGate';
import { classifyRefreshFailure, refreshFailureError } from '../services/refreshOutcome';
import { keyForAction, shouldReleaseKey } from '../services/stableKey';
import type { AppNotificationItem } from '../types';
import type { OnboardingStep } from '../services/apiClient';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

// V11-M5 — only a definitive 401/403 refresh failure reports
// "Session expired" and logs the owner out; a network blip / 5xx
// keeps the session and reports "could not reach the server" with
// NO 401 status, so the ~31 `error.status === 401 → onLogout()` call
// sites no longer destroy a still-valid session on flaky gym Wi-Fi.

test('V11-M5: 401/403 refresh failure is definitive expiry', () => {
  assert.equal(classifyRefreshFailure(401), 'expired');
  assert.equal(classifyRefreshFailure(403), 'expired');
});

test('V11-M5: network failure and 5xx are transient, session kept', () => {
  assert.equal(classifyRefreshFailure(null), 'transient');
  assert.equal(classifyRefreshFailure(500), 'transient');
  assert.equal(classifyRefreshFailure(502), 'transient');
  assert.equal(classifyRefreshFailure(503), 'transient');
  assert.equal(classifyRefreshFailure(400), 'transient');
});

test('V11-M5: expired error keeps the 401 shape callers log out on', () => {
  assert.deepEqual(refreshFailureError('expired'), {
    message: 'Session expired. Please sign in again.',
    status: 401,
  });
});

test('V11-M5: transient error carries no status, so nobody logs out', () => {
  const error = refreshFailureError('transient');
  assert.equal(error.message, 'Could not reach the server. Check your connection and try again.');
  assert.equal(error.status, undefined);
});

// V11-M3 — load success with ZERO plans is a blocking state, same as
// load failure (V10-M8/L27 gated the failure leg only). The empty leg
// is the common one: a new gym has no plans yet.

test('V11-M3: zero plans on a successful load is the no-plans state', () => {
  assert.equal(plansGateState({ loaded: true, plansCount: 0 }), 'no-plans');
  assert.equal(plansGateState({ loaded: true, plansCount: 3 }), 'ready');
});

test('V11-M3: load failure is still the load-failed state', () => {
  assert.equal(plansGateState({ loaded: true, plansCount: 0, error: 'boom' }), 'load-failed');
  assert.equal(plansGateState({ loaded: true, plansCount: 2, error: 'boom' }), 'load-failed');
});

test('V11-M3: an unresolved load never blocks or flashes no-plans', () => {
  assert.equal(plansGateState({ loaded: false, plansCount: 0 }), 'loading');
  assert.equal(plansBlockSubmit('loading', false), false);
});

test('V11-M3: submit blocks only when no plan is resolved', () => {
  // No plans / failed load + no plan → blocked.
  assert.equal(plansBlockSubmit('no-plans', false), true);
  assert.equal(plansBlockSubmit('load-failed', false), true);
  // A plan resolved (selected chip / member.plan fallback) → proceeds
  // even when the fetch failed (the V10-L27 carve-out).
  assert.equal(plansBlockSubmit('no-plans', true), false);
  assert.equal(plansBlockSubmit('load-failed', true), false);
  // Plans loaded fine → never blocked.
  assert.equal(plansBlockSubmit('ready', false), false);
});

// V11-M4 — the Dashboard "Inside Now" tile is gone with the Inside
// removal (the count goes stale until the nightly auto-reset, and its
// tap led to Live Access, which no longer has any Inside view).

test('V11-M4: Dashboard has no Inside Now tile or inside_now read', () => {
  const dashboard = readSource('../screens/DashboardScreen.tsx');
  assert.equal(dashboard.includes('Inside Now'), false);
  assert.equal(dashboard.includes('inside_now'), false);
});

// V11-L26 — Retry All is owner-only (backend V10-L11); staff must not
// see a button that 403s. The role rule itself is covered in
// roleAccess.test.ts (showRetryAll); here the render is pinned.

test('V11-L26: AccessScreen renders Retry All only behind showRetryAll', () => {
  const access = readSource('../screens/AccessScreen.tsx');
  assert.match(access, /\{ownerControls\.showRetryAll \? \(/);
  // The Retry All label sits after the owner gate, never before it.
  const gateIdx = access.indexOf('ownerControls.showRetryAll');
  const retryIdx = access.indexOf("'Retry All'");
  assert.ok(gateIdx !== -1 && retryIdx !== -1 && gateIdx < retryIdx);
});

// V11-L29 — notifications paginate past the newest 50.

test('V11-L29: appending a page keeps order and de-dupes by id', () => {
  const item = (id: number): AppNotificationItem => ({
    id,
    title: `n${id}`,
    body: '',
    category: 'lead',
    data: {},
    is_read: false,
    created_at: null,
  });
  assert.deepEqual(
    mergeNotificationPage([item(1), item(2)], [item(2), item(3)]).map((i) => i.id),
    [1, 2, 3],
  );
  assert.deepEqual(mergeNotificationPage([], [item(1)]).map((i) => i.id), [1]);
});

test('V11-L29: hasMore is true exactly while the server has more', () => {
  assert.equal(hasMoreNotifications(120, 50), true);
  assert.equal(hasMoreNotifications(50, 50), false);
  assert.equal(hasMoreNotifications(0, 0), false);
});

test('V11-L29: NotificationsScreen reads pagination and offers Load more', () => {
  const screen = readSource('../screens/NotificationsScreen.tsx');
  assert.match(screen, /pagination\.total/);
  assert.match(screen, /Showing \{notifications\.length\} of \{total\}/);
  assert.match(screen, /Load more/);
});

// V11-L30 — the Payment Setup checklist step is owner-only.

test('V11-L30: staff never sees the member_payments checklist step', () => {
  const steps: OnboardingStep[] = [
    { id: 'plans', title: 'Plans', completed: true, route: 'Plans' },
    { id: 'member_payments', title: 'Collect member payments', completed: false, route: 'PaymentSetup' },
  ];
  assert.deepEqual(
    visibleOnboardingSteps(steps, false).map((s) => s.id),
    ['plans'],
  );
  assert.deepEqual(
    visibleOnboardingSteps(steps, true).map((s) => s.id),
    ['plans', 'member_payments'],
  );
});

// V11-L31 — a member on a deleted plan shows the plan's name, not
// plan-less; a failed plans load is never read as "deleted".

test('V11-L31: deleted plan resolves to a chip; active plan resolves to null', () => {
  const active = [{ id: 1, name: 'Monthly' }];
  assert.deepEqual(
    resolveDeletedPlan({ id: 9, name: 'Quarterly' }, active, false),
    { id: 9, name: 'Quarterly' },
  );
  assert.equal(resolveDeletedPlan({ id: 1, name: 'Monthly' }, active, false), null);
  assert.equal(resolveDeletedPlan(null, active, false), null);
  assert.equal(resolveDeletedPlan(undefined, active, false), null);
});

test('V11-L31: a failed plans load never claims the plan is deleted', () => {
  assert.equal(
    resolveDeletedPlan({ id: 9, name: 'Quarterly' }, [], true),
    null,
  );
});

// V11-L32 — stable per-action idempotency keys: same action reuses the
// key (a retry replays), a new action mints a fresh one, and the key
// is released on success / 4xx but kept on 5xx / network failure.

test('V11-L32: same scope reuses the key, new scope mints a fresh one', () => {
  const first = keyForAction(undefined, 'checkin:7:ENTRY');
  const retry = keyForAction(first.slot, 'checkin:7:ENTRY');
  assert.equal(retry.key, first.key);
  const other = keyForAction(first.slot, 'checkin:7:EXIT');
  assert.notEqual(other.key, first.key);
  const otherMember = keyForAction(first.slot, 'checkin:8:ENTRY');
  assert.notEqual(otherMember.key, first.key);
});

test('V11-L32: key releases on success and 4xx, never on 5xx/network', () => {
  assert.equal(shouldReleaseKey(true), true);
  assert.equal(shouldReleaseKey(false, 400), true);
  assert.equal(shouldReleaseKey(false, 401), true);
  assert.equal(shouldReleaseKey(false, 403), true);
  assert.equal(shouldReleaseKey(false, 500), false);
  assert.equal(shouldReleaseKey(false, 503), false);
  assert.equal(shouldReleaseKey(false, undefined), false);
});

// V11-L33 — "Excel" is gone from the member-import copy and picker:
// the backend is CSV-only.

test('V11-L33: no Excel copy or .xls MIME in the import surfaces', () => {
  const dashboard = readSource('../screens/DashboardScreen.tsx');
  assert.equal(dashboard.includes('Excel / CSV'), false);
  assert.match(dashboard, /Import Existing Members \(CSV\)/);
  const importer = readSource('../screens/MemberImportScreen.tsx');
  assert.equal(importer.includes('Excel'), false);
  assert.equal(importer.includes('application/vnd.ms-excel'), false);
});

// V11-L34 — version/build come from the embedded app config, never
// hardcoded literals.

test('V11-L34: real version + versionCode resolve to display labels', () => {
  assert.deepEqual(resolveAppVersion({ version: '1.0.0', versionCode: 45 }), {
    versionLabel: '1.0.0',
    buildLabel: 'Build 45',
  });
});

test('V11-L34: missing values degrade to honest Unknown, never a stale literal', () => {
  assert.deepEqual(resolveAppVersion({}), {
    versionLabel: 'Unknown',
    buildLabel: 'Build unknown',
  });
  assert.deepEqual(resolveAppVersion({ version: '  ', versionCode: null }), {
    versionLabel: 'Unknown',
    buildLabel: 'Build unknown',
  });
});

test('V11-L34: Settings shows the config version, not hardcoded 1.0.0 / Build 5', () => {
  const settings = readSource('../screens/SettingsScreen.tsx');
  assert.equal(settings.includes('value="1.0.0"'), false);
  assert.equal(settings.includes('Build 5'), false);
  assert.match(settings, /getAppVersion\(\)/);
});
