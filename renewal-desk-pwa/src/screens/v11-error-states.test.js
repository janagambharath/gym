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

// Screens under test (imported after the DOM shims above).
const campaignCreate = (await import('./campaign-create.js')).default;
const campaigns = (await import('./campaigns.js')).default;
const campaignDetail = (await import('./campaign-detail.js')).default;
const memberScanReview = (await import('./member-scan-review.js')).default;
const memberScan = (await import('./member-scan.js')).default;
const recordPayment = (await import('./record-payment.js')).default;
const memberDetail = (await import('./member-detail.js')).default;
const payments = (await import('./payments.js')).default;
const renewals = (await import('./renewals.js')).default;
const staff = (await import('./staff.js')).default;
const rrrMappings = (await import('./rrr-mappings.js')).default;
const rrrDeleteMembers = (await import('./rrr-delete-members.js')).default;
const access = (await import('./access.js')).default;
const { apiRequest, setCachedSession } = await import('../api.js');
const { renderAvatar } = await import('../components.js');

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

const toastText = () => document.body.querySelector('#toast-container')?.textContent || '';

// ─── Fixtures ───────────────────────────────────────────────────────────

const MEMBER_7 = {
  id: 7, full_name: 'Asha', phone: '98765', email: 'a@x.com', address: 'Hyderabad',
  gender: 'Female', status: 'active', plan: { id: 1, name: 'Monthly', duration_days: 30, price: 1500 },
  membership_start: '2026-10-01', membership_end: '2026-12-31', days_until_expiry: 54,
  joined_on: '2026-01-01', notes: '', is_inside: false, whatsapp_opted_in: true,
  has_biometric: true, device_enroll_number: '101', door_blocked: false,
};
const MEMBER_8 = {
  id: 8, full_name: 'Bala', phone: '98766', email: 'b@x.com', address: 'Hyderabad',
  gender: 'Male', status: 'active', plan: { id: 1, name: 'Monthly', duration_days: 30, price: 1500 },
  membership_start: '2026-10-01', membership_end: '2026-12-31', days_until_expiry: 54,
  joined_on: '2026-01-01', notes: '', is_inside: false, whatsapp_opted_in: true,
  has_biometric: true, device_enroll_number: '102', door_blocked: false,
};
const PLAN_MONTHLY = { id: 1, name: 'Monthly', duration_days: 30, price: 1500 };
const PLAN_QUARTERLY = { id: 2, name: 'Quarterly', duration_days: 90, price: 4000 };

// ─── V11-C1: campaign create sends the backend's keys, then sends ─────

test('V11-C1 campaign-create: create posts segment_type/whatsapp_template_name/message_template, then calls send; "launched" only after send succeeds', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [{ id: 'expired_member_reactivation_01', name: 'expired_member_reactivation_01', body: 'Hi {name}, come back!' }] });
    if (url.includes('/campaigns/9/send') && method === 'POST') return okData({ sent: 8, total: 10, failed: 2 });
    if (url.includes('/api/mobile/v1/campaigns') && method === 'POST') return okData({ id: 9 });
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
    const posts = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 2, 'create + send, nothing else');
    const create = posts.find((c) => !c.url.includes('/send'));
    const send = posts.find((c) => c.url.includes('/send'));
    assert.ok(create, 'create POST exists');
    assert.ok(send, 'send POST exists');
    const body = JSON.parse(create.options.body);
    assert.equal(body.segment_type, 'expiring_7d', 'backend segment key');
    assert.equal(body.whatsapp_template_name, 'expired_member_reactivation_01', 'backend template key');
    assert.equal(body.message_template, 'Hi {name}, come back!', 'template body as message_template');
    assert.equal('segment' in body, false, 'no dead segment key');
    assert.equal('template_id' in body, false, 'no dead template_id key');
    assert.equal('message' in body, false, 'no dead message key');
    assert.match(send.url, /\/api\/mobile\/v1\/campaigns\/9\/send/, 'send targets the created campaign');
    assert.match(toastText(), /Campaign launched! Sent to 8 of 10 members \(2 failed\)/, 'launched toast with real counts, only after send');
  } finally { restore(); }
});

