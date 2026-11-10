/* WhatsApp embedded-signup PWA tests (W-H8, W-L4).
 *
 * Same tiny tree-based DOM shim as v9-error-states.test.js (no jsdom —
 * node --test only), plus a real visibilitychange dispatcher on document,
 * a controllable window.open, and El.isConnected.
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
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === body; }
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
const _docListeners = {};
globalThis.document = {
  body,
  createElement: (tag) => new El(tag),
  getElementById: (id) => body.querySelector(`#${id}`),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: (type, fn) => { (_docListeners[type] ??= []).push(fn); },
  removeEventListener: (type, fn) => { _docListeners[type] = (_docListeners[type] || []).filter((f) => f !== fn); },
  dispatchEvent: (event) => { for (const fn of _docListeners[event.type] || []) fn(event); return true; },
  visibilityState: 'visible',
  hidden: false,
  activeElement: null,
};
const openCalls = [];
let openResult = {};
globalThis.window = { scrollY: 0, scrollTo: () => {}, location: { href: '', origin: 'https://app.example' }, open: (url, target) => { openCalls.push({ url, target }); return openResult; }, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
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

// WhatsApp embedded-signup PWA tests (W-H8, W-L4).
//
// DOM shim + fetch stub are the v9-error-states.test.js harness, with two
// additions: document keeps real visibilitychange listeners (dispatchable
// from tests) and window.open is controllable (return null = popup blocked).
// Page-template literal coverage lives in the backend suite:
// tests/test_whatsapp_embedded_signup_page.py.
const whatsappSetup = (await import('./whatsapp-setup.js')).default;

async function mount(screen, params) {
  const el = new El('div');
  document.body.appendChild(el);
  await screen.mount(el, params);
  return el;
}

const NOT_CONNECTED = { status: 'NOT_CONNECTED', status_description: 'Connect your WhatsApp Business number to send automated renewal reminders.' };
const CONNECTED = { status: 'CONNECTED', status_description: 'Connected', business_phone_number: '919876543210' };
const ONBOARDING = { signup_handshake: 'hs_1234567890abcdef', config_id: 'cfg123', meta_app_id: '1234567890' };

function resetDom() {
  for (const child of [...document.body.children]) child.remove();
  openCalls.length = 0;
  openResult = {};
  document.hidden = false;
}

// W-L4: a blocked popup must show an error toast (not the success toast
// for a tab that never opened) and re-enable Start Setup; no return
// notice is armed, because no tab was ever opened.
test('W-L4 whatsapp-setup: blocked popup shows an error toast, no success toast, Start Setup re-enabled', async () => {
  resetDom();
  openResult = null;
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) return okData({ ...NOT_CONNECTED });
    if (url.includes('/api/mobile/v1/whatsapp/onboarding-config')) return okData({ ...ONBOARDING });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    assert.ok(el.querySelector('#ws-start'), 'Start Setup renders');
    el.querySelector('#ws-start').click();
    await tick();
    assert.equal(openCalls.length, 1, 'window.open attempted once');
    assert.match(document.body.innerHTML, /blocked the setup tab/);
    assert.match(document.body.innerHTML, /allow popups for this site/);
    assert.doesNotMatch(document.body.innerHTML, /Complete the Meta setup in the new tab/);
    assert.equal(el.querySelector('#ws-start').disabled, false, 'Start Setup re-enabled after blocked popup');
    document.dispatchEvent({ type: 'visibilitychange' });
    await tick(); await tick();
    assert.equal(el.querySelector('#ws-return-notice'), null, 'no return notice when no tab opened');
  } finally { restore(); }
});

// W-L4 (positive): a successful open hands the owner the real signup URL.
test('W-L4 whatsapp-setup: Start Setup opens the signup page in a new tab and toasts success', async () => {
  resetDom();
  openResult = { closed: false };
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) return okData({ ...NOT_CONNECTED });
    if (url.includes('/api/mobile/v1/whatsapp/onboarding-config')) return okData({ ...ONBOARDING });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    el.querySelector('#ws-start').click();
    await tick();
    assert.equal(openCalls.length, 1, 'one tab opened');
    assert.match(openCalls[0].url, /\/api\/mobile\/v1\/whatsapp\/embedded-signup-page\?handshake=/);
    assert.match(openCalls[0].url, /config_id=cfg123/);
    assert.match(openCalls[0].url, /meta_app_id=1234567890/);
    assert.equal(openCalls[0].target, '_blank');
    assert.match(document.body.innerHTML, /Complete the Meta setup in the new tab/);
  } finally { restore(); }
});

// W-H8: returning from the tab still-not-connected must explain the
// failure with retry guidance — not silently re-render "Connect WhatsApp".
test('W-H8 whatsapp-setup: returning from the tab still-not-connected explains the failure with retry guidance', async () => {
  resetDom();
  openResult = { closed: false };
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) return okData({ ...NOT_CONNECTED });
    if (url.includes('/api/mobile/v1/whatsapp/onboarding-config')) return okData({ ...ONBOARDING });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    assert.equal(el.querySelector('#ws-return-notice'), null, 'no notice before setup');
    el.querySelector('#ws-start').click();
    await tick();
    // Simulate returning to the PWA tab after the Meta tab.
    document.dispatchEvent({ type: 'visibilitychange' });
    await tick(); await tick();
    const notice = el.querySelector('#ws-return-notice');
    assert.ok(notice, 'return notice appears when still not connected');
    assert.match(notice.innerHTML, /still isn't connected/);
    assert.match(notice.innerHTML, /Tap Start Setup to try again/);
    assert.ok(el.querySelector('#ws-start'), 'Start Setup still present for retry');
    assert.match(el.innerHTML, /Connect WhatsApp/);
    // A second return without a new setup keeps exactly one notice.
    document.dispatchEvent({ type: 'visibilitychange' });
    await tick(); await tick();
    assert.equal(el.querySelectorAll('#ws-return-notice').length, 1, 'notice persists, never duplicates');
    // A manual re-check keeps the explanation too.
    el.querySelector('#ws-check').click();
    await tick(); await tick();
    assert.equal(el.querySelectorAll('#ws-return-notice').length, 1, 'notice survives a manual re-check');
  } finally { restore(); }
});

// W-H8 (positive): returning connected shows the connected state, no notice.
test('W-H8 whatsapp-setup: returning from the tab connected shows no failure notice', async () => {
  resetDom();
  openResult = { closed: false };
  let statusMode = 'not-connected';
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) {
      return okData(statusMode === 'connected' ? { ...CONNECTED } : { ...NOT_CONNECTED });
    }
    if (url.includes('/api/mobile/v1/whatsapp/onboarding-config')) return okData({ ...ONBOARDING });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    el.querySelector('#ws-start').click();
    await tick();
    statusMode = 'connected';
    document.dispatchEvent({ type: 'visibilitychange' });
    await tick(); await tick();
    assert.match(el.innerHTML, /WhatsApp Connected/);
    assert.equal(el.querySelector('#ws-return-notice'), null, 'no failure notice when connected');
    assert.equal(el.querySelector('#ws-start'), null, 'no Start Setup once connected');
  } finally { restore(); }
});

// W-H8 (negative): switching tabs without ever opening a setup must not
// invent a failure notice.
test('W-H8 whatsapp-setup: visibilitychange with no setup opened shows no notice', async () => {
  resetDom();
  const { restore } = installFetch(async (url) => {
    if (url.includes('/api/mobile/v1/whatsapp/connection-status')) return okData({ ...NOT_CONNECTED });
    return errData(404, 'not found');
  });
  try {
    const el = await mount(whatsappSetup);
    document.dispatchEvent({ type: 'visibilitychange' });
    await tick(); await tick();
    assert.equal(el.querySelector('#ws-return-notice'), null, 'no notice without a setup attempt');
    assert.ok(el.querySelector('#ws-start'), 'plain Connect WhatsApp state, no explanation added');
  } finally { restore(); }
});
