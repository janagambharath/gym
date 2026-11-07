/* V9 error-state tests (V9-M3..M6, V9-L6..L12, V8-L26 partial).
 *
 * Same tiny tree-based DOM shim as v8-error-states.test.js (no jsdom —
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
const errData = (status, message) => ({ ok: false, status, json: async () => ({ success: false, error: { message } }) });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Screens are imported after the DOM shims above (module evaluation
// touches document/window via api.js / router.js).
const botSetup = (await import('./bot-setup.js')).default;
const gymProfile = (await import('./gym-profile.js')).default;
const editMember = (await import('./edit-member.js')).default;
const rrrIntegrations = (await import('./rrr-integrations.js')).default;
const whatsapp = (await import('./whatsapp.js')).default;
const memberDetail = (await import('./member-detail.js')).default;
const notifications = (await import('./notifications.js')).default;
const rrrList = (await import('./rrr-list.js')).default;
const campaignCreate = (await import('./campaign-create.js')).default;
const renewMember = (await import('./renew-member.js')).default;
const subscription = (await import('./subscription.js')).default;
const dateRepair = (await import('./date-repair.js')).default;
const rrrDeleteMembers = (await import('./rrr-delete-members.js')).default;
const memberAttendance = (await import('./member-attendance.js')).default;
const access = (await import('./access.js')).default;
const rrrDashboard = (await import('./rrr-dashboard.js')).default;
const memberHistory = (await import('./member-history.js')).default;
const { uploadFormData, setCachedSession } = await import('../api.js');
const paymentSetup = (await import('./payment-setup.js')).default;
const addMember = (await import('./add-member.js')).default;
const whatsappSetup = (await import('./whatsapp-setup.js')).default;
const renewals = (await import('./renewals.js')).default;
const recordPayment = (await import('./record-payment.js')).default;
const members = (await import('./members.js')).default;
const payments = (await import('./payments.js')).default;
const ownerLeads = (await import('./owner-leads.js')).default;
const plans = (await import('./plans.js')).default;
const staff = (await import('./staff.js')).default;
const { configureDisplayPreferences, formatTime, getInvalidStoredTimezone, getEffectiveTimezone } = await import('../utils.js');
const { bootVynla } = await import('../vynla.js');


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


// ─── FormData shim (see note above) ─────────────────────────────────────
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

// V9-M3: payment-setup load failure must show error + retry and NO form /
// Save (a blank form + Save used to wipe payment_label + instructions).
test('V9-M3 payment-setup: load failure shows error, no form/Save; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings/payment')) {
      if (mode === 'fail') return errData(500, 'Payment settings unavailable');
      return okData({ upi_id: 'gym@okhdfcbank', payment_label: 'Iron Paradise', instructions: 'Pay and share the reference' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(paymentSetup);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Payment settings unavailable/);
    assert.equal(el.querySelector('#ps-form'), null, 'no form on load failure');
    assert.equal(el.querySelector('#ps-submit'), null, 'no Save button on load failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Iron Paradise/);
    assert.ok(el.querySelector('#ps-submit'), 'Save appears only after a successful load');
  } finally { restore(); }
});

// V9-M4: add-member plans-leg failure must show error + retry and NO form
// (an empty plan dropdown used to create a plan-less 0-day member).
test('V9-M4 add-member: plans failure shows error, no form; retry recovers; plan-less submit blocked', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Plans unavailable');
      return okData({ plans: [PLAN_MONTHLY] });
    }
    if (url.includes('/api/mobile/v1/members') && (options?.method || 'GET') === 'POST') return okData({ id: 8, full_name: 'Ravi' });
    if (url.includes('/api/mobile/v1/members')) return okData({ members: [], pagination: { total: 0 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(addMember);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Plans unavailable/);
    assert.equal(el.querySelector('#add-form'), null, 'no form on plans failure');
    assert.equal(el.querySelector('#am-submit'), null, 'no Save button on plans failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Monthly/);
    assert.ok(el.querySelector('#am-submit'), 'form appears only after plans load');
    // Plan-less submit (no plan chosen) must not POST.
    el.querySelector('#am-name').value = 'Ravi';
    el.querySelector('#am-phone').value = '9876543210';
    el.querySelector('#add-form').dispatchEvent({ type: 'submit' });
    await tick();
    assert.equal(calls.filter((c) => (c.options?.method || 'GET') === 'POST').length, 0, 'no member POST without a plan');
    assert.match(document.body.innerHTML, /select a membership plan/);
    // With a plan chosen the POST goes through with that plan.
    el.querySelector('#am-plan').value = '1';
    el.querySelector('#add-form').dispatchEvent({ type: 'submit' });
    await tick();
    const posts = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'one member POST once a plan is chosen');
    assert.equal(JSON.parse(posts[0].options.body).plan_id, 1);
  } finally { restore(); }
});

// V9-M5: whatsapp-setup status failure must show error + retry, never the
// "Connect WhatsApp" + Start Setup state as fact.
test('V9-M5 whatsapp-setup: status failure shows error, no Start Setup; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) {
      if (mode === 'fail') return errData(500, 'WhatsApp status unavailable');
      return okData({ status: 'CONNECTED', status_description: 'Connected', business_phone_number: '919876543210' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /WhatsApp status unavailable/);
    assert.equal(el.querySelector('#ws-start'), null, 'no Start Setup button on status failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /WhatsApp Connected/);
    assert.equal(el.querySelector('#ws-start'), null, 'connected state has no Start Setup either');
  } finally { restore(); }
});

// V9-M6: renewals — (a) total failure shows error + a WORKING retry;
// (b) one leg failing while the other is empty must not claim "All members
// are up to date!"; (c) one leg failing with members shown surfaces a
// per-leg notice + retry instead of silently hiding the section.
test('V9-M6 renewals: total failure retry works; single-leg failure never claims all up to date', async () => {
  let mode = 'bothFail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/renewals/upcoming')) {
      if (mode === 'bothFail' || mode === 'upcomingFail') return errData(500, 'Upcoming unavailable');
      return okData({ members: mode === 'upcomingEmpty' || mode === 'upcomingEmptyExpiredFail' ? [] : [{ id: 7, full_name: 'Asha', phone: '98765', days_until_expiry: 2, plan: { name: 'Monthly' } }] });
    }
    if (url.includes('/api/mobile/v1/renewals/expired')) {
      if (mode === 'bothFail' || mode === 'expiredFail' || mode === 'upcomingEmptyExpiredFail') return errData(500, 'Expired unavailable');
      return okData({ members: [] });
    }
    return errData(404, 'not found');
  });
  try {
    // (a) total failure: error + retry that actually reloads.
    const el = await mount(renewals);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.doesNotMatch(el.innerHTML, /Something went wrong/);

    // (b) upcoming empty + expired leg failed: no false "up to date".
    mode = 'upcomingEmptyExpiredFail';
    const el2 = await mount(renewals);
    assert.doesNotMatch(el2.innerHTML, /All members are up to date!/);
    assert.match(el2.innerHTML, /Could not load expired members/);
    assert.ok(el2.querySelector('#retry-btn'), 'retry button exists on single-leg failure');

    // (c) upcoming has members + expired leg failed: list + per-leg notice.
    mode = 'ok';
    el2.querySelector('#retry-btn').click();
    await tick();
    assert.match(el2.innerHTML, /Asha/);
    mode = 'expiredFail';
    const el3 = await mount(renewals);
    assert.match(el3.innerHTML, /Asha/);
    assert.match(el3.innerHTML, /Could not load expired members/);
    assert.ok(el3.querySelector('#rn-leg-retry'), 'per-leg retry exists');
    mode = 'ok';
    el3.querySelector('#rn-leg-retry').click();
    await tick();
    assert.doesNotMatch(el3.innerHTML, /Could not load expired members/);
  } finally { restore(); }
});

// V9-L6: record-payment settings failure must show error + retry (not a
// false "No plans yet" + IST fallback), no 30-day default preview, and no
// POST with plan_id: null.
test('V9-L6 record-payment: settings failure shows error, not "No plans yet"; plan-less POST blocked', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Settings unavailable');
      return okData({ plans: [PLAN_MONTHLY], gym: { timezone: 'Asia/Kolkata' } });
    }
    if (url.includes('/api/mobile/v1/members/7')) return okData({ ...MEMBER_7 });
    if (url.includes('/api/mobile/v1/payments') && (options?.method || 'GET') === 'POST') return okData({ id: 3 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(recordPayment, { memberId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Settings unavailable/);
    assert.equal(el.querySelector('#rp-form'), null, 'no form on settings failure');
    assert.doesNotMatch(el.innerHTML, /No plans yet/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.ok(el.querySelector('#rp-form'), 'form appears only after settings load');
    assert.doesNotMatch(el.innerHTML, /No plans yet/);
    // No plan selected: no 30-day default preview and no POST.
    assert.equal(el.querySelector('#rp-end-preview').textContent, '', 'no end preview without a plan');
    el.querySelector('#rp-amount').value = '1500';
    el.querySelector('#rp-form').dispatchEvent({ type: 'submit' });
    await tick();
    assert.equal(calls.filter((c) => (c.options?.method || 'GET') === 'POST').length, 0, 'no payment POST without a plan');
    assert.match(document.body.innerHTML, /select a membership plan/);
    // With a plan the POST carries that plan id, never null.
    el.querySelector('#rp-plan').value = '1';
    el.querySelector('#rp-form').dispatchEvent({ type: 'submit' });
    await tick();
    const posts = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0].options.body).plan_id, 1);
  } finally { restore(); }
});

// V9-L7: members list first-load failure renders a WORKING Try Again button.
test('V9-L7 members: first-load failure retry works', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members')) {
      if (mode === 'fail') return errData(500, 'Members unavailable');
      return okData({ members: [{ ...MEMBER_7 }], pagination: { total: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(members);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Members unavailable/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.doesNotMatch(el.innerHTML, /Something went wrong/);
  } finally { restore(); }
});

// V9-L8: payments list first-load failure renders a WORKING Try Again button.
test('V9-L8 payments: first-load failure retry works', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/payments/summary')) return okData({ today: { total_collected: '0', payment_count: 0 }, pending: { count: 0 } });
    if (url.includes('/api/mobile/v1/payments')) {
      if (mode === 'fail') return errData(500, 'Payments unavailable');
      return okData({ payments: [{ id: 2, member_name: 'Asha', amount: 1500, status: 'verified', method: 'upi', paid_on: '2026-11-07' }], pagination: { total: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(payments);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Payments unavailable/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.doesNotMatch(el.innerHTML, /Something went wrong/);
  } finally { restore(); }
});

// V9-L9: double-submit guards — a second submit while the first is in
// flight fires no second POST, and a retry after failure reuses the same
// stable per-form idempotency key.
test('V9-L9 owner-leads: double submit fires one POST; retry reuses the same key', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/owner/leads') && (options?.method || 'GET') === 'GET') {
      return okData({ leads: [] });
    }
    if (url.includes('/api/mobile/v1/owner/leads')) {
      if (mode === 'fail') return errData(500, 'Lead save failed');
      return okData({ id: 1 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(ownerLeads);
    el.querySelector('#lead-add').click();
    el.querySelector('input[name="name"]').value = 'Neha Rao';
    el.querySelector('input[name="phone"]').value = '9876543210';
    const form = el.querySelector('#lead-form');
    form.dispatchEvent({ type: 'submit' });
    form.dispatchEvent({ type: 'submit' });
    await tick();
    const posts = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'double submit fires one POST');
    const key1 = posts[0].options.headers['Idempotency-Key'];
    assert.match(key1, /^[0-9a-f-]{36}$/, 'POST carries a stable idempotency key');
    // Failure re-enables the button; a retry reuses the SAME key.
    assert.equal(form.querySelector('button[type="submit"]').disabled, false, 'submit re-enabled after failure');
    form.dispatchEvent({ type: 'submit' });
    await tick();
    const posts2 = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts2.length, 2, 'retry fires a second POST');
    assert.equal(posts2[1].options.headers['Idempotency-Key'], key1, 'retry reuses the same key');
  } finally { restore(); }
});

test('V9-L9 plans: double submit fires one POST; retry reuses the same key', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [] });
    if (url.includes('/api/mobile/v1/plans') && (options?.method || 'GET') === 'POST') {
      if (mode === 'fail') return errData(500, 'Plan save failed');
      return okData({ id: 1 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(plans);
    el.querySelector('#header-action-0').click();
    el.querySelector('#pl-name').value = 'Monthly';
    el.querySelector('#pl-days').value = '30';
    el.querySelector('#pl-price').value = '1500';
    const form = el.querySelector('#plan-form');
    form.dispatchEvent({ type: 'submit' });
    form.dispatchEvent({ type: 'submit' });
    await tick();
    const posts = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'double submit fires one POST');
    const key1 = posts[0].options.headers['Idempotency-Key'];
    assert.match(key1, /^[0-9a-f-]{36}$/, 'POST carries a stable idempotency key');
    assert.equal(form.querySelector('button[type="submit"]').disabled, false, 'Save re-enabled after failure');
    form.dispatchEvent({ type: 'submit' });
    await tick();
    const posts2 = calls.filter((c) => (c.options?.method || 'GET') === 'POST');
    assert.equal(posts2.length, 2, 'retry fires a second POST');
    assert.equal(posts2[1].options.headers['Idempotency-Key'], key1, 'retry reuses the same key');
  } finally { restore(); }
});

test('V9-L9 staff reset-password: double click fires one POST; retry reuses the same key', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/staff/') && url.includes('/reset-password')) {
      if (mode === 'fail') return errData(500, 'Reset failed');
      return okData({ new_password: 'Temp1234', invite_whatsapp_url: 'https://wa.me/1' });
    }
    if (url.includes('/api/mobile/v1/staff')) return okData({ staff: [{ id: 4, full_name: 'Vikram', email: 'v@x.com', role: 'staff', is_active: true }] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(staff);
    el.querySelector('[data-staff-id="4"]').click();
    const resetBtn = () => el.querySelector('#btn-reset-staff-pass');
    assert.ok(resetBtn(), 'reset button rendered');
    resetBtn().click();
    await tick(10);
    document.body.querySelector('#confirm-yes').click();
    resetBtn().click();
    await tick();
    let posts = calls.filter((c) => c.url.includes('/reset-password'));
    assert.equal(posts.length, 1, 'double click fires one reset POST');
    const key1 = posts[0].options.headers['Idempotency-Key'];
    assert.match(key1, /^[0-9a-f-]{36}$/, 'reset POST carries a stable idempotency key');
    // Failure re-enables; a retry reuses the SAME key (no second password).
    assert.equal(resetBtn().disabled, false, 'reset re-enabled after failure');
    resetBtn().click();
    await tick(10);
    document.body.querySelector('#confirm-yes').click();
    await tick();
    posts = calls.filter((c) => c.url.includes('/reset-password'));
    assert.equal(posts.length, 2, 'retry fires a second reset POST');
    assert.equal(posts[1].options.headers['Idempotency-Key'], key1, 'retry reuses the same key');
  } finally { restore(); }
});

// V9-L10: the VYNLA member client attaches a fresh Idempotency-Key to every
// mutation (and none to GETs) — the Android-only V8-L32 fix, now on vynla.js.
test('V9-L10 vynla: mutations carry a fresh Idempotency-Key each; GETs carry none', async () => {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/member/v1/auth/request-otp')) return okData({ challenge: 'c1' });
    if (url.includes('/api/member/v1/auth/verify-otp')) return okData({ token: 'tok', refresh_token: 'rt', member: { full_name: 'Asha' } });
    if (url.includes('/api/member/v1/dashboard')) return okData({ member: { full_name: 'Asha', days_left: 10, status: 'active', plan_name: 'Monthly', membership_start: '2026-10-01', membership_end: '2026-12-31' }, gym: { name: 'Iron Paradise', timezone: 'Asia/Kolkata' }, branding: {} });
    if (url.includes('/api/member/v1/access')) return okData({ summary: { today_entries: 1, last_visit: '2026-11-07T08:00:00Z' }, events: [] });
    return errData(404, 'not found');
  });
  try {
    const app = new El('div');
    app.attrs.id = 'app';
    document.body.appendChild(app);
    bootVynla();
    await tick();
    document.querySelector('#phone').value = '9876543210';
    document.querySelector('#phone-form').dispatchEvent({ type: 'submit' });
    await tick();
    document.querySelector('#otp').value = '123456';
    document.querySelector('#otp-form').dispatchEvent({ type: 'submit' });
    await tick();
    assert.match(document.body.innerHTML, /Hi, Asha/);
    const otpPosts = calls.filter((c) => c.url.includes('request-otp'));
    const verifyPosts = calls.filter((c) => c.url.includes('verify-otp'));
    assert.equal(otpPosts.length, 1, 'one request-otp POST');
    assert.equal(verifyPosts.length, 1, 'one verify-otp POST');
    const key1 = otpPosts[0].options.headers['Idempotency-Key'];
    const key2 = verifyPosts[0].options.headers['Idempotency-Key'];
    assert.match(key1, /^[0-9a-f-]{36}$/, 'request-otp carries a UUID key');
    assert.match(key2, /^[0-9a-f-]{36}$/, 'verify-otp carries a UUID key');
    assert.notEqual(key2, key1, 'each mutation gets a FRESH key');
    for (const get of calls.filter((c) => (c.options?.method || 'GET') === 'GET')) {
      assert.equal(get.options.headers['Idempotency-Key'], undefined, `GET ${get.url} carries no key`);
    }
    app.remove();
  } finally { restore(); }
});

// V9-L11: rrr-integrations commands-leg failure must show an error state for
// the commissioning tests — never both eSSL tests as un-run.
test('V9-L11 rrr-integrations: commands failure shows error, not "un-run"; retry recovers', async () => {
  let mode = 'fail';
  const direct = { id: 1, type: 'adms_direct', status: 'connected', device_serial: 'X1', device_name: 'Terminal', last_seen_at: new Date().toISOString(), records_synced: 1, terminal_settings: { server_address: 'x', server_port: 80, https: false, path: '/iclock', server_mode: 'ADMS' } };
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/integrations') && url.includes('/adms/commands')) {
      if (mode === 'fail') return errData(500, 'Commands unavailable');
      return okData({ commands: [{ id: 1, action: 'essl_group_block_test', status: 'acked' }, { id: 2, action: 'essl_group_unblock_test', status: 'acked' }] });
    }
    if (url.includes('/api/mobile/v1/rrr/integrations')) return okData({ integrations: [direct], devices: [] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    assert.match(el.innerHTML, /Could not load the commissioning test results/);
    assert.doesNotMatch(el.innerHTML, /No commissioning command sent yet/);
    assert.ok(el.querySelector('#rrr-commands-retry'), 'commands retry exists');
    mode = 'ok';
    el.querySelector('#rrr-commands-retry').click();
    await tick();
    assert.doesNotMatch(el.innerHTML, /Could not load the commissioning test results/);
    assert.match(el.innerHTML, /Grp=100 update acknowledged/);
  } finally { restore(); }
});

// V9-L12: an invalid stored gym timezone ('india') is surfaced with the
// effective timezone — formatters use Asia/Kolkata, never device-local,
// and the dashboard never claims "(gym time)" for it.
test('V9-L12 utils: invalid stored timezone falls back explicitly and is reported', () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'india' });
  assert.equal(getInvalidStoredTimezone(), 'india');
  assert.equal(getEffectiveTimezone(), 'Asia/Kolkata');
  // 12:00 UTC == 17:30 IST — Asia/Kolkata, not device-local.
  assert.match(formatTime('2026-11-06T12:00:00Z'), /5:30/);
  // A valid timezone clears the warning.
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  assert.equal(getInvalidStoredTimezone(), null);
  assert.equal(getEffectiveTimezone(), 'Asia/Kolkata');
});

test('V9-L12 rrr-dashboard: invalid stored timezone shows a warning with the effective zone, not "(gym time)"', async () => {
  configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'india' });
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/dashboard')) {
      return okData({ integration: null, pillars: { revenue: { count: 0, potential_revenue: 0, items: [] }, retain: { count: 0, potential_revenue: 0, items: [] }, recover: { count: 0, potential_revenue: 0, items: [] } }, members: { total: 5, active: 4, attendance_rate: 80 }, unmapped_count: 0, total_potential_revenue: 0, owner_confirmed_revenue: 0, plans_count: 1, whatsapp_connected: false, payment_setup_done: false });
    }
    if (url.includes('/api/mobile/v1/owner/today')) return okData({ actions: [] });
    if (url.includes('/api/mobile/v1/settings')) return okData({ gym: { show_biometric_link_banner: false } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrDashboard);
    assert.match(el.innerHTML, /stored timezone/);
    assert.match(el.innerHTML, /india/);
    assert.match(el.innerHTML, /Asia\/Kolkata/);
    assert.doesNotMatch(el.innerHTML, /\(gym time\)/);
  } finally {
    restore();
    configureDisplayPreferences({ country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' });
  }
});

// V8-L26 PARTIAL (v9): single-leg first-load failures must show error +
// retry, not false state — (a) summary-OK + feed-failed is not "No events";
// (b) summary-failed + feed-OK is not "Biometric Device Offline" + 0/0.
test('V8-L26 partial access: summary-OK + feed-failed shows error + retry, not "No events"', async () => {
  let mode = 'feedFail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ device_online: true, entries_today: 3, exits_today: 1, inside_now: 0, denied_today: 0 });
    if (url.includes('/api/mobile/v1/access/events')) {
      if (mode === 'feedFail') return errData(500, 'Feed unavailable');
      return okData({ events: [{ id: 1, event_type: 'ENTRY', member_id: 7, member_name: 'Asha', event_timestamp: '2026-11-07T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Feed unavailable/);
    assert.doesNotMatch(el.innerHTML, /No events/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.match(el.innerHTML, /Biometric Device Online/);
  } finally { restore(); }
});

test('V8-L26 partial access: summary-failed + feed-OK shows error + retry, not "Offline" + 0/0', async () => {
  let mode = 'summaryFail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) {
      if (mode === 'summaryFail') return errData(500, 'Summary unavailable');
      return okData({ device_online: true, entries_today: 3, exits_today: 1, inside_now: 0, denied_today: 0 });
    }
    if (url.includes('/api/mobile/v1/access/events')) return okData({ events: [{ id: 1, event_type: 'ENTRY', member_id: 7, member_name: 'Asha', event_timestamp: '2026-11-07T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Summary unavailable/);
    assert.doesNotMatch(el.innerHTML, /Biometric Device Offline/);
    assert.doesNotMatch(el.innerHTML, /No events/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.match(el.innerHTML, /Biometric Device Online/);
  } finally { restore(); }
});
