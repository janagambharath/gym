/* V7 error-state tests (V7-M12, V7-L11, V7-L12 + login id rename).
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
globalThis.window = { scrollY: 0, scrollTo: () => {}, location: { href: '' }, open: () => {}, addEventListener: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
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
const inbox = (await import('./inbox.js')).default;
const campaigns = (await import('./campaigns.js')).default;
const botLeads = (await import('./bot-leads.js')).default;
const botConversations = (await import('./bot-conversations.js')).default;
const botOverview = (await import('./bot-overview.js')).default;
const plans = (await import('./plans.js')).default;
const staff = (await import('./staff.js')).default;
const campaignDetail = (await import('./campaign-detail.js')).default;
const botConversationDetail = (await import('./bot-conversation-detail.js')).default;
const botLeadDetail = (await import('./bot-lead-detail.js')).default;
const paymentDetail = (await import('./payment-detail.js')).default;
const rrrMappings = (await import('./rrr-mappings.js')).default;
const login = (await import('./login.js')).default;

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

// V7-M12: a failed fetch must render the error state with retry — never
// the empty state — and retry must recover once the server responds.
test('V7-M12 inbox: fetch failure shows error + retry, not "Inbox empty"', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/inbox')) {
      if (mode === 'fail') return errData(500, 'Inbox is down');
      return okData({ messages: [{ sender_name: 'Asha', text: 'Hi', created_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(inbox);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Inbox is down/);
    assert.doesNotMatch(el.innerHTML, /Inbox empty/);
    const retry = el.querySelector('#retry-btn');
    assert.ok(retry, 'retry button exists');
    mode = 'ok';
    retry.click();
    await tick();
    assert.match(el.innerHTML, /Asha/);
    assert.equal(calls.filter((c) => c.url.includes('/inbox')).length, 2);
  } finally { restore(); }
});

test('V7-M12 campaigns: fetch failure shows error, not "No campaigns" + New Campaign CTA', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns')) {
      if (mode === 'fail') return errData(500, 'Campaigns unavailable');
      return okData({ campaigns: [{ id: 1, name: 'Diwali Blast', segment: 'all', recipient_count: 10, status: 'sent', created_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaigns);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Campaigns unavailable/);
    assert.doesNotMatch(el.innerHTML, /No campaigns/);
    assert.equal(el.querySelector('#cp-new'), null, 'no New Campaign CTA on failure');
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Diwali Blast/);
    assert.equal(calls.filter((c) => c.url.includes('/campaigns')).length, 2);
  } finally { restore(); }
});

test('V7-M12 bot-leads: fetch failure shows error, not "No leads yet"', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/leads')) {
      if (mode === 'fail') return errData(500, 'Leads unavailable');
      return okData({ leads: [{ id: 2, name: 'Ravi', phone: '98765', status: 'new', created_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botLeads);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.doesNotMatch(el.innerHTML, /No leads yet/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Ravi/);
  } finally { restore(); }
});

test('V7-M12 bot-conversations: fetch failure shows error, not "No conversations"', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/conversations')) {
      if (mode === 'fail') return errData(500, 'Conversations unavailable');
      return okData({ conversations: [{ id: 3, customer_name: 'Kiran', state: 'active', last_message_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botConversations);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.doesNotMatch(el.innerHTML, /No conversations/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Kiran/);
  } finally { restore(); }
});

test('V7-M12 bot-overview: fetch failure shows error, not all-zero metric cards', async () => {
  let mode = 'fail';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/overview')) {
      if (mode === 'fail') return errData(500, 'Overview unavailable');
      return okData({ total_conversations: 5, total_leads: 2, handover_count: 1, resolution_rate: 80 });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botOverview);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Overview unavailable/);
    assert.doesNotMatch(el.innerHTML, /metric-grid/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Conversations/);
    assert.match(el.innerHTML, /metric-grid/);
  } finally { restore(); }
});

test('V7-M12 plans: fetch failure shows error, not "No plans" + Add Plan CTA', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) {
      if (mode === 'fail') return errData(500, 'Settings unavailable');
      return okData({ plans: [{ id: 1, name: 'Monthly', duration_days: 30, price: 1500 }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(plans);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Settings unavailable/);
    assert.doesNotMatch(el.innerHTML, /No plans/);
    assert.equal(el.querySelector('#add-plan'), null, 'no Add Plan CTA on failure');
    mode = 'ok';
    el.querySelector('#plans-retry').click();
    await tick();
    assert.match(el.innerHTML, /Monthly/);
    assert.equal(calls.filter((c) => c.url.includes('/settings')).length, 2);
  } finally { restore(); }
});

test('V7-M12 plans: successful empty load still shows the empty state', async () => {
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/settings')) return okData({ plans: [] });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(plans);
    assert.match(el.innerHTML, /No plans/);
    assert.doesNotMatch(el.innerHTML, /Something went wrong/);
  } finally { restore(); }
});

test('V7-M12 staff: fetch failure shows error, not "No staff members yet"', async () => {
  let mode = 'fail';
  const { calls, restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/staff')) {
      if (mode === 'fail') return errData(500, 'Staff unavailable');
      return okData({ staff: [{ id: 1, full_name: 'Vikram', email: 'v@x.com', role: 'staff', is_active: true }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(staff);
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Staff unavailable/);
    assert.doesNotMatch(el.innerHTML, /No staff members yet/);
    mode = 'ok';
    el.querySelector('#staff-retry').click();
    await tick();
    assert.match(el.innerHTML, /Vikram/);
    assert.equal(calls.filter((c) => c.url.includes('/staff')).length, 2);
  } finally { restore(); }
});

// V7-L11: a 500/timeout is an error with retry; only a 404 is "not found".
test('V7-L11 campaign-detail: 500 shows error + retry, 404 shows "not found" without retry', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/campaigns/9')) {
      if (mode === 'fail500') return errData(500, 'Campaign load failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ name: 'Diwali', status: 'sent', segment: 'all', recipient_count: 5, sent_count: 5, delivered_count: 4, failed_count: 1, created_at: '2026-11-06T10:00:00Z', recipients: [] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(campaignDetail, { campaignId: '9' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.match(el.innerHTML, /Campaign load failed/);
    assert.doesNotMatch(el.innerHTML, /Campaign not found/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Diwali/);

    mode = 'fail404';
    const el2 = await mount(campaignDetail, { campaignId: '9' });
    assert.match(el2.innerHTML, /Campaign not found/);
    assert.equal(el2.querySelector('#retry-btn'), null, 'no retry on a genuine 404');
  } finally { restore(); }
});

test('V7-L11 bot-conversation-detail: 500 shows error + retry, 404 shows "Not found"', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/conversations/3')) {
      if (mode === 'fail500') return errData(500, 'Conversation load failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ messages: [{ sender: 'customer', body: 'Hello there', created_at: '2026-11-06T10:00:00Z' }] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botConversationDetail, { conversationId: '3' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.doesNotMatch(el.innerHTML, /Not found/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Hello there/);

    mode = 'fail404';
    const el2 = await mount(botConversationDetail, { conversationId: '3' });
    assert.match(el2.innerHTML, /Not found/);
    assert.equal(el2.querySelector('#retry-btn'), null);
  } finally { restore(); }
});

test('V7-L11 bot-lead-detail: 500 shows error + retry, 404 shows "Lead not found"', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/bot/leads/5')) {
      if (mode === 'fail500') return errData(500, 'Lead load failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ lead: { id: 5, name: 'Ravi', phone: '98765', status: 'new', created_at: '2026-11-06T10:00:00Z' }, messages: [] });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(botLeadDetail, { leadId: '5' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.doesNotMatch(el.innerHTML, /Lead not found/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Ravi/);

    mode = 'fail404';
    const el2 = await mount(botLeadDetail, { leadId: '5' });
    assert.match(el2.innerHTML, /Lead not found/);
    assert.equal(el2.querySelector('#retry-btn'), null);
  } finally { restore(); }
});

test('V7-L11 payment-detail: 500 shows error + retry, 404 shows "Payment not found"', async () => {
  let mode = 'fail500';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/payments/7')) {
      if (mode === 'fail500') return errData(500, 'Payment load failed');
      if (mode === 'fail404') return errData(404, 'not found');
      return okData({ amount: 1500, status: 'pending', member_name: 'Asha', plan_name: 'Monthly', method: 'UPI', reference: 'REF1', paid_on: '2026-11-06' });
    }
    return errData(404, 'not found');
  });
  try {
    const el = await mount(paymentDetail, { paymentId: '7' });
    assert.match(el.innerHTML, /Something went wrong/);
    assert.doesNotMatch(el.innerHTML, /Payment not found/);
    mode = 'ok';
    el.querySelector('#retry-btn').click();
    await tick();
    assert.match(el.innerHTML, /Asha/);

    mode = 'fail404';
    const el2 = await mount(paymentDetail, { paymentId: '7' });
    assert.match(el2.innerHTML, /Payment not found/);
    assert.equal(el2.querySelector('#retry-btn'), null);
  } finally { restore(); }
});

// V7-L12: "Link all" must confirm the count before executing any link.
async function setupMappingsWithOneSelection(fetchCalls) {
  const { calls, restore } = installFetch(async (url, options) => {
    if (url.includes('/rrr/mappings/unresolved')) {
      return okData({ pagination: { total: 1, total_pages: 1, page: 1 }, groups: [{ biometric_user_id: 4, punch_count: 3, latest_punch_time: '2026-11-06T09:00:00Z' }] });
    }
    if (url.includes('/api/mobile/v1/members')) {
      return okData({ members: [{ id: 7, full_name: 'Test Member', phone: '99999' }], pagination: { total: 1 } });
    }
    if (url.includes('/rrr/mappings/bulk-resolve')) {
      return okData({ linked: 1, results: [{ external_id: '4', ok: true }] });
    }
    return errData(404, 'not found');
  });
  const el = await mount(rrrMappings);
  // Tap the ID card to open the picker, then tap the member to select them.
  el.querySelectorAll('.bm-card')[0].click();
  await tick(10);
  el.querySelectorAll('[data-pick]')[0].click();
  await tick(10);
  assert.equal(el.querySelector('#bm-count').textContent, '1');
  return { el, calls, restore };
}

test('V7-L12 mappings: Link all asks for confirmation and does not link before it', async () => {
  const { el, calls, restore } = await setupMappingsWithOneSelection();
  try {
    const bulkCalls = () => calls.filter((c) => c.url.includes('bulk-resolve'));
    el.querySelector('#bm-link-all').click();
    await tick();
    assert.match(document.body.innerHTML, /Link 1 biometric ID/);
    assert.equal(bulkCalls().length, 0, 'no link executed before confirmation');
    document.body.querySelector('#confirm-yes').click();
    await tick(50);
    assert.equal(bulkCalls().length, 1, 'exactly one bulk-resolve after confirmation');
    const sent = JSON.parse(bulkCalls()[0].options.body);
    assert.deepEqual(sent.mappings, [{ external_id: '4', member_id: 7 }]);
    assert.match(el.innerHTML, /Linked 1 of 1/);
  } finally { restore(); }
});

test('V7-L12 mappings: cancelling Link all links nothing', async () => {
  const { el, calls, restore } = await setupMappingsWithOneSelection();
  try {
    el.querySelector('#bm-link-all').click();
    await tick();
    assert.match(document.body.innerHTML, /Link 1 biometric ID/);
    document.body.querySelector('#confirm-no').click();
    await tick(50);
    assert.equal(calls.filter((c) => c.url.includes('bulk-resolve')).length, 0);
  } finally { restore(); }
});

// Residual: login.js button id was a misnomer (went to /vynla) — renamed.
test('login: member button id is goto-vynla and still opens /vynla', async () => {
  const el = await mount(login);
  assert.doesNotMatch(el.innerHTML, /goto-member-login/);
  const btn = el.querySelector('#goto-vynla');
  assert.ok(btn, 'goto-vynla button exists');
  btn.click();
  assert.equal(globalThis.window.location.href, '/vynla');
});