test('V11-C1 campaign-create: a failed send never toasts "launched" — the campaign is a saved draft', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [{ id: 'expired_member_reactivation_01', name: 'expired_member_reactivation_01', body: 'Hi!' }] });
    if (url.includes('/campaigns/9/send') && method === 'POST') return errData(500, 'WhatsApp is not configured');
    if (url.includes('/api/mobile/v1/campaigns') && method === 'POST') return okData({ id: 9 });
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
    assert.equal(calls.filter((c) => c.url.includes('/send')).length, 1, 'send was attempted');
    assert.doesNotMatch(toastText(), /Campaign launched!/, 'no launched toast when nothing was sent');
    assert.match(toastText(), /saved as a draft/, 'draft truth told instead');
  } finally { restore(); }
});

test('V11-C1 campaign-detail: a draft campaign has a Send button that calls the send endpoint', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/campaigns/9/send') && method === 'POST') return okData({ sent: 3, total: 5, failed: 0 });
    if (url.includes('/api/mobile/v1/campaigns/9')) {
      return okData({ id: 9, name: 'Win-back', status: 'draft', segment_type: 'all_expired', total_recipients: 5, total_sent: 0, total_delivered: 0, total_read: 0, total_replied: 0, total_renewed: 0, total_revenue_recovered: '0', created_at: '2026-11-09T10:00:00Z' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignDetail, { campaignId: '9' });
    const sendBtn = el.querySelector('#cd-send');
    assert.ok(sendBtn, 'draft campaign offers Send');
    sendBtn.click();
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/send')).length, 1, 'Send calls the send endpoint');
    assert.match(toastText(), /Campaign launched! Sent to 3 of 5 members/, 'launched toast with counts');
  } finally { restore(); }
});

// ─── V11-H4: scan-review plan contract + duplicate filtering ───────────

const SCAN_MEMBERS = [
  { temp_id: 'scan_1', name: 'Asha', phone: '+919876543210', plan_id: 2, plan_name: 'Quarterly', membership_start: '2026-11-01', membership_end: '2027-01-30', status: 'active', warnings: [], is_duplicate: false, is_ready: true, selected: true },
  { temp_id: 'scan_2', name: 'Bala', phone: '+919876543211', plan_id: null, plan_name: null, membership_start: '2026-11-01', membership_end: '2026-11-30', status: 'active', warnings: [], is_duplicate: true, is_ready: false, selected: false },
  { temp_id: 'scan_3', name: 'Chitra', phone: '+91987654321', plan_id: null, plan_name: 'Monthly', membership_start: '2026-11-01', membership_end: '2026-11-30', status: 'active', warnings: ['Phone looks short'], is_duplicate: false, is_ready: false, selected: false },
];

test('V11-H4 scan-review: plan_name renders, duplicates/not-ready rows are skipped with a visible count, import ships only ready rows with plan_id', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY, PLAN_QUARTERLY] });
    if (url.includes('/members/batch-create')) return okData({ imported: 1 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScanReview, { members: JSON.stringify(SCAN_MEMBERS) });
    assert.match(el.innerHTML, /Quarterly/, 'scanned plan_name renders in the Plan column');
    assert.match(el.innerHTML, /Duplicate/, 'duplicate row is badged');
    assert.match(el.innerHTML, /2 rows skipped/, 'skipped count is visible');
    assert.match(el.innerHTML, /Import 1 Member/, 'import button counts only importable rows');
    // Reassign the ready row's plan via the picker, then import.
    const planSelect = el.querySelectorAll('select[data-field="plan_id"]')[0];
    assert.ok(planSelect, 'plan picker renders');
    planSelect.value = '1';
    planSelect.dispatchEvent({ type: 'change' });
    el.querySelector('#sr-import').click();
    await tick(); await tick();
    const imports = calls.filter((c) => c.url.includes('/members/batch-create'));
    assert.equal(imports.length, 1, 'one import POST');
    const payload = JSON.parse(imports[0].options.body);
    assert.equal(payload.members.length, 1, 'duplicates / not-ready rows never submitted');
    assert.equal(payload.members[0].name, 'Asha');
    assert.equal(payload.members[0].plan_id, 1, 'picker edit writes plan_id, not plan');
    assert.equal('plan' in payload.members[0], false, 'no dead plan field in the payload');
    assert.match(toastText(), /1 members imported!/, 'success toast');
  } finally { restore(); }
});

