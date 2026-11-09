/* V10 error-state tests (V10-H1, V10-H2, V10-M3..M5, V10-L13..L25, V10-L33,
 * contingent owner-gating).
 *
 * Same tiny tree-based DOM shim as v9-error-states.test.js (no jsdom —
 * node --test only), plus navigator + El.dispatchEvent for the screens
 * under test here.
 *
 * Screens mount against a tiny tree-based DOM shim: innerHTML parses into
 * real child nodes, so a re-render replaces old nodes (and their handlers)
 * exactly like the browser. No jsdom dependency — node --test only.
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

// Screens are imported after the DOM shims above (module evaluation
// touches document/window via api.js / router.js).
const memberImport = (await import('./member-import.js')).default;
const memberScan = (await import('./member-scan.js')).default;
const editMember = (await import('./edit-member.js')).default;
const gymProfile = (await import('./gym-profile.js')).default;
const memberDetail = (await import('./member-detail.js')).default;
const access = (await import('./access.js')).default;
const rrrList = (await import('./rrr-list.js')).default;
const recordPayment = (await import('./record-payment.js')).default;
const subscription = (await import('./subscription.js')).default;
const settings = (await import('./settings.js')).default;
const botTest = (await import('./bot-test.js')).default;
const campaignCreate = (await import('./campaign-create.js')).default;
const notifications = (await import('./notifications.js')).default;
const ownerFinance = (await import('./owner-finance.js')).default;
const rrrMappings = (await import('./rrr-mappings.js')).default;
const { apiRequest, setCachedSession, getCachedSession } = await import('../api.js');
const { APP_VERSION } = await import('../version.js');

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

// ─── Fixtures ───────────────────────────────────────────────────────────

const MEMBER_7 = {
  id: 7, full_name: 'Asha', phone: '98765', email: 'a@x.com', address: 'Hyderabad',
  gender: 'Female', status: 'active', plan: { id: 1, name: 'Monthly', duration_days: 30, price: 1500 },
  membership_start: '2026-10-01', membership_end: '2026-12-31', days_until_expiry: 54,
  joined_on: '2026-01-01', notes: '', is_inside: false, whatsapp_opted_in: true,
  has_biometric: true, device_enroll_number: '101', door_blocked: false,
};
const PLAN_MONTHLY = { id: 1, name: 'Monthly', duration_days: 30, price: 1500 };
const PLAN_QUARTERLY = { id: 2, name: 'Quarterly', duration_days: 90, price: 4000 };

const ACCESS_SUMMARY = { device_online: true, device_name: 'Arun Gym Entry', entries_today: 85, exits_today: 0, denied_today: 0, failed_commands: 8, adms_integration_id: 5, adms_online: true, adms_commands_enabled: true, adms_device_name: 'Arun Gym Entry', last_event_at: '2026-11-09T10:50:00Z' };
const ACCESS_EVENTS = { events: [{ id: 1, event_type: 'ENTRY', member_id: 7, member_name: 'Prem', event_timestamp: '2026-11-09T10:50:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } };

// ─── FormData shim ──────────────────────────────────────────────────────
class ShimFormData {
  constructor(form) {
    this._map = new Map();
    if (form) {
      for (const field of form.querySelectorAll('input, select, textarea')) {
        const name = field.attrs?.name;
        if (!name) continue;
        if (field.tagName === 'input' && field.attrs.type === 'checkbox') {
          if (field.checked) this._map.set(name, 'on');
        } else this._map.set(name, field.value ?? '');
      }
    }
  }
  append(k, v) { this._map.set(k, v); }
  get(k) { return this._map.has(k) ? this._map.get(k) : null; }
}
globalThis.FormData = ShimFormData;

// ─── V10-H1: CSV import posts JSON csv_text, previews counts ────────────

test('V10-H1 import: file change POSTs JSON csv_text to preview and renders counts; Import hidden until clean', async () => {
  const CSV = 'name,phone,plan\nAsha,98765,Monthly\nRavi,98766,Monthly\n';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/members/import/preview')) {
      return okData({ rows: [], summary: { total: 2, valid: 2, invalid: 0, duplicates: 0 }, file_errors: [] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberImport);
    assert.match(el.querySelector('#mi-file').attrs.accept, /^\.csv$/, 'accept is CSV-only, no .xlsx');
    const input = el.querySelector('#mi-file');
    input.files = [{ name: 'members.csv', size: 120, text: async () => CSV }];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    const previews = calls.filter((c) => c.url.includes('/members/import/preview'));
    assert.equal(previews.length, 1, 'one preview POST on file change');
    const body = JSON.parse(previews[0].options.body);
    assert.equal(body.csv_text, CSV, 'preview carries the file text as JSON csv_text');
    assert.ok(!(previews[0].options.body instanceof FormData), 'not a multipart FormData post');
    assert.match(el.innerHTML, /2 rows · 2 valid · 0 invalid · 0 duplicates/);
    assert.ok(!el.querySelector('#mi-submit').classList.contains('hidden'), 'Import shown on a clean preview');
  } finally { restore(); }
});

test('V10-H1 import: invalid/duplicate preview keeps Import hidden; submit POSTs JSON csv_text with a stable key', async () => {
  const CSV = 'name,phone,plan\nAsha,98765,Monthly\nBad Row,,\n';
  let mode = 'dirty';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/members/import/preview')) {
      if (mode === 'dirty') return okData({ rows: [], summary: { total: 2, valid: 1, invalid: 1, duplicates: 0 }, file_errors: [] });
      return okData({ rows: [], summary: { total: 1, valid: 1, invalid: 0, duplicates: 0 }, file_errors: [] });
    }
    if (url.includes('/members/import') && (options?.method || 'GET') === 'POST') return okData({ imported: 1, skipped: 0 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberImport);
    const input = el.querySelector('#mi-file');
    input.files = [{ name: 'members.csv', size: 120, text: async () => CSV }];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    assert.match(el.innerHTML, /1 valid · 1 invalid/);
    assert.match(el.innerHTML, /Fix every invalid or duplicate row/);
    assert.ok(el.querySelector('#mi-submit').classList.contains('hidden'), 'Import hidden while the preview is dirty');
    // Fixed file → clean preview → Import appears → submit is JSON.
    mode = 'clean';
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    assert.ok(!el.querySelector('#mi-submit').classList.contains('hidden'), 'Import shown on a clean preview');
    el.querySelector('#mi-submit').click();
    await tick(); await tick();
    const imports = calls.filter((c) => c.url.includes('/members/import') && !c.url.includes('preview'));
    assert.equal(imports.length, 1, 'one import POST');
    assert.equal(JSON.parse(imports[0].options.body).csv_text, CSV);
    assert.ok(imports[0].options.headers['Idempotency-Key'], 'import POST carries an idempotency key');
  } finally { restore(); }
});

// ─── V10-H2: register scan posts JSON images[] ──────────────────────────

test('V10-H2 scan: photo POSTs JSON {images:[dataUrl]}; pickers disabled in flight, re-enabled on failure', async () => {
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  let resolveScan;
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/members/scan')) {
      return new Promise((resolve) => { resolveScan = () => resolve(okData({ members: [{ full_name: 'Asha' }] })); });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScan);
    const input = el.querySelector('#ms-file');
    input.files = [{ name: 'register.png', size: 5000, _dataUrl: DATA_URL }];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    // Still in flight: both pickers disabled, one scan POST, JSON body.
    assert.equal(el.querySelector('#ms-file').disabled, true, 'photo picker disabled in flight');
    assert.equal(el.querySelector('#ms-gallery').disabled, true, 'gallery picker disabled in flight');
    const scans = calls.filter((c) => c.url.includes('/members/scan'));
    assert.equal(scans.length, 1, 'one scan POST');
    assert.deepEqual(JSON.parse(scans[0].options.body).images, [DATA_URL], 'scan carries base64 images[] as JSON');
    // A second change while in flight fires nothing.
    input.dispatchEvent({ type: 'change' });
    await tick();
    assert.equal(calls.filter((c) => c.url.includes('/members/scan')).length, 1, 'no second scan while in flight');
    resolveScan();
    await tick(); await tick();
    assert.equal(el.querySelector('#ms-file').disabled, false, 'pickers re-enabled after the scan');
  } finally { restore(); }
});

test('V10-H2 scan: failed scan re-enables pickers and toasts', async () => {
  let resolveScan;
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/members/scan')) {
      return new Promise((resolve) => { resolveScan = () => resolve(errData(400, 'Please provide at least one document image to scan.')); });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScan);
    const input = el.querySelector('#ms-gallery');
    input.files = [{ name: 'register.png', size: 5000, _dataUrl: 'data:image/png;base64,AAA' }];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    // Mid-flight the pickers are disabled (this is what the old code
    // never did — it left both pickers live during the scan).
    assert.equal(el.querySelector('#ms-gallery').disabled, true, 'gallery picker disabled in flight');
    assert.equal(el.querySelector('#ms-file').disabled, true, 'photo picker disabled in flight');
    resolveScan();
    await tick(); await tick();
    assert.equal(el.querySelector('#ms-gallery').disabled, false, 'gallery picker re-enabled after failure');
    assert.equal(el.querySelector('#ms-file').disabled, false, 'photo picker re-enabled after failure');
    assert.equal(calls.filter((c) => c.url.includes('/members/scan')).length, 1);
    assert.match(document.body.innerHTML, /Please provide at least one document image/);
  } finally { restore(); }
});

// ─── V10-M3: edit-member keeps a deleted plan ───────────────────────────

test('V10-M3 edit-member: member on a deleted plan shows it as "(deleted)" and submit omits plan_id', async () => {
  const DELETED_PLAN_MEMBER = { ...MEMBER_7, plan: { id: 9, name: 'Quarterly', duration_days: 90, price: 4000 } };
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7') && (options?.method || 'GET') === 'GET') return okData({ ...DELETED_PLAN_MEMBER });
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY], gym: { timezone: 'Asia/Kolkata' } });
    if (url.includes('/api/mobile/v1/members/7') && options?.method === 'PATCH') return okData({ ...DELETED_PLAN_MEMBER });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(editMember, { memberId: '7' });
    assert.match(el.innerHTML, /Quarterly \(deleted\)/, 'deleted plan shown as a disabled-labelled option');
    el.querySelector('#em-name').value = 'Asha';
    el.querySelector('#em-phone').value = '98765';
    el.querySelector('#em-plan').value = '9';
    el.querySelector('#em-start').value = '2026-10-01';
    el.querySelector('#edit-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    const patches = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7') && c.options?.method === 'PATCH');
    assert.equal(patches.length, 1, 'one PATCH');
    const body = JSON.parse(patches[0].options.body);
    assert.equal('plan_id' in body, false, 'plan_id omitted — the deleted plan is not nulled');
    assert.equal(body.full_name, 'Asha');
  } finally { restore(); }
});

test('V10-M3 edit-member: switching to an active plan still sends plan_id', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7') && (options?.method || 'GET') === 'GET') return okData({ ...MEMBER_7 });
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY, PLAN_QUARTERLY], gym: { timezone: 'Asia/Kolkata' } });
    if (url.includes('/api/mobile/v1/members/7') && options?.method === 'PATCH') return okData({ ...MEMBER_7 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(editMember, { memberId: '7' });
    assert.doesNotMatch(el.innerHTML, /\(deleted\)/, 'active plan is not labelled deleted');
    el.querySelector('#em-name').value = 'Asha';
    el.querySelector('#em-phone').value = '98765';
    el.querySelector('#em-plan').value = '2';
    el.querySelector('#em-start').value = '2026-10-01';
    el.querySelector('#edit-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    const patches = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7') && c.options?.method === 'PATCH');
    assert.equal(JSON.parse(patches[0].options.body).plan_id, 2, 'active plan change sends plan_id');
  } finally { restore(); }
});

// ─── V10-M4 / V10-L22: session expiry is central + messages split ──────

test('V10-M4/L22 api: refresh 401 fires one session-expired event and says Session expired', async () => {
  const dispatched = [];
  const prevDispatch = globalThis.window.dispatchEvent;
  globalThis.window.dispatchEvent = (e) => { dispatched.push(e.type); return true; };
  setCachedSession({ accessToken: 'old', refreshToken: 'r1', tenantId: '1', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/auth/refresh')) return errData(401, 'refresh expired');
    if (url.includes('/api/mobile/v1/members/7')) return errData(401, 'unauthorized');
    return errData(404, 'not found');
  });
  try {
    const res = await apiRequest('/api/mobile/v1/members/7');
    assert.equal(res.ok, false);
    assert.equal(res.error.message, 'Session expired. Please sign in again.');
    assert.deepEqual(dispatched, ['session-expired'], 'one session-expired event');
    assert.equal(getCachedSession(), undefined, 'session cleared on definitive expiry');
    assert.equal(calls.filter((c) => c.url.includes('/api/mobile/v1/members/7')).length, 1, 'original request not retried');
    // Two concurrent expired calls share one refresh and fire one event.
    setCachedSession({ accessToken: 'old2', refreshToken: 'r2', tenantId: '1', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    dispatched.length = 0;
    const [a, b] = await Promise.all([apiRequest('/api/mobile/v1/members/7'), apiRequest('/api/mobile/v1/members/7')]);
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.deepEqual(dispatched, ['session-expired'], 'one event for two concurrent expiries');
  } finally {
    restore();
    globalThis.window.dispatchEvent = prevDispatch;
    setCachedSession(undefined);
  }
});

test('V10-L22 api: refresh 500 is transient — no event, session kept, retryable message', async () => {
  const dispatched = [];
  const prevDispatch = globalThis.window.dispatchEvent;
  globalThis.window.dispatchEvent = (e) => { dispatched.push(e.type); return true; };
  setCachedSession({ accessToken: 'old', refreshToken: 'r1', tenantId: '1', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
  const { restore } = installFetch(async (url) => {
    if (url.includes('/auth/refresh')) return errData(500, 'refresh blew up');
    if (url.includes('/api/mobile/v1/members/7')) return errData(401, 'unauthorized');
    return errData(404, 'not found');
  });
  try {
    const res = await apiRequest('/api/mobile/v1/members/7');
    assert.equal(res.ok, false);
    assert.equal(res.error.message, 'Could not reach the server. Check your connection and retry.');
    assert.deepEqual(dispatched, [], 'no session-expired event for a transient failure');
    assert.ok(getCachedSession(), 'session kept — a retry may succeed');
  } finally {
    restore();
    globalThis.window.dispatchEvent = prevDispatch;
    setCachedSession(undefined);
  }
});

// ─── V10-M5: gym-profile timezone is a validated select ────────────────

test('V10-M5 gym-profile: timezone renders as a select; invalid stored value is refused and named', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings') && (options?.method || 'GET') === 'GET') {
      return okData({ gym: { name: 'Yodha Fitness', email: '', phone: '', address: '', timezone: 'india' }, plans: [], payment_settings: {} });
    }
    if (url.includes('/api/mobile/v1/settings') && options?.method === 'PATCH') return okData({ gym: { name: 'Yodha Fitness', timezone: 'Asia/Kolkata' } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(gymProfile);
    const tz = el.querySelector('#gp-timezone');
    assert.equal(tz.tagName, 'select', 'timezone is a select, not free text');
    assert.match(el.innerHTML, /Asia\/Kolkata/);
    assert.match(el.innerHTML, /india \(current\)/, 'stored value stays visible');
    assert.match(el.innerHTML, /not a valid timezone/, 'invalid stored value is flagged');
    // Submit with the invalid value: refused, no PATCH, toast names it.
    el.querySelector('#gp-name').value = 'Yodha Fitness';
    tz.value = 'india';
    el.querySelector('#gp-form').dispatchEvent({ type: 'submit' });
    await tick();
    assert.equal(calls.filter((c) => c.options?.method === 'PATCH').length, 0, 'no PATCH for an invalid timezone');
    assert.match(document.body.innerHTML, /india.*is not a valid timezone/);
    // Pick a valid zone: the PATCH goes through with it.
    tz.value = 'Asia/Kolkata';
    el.querySelector('#gp-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    const patches = calls.filter((c) => c.options?.method === 'PATCH');
    assert.equal(patches.length, 1);
    assert.equal(JSON.parse(patches[0].options.body).timezone, 'Asia/Kolkata');
  } finally { restore(); }
});

// ─── V10-L13 / L25: member-detail send-reminder guard + stable key ─────

test('V10-L13/L25 member-detail: double-tap sends one reminder; failed retry reuses the key; success rotates it', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7')) return okData({ ...MEMBER_7 });
    if (url.includes('/whatsapp/send-reminder')) {
      if (mode === 'fail') return errData(500, 'WhatsApp down');
      return okData({ sent: true });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const btn = el.querySelector('#btn-send-reminder');
    assert.ok(btn, 'reminder button exists');
    // Double-tap while in flight: one POST.
    btn.click();
    btn.click();
    await tick(); await tick();
    let sends = calls.filter((c) => c.url.includes('/whatsapp/send-reminder'));
    assert.equal(sends.length, 1, 'double-tap fires one reminder POST');
    assert.equal(btn.disabled, false, 'button re-enabled after failure');
    const firstKey = sends[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'reminder POST carries a key');
    // Retry after failure reuses the same key.
    btn.click();
    await tick(); await tick();
    sends = calls.filter((c) => c.url.includes('/whatsapp/send-reminder'));
    assert.equal(sends.length, 2, 'retry posts again');
    assert.equal(sends[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
    // Success rotates the key: a later deliberate reminder is a new action.
    mode = 'ok';
    btn.click();
    await tick(); await tick();
    sends = calls.filter((c) => c.url.includes('/whatsapp/send-reminder'));
    assert.equal(sends.length, 3);
    assert.equal(sends[2].options.headers['Idempotency-Key'], firstKey, 'successful send reuses the pending key');
    btn.click();
    await tick(); await tick();
    sends = calls.filter((c) => c.url.includes('/whatsapp/send-reminder'));
    assert.equal(sends.length, 4);
    assert.notEqual(sends[3].options.headers['Idempotency-Key'], firstKey, 'key rotates after a successful send');
  } finally { restore(); }
});

// ─── V10-L24: freeze/unfreeze toast reads the top-level message ────────

test('V10-L24 member-detail: freeze toast shows the backend top-level message, not the generic fallback', async () => {
  const { restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7') && (options?.method || 'GET') === 'GET') return okData({ ...MEMBER_7 });
    if (url.includes('/members/7/freeze')) {
      return okMsg({ ...MEMBER_7, status: 'paused' }, 'Membership paused for 14 days. Gate access disabled.');
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    el.querySelector('#btn-freeze').click();
    await tick();
    // First prompt: days.
    document.body.querySelector('#prompt-input').value = '14';
    document.body.querySelector('#prompt-ok').click();
    await tick();
    // Second prompt: reason (optional).
    document.body.querySelector('#prompt-input').value = '';
    document.body.querySelector('#prompt-ok').click();
    await tick(); await tick();
    assert.match(document.body.innerHTML, /Membership paused for 14 days\. Gate access disabled\./);
    assert.doesNotMatch(document.body.innerHTML, /Membership paused successfully/);
  } finally { restore(); }
});

// ─── V10-L14: retry-reasons pluralization ──────────────────────────────

test('V10-L14 access: skip reasons pluralize correctly, including the two new backend reasons', async () => {
  const SKIPPED = [
    { command_id: 1, reason: 'requeue_failed' },
    { command_id: 2, reason: 'requeue_failed' },
    { command_id: 3, reason: 'commands_disabled' },
    { command_id: 4, reason: 'commands_disabled' },
    { command_id: 5, reason: 'terminal_never_polled' },
    { command_id: 6, reason: 'no_terminal_identity' },
    { command_id: 7, reason: 'no_terminal_identity' },
    { command_id: 8, reason: 'not_enableable' },
  ];
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/retry-sync')) {
      return okData({ retried_count: 0, skipped_count: 8, skipped: SKIPPED, message: 'Queued 0 failed command(s) for retry; 8 could not be retried.' });
    }
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick();
    const reasons = el.querySelector('#retry-reasons');
    assert.ok(reasons, 'reasons detail renders after retry');
    assert.match(reasons.innerHTML, /2 could not re-queue/);
    assert.match(reasons.innerHTML, /2 commands disabled/);
    assert.match(reasons.innerHTML, /1 terminal never connected/);
    assert.match(reasons.innerHTML, /2 no terminal identities/);
    assert.match(reasons.innerHTML, /1 member not eligible/);
    assert.doesNotMatch(reasons.innerHTML, /re-queues|disableds|connecteds/);
  } finally { restore(); }
});

// ─── V10-L15: lastRetryResult lifecycle ────────────────────────────────

test('V10-L15 access: retry result is timestamped and cleared on Clear; a failed retry clears the stale card', async () => {
  let retryMode = 'ok';
  let summaryMode = 'failed';
  const prevConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/retry-sync')) {
      if (retryMode === 'ok') return okData({ retried_count: 1, skipped_count: 0, skipped: [], message: 'Queued 1 failed command(s) for retry.' });
      return errData(500, 'Retry unavailable');
    }
    if (url.includes('/api/mobile/v1/access/clear-failed')) return okData({ cleared: 8 });
    if (url.includes('/api/mobile/v1/access/summary')) {
      if (summaryMode === 'failed') return okData({ ...ACCESS_SUMMARY });
      return okData({ ...ACCESS_SUMMARY, failed_commands: 0 });
    }
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick();
    let reasons = el.querySelector('#retry-reasons');
    assert.ok(reasons, 'reasons card renders after retry');
    assert.match(reasons.innerHTML, /Retried /, 'result is timestamped');
    // A failed retry attempt clears the stale card immediately.
    retryMode = 'fail';
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick();
    assert.equal(el.querySelector('#retry-reasons'), null, 'stale card cleared at the start of a failed retry');
    // A good retry, then Clear: the card goes with the rows it described.
    retryMode = 'ok';
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick();
    assert.ok(el.querySelector('#retry-reasons'), 'card back after a good retry');
    summaryMode = 'cleared';
    el.querySelector('#btn-clear-failed').click();
    await tick(); await tick();
    assert.equal(el.querySelector('#retry-reasons'), null, 'card cleared on Clear success');
    assert.equal(calls.filter((c) => c.url.includes('/clear-failed')).length, 1);
  } finally { restore(); globalThis.confirm = prevConfirm; }
});

// ─── V10-L33: queued ADMS commands + cancel ────────────────────────────

test('V10-L33 access: queued commands render with per-row Cancel; cancel POSTs and refreshes; absent field renders nothing', async () => {
  const QUEUED = {
    count: 2,
    commands: [
      { id: 11, action: 'block', enroll_number: 2151, queued_at: '2026-11-09T10:00:00Z' },
      { id: 12, action: 'unblock', enroll_number: 2169, queued_at: '2026-11-09T10:05:00Z' },
    ],
  };
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/access/adms-commands/11/cancel')) return okData({ cancelled: true });
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY, failed_commands: 0, queued_adms_commands: QUEUED });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    const section = el.querySelector('#queued-commands');
    assert.ok(section, 'queued section renders');
    assert.match(section.innerHTML, /Queued door commands \(2\)/);
    assert.match(section.innerHTML, /block · ID 2151/);
    assert.match(section.innerHTML, /unblock · ID 2169/);
    const cancels = el.querySelectorAll('[data-cancel-adms]');
    assert.equal(cancels.length, 2, 'one Cancel per queued row');
    cancels[0].click();
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/adms-commands/11/cancel')).length, 1, 'cancel POSTs to the endpoint');
    // Absent field (old backend): no section at all.
    const { restore: restore2 } = installFetch(async (url) => {
      if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY, failed_commands: 0 });
      if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
      return errData(404, 'not found');
    });
    try {
      const el2 = await mount(access);
      assert.equal(el2.querySelector('#queued-commands'), null, 'no section when the summary field is absent');
    } finally { restore2(); }
  } finally { restore(); }
});

// ─── V10 contingent gating (20b): Retry All / Clear are owner-only ─────

test('V10-gating access: staff session hides Retry All and Clear; unknown role still shows them', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '1', tenantName: 'Gym', userId: '2', userName: 'Staff', userRole: 'staff', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const elStaff = await mount(access);
    assert.match(elStaff.innerHTML, /failed to sync/, 'banner still shows for staff');
    assert.equal(elStaff.querySelector('#btn-retry-sync'), null, 'Retry All hidden for staff');
    assert.equal(elStaff.querySelector('#btn-clear-failed'), null, 'Clear hidden for staff');
    setCachedSession(undefined);
    const elUnknown = await mount(access);
    assert.ok(elUnknown.querySelector('#btn-retry-sync'), 'Retry All shown when the role is unknown');
    assert.ok(elUnknown.querySelector('#btn-clear-failed'), 'Clear shown when the role is unknown');
  } finally { restore(); setCachedSession(undefined); }
});

test('V10-gating access: retry-sync 403 toasts the owner-only message', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/retry-sync')) return errData(403, 'Only the gym owner can retry failed commands.');
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    el.querySelector('#btn-retry-sync').click();
    await tick(); await tick();
    assert.match(document.body.innerHTML, /Only the gym owner can retry failed commands/);
  } finally { restore(); }
});

// ─── V10-L25: check-in holds a stable key ──────────────────────────────

test('V10-L25 access: manual check-in double-click fires one POST; failed retry reuses the key', async () => {
  let checkinMode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...ACCESS_SUMMARY, failed_commands: 0 });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...ACCESS_EVENTS });
    if (url.includes('/api/mobile/v1/members?page_size=20')) return okData({ members: [{ ...MEMBER_7 }], pagination: { total: 1 } });
    if (url.includes('/api/mobile/v1/access/checkin')) {
      if (checkinMode === 'fail') return errData(500, 'Check-in unavailable');
      return okData({ event_type: 'ENTRY' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    el.querySelector('#header-action-0').click();
    await tick(); await tick();
    const checkinBtn = document.body.querySelector('.btn-do-checkin');
    assert.ok(checkinBtn, 'check-in button renders in the modal');
    checkinBtn.click();
    checkinBtn.click();
    await tick(); await tick();
    let posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 1, 'double-click fires one check-in POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'check-in POST carries a key');
    assert.equal(checkinBtn.disabled, false, 'button re-enabled after failure');
    checkinBtn.click();
    await tick(); await tick();
    posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
  } finally { restore(); }
});

// ─── V10-L16: RRR list cancel re-enables the button ─────────────────────

test('V10-L16 rrr-list: cancelling the Close-as-recovered prompt re-enables the row button', async () => {
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/opportunities?pillar=revenue')) {
      return okData({ opportunities: [{ id: 5, member: { name: 'Asha' }, reason: 'Expired 10 days ago', priority: 'high', status: 'open', potential_revenue: 1500 }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrList, { pillar: 'revenue' });
    const btn = el.querySelector('[data-status="closed"]');
    assert.ok(btn, 'Close as recovered button exists');
    btn.click();
    await tick();
    assert.equal(btn.disabled, true, 'button disabled while the prompt is open');
    document.body.querySelector('#prompt-cancel').click();
    await tick();
    assert.equal(btn.disabled, false, 'button re-enabled after cancelling the prompt');
    assert.equal(calls.filter((c) => c.url.includes('/rrr/opportunities/5')).length, 0, 'no PATCH on cancel');
  } finally { restore(); }
});

// ─── V10-L17: record-payment prefilled-member failure ───────────────────

test('V10-L17 record-payment: prefilled-member fetch failure shows an error with a working retry', async () => {
  let memberMode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY], gym: { timezone: 'Asia/Kolkata' } });
    if (url.includes('/api/mobile/v1/members/7')) {
      if (memberMode === 'fail') return errData(500, 'Member unavailable');
      return okData({ ...MEMBER_7 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(recordPayment, { memberId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Member unavailable/);
    assert.equal(el.querySelector('#rp-form'), null, 'no form while the member failed to load');
    memberMode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick(); await tick();
    assert.ok(el.querySelector('#rp-form'), 'form appears after retry');
    assert.match(el.innerHTML, /Asha/, 'prefilled member renders');
  } finally { restore(); }
});

// ─── V10-L18: subscription members-leg failure ──────────────────────────

test('V10-L18 subscription: members-leg failure shows an inline notice with retry; retry recovers the count', async () => {
  let membersMode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/subscription/status')) return okData({ plan_name: 'Pro', subscription_status: 'active', max_members: 100, plan: { price: 2500 } });
    if (url.includes('/api/mobile/v1/members?page=1')) {
      if (membersMode === 'fail') return errData(500, 'Members unavailable');
      return okData({ members: [], pagination: { total: 42 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(subscription);
    assert.match(el.innerHTML, /Could not load member count/);
    assert.ok(el.querySelector('#sub-members-retry'), 'retry button exists');
    assert.doesNotMatch(el.innerHTML, /Members Used/, 'no silently-missing usage row');
    membersMode = 'ok';
    el.querySelector('#sub-members-retry').click();
    await tick(); await tick();
    assert.match(el.innerHTML, /Members Used/);
    assert.match(el.innerHTML, /42/);
    assert.doesNotMatch(el.innerHTML, /Could not load member count/);
  } finally { restore(); }
});

// ─── V10-L19: version indicator ─────────────────────────────────────────

test('V10-L19 settings: footer shows the app version', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ gym: { name: 'Gym', show_biometric_link_banner: true }, plans: [], payment_settings: {} });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(settings);
    const footer = el.querySelector('#app-version');
    assert.ok(footer, 'version footer renders');
    assert.match(footer.textContent, /App version /);
    assert.match(footer.textContent, new RegExp(APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'footer shows the build version');
  } finally { restore(); }
});

test('V10-L19 version: module exports a dev fallback under node --test', () => {
  assert.equal(APP_VERSION, 'dev', 'no Vite define in tests — safe fallback, not a crash');
});

// ─── V10-L20: bot-test keeps focus, guards double-send ──────────────────

test('V10-L20 bot-test: send appends in place (input survives), Send disabled in flight, one POST per message', async () => {
  let resolveBot;
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/test')) {
      return new Promise((resolve) => { resolveBot = () => resolve(okData({ response: 'Hi there!' })); });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botTest);
    const input = el.querySelector('#bt-input');
    input.value = 'hello';
    const sendBtn = el.querySelector('#bt-send');
    sendBtn.click();
    assert.equal(sendBtn.disabled, true, 'Send disabled while a reply is in flight');
    sendBtn.click();
    await tick();
    assert.equal(calls.filter((c) => c.url.includes('/bot/test')).length, 1, 'second click while in flight fires nothing');
    assert.equal(el.querySelector('#bt-input'), input, 'input element survives the send (no full re-render)');
    resolveBot();
    await tick(); await tick();
    assert.equal(el.querySelector('#bt-input'), input, 'input element survives the reply too');
    assert.match(el.innerHTML, /hello/);
    assert.match(el.innerHTML, /Hi there!/);
    assert.equal(el.querySelector('#bt-send').disabled, false, 'Send re-enabled after the reply');
  } finally { restore(); }
});

// ─── V10-L21 / L25: campaign-create templates failure + stable key ─────

test('V10-L21 campaign-create: templates failure shows an error + retry, blocks Send, no free-text swap; retry recovers', async () => {
  let templMode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns/templates')) {
      if (templMode === 'fail') return errData(500, 'Templates unavailable');
      return okData({ templates: [{ id: 1, name: 'Renewal nudge', body: 'Hi {name}!' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    assert.match(el.innerHTML, /Could not load message templates/);
    assert.match(el.innerHTML, /Templates unavailable/);
    assert.ok(el.querySelector('#cc-templ-retry'), 'templates retry exists');
    assert.equal(el.querySelector('#cc-msg'), null, 'no silent free-text fallback on failure');
    assert.equal(el.querySelector('#cc-templ'), null, 'no template picker on failure');
    assert.equal(el.querySelector('#cc-send').disabled, true, 'Send blocked until templates load');
    templMode = 'ok';
    el.querySelector('#cc-templ-retry').click();
    await tick(); await tick();
    assert.ok(el.querySelector('#cc-templ'), 'template picker appears after retry');
    assert.equal(el.querySelector('#cc-send').disabled, false, 'Send unblocked after templates load');
    assert.doesNotMatch(el.innerHTML, /Could not load message templates/);
  } finally { restore(); }
});

test('V10-L21 campaign-create: a load that succeeds with zero templates still offers free-text', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    assert.ok(el.querySelector('#cc-msg'), 'free-text field renders when zero templates load successfully');
    assert.equal(el.querySelector('#cc-send').disabled, false, 'Send allowed with zero templates');
  } finally { restore(); }
});

test('V10-L25 campaign-create: campaign POST carries one stable key reused across a failed retry', async () => {
  let postMode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [{ id: 1, name: 'Renewal nudge', body: 'Hi {name}!' }] });
    if (url.includes('/api/mobile/v1/campaigns') && (options?.method || 'GET') === 'POST' && !url.includes('segments')) {
      if (postMode === 'fail') return errData(500, 'Campaign failed');
      return okData({ id: 9 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    const submit = async () => {
      el.querySelector('#cc-name').value = 'Test';
      el.querySelector('#cc-segment').value = 'expiring';
      el.querySelector('#cc-templ').value = '1';
      el.querySelector('#cc-form').dispatchEvent({ type: 'submit' });
      await tick();
      // Confirm dialog (showConfirm) renders into document.body.
      document.body.querySelector('#confirm-yes').click();
      await tick(); await tick();
    };
    await submit();
    let posts = calls.filter((c) => c.url.includes('/api/mobile/v1/campaigns') && (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'one campaign POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'campaign POST carries a key');
    assert.equal(el.querySelector('#cc-send').disabled, false, 'Send re-enabled after failure');
    await submit();
    posts = calls.filter((c) => c.url.includes('/api/mobile/v1/campaigns') && (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
  } finally { restore(); }
});

// ─── V10-L23: notifications total from the parsed array ─────────────────

test('V10-L23 notifications: total derives from the parsed notifications array when pagination is absent', async () => {
  const NOTIFS = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, title: `Note ${i + 1}`, read: false, created_at: '2026-11-09T10:00:00Z' }));
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/notifications?page=1')) return okData({ notifications: NOTIFS });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(notifications);
    assert.match(el.innerHTML, /Showing 3 of 3 notifications/);
    assert.match(el.innerHTML, /Note 1/);
  } finally { restore(); }
});

// ─── V10-L25: cash-close holds a stable key ─────────────────────────────

test('V10-L25 owner-finance: cash-close POST carries one stable key reused across a failed retry', async () => {
  let closeMode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/owner/finance')) {
      return okData({ today: { total: 5000, expected_cash: 2000, by_method: { cash: 2000 } }, pending_verification: 0, last_7_days: { total: 30000 }, cash_close: { closed: false, counted_cash: null, variance: null, notes: null } });
    }
    if (url.includes('/api/mobile/v1/owner/cash-close')) {
      if (closeMode === 'fail') return errData(500, 'Close failed');
      return okData({ variance: 0 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(ownerFinance);
    const form = el.querySelector('#cash-close-form');
    assert.ok(form, 'cash-close form renders');
    form.dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    let posts = calls.filter((c) => c.url.includes('/owner/cash-close'));
    assert.equal(posts.length, 1, 'one cash-close POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'cash-close POST carries a key');
    form.dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    posts = calls.filter((c) => c.url.includes('/owner/cash-close'));
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
  } finally { restore(); }
});

// ─── V10 contingent gating (20a): DELETE unmapped is owner-only ─────────

test('V10-gating rrr-mappings: staff session hides Clear-all-unmapped; owner session shows it', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/rrr/mappings/unresolved')) {
      return okData({ groups: [{ biometric_user_id: '101', punch_count: 3, latest_punch_time: '2026-11-09T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    }
    if (url.includes('/api/mobile/v1/members?page=1')) return okData({ members: [{ ...MEMBER_7 }], pagination: { total: 1 } });
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '9', tenantName: 'Gym', userId: '2', userName: 'Staff', userRole: 'staff', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const elStaff = await mount(rrrMappings);
    assert.equal(elStaff.querySelector('#bm-clear-all'), null, 'Clear-all hidden for staff');
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '9', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const elOwner = await mount(rrrMappings);
    assert.ok(elOwner.querySelector('#bm-clear-all'), 'Clear-all shown for the owner');
  } finally { restore(); setCachedSession(undefined); }
});
