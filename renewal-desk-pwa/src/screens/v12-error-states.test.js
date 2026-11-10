/* V12 fix tests (V12-P1..P5, V12-P7, V12-P8, V12-A2, V12-A4).
 *
 * Same tiny tree-based DOM shim as v10/v11-error-states.test.js (no jsdom —
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
  removeEventListener: () => {},
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

// Screens under test (imported after the DOM shims above).
// ─── Screens under test (imported after the DOM shims above) ──────────
const campaignCreate = (await import('./campaign-create.js')).default;
const campaignDetail = (await import('./campaign-detail.js')).default;
const memberScan = (await import('./member-scan.js')).default;
const gymProfile = (await import('./gym-profile.js')).default;
const botTest = (await import('./bot-test.js')).default;
const rrrMappings = (await import('./rrr-mappings.js')).default;
const rrrIntegrations = (await import('./rrr-integrations.js')).default;
const access = (await import('./access.js')).default;
const { apiRequest, getCachedSession, setCachedSession, refreshSessionFromSettings } = await import('../api.js');
const { disposeScreen } = await import('../live-refresh.js');

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

const toastText = () => document.body.querySelector('#toast-container')?.textContent || '';
// Toasts live in the shared document.body across tests in this file —
// clear them so one test's toast never leaks into the next test's reads.
const clearToasts = () => { document.body.querySelector('#toast-container')?.remove(); };
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

const MEMBER_1 = {
  id: 1, full_name: 'Asha', phone: '98765', email: 'a@x.com', address: 'Hyderabad',
  gender: 'Female', status: 'active', plan: { id: 1, name: 'Monthly', duration_days: 30, price: 1500 },
  membership_start: '2026-10-01', membership_end: '2026-12-31', days_until_expiry: 54,
  joined_on: '2026-01-01', notes: '', is_inside: false, whatsapp_opted_in: true,
  has_biometric: true, device_enroll_number: '101', door_blocked: false,
};

const OWNER_SESSION = {
  accessToken: 'tok', refreshToken: 'ref', tenantId: '9', tenantName: 'Old Gym',
  userId: '2', userName: 'Owner', userRole: 'gym_owner',
  gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN',
};

// ─── V12-P1: campaign send — long timeout + one stable key ─────────────

test('V12-P1 campaign-create: send carries the stable per-campaign key campaign-send-<id>', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [{ id: 'expired_member_reactivation_01', name: 'expired_member_reactivation_01', body: 'Hi {name}, come back!' }] });
    if (url.includes('/campaigns/42/send') && method === 'POST') return okData({ sent: 5, total: 5, failed: 0 });
    if (url.includes('/api/mobile/v1/campaigns') && method === 'POST') return okData({ id: 42 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    el.querySelector('#cc-name').value = 'Win-back';
    el.querySelector('#cc-segment').value = 'expiring_7d';
    el.querySelector('#cc-templ').value = 'expired_member_reactivation_01';
    el.querySelector('#cc-form').dispatchEvent({ type: 'submit' });
    await tick();
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick(); await tick();
    const send = calls.find((c) => c.url.includes('/campaigns/42/send'));
    assert.ok(send, 'send POST exists');
    assert.equal(send.options.headers['Idempotency-Key'], 'campaign-send-42', 'stable per-campaign send key, not a fresh uuid');
  } finally { restore(); setCachedSession(undefined); }
});

test('V12-P1 campaign-detail: retry sends the SAME key as create-then-send, so a lost response replays', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/campaigns/42') && method === 'GET') {
      return okData({ id: 42, name: 'Win-back', status: 'draft', segment_type: 'expiring_7d', total_recipients: 5, total_sent: 0, total_delivered: 0, total_read: 0, total_replied: 0, total_renewed: 0, total_revenue_recovered: '0', created_at: '2026-11-10T08:00:00Z' });
    }
    if (url.includes('/campaigns/42/send') && method === 'POST') return okData({ sent: 5, total: 5, failed: 0 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignDetail, { campaignId: '42' });
    el.querySelector('#cd-send').click();
    await tick(); await tick(); await tick();
    const send = calls.find((c) => c.url.includes('/campaigns/42/send'));
    assert.ok(send, 'retry send POST exists');
    assert.equal(send.options.headers['Idempotency-Key'], 'campaign-send-42', 'detail retry reuses the create-then-send key');
  } finally { restore(); setCachedSession(undefined); }
});

test('V12-P1 campaign send: no timeout at 15 s, aborts at 120 s (mock clock)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  clearToasts();
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [{ id: 'expired_member_reactivation_01', name: 'expired_member_reactivation_01', body: 'Hi {name}, come back!' }] });
    if (url.includes('/campaigns/42/send') && method === 'POST') {
      // Hangs until the request is aborted — the abort must fire at 120 s, not 15 s.
      // NOTE: this branch must precede the generic /campaigns POST below —
      // the send URL also matches it, and the send would "succeed" instantly.
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }
    if (url.includes('/api/mobile/v1/campaigns') && method === 'POST') return okData({ id: 42 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    el.querySelector('#cc-name').value = 'Win-back';
    el.querySelector('#cc-segment').value = 'expiring_7d';
    el.querySelector('#cc-templ').value = 'expired_member_reactivation_01';
    el.querySelector('#cc-form').dispatchEvent({ type: 'submit' });
    await flush();
    document.body.querySelector('#confirm-yes').click();
    await flush();
    assert.ok(calls.some((c) => c.url.includes('/campaigns/42/send')), 'send started');
    t.mock.timers.tick(15000);
    await flush();
    assert.doesNotMatch(toastText(), /timed out/, 'no timeout at 15 s — the old default would have aborted here');
    t.mock.timers.tick(105000);
    await flush();
    assert.match(toastText(), /timed out/, 'send aborts at 120 s with the timeout message');
  } finally { restore(); t.mock.timers.reset(); setCachedSession(undefined); }
});

// ─── V12-P2: register scan — long timeout ───────────────────────────────

test('V12-P2 member-scan: no timeout at 15 s, aborts at 120 s (mock clock)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  clearToasts();
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/members/scan') && method === 'POST') {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScan);
    const input = el.querySelector('#ms-file');
    input.files = [{ _dataUrl: 'data:image/png;base64,AAA' }];
    input.dispatchEvent({ type: 'change' });
    t.mock.timers.tick(1); // FileReader shim resolves
    await flush();
    assert.ok(calls.some((c) => c.url.includes('/api/mobile/v1/members/scan')), 'scan started');
    t.mock.timers.tick(15000);
    await flush();
    assert.doesNotMatch(toastText(), /timed out/, 'no timeout at 15 s');
    t.mock.timers.tick(105000);
    await flush();
    assert.match(toastText(), /timed out/, 'scan aborts at 120 s with the timeout message');
  } finally { restore(); t.mock.timers.reset(); setCachedSession(undefined); }
});

// ─── V12-P3: Gym Profile save refreshes the cached session ─────────────

test('V12-P3 gym-profile: after save, the session carries the new name/timezone/currency/country and keeps its tokens', async () => {
  let settingsGets = 0;
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/settings') && method === 'GET') {
      settingsGets++;
      // First GET is the form load (old values); later GETs are the post-save refresh.
      return settingsGets === 1
        ? okData({ gym: { name: 'Old Gym', email: '', phone: '', address: '', timezone: 'Asia/Kolkata', country: 'IN', currency: 'INR' } })
        : okData({ gym: { name: 'New Gym', email: '', phone: '', address: '', timezone: 'Asia/Dubai', country: 'AE', currency: 'AED' } });
    }
    if (url.includes('/api/mobile/v1/settings') && method === 'PATCH') return okData({ message: 'Settings updated.' });
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(gymProfile);
    el.querySelector('#gp-name').value = 'New Gym';
    el.querySelector('#gp-timezone').value = 'Asia/Dubai';
    el.querySelector('#gp-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick(); await tick();
    assert.ok(settingsGets >= 2, 'settings re-fetched after the save');
    const s = getCachedSession();
    assert.equal(s.tenantName, 'New Gym', 'renamed gym visible without sign-out');
    assert.equal(s.gymTimezone, 'Asia/Dubai', 'new timezone visible without sign-out');
    assert.equal(s.gymCurrency, 'AED', 'currency refreshed');
    assert.equal(s.gymCountry, 'AE', 'country refreshed');
    assert.equal(s.accessToken, 'tok', 'tokens preserved');
    assert.equal(s.refreshToken, 'ref', 'refresh token preserved');
  } finally { restore(); setCachedSession(undefined); }
});

test('V12-P3 refreshSessionFromSettings: a failed re-read leaves the session untouched, never throws', async () => {
  const { restore } = installFetch(async () => errData(500, 'Settings unavailable'));
  try {
    setCachedSession({ ...OWNER_SESSION });
    const ok = await refreshSessionFromSettings();
    assert.equal(ok, false, 'reports failure');
    assert.equal(getCachedSession().tenantName, 'Old Gym', 'session untouched');
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V12-P4: mappings "Link all" chunks at 100 ─────────────────────────

async function pickAllGroups(el, n) {
  for (let i = 0; i < n; i++) {
    const cards = el.querySelectorAll('.bm-card');
    cards[i].click(); // opens the picker with the first member listed
    await flush(2);
    const row = el.querySelector('.bm-result');
    assert.ok(row, `picker row renders for card ${i}`);
    row.click(); // assigns member 1 to this biometric ID
  }
}

function mappingsFetch({ groups, members, bulk }) {
  return installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/rrr/mappings/unresolved')) {
      return okData({ groups, pagination: { total: groups.length, total_pages: 1, page: 1 } });
    }
    if (url.includes('/api/mobile/v1/members?page=1')) return okData({ members, pagination: { total: members.length } });
    if (url.includes('/rrr/mappings/bulk-resolve') && method === 'POST') return bulk(JSON.parse(options.body));
    return errData(404, 'not found');
  });
}

test('V12-P4 rrr-mappings: 105 selections link in two calls (100 + 5), not one 105 call', async () => {
  const groups = Array.from({ length: 105 }, (_, i) => ({ biometric_user_id: String(1000 + i), punch_count: 2, latest_punch_time: '2026-11-09T08:00:00Z' }));
  const { calls, restore } = mappingsFetch({
    groups,
    members: [{ ...MEMBER_1 }],
    bulk: (body) => okData({
      linked: body.mappings.length,
      results: body.mappings.map((m) => ({ ok: true, external_id: m.external_id })),
    }),
  });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(rrrMappings);
    await pickAllGroups(el, 105);
    assert.equal(el.querySelector('#bm-count').textContent, '105', '105 ready to link');
    el.querySelector('#bm-link-all').click();
    await tick();
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick(); await tick();
    const posts = calls.filter((c) => c.url.includes('/rrr/mappings/bulk-resolve'));
    assert.equal(posts.length, 2, 'two chunked calls, not one 105-mapping call');
    assert.equal(JSON.parse(posts[0].options.body).mappings.length, 100, 'first batch is 100');
    assert.equal(JSON.parse(posts[1].options.body).mappings.length, 5, 'second batch is the remaining 5');
    assert.match(el.innerHTML, /Linked 105 of 105/, 'progress reports the full count');
  } finally { restore(); setCachedSession(undefined); }
});

test('V12-P4 rrr-mappings: a bulk-resolve failure surfaces the backend reason, not "Something went wrong"', async () => {
  const groups = Array.from({ length: 3 }, (_, i) => ({ biometric_user_id: String(2000 + i), punch_count: 1, latest_punch_time: '2026-11-09T08:00:00Z' }));
  const { restore } = mappingsFetch({
    groups,
    members: [{ ...MEMBER_1 }],
    bulk: () => errData(422, 'Max 100 mappings per call.'),
  });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(rrrMappings);
    await pickAllGroups(el, 3);
    el.querySelector('#bm-link-all').click();
    await tick();
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick(); await tick();
    assert.match(el.innerHTML, /Max 100 mappings per call/, 'backend reason surfaces');
    assert.doesNotMatch(el.innerHTML, /Something went wrong/, 'generic failure text is gone');
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V12-P7: Bot Test failure is a system bubble, never a bot reply ────

test('V12-P7 bot-test: a failed reply renders a system/error bubble, not a bot apology', async () => {
  const { restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/bot/test')) return errData(500, 'Bot service is down');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botTest);
    el.querySelector('#bt-input').value = 'Do you have parking?';
    el.querySelector('#bt-send').click();
    await tick(); await tick(); await tick();
    assert.equal(el.querySelectorAll('.chat-bubble.bot').length, 1, 'only the greeting is a bot bubble');
    const sys = el.querySelectorAll('.chat-bubble.system');
    assert.equal(sys.length, 1, 'one distinct system bubble');
    assert.match(sys[0].textContent, /Test failed/, 'system bubble says the test failed');
    assert.match(sys[0].textContent, /Bot service is down/, 'backend reason rides in the system bubble');
  } finally { restore(); setCachedSession(undefined); }
});

test('V12-P7 bot-test: a genuine bot reply still renders as a bot bubble', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/test')) return okData({ response: 'Yes, free parking on site.' });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botTest);
    el.querySelector('#bt-input').value = 'Do you have parking?';
    el.querySelector('#bt-send').click();
    await tick(); await tick(); await tick();
    assert.equal(el.querySelectorAll('.chat-bubble.bot').length, 2, 'greeting + genuine reply are bot bubbles');
    assert.equal(el.querySelectorAll('.chat-bubble.system').length, 0, 'no system bubble on success');
    assert.match(el.innerHTML, /free parking on site/, 'reply text renders');
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V12-P8: no other gym's name in the device identity ─────────────────

const DIRECT_INTEGRATION = (overrides = {}) => ({
  id: 1, type: 'adms_direct', status: 'connected',
  last_seen_at: new Date().toISOString(), device_name: 'Main Terminal',
  device_serial: 'X2008', terminal_settings: {}, commands_enabled: false,
  records_synced: 0, unmapped_records: 0, ...overrides,
});

function integrationsFetch({ direct, commands }) {
  return installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/integrations/') && url.includes('/adms/commands')) {
      return okData({ commands });
    }
    if (url.includes('/api/mobile/v1/rrr/integrations')) {
      return okData({ integrations: [direct], devices: [] });
    }
    return errData(404, 'not found');
  });
}

test('V12-P8 rrr-integrations: an unnamed terminal shows neutral "Terminal", never another gym\'s name', async () => {
  const { restore } = integrationsFetch({ direct: DIRECT_INTEGRATION({ device_name: '' }), commands: [] });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(rrrIntegrations);
    assert.match(el.innerHTML, />Terminal</, 'neutral fallback renders');
    assert.doesNotMatch(el.innerHTML, /Elite Gym/, 'no other gym\'s name anywhere on the screen');
    disposeScreen(el);
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V12-A4: USERINFO_TOO_LARGE is explained, not a bare result code ────

test('V12-A4 rrr-integrations: a USERINFO_TOO_LARGE scan failure tells the owner the user list is too large', async () => {
  const failedSync = {
    id: 9, action: 'sync_users', status: 'failed', test_enroll_number: null,
    result_code: 'USERINFO_TOO_LARGE', result_message: null,
    created_at: '2026-11-10T08:00:00Z', delivered_at: null, acknowledged_at: null,
  };
  const { restore } = integrationsFetch({ direct: DIRECT_INTEGRATION(), commands: [failedSync] });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(rrrIntegrations);
    assert.match(el.innerHTML, /user list is too large to sync/, 'plain-language explanation renders');
    assert.match(el.innerHTML, /retrying will fail the same way/, 'deterministic failure is stated');
    assert.doesNotMatch(el.innerHTML, /result USERINFO_TOO_LARGE/, 'no bare result code');
    disposeScreen(el);
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V12-A2: "manual_action" skip reason has a human label ──────────────

test('V12-A2 access: a manual_action skip renders the owner-action label, not "other command"', async () => {
  const summary = {
    device_online: true, device_name: 'Main Terminal', entries_today: 3, exits_today: 1,
    inside_now: 0, denied_today: 0, failed_commands: 1, bridge_online: false,
    adms_integration_id: 1, adms_online: true, adms_device_name: 'Main Terminal',
    adms_commands_enabled: true, adms_last_seen_at: new Date().toISOString(),
    queued_adms_commands: { count: 0, commands: [] },
  };
  const { restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...summary });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ events: [], pagination: { total: 0, total_pages: 1, page: 1 } });
    if (url.includes('/api/mobile/v1/access/retry-sync') && method === 'POST') {
      return okData({ message: 'Retry done', retried_count: 0, skipped_count: 1, skipped: [{ reason: 'manual_action' }] });
    }
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ ...OWNER_SESSION });
    const el = await mount(access);
    assert.ok(el.querySelector('#btn-retry-sync'), 'Retry All renders for the owner');
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick(); await tick(); await tick();
    assert.match(el.innerHTML, /owner action — re-queue from the member page/, 'manual_action has its own label');
    assert.doesNotMatch(el.innerHTML, /1 other command/, 'not the generic fallback');
  } finally { restore(); setCachedSession(undefined); }
});