test('V11-H4 scan-review: batch-create per-row errors name the failing row; a failed import reuses one stable key', async () => {
  let batchMode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY, PLAN_QUARTERLY] });
    if (url.includes('/members/batch-create')) {
      if (batchMode === 'fail') {
        return { ok: false, status: 422, json: async () => ({ success: false, error: { message: '1 member records failed validation. Please correct errors and retry.', code: 'BATCH_VALIDATION_FAILED', details: { errors: [{ index: 1, name: 'Asha', phone: '+919876543210', errors: ['Phone +919876543210 already belongs to an existing member'] }] } } }) };
      }
      return okData({ imported: 1 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScanReview, { members: JSON.stringify(SCAN_MEMBERS) });
    el.querySelector('#sr-import').click();
    await tick(); await tick();
    assert.match(el.innerHTML, /Some rows could not be imported/, 'per-row error box renders');
    assert.match(el.innerHTML, /Asha/, 'failing row is named');
    assert.match(el.innerHTML, /already belongs to an existing member/, 'backend reason surfaces');
    let imports = calls.filter((c) => c.url.includes('/members/batch-create'));
    assert.equal(imports.length, 1, 'one import POST');
    const firstKey = imports[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'import POST carries a key');
    el.querySelector('#sr-import').click();
    await tick(); await tick();
    imports = calls.filter((c) => c.url.includes('/members/batch-create'));
    assert.equal(imports.length, 2, 'retry posts again');
    assert.equal(imports[1].options.headers['Idempotency-Key'], firstKey, 'V11-L24: failed retry reuses the per-review key');
  } finally { restore(); }
});

test('V11-H4 scan-review: unchecking the only ready row disables Import', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY, PLAN_QUARTERLY] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScanReview, { members: JSON.stringify(SCAN_MEMBERS) });
    const box = el.querySelectorAll('input[data-field="selected"]')[0];
    assert.ok(box, 'row checkbox renders');
    box.checked = false;
    box.dispatchEvent({ type: 'change' });
    assert.equal(el.querySelector('#sr-import').disabled, true, 'nothing importable, Import disabled');
    assert.match(el.innerHTML, /Import 0 Members/);
  } finally { restore(); }
});

// ─── V11-H5: campaign list + detail read the backend's total_* keys ───

test('V11-H5 campaigns: list shows total_recipients and segment_type, never "0 recipients"', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns')) {
      return okData({ campaigns: [{ id: 1, name: 'Diwali Blast', segment_type: 'all_expired', total_recipients: 10, total_sent: 9, status: 'sent', created_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaigns);
    assert.match(el.innerHTML, /10 recipients/, 'real recipient count');
    assert.match(el.innerHTML, /All Expired Members/, 'real segment label');
    assert.doesNotMatch(el.innerHTML, /· 0 recipients/, 'no false zero');
  } finally { restore(); }
});

test('V11-H5 campaign-detail: detail shows total_* counts + attribution, no dead recipient list', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns/9')) {
      return okData({ id: 9, name: 'Diwali', status: 'sent', segment_type: 'all_expired', total_recipients: 5, total_sent: 5, total_delivered: 4, total_read: 3, total_replied: 1, total_renewed: 2, total_revenue_recovered: '1200.00', created_at: '2026-11-06T10:00:00Z' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignDetail, { campaignId: '9' });
    assert.match(el.innerHTML, /All Expired Members/, 'segment_type label');
    assert.match(el.innerHTML, /Renewals attributed/, 'attribution row exists');
    assert.match(el.innerHTML, /Revenue recovered/, 'revenue row exists');
    assert.match(el.innerHTML, /1,200/, 'recovered revenue renders');
    assert.doesNotMatch(el.innerHTML, /Showing .* of .* recipients/, 'no recipient list UI');
    assert.equal(el.querySelector('#cd-more'), null, 'no show-more for a list that never loads');
  } finally { restore(); }
});

// ─── V11-M2: record-payment search failure clears stale results ───────

