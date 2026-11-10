/* V11 error-state tests (V11-C1, V11-H4, V11-H5, V11-M2, V11-L12..L24).
 *
 * Same tiny tree-based DOM shim as v10-error-states.test.js (no jsdom —
 * node --test only). Screens mount against the shim: innerHTML parses into
 * real child nodes, so a re-render replaces old nodes (and their handlers)
 * exactly like the browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ─── Minimal DOM ────────────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function parseAttrs(src) {
  const attrs = {};
  const re = /([\w-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1]] = m[2] ?? '';
  return attrs;
}

function parseSimple(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let s = sel.trim();
  const tagM = s.match(/^([a-zA-Z][\w-]*)/);
  if (tagM) { out.tag = tagM[1].toLowerCase(); s = s.slice(tagM[0].length); }
  const re = /([#.])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] === '#') out.id = m[2];
    else if (m[1] === '.') out.classes.push(m[2]);
    else out.attrs.push({ name: m[3], value: m[4] ?? null });
  }
  return out;
}

function matchesSimple(el, sel) {
  if (!(el instanceof El)) return false;
  const p = parseSimple(sel);
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.attrs.id !== p.id) return false;
  const classes = (el.attrs.class || '').split(/\s+/).filter(Boolean);
  if (p.classes.some((c) => !classes.includes(c))) return false;
  for (const a of p.attrs) {
    if (!(a.name in el.attrs)) return false;
    if (a.value !== null && el.attrs[a.name] !== a.value) return false;
  }
  return true;
}

function parseHtml(html, parent) {
  const nodes = [];
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [{ children: nodes }];
  let m;
  while ((m = re.exec(clean))) {
    if (m[5] !== undefined) {
      const text = m[5];
      if (text) stack[stack.length - 1].children.push(text);
      continue;
    }
    const [, closing, tagRaw, attrSrc, selfClose] = m;
    const tag = tagRaw.toLowerCase();
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].el?.tagName === tag) stack.pop();
      continue;
    }
    const el = new El(tag);
    el.attrs = parseAttrs(attrSrc || '');
    el.parent = stack[stack.length - 1].el || parent || null;
    stack[stack.length - 1].children.push(el);
    if (!VOID.has(tag) && !selfClose) stack.push({ el, children: el.children });
  }
  // Attach parents for nodes created at the top level.
  const fixParents = (list, par) => {
    for (const n of list) {
      if (n instanceof El) { n.parent = par; fixParents(n.children, n); }
    }
  };
  fixParents(nodes, parent || null);
  return nodes;
}

function serialize(node) {
  if (typeof node === 'string') return node;
  const attrStr = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  if (VOID.has(node.tagName)) return `<${node.tagName}${attrStr}>`;
  return `<${node.tagName}${attrStr}>${node.children.map(serialize).join('')}</${node.tagName}>`;
}

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toLowerCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.style = {};
    this._handlers = {};
    this.onclick = null;
    this.value = '';
    this.disabled = false;
    this.scrollTop = 0;
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get dataset() {
    const self = this;
    return new Proxy({}, {
      get(_, prop) {
        const attr = `data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        return self.attrs[attr];
      },
      set(_, prop, val) {
        const attr = `data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        self.attrs[attr] = String(val);
        return true;
      },
    });
  }
  get classList() {
    const self = this;
    const read = () => new Set((self.attrs.class || '').split(/\s+/).filter(Boolean));
    const write = (set) => { self.attrs.class = [...set].join(' '); };
    return {
      add: (...c) => { const s = read(); c.forEach((x) => s.add(x)); write(s); },
      remove: (...c) => { const s = read(); c.forEach((x) => s.delete(x)); write(s); },
      toggle: (c, force) => { const s = read(); const on = force ?? !s.has(c); if (on) s.add(c); else s.delete(c); write(s); return on; },
      contains: (c) => read().has(c),
    };
  }
  set innerHTML(v) { this.children = parseHtml(v, this); }
  get innerHTML() { return this.children.map(serialize).join(''); }
  set textContent(v) { this.children = [String(v)]; }
  get textContent() {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  matches(sel) { return String(sel).split(',').some((s) => matchesSimple(this, s)); }
  querySelector(sel) {
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof El) {
          if (parts.some((p) => matchesSimple(child, p))) return child;
          const hit = walk(child);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(sel) {
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof El) {
          if (parts.some((p) => matchesSimple(child, p))) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }
  getElementById(id) { return this.querySelector(`#${id}`); }
  closest(sel) {
    let node = this;
    while (node) {
      if (node instanceof El && node.matches(sel)) return node;
      node = node.parent;
    }
    return null;
  }
  contains(node) {
    let cur = node;
    while (cur) { if (cur === this) return true; cur = cur.parent; }
    return false;
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  prepend(child) { child.parent = this; this.children.unshift(child); return child; }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
  after(node) {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    node.parent = this.parent;
    this.parent.children.splice(i + 1, 0, node);
  }
  insertAdjacentHTML(position, html) {
    const nodes = parseHtml(html, this);
    if (position === 'beforeend') this.children.push(...nodes);
    else if (position === 'afterbegin') this.children.unshift(...nodes);
    else this.children.push(...nodes);
  }
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); }
  click() {
    const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    if (typeof this.onclick === 'function') this.onclick(event);
    for (const fn of this._handlers.click || []) fn(event);
  }
  focus() {}
  select() {}
  dispatchEvent(event) {
    const e = { ...event, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const fn of this._handlers[event.type] || []) fn(e);
    return true;
  }
}

const body = new El('body');
globalThis.document = {
  body,
  createElement: (tag) => new El(tag),
  getElementById: (id) => body.querySelector(`#${id}`),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: () => {},
  visibilityState: 'visible',
  activeElement: null,
};
globalThis.window = { scrollY: 0, scrollTo: () => {}, location: { href: '' }, open: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, clipboard: { writeText: async () => {} } }, configurable: true, writable: true });
globalThis.CSS = { escape: (s) => String(s) };
globalThis.alert = () => {};
globalThis.confirm = () => false;

// FileReader shim for member-scan (V10-H2): fake files carry _dataUrl.
class ShimFileReader {
  constructor() { this.result = null; this.onload = null; this.onerror = null; }
  readAsDataURL(file) {
    setTimeout(() => {
      if (file && file._dataUrl) { this.result = file._dataUrl; if (this.onload) this.onload(); }
      else if (this.onerror) this.onerror();
    }, 0);
  }
}
globalThis.FileReader = ShimFileReader;

// ─── Fetch stub ───────────────────────────────────────────────────────

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const okData = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const okMsg = (data, message) => ({ ok: true, status: 200, json: async () => ({ success: true, data, message }) });
const errData = (status, message) => ({ ok: false, status, json: async () => ({ success: false, error: { message } }) });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ─── Gaps G1–G5 PWA tests ─────────────────────────────────────────────
// Same tiny tree-based DOM shim as v11-error-states.test.js (lines 1–265
// above, copied verbatim — no jsdom, node --test only).

// Screens under test (imported after the DOM shims above).
const rrrIntegrations = (await import('./rrr-integrations.js')).default;
const rrrDashboard = (await import('./rrr-dashboard.js')).default;
const notifications = (await import('./notifications.js')).default;
const auditLogs = (await import('./audit-logs.js')).default;
const { setCachedSession } = await import('../api.js');

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

const toastText = () => document.body.querySelector('#toast-container')?.textContent || '';
const clearOverlays = () => {
  document.body.querySelectorAll('.modal-overlay').forEach((n) => n.remove());
  const toast = document.body.querySelector('#toast-container');
  if (toast) toast.innerHTML = '';
};

const OWNER_SESSION = { accessToken: 'tok', refreshToken: 'rt', tenantId: '1', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' };
const STAFF_SESSION = { ...OWNER_SESSION, userRole: 'staff', userName: 'Staff' };

const DIRECT = {
  id: 11, type: 'adms_direct', status: 'connected', device_serial: 'X2008-111',
  device_name: 'Main Entrance', records_synced: 5, commands_enabled: true,
  last_seen_at: new Date().toISOString(),
  terminal_settings: { server_address: 'gym.example.com', server_port: 443, https: true, path: '/iclock', server_mode: 'ADMS' },
  allow_serial_fallback: false, unmapped_records: 0,
};

function integrationsFetch(handler) {
  return installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/adms/commands') && method === 'GET') return okData({ commands: [] });
    if (url.includes('/api/mobile/v1/rrr/integrations') && method === 'GET') return okData({ integrations: [DIRECT], devices: [] });
    return handler(url, options);
  });
}

const DASHBOARD_OK = {
  integration: null,
  pillars: {
    revenue: { count: 0, potential_revenue: 0, items: [] },
    retain: { count: 0, potential_revenue: 0, items: [] },
    recover: { count: 0, potential_revenue: 0, items: [] },
  },
  members: { total: 5, active: 4, attendance_rate: 80 },
  unmapped_count: 0, total_potential_revenue: 0, owner_confirmed_revenue: 0,
  plans_count: 1, whatsapp_connected: false, payment_setup_done: false,
};

function dashboardFetch({ summary, blocked } = {}) {
  return installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/dashboard')) return okData(DASHBOARD_OK);
    if (url.includes('/api/mobile/v1/owner/today')) return okData({ actions: [] });
    if (url.includes('/api/mobile/v1/settings')) return okData({ gym: { show_biometric_link_banner: false } });
    if (url.includes('/api/mobile/v1/access/summary')) {
      return summary === 'fail' ? errData(500, 'Summary unavailable') : okData(summary ?? {});
    }
    if (url.includes('/api/mobile/v1/rrr/blocked-active')) return okData(blocked ?? { members: [] });
    return errData(404, 'not found');
  });
}

// ─── G1: replace terminal ─────────────────────────────────────────────

test('G1 replace: prompts for serial + name, confirms, POSTs replace with confirm:true, toasts success', async () => {
  setCachedSession(OWNER_SESSION);
  const { calls, restore } = integrationsFetch(async (url, options) => {
    if (url.includes('/replace') && (options?.method || 'GET') === 'POST') return okData({ id: 11 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    assert.ok(el.querySelector('#rrr-replace-terminal'), 'replace button rendered for owner');
    el.querySelector('#rrr-replace-terminal').click();
    await tick();
    document.body.querySelector('#prompt-input').value = 'X2008-999';
    document.body.querySelector('#prompt-ok').click();
    await tick();
    document.body.querySelector('#prompt-input').value = 'New Entry';
    document.body.querySelector('#prompt-ok').click();
    await tick();
    assert.match(document.body.innerHTML, /decommissioned/, 'confirm explains the old terminal is decommissioned');
    assert.match(document.body.innerHTML, /supervised physical test/, 'confirm restates the test must pass again');
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick();
    const posts = calls.filter((c) => c.url.includes('/replace'));
    assert.equal(posts.length, 1, 'one replace POST');
    assert.equal(JSON.parse(posts[0].options.body).device_serial, 'X2008-999');
    assert.equal(JSON.parse(posts[0].options.body).device_name, 'New Entry');
    assert.equal(JSON.parse(posts[0].options.body).confirm, true);
    assert.match(toastText(), /Terminal replaced/, 'success toast');
  } finally { restore(); setCachedSession(undefined); clearOverlays(); }
});

test('G1 replace: a 409 wrong-gym serial surfaces the backend message via toast, no success', async () => {
  setCachedSession(OWNER_SESSION);
  const { calls, restore } = integrationsFetch(async (url, options) => {
    if (url.includes('/replace') && (options?.method || 'GET') === 'POST') return errData(409, 'That serial belongs to another gym.');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    el.querySelector('#rrr-replace-terminal').click();
    await tick();
    document.body.querySelector('#prompt-input').value = 'X2008-777';
    document.body.querySelector('#prompt-ok').click();
    await tick();
    document.body.querySelector('#prompt-input').value = 'Other Gym Door';
    document.body.querySelector('#prompt-ok').click();
    await tick();
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/replace')).length, 1);
    assert.match(toastText(), /That serial belongs to another gym/, 'backend 409 message in toast');
    assert.match(el.querySelector('#rrr-terminal-error').textContent, /That serial belongs to another gym/);
    assert.doesNotMatch(toastText(), /Terminal replaced/);
  } finally { restore(); setCachedSession(undefined); clearOverlays(); }
});

test('G1 decommission: confirm yes POSTs decommission with confirm:true; cancel posts nothing', async () => {
  setCachedSession(OWNER_SESSION);
  const { calls, restore } = integrationsFetch(async (url, options) => {
    if (url.includes('/decommission') && (options?.method || 'GET') === 'POST') return okData({});
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    el.querySelector('#rrr-decommission-terminal').click();
    await tick();
    document.body.querySelector('#confirm-no').click();
    await tick();
    assert.equal(calls.filter((c) => c.url.includes('/decommission')).length, 0, 'cancel posts nothing');
    el.querySelector('#rrr-decommission-terminal').click();
    await tick();
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick();
    const posts = calls.filter((c) => c.url.includes('/decommission'));
    assert.equal(posts.length, 1, 'one decommission POST');
    assert.equal(JSON.parse(posts[0].options.body).confirm, true);
    assert.match(toastText(), /Terminal decommissioned/);
  } finally { restore(); setCachedSession(undefined); clearOverlays(); }
});

test('G1/G4 owner-only: staff never sees replace / decommission / restore buttons', async () => {
  setCachedSession(STAFF_SESSION);
  const { restore } = integrationsFetch(async () => errData(404, 'not found'));
  try {
    const el = await mount(rrrIntegrations);
    assert.equal(el.querySelector('#rrr-replace-terminal'), null, 'no replace for staff');
    assert.equal(el.querySelector('#rrr-decommission-terminal'), null, 'no decommission for staff');
    assert.equal(el.querySelector('#rrr-restore-fingerprints'), null, 'no restore for staff');
  } finally { restore(); setCachedSession(undefined); clearOverlays(); }
});

// ─── G4: restore fingerprints ────────────────────────────────────────

test('G4 restore-fingerprints: confirm yes POSTs and toasts the queued count; no template data rendered', async () => {
  setCachedSession(OWNER_SESSION);
  const { calls, restore } = integrationsFetch(async (url, options) => {
    if (url.includes('/restore-fingerprints') && (options?.method || 'GET') === 'POST') return okData({ queued_count: 12 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    assert.ok(el.querySelector('#rrr-restore-fingerprints'), 'restore button rendered for owner');
    el.querySelector('#rrr-restore-fingerprints').click();
    await tick();
    assert.match(document.body.innerHTML, /terminal reset or replacement/, 'confirm explains when to use it');
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/restore-fingerprints')).length, 1);
    assert.match(toastText(), /Fingerprint restore queued for 12 members/);
    assert.doesNotMatch(el.innerHTML, /template/i, 'no template data in the UI');
  } finally { restore(); setCachedSession(undefined); clearOverlays(); }
});

// ─── G2: audit log ────────────────────────────────────────────────────

const AUDIT_PAGE_1 = {
  items: [
    { id: 1, created_at: '2026-11-10T06:00:00Z', actor_name: 'Bharath', action: 'member_blocked', resource_type: 'member', resource_id: 7, metadata: { reason: 'expired', enroll_number: 101 } },
    { id: 2, created_at: '2026-11-10T05:00:00Z', actor_name: 'Bharath', action: 'terminal_replaced', resource_type: 'integration', resource_id: 11, metadata: { device_serial: 'X2008-999' } },
  ],
  page: 1, per_page: 20, total: 3,
};
const AUDIT_PAGE_2 = {
  items: [
    { id: 3, created_at: '2026-11-09T06:00:00Z', actor_name: 'System', action: 'payment_recorded', resource_type: 'payment', resource_id: 4, metadata: { amount: 1500 } },
  ],
  page: 2, per_page: 20, total: 3,
};

test('G2 audit-log: renders rows with human labels, actor, resource, metadata; Load more paginates', async () => {
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/audit-logs')) {
      // NB: `per_page=20` contains the substring `page=2` — match the
      // page param with its trailing `&`.
      if (url.includes('page=2&')) return okData(AUDIT_PAGE_2);
      return okData(AUDIT_PAGE_1);
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(auditLogs);
    assert.match(el.innerHTML, /Member blocked at door/, 'human-readable action label');
    assert.match(el.innerHTML, /Bharath/);
    assert.match(el.innerHTML, /member #7/);
    assert.match(el.innerHTML, /reason: expired/, 'metadata summary');
    assert.match(el.innerHTML, /Terminal replaced/);
    assert.match(el.innerHTML, /Showing 2 of 3 events/);
    assert.ok(el.querySelector('#al-more'), 'Load more present while rows < total');
    el.querySelector('#al-more').click();
    await tick();
    assert.match(el.innerHTML, /Showing 3 of 3 events/);
    assert.match(el.innerHTML, /Payment recorded/);
    assert.ok(calls.some((c) => c.url.includes('page=2')), 'page 2 fetched');
    assert.ok(calls.some((c) => c.url.includes('per_page=20')), 'per_page sent');
  } finally { restore(); }
});

test('G2 audit-log: Apply filters sends action + from + to; empty result shows the empty state', async () => {
  let lastUrl = '';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/audit-logs')) {
      lastUrl = url;
      if (url.includes('action=member_blocked')) return okData({ items: [], page: 1, per_page: 20, total: 0 });
      return okData(AUDIT_PAGE_1);
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(auditLogs);
    el.querySelector('#al-action').value = 'member_blocked';
    el.querySelector('#al-from').value = '2026-11-01';
    el.querySelector('#al-to').value = '2026-11-10';
    el.querySelector('#al-apply').click();
    await tick();
    assert.match(lastUrl, /action=member_blocked/);
    assert.match(lastUrl, /from=2026-11-01/);
    assert.match(lastUrl, /to=2026-11-10/);
    assert.match(el.innerHTML, /No audit events/);
  } finally { restore(); }
});

test('G2 audit-log: load failure shows error + retry; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/audit-logs')) {
      if (mode === 'fail') return errData(500, 'Audit log unavailable');
      return okData(AUDIT_PAGE_1);
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(auditLogs);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Audit log unavailable/);
    assert.ok(el.querySelector('#retry-btn'), 'retry exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Member blocked at door/);
  } finally { restore(); }
});

// ─── G3a: terminal_offline in the notifications inbox ───────────────

test('G3 notifications: terminal_offline renders distinctly with serial + last seen', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/notifications')) {
      return okData({
        notifications: [{
          id: 9, title: 'Terminal offline', body: 'No poll for over an hour.',
          category: 'terminal_offline', is_read: false,
          data: { device_serial: 'X2008-111', last_seen_at: '2026-11-10T06:00:00Z' },
          created_at: '2026-11-10T07:05:00Z',
        }],
        pagination: { total: 1, page: 1 },
      });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(notifications);
    const row = el.querySelector('[data-offline-alert="1"]');
    assert.ok(row, 'offline alert row marked');
    assert.match(el.innerHTML, /Serial X2008-111/);
    assert.match(el.innerHTML, /Last seen/);
    assert.match(el.innerHTML, /warning/, 'warning styling present');
    assert.match(el.innerHTML, /Terminal offline/);
  } finally { restore(); }
});

// ─── G3b: dashboard offline banner ──────────────────────────────────

test('G3 dashboard: terminal_offline flag shows the warning banner; no flag hides it', async () => {
  const offline = { since: '2026-11-10T06:00:00Z', last_success_at: '2026-11-10T05:55:00Z' };
  const { restore } = dashboardFetch({ summary: { terminal_offline: offline } });
  try {
    const el = await mount(rrrDashboard);
    assert.ok(el.querySelector('#rrr-offline-banner'), 'banner rendered while flag present');
    assert.match(el.innerHTML, /Terminal offline since/);
    assert.match(el.innerHTML, /Punches and door commands are paused/);
    assert.ok(el.querySelector('#rrr-offline-live-access'), 'banner links to Live Access');
  } finally { restore(); }
  const { restore: restore2 } = dashboardFetch({ summary: {} });
  try {
    const el = await mount(rrrDashboard);
    assert.equal(el.querySelector('#rrr-offline-banner'), null, 'no banner when the flag is absent');
  } finally { restore2(); }
});

test('G3 dashboard: a failed access-summary leg never breaks the dashboard or shows a banner', async () => {
  const { restore } = dashboardFetch({ summary: 'fail' });
  try {
    const el = await mount(rrrDashboard);
    assert.match(el.innerHTML, /Run the gym/);
    assert.equal(el.querySelector('#rrr-offline-banner'), null, 'no banner on a failed leg');
  } finally { restore(); }
});

// ─── G5: blocked-active card ──────────────────────────────────────────

test('G5 dashboard: blocked-active card shows count + members only when non-empty', async () => {
  const blocked = { members: [{ id: 7, name: 'Asha', phone: '98765', enroll_number: 101, membership_end: '2026-12-31' }] };
  const { restore } = dashboardFetch({ blocked });
  try {
    const el = await mount(rrrDashboard);
    assert.ok(el.querySelector('#rrr-blocked-active-card'), 'card rendered');
    assert.match(el.innerHTML, /1 active member blocked at the door/);
    assert.match(el.innerHTML, /Asha/);
    assert.match(el.innerHTML, /98765/);
    assert.match(el.innerHTML, /Enroll #101/);
    assert.match(el.innerHTML, /ends 31 Dec 2026/);
    assert.doesNotMatch(el.innerHTML, /unblock/i, 'no unblock action offered');
  } finally { restore(); }
  const { restore: restore2 } = dashboardFetch({ blocked: { members: [] } });
  try {
    const el = await mount(rrrDashboard);
    assert.equal(el.querySelector('#rrr-blocked-active-card'), null, 'no card when the list is empty');
  } finally { restore2(); }
});
