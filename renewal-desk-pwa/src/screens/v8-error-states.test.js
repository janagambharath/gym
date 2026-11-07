/* V8 error-state tests (V8-M9..M13, V8-L19..L30).
 *
 * Same tiny tree-based DOM shim as v7-error-states.test.js (no jsdom —
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

// V8-M9: bot-setup load failure must show error + retry and NO Save button
// (a blank form + Save used to wipe the whole bot config with nulls).
test('V8-M9 bot-setup: load failure shows error, no form/Save; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/config')) {
      if (mode === 'fail') return errData(500, 'Bot config unavailable');
      return okData({ config: { greeting_message: 'Hi there', opening_hours: 'Mon-Sat 6AM-10PM' } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botSetup);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Bot config unavailable/);
    assert.equal(el.querySelector('#bs-form'), null, 'no form on load failure');
    assert.equal(el.querySelector('#bs-save'), null, 'no Save button on load failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Hi there/);
    assert.ok(el.querySelector('#bs-save'), 'Save appears only after a successful load');
  } finally { restore(); }
});

// V8-M10: gym-profile load failure must show error + retry and NO Save
// (a blank form + Save used to clear contact fields + force IST timezone).
test('V8-M10 gym-profile: load failure shows error, no form/Save; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Settings unavailable');
      return okData({ settings: { name: 'Iron Paradise', email: 'gym@x.com', phone: '98765', address: 'Hyd', timezone: 'Asia/Kolkata' } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(gymProfile);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Settings unavailable/);
    assert.equal(el.querySelector('#gp-form'), null, 'no form on load failure');
    assert.equal(el.querySelector('#gp-save'), null, 'no Save button on load failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Iron Paradise/);
    assert.ok(el.querySelector('#gp-save'), 'Save appears only after a successful load');
  } finally { restore(); }
});

// V8-M11: edit-member plans-leg failure must block Save (submit disabled +
// error + retry) so the plan can't be silently unassigned via plan_id: null.
test('V8-M11 edit-member: plans failure blocks Save; retry unblocks it', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7')) return okData({ ...MEMBER_7 });
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Plans unavailable');
      return okData({ plans: [PLAN_MONTHLY] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(editMember, { memberId: '7' });
    assert.match(el.innerHTML, /Could not load the membership plans/);
    assert.match(el.innerHTML, /Plans unavailable/);
    const submit = el.querySelector('#em-submit');
    assert.ok(submit.disabled, 'Save is disabled while plans failed to load');
    assert.equal(calls.filter((c) => (c.options?.method || 'GET') === 'PATCH').length, 0, 'no save attempted');
    mode = 'ok';
    el.querySelector('#em-plans-retry').click();
    await tick();
    assert.doesNotMatch(el.innerHTML, /Could not load the membership plans/);
    assert.equal(el.querySelector('#em-submit').disabled, false, 'Save re-enabled after plans load');
    assert.match(el.innerHTML, /Monthly/);
  } finally { restore(); }
});

// V8-L19: edit-member 500 is an error + retry; only a 404 is "not found".
test('V8-L19 edit-member: 500 shows error + retry, 404 shows "not found" without retry', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members/7')) {
      if (mode === 'fail500') return errData(500, 'Member load failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ ...MEMBER_7 });
    }
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [PLAN_MONTHLY] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(editMember, { memberId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Member load failed/);
    assert.doesNotMatch(el.innerHTML, /Member not found/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);

    mode = 'fail404';
    const el2 = await mount(editMember, { memberId: '7' });
    assert.match(el2.innerHTML, /Member not found/);
    assert.equal(el2.querySelector('#retry-btn'), null, 'no retry on a genuine 404');
  } finally { restore(); }
});

// V8-M12: rrr-integrations total load failure must show error + retry, not
// "Step 1 of 3 / 0 verified records / provisioning form" as if not set up.
test('V8-M12 rrr-integrations: load failure shows error, not "not set up"; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/integrations')) {
      if (mode === 'fail') return errData(500, 'Integrations unavailable');
      return okData({ integrations: [], devices: [] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrIntegrations);
    assert.match(el.innerHTML, /Could not load your terminal connection/);
    assert.match(el.innerHTML, /Integrations unavailable/);
    assert.doesNotMatch(el.innerHTML, /Step 1 of 3/);
    assert.doesNotMatch(el.innerHTML, /Terminal serial number/);
    mode = 'ok';
    el.querySelector('#rrr-retry').click();
    await tick();
    // Genuinely empty (successful load, nothing configured) may show Step 1.
    assert.match(el.innerHTML, /Step 1 of 3/);
    assert.match(el.innerHTML, /Terminal serial number/);
  } finally { restore(); }
});

// V8-M13: whatsapp status failure must show error + retry, never the
// "Disconnected" badge as fact; a logs failure shows its own error + retry.
test('V8-M13 whatsapp: status failure shows error, not "Disconnected"; logs failure shows its error', async () => {
  let statusMode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/status')) {
      if (statusMode === 'fail') return errData(500, 'WhatsApp status unavailable');
      return okData({ state: 'CONNECTED', checklist: { messaging_ready: true, reminders_ready: true }, business_phone_number: '919876543210', messages_sent_today: 3 });
    }
    if (url.includes('/api/mobile/v1/whatsapp/logs')) return errData(500, 'Logs unavailable');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsapp);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /WhatsApp status unavailable/);
    assert.doesNotMatch(el.innerHTML, /Disconnected/);
    assert.doesNotMatch(el.innerHTML, /Connect WhatsApp/);
    statusMode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Connected/);
    assert.match(el.innerHTML, /Could not load recent messages/);
    assert.match(el.innerHTML, /Logs unavailable/);
    assert.ok(el.querySelector('#wa-logs-retry'), 'logs retry exists');
  } finally { restore(); }
});

// V8-L20: member-detail — (a) no cached member + refresh failure: error +
// retry, and retry recovers; (b) cached member + refresh failure: stale
// banner, no silent stale data; (c) 404 is "Member not found", no retry.
test('V8-L20 member-detail: refresh failure shows retry; cached member shows stale banner; 404 is not-found', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members/7')) {
      if (mode === 'fail500') return errData(500, 'Member refresh failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ ...MEMBER_7 });
    }
    return errData(404, 'not found');
  });
  try {
    // (a) fresh load fails, retry recovers.
    const el = await mount(memberDetail, { memberId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Member refresh failed/);
    assert.ok(el.querySelector('#retry-btn'), 'retry button is bound');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);

    // (b) cached member + failed refresh keeps data but flags it stale.
    mode = 'fail500';
    const el2 = await mount(memberDetail, { member: JSON.stringify(MEMBER_7) });
    assert.match(el2.innerHTML, /Asha/);
    assert.ok(el2.querySelector('#md-stale-banner'), 'stale banner shown');
    assert.match(el2.innerHTML, /Showing saved details/);
    assert.match(el2.innerHTML, /Member refresh failed/);
    assert.ok(el2.querySelector('#md-refresh-retry'), 'banner retry exists');
    mode = 'ok';
    el2.querySelector('#md-refresh-retry').click();
    await tick();
    assert.equal(el2.querySelector('#md-stale-banner'), null, 'banner clears after a good refresh');

    // (c) genuine 404.
    mode = 'fail404';
    const el3 = await mount(memberDetail, { memberId: '7' });
    assert.match(el3.innerHTML, /Member not found/);
    assert.equal(el3.querySelector('#retry-btn'), null, 'no retry on a genuine 404');
  } finally { restore(); }
});

// V8-L21: notifications per-tap mark-read must await the POST — a failed
// POST keeps the highlight and surfaces an error; success clears it.
test('V8-L21 notifications: failed mark-read keeps highlight + toasts; success clears it', async () => {
  let readMode = 'fail';
  const { restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/notifications/5/read')) {
      if (readMode === 'fail') return errData(500, 'Mark-read failed');
      return okData({});
    }
    if (url.includes('/api/mobile/v1/notifications')) {
      return okData({ notifications: [{ id: 5, title: 'Payment due', body: 'Asha owes ₹1500', read: false, created_at: '2026-11-07T08:00:00Z' }], pagination: { total: 1, page: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(notifications);
    const row = el.querySelector('[data-idx="0"]');
    assert.ok(row, 'notification row rendered');
    row.click();
    await tick();
    assert.match(document.body.innerHTML, /Mark-read failed/);
    assert.equal(row.style.background, undefined, 'highlight NOT cleared on failure');
    readMode = 'ok';
    row.click();
    await tick();
    assert.equal(row.style.background, '', 'highlight cleared after the server confirms');
  } finally { restore(); }
});

// V8-L22: rrr-list PATCH failure must surface an error toast.
test('V8-L22 rrr-list: failed status PATCH toasts an error', async () => {
  const { restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/rrr/opportunities?pillar=revenue')) {
      return okData({ opportunities: [{ id: 9, member: { name: 'Ravi' }, reason: 'Membership ends soon', priority: 'high', status: 'open', potential_revenue: 1500 }] });
    }
    if (url.includes('/api/mobile/v1/rrr/opportunities/9')) return errData(500, 'Status update failed');
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrList, { pillar: 'revenue' });
    assert.match(el.innerHTML, /Ravi/);
    el.querySelector('[data-status="actioned"]').click();
    await tick();
    assert.match(document.body.innerHTML, /Status update failed/);
  } finally { restore(); }
});

// V8-L23: campaign-create Send confirm must show the Preview & Count
// recipient number; a changed segment falls back to the generic text.
test('V8-L23 campaign-create: Send confirm shows the previewed recipient count', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns/templates')) return okData({ templates: [] });
    if (url.includes('/api/mobile/v1/campaigns/segments/preview')) return okData({ total: 42 });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignCreate);
    el.querySelector('#cc-segment').value = 'expiring';
    el.querySelector('#cc-preview-btn').click();
    await tick();
    assert.match(el.innerHTML, /42 recipients will receive this message/);
    el.querySelector('#cc-form').dispatchEvent({ type: 'submit' });
    await tick(10);
    assert.match(document.body.innerHTML, /42 recipients/);
    document.body.querySelector('#confirm-no').click();
    await tick(10);
    // Segment changed after the preview → the count is stale, generic text.
    el.querySelector('#cc-segment').value = 'all';
    el.querySelector('#cc-form').dispatchEvent({ type: 'submit' });
    await tick(10);
    assert.match(document.body.innerHTML, /all recipients/);
    assert.doesNotMatch(document.body.innerHTML, /42 recipients/);
    document.body.querySelector('#confirm-no').click();
  } finally { restore(); }
});

// V8-L24: renew-member — member-fetch failure is an error + retry (not "No
// member selected"); settings failure is an error + retry (not "No plans"
// and no IST fallback); a genuinely empty plans list still shows "No plans".
test('V8-L24 renew-member: fetch failures show error + retry, not empty states', async () => {
  let mode = 'memberFail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members/7')) {
      if (mode === 'memberFail') return errData(500, 'Member load failed');
      return okData({ ...MEMBER_7 });
    }
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'settingsFail') return errData(500, 'Settings unavailable');
      if (mode === 'emptyPlans') return okData({ plans: [], gym: { timezone: 'Asia/Kolkata' } });
      return okData({ plans: [PLAN_MONTHLY], gym: { timezone: 'Asia/Kolkata' } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(renewMember, { memberId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Member load failed/);
    assert.doesNotMatch(el.innerHTML, /No member selected/);

    mode = 'settingsFail';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Settings unavailable/);
    assert.doesNotMatch(el.innerHTML, /No membership plans yet/);

    mode = 'emptyPlans';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /No membership plans yet/);

    mode = 'ok';
    const el2 = await mount(renewMember, { memberId: '7' });
    assert.match(el2.innerHTML, /Renew Membership/);
    assert.match(el2.innerHTML, /Monthly/);
  } finally { restore(); }
});

// V8-L25: the four no-retry error states all get retry + error detail.
test('V8-L25 subscription: load failure shows error + detail + retry', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/subscription/status')) {
      if (mode === 'fail') return errData(500, 'Subscription unavailable');
      return okData({ plan_name: 'Pro', subscription_status: 'active', max_members: 500 });
    }
    if (url.includes('/api/mobile/v1/members')) return okData({ pagination: { total: 3 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(subscription);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Subscription unavailable/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Pro/);
  } finally { restore(); }
});

test('V8-L25 date-repair: scan failure shows retry; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/date-repair/scan')) {
      if (mode === 'fail') return errData(500, 'Scan failed');
      return okData({ flagged: [] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(dateRepair);
    assert.match(el.innerHTML, /Could not run the scan/);
    assert.match(el.innerHTML, /Scan failed/);
    assert.ok(el.querySelector('#dr-retry'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#dr-retry').click();
    await tick();
    assert.match(el.innerHTML, /All dates look correct/);
  } finally { restore(); }
});

test('V8-L25 rrr-delete-members: load failure shows error + detail + retry', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members')) {
      if (mode === 'fail') return errData(500, 'Members unavailable');
      return okData({ members: [{ id: 1, full_name: 'Asha', status: 'active', device_enroll_number: '101' }], pagination: { total: 1, total_pages: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrDeleteMembers);
    assert.match(el.innerHTML, /Could not load members/);
    assert.match(el.innerHTML, /Members unavailable/);
    assert.ok(el.querySelector('#rrr-retry'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#rrr-retry').click();
    await tick();
    assert.match(el.innerHTML, /Deactivate Members/);
  } finally { restore(); }
});

test('V8-L25 member-attendance: load failure shows retry; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/member/7/attendance')) {
      if (mode === 'fail') return errData(500, 'Attendance unavailable');
      return okData({ member: { name: 'Asha', enroll_number: '101' }, events: [], stats: { total_punches: 0, last_30_days: 0 }, pagination: { total_pages: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberAttendance, { id: '7' });
    assert.match(el.innerHTML, /Could not load records/);
    assert.match(el.innerHTML, /Attendance unavailable/);
    assert.ok(el.querySelector('#rrr-retry'), 'retry button exists');
    mode = 'ok';
    el.querySelector('#rrr-retry').click();
    await tick();
    assert.match(el.innerHTML, /No punches yet/);
  } finally { restore(); }
});

// V8-L26: access first-load total failure shows error + retry, never
// 0 entries/exits + "Biometric Device Offline" as fact.
test('V8-L26 access: total first-load failure shows error + retry, not zeros', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (mode === 'fail') return errData(500, 'Access service unavailable');
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ device_online: true, entries_today: 3, exits_today: 1, inside_now: 0, denied_today: 0 });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ events: [{ id: 1, event_type: 'ENTRY', member_id: 7, member_name: 'Asha', event_timestamp: '2026-11-07T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Access service unavailable/);
    assert.doesNotMatch(el.innerHTML, /Biometric Device Offline/);
    assert.doesNotMatch(el.innerHTML, /No events/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.match(el.innerHTML, /Biometric Device Online/);
  } finally { restore(); }
});

// A9 (fix-all v8 addition): the Inside Now section is REMOVED from the PWA
// Live Access screen. Even when the summary says members are inside, the
// screen must render no Inside Now section, no Check Out buttons, and must
// never fetch /access/inside — while the feed + summary still render.
test('A9 access: Inside Now section is gone — no inside fetch, feed still renders', async () => {
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/access/summary')) return okData({ device_online: true, entries_today: 3, exits_today: 1, inside_now: 2, denied_today: 0 });
    if (url.includes('/api/mobile/v1/access/events')) return okData({ events: [{ id: 1, event_type: 'ENTRY', member_id: 7, member_name: 'Asha', event_timestamp: '2026-11-07T08:00:00Z' }], pagination: { total: 1, total_pages: 1, page: 1 } });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(access);
    assert.equal(el.querySelector('#ac-inside-list'), null, 'no #ac-inside-list element');
    assert.equal(el.querySelector('#ac-inside-count'), null, 'no #ac-inside-count element');
    assert.equal(el.querySelector('#ac-inside-more'), null, 'no #ac-inside-more button');
    assert.doesNotMatch(el.innerHTML, /Inside now/);
    assert.doesNotMatch(el.innerHTML, /Check Out/);
    assert.equal(calls.filter((c) => c.url.includes('/access/inside')).length, 0, 'no fetch to /access/inside');
    assert.ok(calls.some((c) => c.url.includes('/access/summary')), 'summary still fetched');
    assert.ok(calls.some((c) => c.url.includes('/access/events')), 'feed still fetched');
    assert.match(el.innerHTML, /Asha/);
    assert.match(el.innerHTML, /Biometric Device Online/);
  } finally { restore(); }
});

// V8-L27: dashboard "Updated" clock renders in gym time, and today/settings
// failures surface with retry instead of being silently omitted/defaulted.
test('V8-L27 rrr-dashboard: gym-time clock + aux-leg failures surface with retry', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/rrr/dashboard')) {
      return okData({ integration: null, pillars: { revenue: { count: 0, potential_revenue: 0, items: [] }, retain: { count: 0, potential_revenue: 0, items: [] }, recover: { count: 0, potential_revenue: 0, items: [] } }, members: { total: 5, active: 4, attendance_rate: 80 }, unmapped_count: 0, total_potential_revenue: 0, owner_confirmed_revenue: 0, plans_count: 1, whatsapp_connected: false, payment_setup_done: false });
    }
    if (url.includes('/api/mobile/v1/owner/today')) {
      if (mode === 'fail') return errData(500, 'Today queue unavailable');
      return okData({ actions: [] });
    }
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Settings unavailable');
      return okData({ gym: { show_biometric_link_banner: false } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(rrrDashboard);
    assert.match(el.innerHTML, /Updated .*\(gym time\)/);
    assert.match(el.innerHTML, /Could not load/);
    assert.match(el.innerHTML, /today&#39;s queue/); // escapeHtml escapes the apostrophe
    assert.match(el.innerHTML, /Settings unavailable/);
    assert.ok(el.querySelector('#rrr-aux-retry'), 'aux retry exists');
    mode = 'ok';
    el.querySelector('#rrr-aux-retry').click();
    await tick();
    assert.match(el.innerHTML, /Run the gym/);
    assert.doesNotMatch(el.innerHTML, /Could not load/);
  } finally { restore(); }
});

// V8-L30: member-history renewals/payments legs fail with error + retry,
// matching the member leg — not a muted note.
test('V8-L30 member-history: sub-leg failures show error + retry; retry recovers', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/members/7')) return okData({ ...MEMBER_7 });
    if (url.includes('/api/mobile/v1/renewals')) {
      if (mode === 'fail') return errData(500, 'Renewals unavailable');
      return okData({ renewals: [{ id: 1, plan_name: 'Monthly', new_start: '2026-10-01', new_end: '2026-10-30', amount: 1500, channel: 'cash', created_at: '2026-10-01T00:00:00Z' }], pagination: { total: 1 } });
    }
    if (url.includes('/api/mobile/v1/payments')) {
      if (mode === 'fail') return errData(500, 'Payments unavailable');
      return okData({ payments: [{ id: 2, plan_name: 'Monthly', amount: 1500, status: 'paid', method: 'UPI', paid_on: '2026-10-01', renewal_days: 30 }], pagination: { total: 1 } });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(memberHistory, { memberId: '7' });
    assert.match(el.innerHTML, /Could not load renewals/);
    assert.match(el.innerHTML, /Renewals unavailable/);
    assert.match(el.innerHTML, /Could not load payments/);
    assert.match(el.innerHTML, /Payments unavailable/);
    assert.ok(el.querySelector('#retry-renewals'), 'renewals retry exists');
    assert.ok(el.querySelector('#retry-payments'), 'payments retry exists');
    mode = 'ok';
    el.querySelector('#retry-renewals').click();
    await tick();
    assert.doesNotMatch(el.innerHTML, /Could not load renewals/);
    assert.doesNotMatch(el.innerHTML, /Could not load payments/);
    assert.match(el.innerHTML, /Membership Renewals \(1\)/);
    assert.match(el.innerHTML, /Payments \(1\)/);
  } finally { restore(); }
});

// V8-L29: uploadFormData carries one Idempotency-Key, re-sent unchanged on
// the 401-refresh retry (client side of the invariant).
test('V8-L29 uploadFormData: one Idempotency-Key, same key on 401-refresh retry', async () => {
  setCachedSession({ accessToken: 'tok1', refreshToken: 'rt1', tenantId: '1', tenantName: 'Gym', userId: '1', userName: 'Owner', userRole: 'gym_owner', gymTimezone: 'Asia/Kolkata', gymCurrency: 'INR', gymCountry: 'IN' });
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/api/mobile/v1/auth/refresh')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { access_token: 'tok2', refresh_token: 'rt2' } }) };
    }
    if (url.includes('/api/mobile/v1/settings/payment/qr')) {
      const auth = options?.headers?.Authorization;
      if (auth === 'Bearer tok1') return { ok: false, status: 401, json: async () => ({ success: false, error: { message: 'expired' } }) };
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
    }
    return errData(404, 'not found');
  });
  try {
    const form = new FormData();
    form.append('qr_image', 'fake-bytes');
    const res = await uploadFormData('/api/mobile/v1/settings/payment/qr', form);
    assert.equal(res.ok, true, 'upload succeeds after refresh');
    const uploads = calls.filter((c) => c.url.includes('/settings/payment/qr'));
    assert.equal(uploads.length, 2, 'initial attempt + one refresh retry');
    const key1 = uploads[0].options.headers['Idempotency-Key'];
    const key2 = uploads[1].options.headers['Idempotency-Key'];
    assert.ok(key1, 'first attempt carries an Idempotency-Key');
    assert.equal(key2, key1, 'retry re-sends the SAME key');
    assert.match(key1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  } finally {
    restore();
    setCachedSession(undefined);
  }
});