test('V11-M2 record-payment: a failed member search clears stale results and shows an error with retry', async () => {
  let searchMode = 'ok';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY], gym: { timezone: 'Asia/Kolkata' } });
    if (url.includes('/api/mobile/v1/members?q=Asha')) return okData({ members: [{ ...MEMBER_7 }] });
    if (url.includes('/api/mobile/v1/members?q=Bala')) {
      if (searchMode === 'ok') return okData({ members: [{ ...MEMBER_8 }] });
      return errData(500, 'Search unavailable');
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(recordPayment);
    const search = el.querySelector('#rp-search');
    assert.ok(search, 'search renders');
    search.value = 'Asha';
    search.dispatchEvent({ type: 'input' });
    await tick(450);
    assert.match(el.innerHTML, /Asha/, 'first search renders its results');
    searchMode = 'fail';
    search.value = 'Bala';
    search.dispatchEvent({ type: 'input' });
    await tick(450);
    assert.doesNotMatch(el.innerHTML, /Asha/, 'stale results are cleared on failure');
    assert.match(el.innerHTML, /Couldn’t search members/, 'error shown, not silence');
    assert.ok(el.querySelector('#rp-search-retry'), 'retry offered');
    searchMode = 'ok';
    el.querySelector('#rp-search-retry').click();
    await tick(450);
    assert.match(el.innerHTML, /Bala/, 'retry recovers with fresh results');
  } finally { restore(); }
});

// ─── V11-L12: member-detail check-in/out uses a stable key ─────────────

test('V11-L12 member-detail: check-in POST carries one stable key reused across a failed retry, rotated after success', async () => {
  let checkinMode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/members/7') && method === 'GET') return okData({ ...MEMBER_7 });
    if (url.includes('/api/mobile/v1/access/checkin') && method === 'POST') {
      if (checkinMode === 'fail') return errData(500, 'Check-in failed');
      return okMsg({ event_type: 'ENTRY', message: 'Checked in' }, 'Checked in');
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const clickCheckin = async () => { el.querySelector('#btn-checkin').click(); await tick(); await tick(); };
    await clickCheckin();
    let posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 1, 'one check-in POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'check-in carries a key');
    await clickCheckin();
    posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
    checkinMode = 'ok';
    await clickCheckin();
    posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 3, 'success posts');
    assert.match(toastText(), /Checked in/, 'success toast');
    await clickCheckin();
    posts = calls.filter((c) => c.url.includes('/access/checkin'));
    assert.equal(posts.length, 4, 'next deliberate tap posts');
    assert.notEqual(posts[3].options.headers['Idempotency-Key'], firstKey, 'key rotates after a completed check-in');
  } finally { restore(); }
});

// ─── V11-L13: mappings search failure is an error, not "No members" ───

test('V11-L13 rrr-mappings: a failed member search shows an error with retry, not "No members found"', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/rrr/mappings/unresolved')) {
      return okData({ groups: [{ biometric_user_id: '101', punch_count: 3, latest_punch_time: '2026-11-09T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    }
    if (url.includes('q=Zed')) return errData(500, 'Search unavailable');
    if (url.includes('/api/mobile/v1/members?page=1')) return okData({ members: [{ ...MEMBER_7 }], pagination: { total: 1 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrMappings);
    el.querySelector('.bm-card').click();
    await tick();
    const search = el.querySelector('[data-search]');
    assert.ok(search, 'picker search renders');
    search.value = 'Zed';
    search.dispatchEvent({ type: 'input' });
    await tick(450);
    assert.match(el.innerHTML, /Couldn’t search members/, 'error state, not an empty state');
    assert.doesNotMatch(el.innerHTML, /No members found/, 'no false "No members found"');
    assert.ok(el.querySelector('[data-bm-search-retry]'), 'retry offered');
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V11-L14: payments summary leg failure shows a notice + retry ─────

test('V11-L14 payments: a failed summary leg shows an inline notice with retry instead of dropping the cards silently', async () => {
  let summaryMode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/payments/summary')) {
      if (summaryMode === 'fail') return errData(500, 'Summary unavailable');
      return okData({ today: { total_collected: '5000', payment_count: 3 }, pending: { count: 2 } });
    }
    if (url.includes('/api/mobile/v1/payments?page=1')) return okData({ payments: [], pagination: { total: 0 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(payments);
    assert.match(el.innerHTML, /Could not load the payment summary/, 'summary failure is surfaced');
    assert.ok(el.querySelector('#pay-summary-retry'), 'retry offered');
    summaryMode = 'ok';
    el.querySelector('#pay-summary-retry').click();
    await tick(); await tick();
    assert.match(el.innerHTML, /Today/, 'summary cards render after retry');
    assert.doesNotMatch(el.innerHTML, /Could not load the payment summary/, 'notice clears on success');
  } finally { restore(); }
});

// ─── V11-L15: renewals background refresh failure toasts once ──────────

test('V11-L15 renewals: a failed background refresh toasts instead of staying silent', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  let legsMode = 'ok';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/renewals/upcoming') || url.includes('/api/mobile/v1/renewals/expired')) {
      if (legsMode === 'fail') return errData(500, 'Renewals unavailable');
      return okData({ members: [{ ...MEMBER_7 }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = new El('div');
    el.isConnected = true; // live-refresh only runs for a connected screen
    await renewals.mount(el);
    assert.match(el.innerHTML, /Asha/, 'initial load renders');
    legsMode = 'fail';
    t.mock.timers.tick(30000); // live-refresh interval fires load(true)
    for (let i = 0; i < 20; i++) await Promise.resolve(); // flush the fetch chain
    assert.match(toastText(), /Could not refresh renewals/, 'background failure toasts once');
  } finally { restore(); t.mock.timers.reset(); }
});

// ─── V11-L16: staff avatar sizes have matching classes ─────────────────

test('V11-L16 renderAvatar: numeric sizes 44/48 emit matching classes and photo sizes', async () => {
  assert.match(renderAvatar('Asha Kumar', 44), /avatar-44/, '44px initials circle has its class');
  assert.match(renderAvatar('Asha Kumar', 48), /avatar-48/, '48px initials circle has its class');
  assert.match(renderAvatar('Asha Kumar', 44, 'https://example.com/p.jpg'), /width:44px/, '44px photo renders at 44px');
  assert.match(renderAvatar('Asha Kumar', 48, 'https://example.com/p.jpg'), /width:48px/, '48px photo renders at 48px');
});

// ─── V11-L17: staff create holds a stable per-form key ─────────────────

test('V11-L17 staff: create POST carries one stable key reused across a failed retry', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/staff') && method === 'GET') return okData({ staff: [] });
    if (url.includes('/api/mobile/v1/staff') && method === 'POST') return errData(500, 'Create failed');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(staff);
    el.querySelector('#btn-empty-add-staff').click();
    await tick();
    el.querySelector('#st-name').value = 'Vikram';
    el.querySelector('#st-email').value = 'v@x.com';
    el.querySelector('#add-staff-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    let posts = calls.filter((c) => c.url.includes('/api/mobile/v1/staff') && (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'one staff POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'staff create carries a key');
    el.querySelector('#add-staff-form').dispatchEvent({ type: 'submit' });
    await tick(); await tick();
    posts = calls.filter((c) => c.url.includes('/api/mobile/v1/staff') && (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'failed retry reuses the key');
  } finally { restore(); }
});

// ─── V11-L18: member-scan holds one key per scan session ───────────────

test('V11-L18 member-scan: a failed scan retried with the same file reuses one key', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/scan')) return errData(500, 'Scan failed');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberScan);
    const pick = async () => {
      const input = el.querySelector('#ms-file');
      input.files = [{ name: 'register.png', size: 5000, _dataUrl: 'data:image/png;base64,AAA' }];
      input.dispatchEvent({ type: 'change' });
      await tick(50); await tick(50);
    };
    await pick();
    let posts = calls.filter((c) => c.url.includes('/members/scan'));
    assert.equal(posts.length, 1, 'one scan POST');
    const firstKey = posts[0].options.headers['Idempotency-Key'];
    assert.ok(firstKey, 'scan carries a key');
    await pick();
    posts = calls.filter((c) => c.url.includes('/members/scan'));
    assert.equal(posts.length, 2, 'retry posts again');
    assert.equal(posts[1].options.headers['Idempotency-Key'], firstKey, 'same-session retry reuses the key');
  } finally { restore(); }
});

// ─── V11-L22: refresh 200 + success:false is definitive, not transient ─

test('V11-L22 apiRequest: a refresh that 200s with success:false reports "Session expired", not "could not reach the server"', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/auth/refresh')) {
      return { ok: true, status: 200, json: async () => ({ success: false, error: { message: 'Refresh token revoked' } }) };
    }
    if (url.includes('/api/mobile/v1/members/7')) return errData(401, 'Unauthorized');
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '9', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const res = await apiRequest('/api/mobile/v1/members/7');
    assert.equal(res.ok, false, 'request fails');
    assert.match(res.error.message, /Session expired/, 'definitive expiry, routes to login');
    assert.doesNotMatch(res.error.message, /Could not reach the server/, 'not misreported as transient');
  } finally { restore(); setCachedSession(undefined); }
});

// ─── V11-L23: bulk deactivate names its failures ───────────────────────

test('V11-L23 rrr-delete-members: failed deactivations are named with reasons and stay selected after reload', async () => {
  const prevConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const { restore } = installFetch(async (url, options) => {
    const method = options?.method || 'GET';
    if (url.includes('/api/mobile/v1/members/7/deactivate') && method === 'POST') return okData({});
    if (url.includes('/api/mobile/v1/members/8/deactivate') && method === 'POST') return errData(500, 'Deactivate failed');
    if (url.includes('/api/mobile/v1/members?page=1')) return okData({ members: [{ ...MEMBER_7 }, { ...MEMBER_8 }], pagination: { total: 2, total_pages: 1 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrDeleteMembers);
    // The DOM shim does not initialise .value from the value attribute
    // (a real browser does) — mirror the browser before driving the UI.
    for (const cb of el.querySelectorAll('.rrr-del-check')) { cb.value = cb.attrs.value; cb.checked = true; cb.dispatchEvent({ type: 'change' }); }
    el.querySelector('#rrr-delete-btn').click();
    await tick(); await tick(); await tick();
    assert.match(el.innerHTML, /1 deactivated, ⚠ 1 failed/, 'counts render');
    assert.match(el.innerHTML, /Bala/, 'failed member is named');
    assert.match(el.innerHTML, /Deactivate failed/, 'backend reason surfaces');
    await tick(1700); // the 1.5s reload
    const checks = el.querySelectorAll('.rrr-del-check');
    const failed = checks.find((c) => c.attrs.value === '8');
    const succeeded = checks.find((c) => c.attrs.value === '7');
    assert.ok(failed && 'checked' in failed.attrs, 'failed member stays selected after reload');
    assert.ok(succeeded && !('checked' in succeeded.attrs), 'succeeded member is not re-selected');
    assert.match(el.innerHTML, /Bala/, 'failure list survives the reload');
  } finally { restore(); globalThis.confirm = prevConfirm; }
});

// ─── V11-L5 follow-up: Re-sync is owner-only, staff never sees the button ─

const BRIDGE_SUMMARY = { device_online: true, device_name: 'Bridge Gym', entries_today: 3, exits_today: 1, inside_now: 0, denied_today: 0, failed_commands: 0, bridge_online: true };
const EMPTY_EVENTS = { events: [], pagination: { total: 0, total_pages: 1, page: 1 } };

test('V11-L5 access: staff session never renders the Re-sync Members button', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...BRIDGE_SUMMARY });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...EMPTY_EVENTS });
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '9', tenantName: 'Gym', userId: '2', userName: 'Staff', userRole: 'staff', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const el = await mount(access);
    assert.equal(el.querySelector('#btn-reconcile-all'), null, 'no Re-sync button for staff');
    assert.ok(el.querySelector('#btn-bridge-pairing'), 'Pairing Code still renders for staff');
  } finally { restore(); setCachedSession(undefined); }
});

test('V11-L5 access: owner session renders the Re-sync Members button', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ ...BRIDGE_SUMMARY });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ ...EMPTY_EVENTS });
    return errData(404, 'not found');
  });
  try {
    setCachedSession({ accessToken: 't', refreshToken: 'r', tenantId: '9', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
    const el = await mount(access);
    assert.ok(el.querySelector('#btn-reconcile-all'), 'Re-sync button renders for owner');
  } finally { restore(); setCachedSession(undefined); }
});
