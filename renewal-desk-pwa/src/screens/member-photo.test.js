/* Member profile photo tests (owner-set, spec §5.2, 2026-11-09).
 *
 * Same tiny tree-based DOM shim as v9/v10-error-states.test.js (no jsdom —
 * node --test only), plus a FormData shim.
 *
 * Screens mount against a tiny tree-based DOM shim: innerHTML parses into
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
const memberDetail = (await import('./member-detail.js')).default;
const { renderAvatar } = await import('../components.js');

async function mount(screen, params) {
  const el = new El('div');
  await screen.mount(el, params);
  return el;
}

// ─── FormData shim ──────────────────────────────────────────────────────
class ShimFormData {
  constructor() { this._map = new Map(); }
  append(k, v) { this._map.set(k, v); }
  get(k) { return this._map.has(k) ? this._map.get(k) : null; }
}
globalThis.FormData = ShimFormData;

// ─── Fixtures ───────────────────────────────────────────────────────────

const MEMBER_7 = {
  id: 7, full_name: 'Asha', phone: '98765', email: 'a@x.com', address: 'Hyderabad',
  gender: 'Female', status: 'active', plan: { id: 1, name: 'Monthly', duration_days: 30, price: 1500 },
  membership_start: '2026-10-01', membership_end: '2026-12-31', days_until_expiry: 54,
  joined_on: '2026-01-01', notes: '', is_inside: false, whatsapp_opted_in: true,
  has_biometric: true, device_enroll_number: '101', door_blocked: false,
};
const PHOTO_URL = 'https://cdn.example/photos/7.jpg';
const PHOTO_URL_NEW = 'https://cdn.example/photos/7-new.jpg';

// Member-detail fetch handler: GET /members/7 returns the current member
// (via a getter, so tests can flip profile_photo_url between refreshes).
function memberHandler(getMember, extra) {
  return async (url, options) => {
    if (extra) {
      const res = await extra(url, options);
      if (res) return res;
    }
    if (url.includes('/api/mobile/v1/members/7')) return okData({ ...getMember() });
    return errData(404, 'not found');
  };
}

// ─── renderAvatar photoUrl ──────────────────────────────────────────────

test('member-photo renderAvatar: photoUrl renders a 104px cover <img>; without it renders initials', () => {
  const img = renderAvatar('Asha', 'xl', PHOTO_URL);
  assert.match(img, /<img /);
  assert.match(img, new RegExp(PHOTO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(img, /width:104px;height:104px/);
  assert.match(img, /object-fit:cover/);
  const initials = renderAvatar('Asha', 'xl');
  assert.doesNotMatch(initials, /<img /);
  assert.match(initials, /avatar avatar-xl/);
  assert.match(initials, />AS</, 'initials render inside the avatar circle');
  // Payment rows keep initials: no photoUrl passed anywhere else.
  const row = renderAvatar('Ravi Kumar');
  assert.doesNotMatch(row, /<img /);
  assert.match(row, />RK</);
});

// ─── member-detail display ──────────────────────────────────────────────

test('member-photo detail: member with profile_photo_url renders <img>; without renders initials', async () => {
  const { restore } = installFetch(memberHandler(() => ({ ...MEMBER_7, profile_photo_url: PHOTO_URL })));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const img = el.querySelector('#md-photo-wrap').querySelector('img');
    assert.ok(img, 'photo <img> renders in the profile card');
    assert.equal(img.attrs.src, PHOTO_URL);
    assert.match(img.attrs.style, /object-fit:cover/);
    assert.ok(el.querySelector('#md-photo-remove'), 'Remove photo button renders when a photo exists');
    assert.ok(el.querySelector('#md-photo-input'), 'hidden file input renders');
    assert.equal(el.querySelector('#md-photo-input').attrs.accept, 'image/jpeg,image/png,image/webp');
  } finally { restore(); }

  const { restore: restore2 } = installFetch(memberHandler(() => ({ ...MEMBER_7 })));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    assert.equal(el.querySelector('#md-photo-wrap').querySelector('img'), null, 'no <img> without a photo URL');
    assert.match(el.querySelector('#md-photo-wrap').innerHTML, /avatar avatar-xl/, 'initials avatar renders');
    assert.equal(el.querySelector('#md-photo-remove'), null, 'no Remove button without a photo');
    assert.match(el.innerHTML, /Tap photo to add/, 'add-photo hint renders');
  } finally { restore2(); }
});

test('member-photo detail: a broken/expired photo URL falls back to initials on error', async () => {
  const { restore } = installFetch(memberHandler(() => ({ ...MEMBER_7, profile_photo_url: PHOTO_URL })));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const wrap = el.querySelector('#md-photo-wrap');
    assert.ok(wrap.querySelector('img'), 'photo renders first');
    wrap.querySelector('img').dispatchEvent({ type: 'error' });
    assert.equal(wrap.querySelector('img'), null, 'broken <img> is swapped out');
    assert.match(wrap.innerHTML, /avatar avatar-xl/, 'initials avatar takes its place');
    assert.match(wrap.innerHTML, />AS</);
  } finally { restore(); }
});

// ─── member-detail upload ───────────────────────────────────────────────

test('member-photo detail: picking a valid file POSTs FormData to the photo endpoint and re-fetches the member', async () => {
  let member = { ...MEMBER_7 };
  const { calls, restore } = installFetch(memberHandler(() => member, async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7/photo') && (options?.method || 'GET') === 'POST') {
      member = { ...member, profile_photo_url: PHOTO_URL_NEW };
      return okData({ profile_photo_url: PHOTO_URL_NEW });
    }
    return null;
  }));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const input = el.querySelector('#md-photo-input');
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 120000 };
    input.files = [file];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    const posts = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7/photo') && (c.options?.method || 'GET') === 'POST');
    assert.equal(posts.length, 1, 'one photo upload POST');
    assert.ok(posts[0].options.body instanceof ShimFormData, 'upload body is FormData');
    assert.equal(posts[0].options.body.get('photo'), file, 'FormData carries the picked file as "photo"');
    assert.ok(posts[0].options.headers['Idempotency-Key'], 'upload carries an idempotency key');
    const gets = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7') && !c.url.includes('/photo'));
    assert.ok(gets.length >= 2, 'member re-fetched after a successful upload so the URL refreshes');
    assert.match(el.innerHTML, /7-new\.jpg/, 're-render shows the new photo URL');
    assert.match(document.body.innerHTML, /Profile photo updated/);
  } finally { restore(); }
});

test('member-photo detail: invalid file (wrong MIME / over 3 MB) toasts and posts nothing', async () => {
  const { calls, restore } = installFetch(memberHandler(() => ({ ...MEMBER_7 })));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const input = el.querySelector('#md-photo-input');
    // Wrong MIME.
    input.files = [{ name: 'photo.gif', type: 'image/gif', size: 1000 }];
    input.dispatchEvent({ type: 'change' });
    await tick();
    assert.match(document.body.innerHTML, /Choose a JPEG, PNG, or WebP photo up to 3 MB/);
    // Oversize.
    input.files = [{ name: 'photo.jpg', type: 'image/jpeg', size: 3 * 1024 * 1024 + 1 }];
    input.dispatchEvent({ type: 'change' });
    await tick();
    assert.match(document.body.innerHTML, /Choose a JPEG, PNG, or WebP photo up to 3 MB/);
    assert.equal(calls.filter((c) => c.url.includes('/members/7/photo')).length, 0, 'no upload POST for invalid files');
  } finally { restore(); }
});

test('member-photo detail: failed upload toasts and does not re-fetch', async () => {
  const { calls, restore } = installFetch(memberHandler(() => ({ ...MEMBER_7 }), async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7/photo')) return errData(400, 'choose a JPEG, PNG, or WebP image under 3 MB');
    return null;
  }));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    const getsBefore = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7') && !c.url.includes('/photo')).length;
    const input = el.querySelector('#md-photo-input');
    input.files = [{ name: 'photo.jpg', type: 'image/jpeg', size: 1000 }];
    input.dispatchEvent({ type: 'change' });
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/members/7/photo')).length, 1, 'upload attempted once');
    assert.match(document.body.innerHTML, /choose a JPEG, PNG, or WebP image under 3 MB/);
    const getsAfter = calls.filter((c) => c.url.includes('/api/mobile/v1/members/7') && !c.url.includes('/photo')).length;
    assert.equal(getsAfter, getsBefore, 'no re-fetch after a failed upload');
  } finally { restore(); }
});

// ─── member-detail remove ───────────────────────────────────────────────

test('member-photo detail: Remove photo confirms first, then DELETEs and re-fetches', async () => {
  let member = { ...MEMBER_7, profile_photo_url: PHOTO_URL };
  const { calls, restore } = installFetch(memberHandler(() => member, async (url, options) => {
    if (url.includes('/api/mobile/v1/members/7/photo') && options?.method === 'DELETE') {
      member = { ...MEMBER_7 };
      return okData({ profile_photo_url: null });
    }
    return null;
  }));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    el.querySelector('#md-photo-remove').click();
    await tick();
    // Confirm dialog is open, no DELETE yet.
    assert.equal(calls.filter((c) => c.url.includes('/members/7/photo') && c.options?.method === 'DELETE').length, 0, 'no DELETE before confirm');
    assert.match(document.body.innerHTML, /Remove profile photo\?/);
    document.body.querySelector('#confirm-yes').click();
    await tick(); await tick();
    const deletes = calls.filter((c) => c.url.includes('/members/7/photo') && c.options?.method === 'DELETE');
    assert.equal(deletes.length, 1, 'one DELETE after confirm');
    assert.match(document.body.innerHTML, /Profile photo removed/);
    assert.equal(el.querySelector('#md-photo-wrap').querySelector('img'), null, 'photo gone after re-fetch');
    assert.equal(el.querySelector('#md-photo-remove'), null, 'Remove button gone after re-fetch');
  } finally { restore(); }
});

test('member-photo detail: cancelling the remove confirm sends no DELETE', async () => {
  const { calls, restore } = installFetch(memberHandler(() => ({ ...MEMBER_7, profile_photo_url: PHOTO_URL })));
  try {
    const el = await mount(memberDetail, { memberId: '7' });
    el.querySelector('#md-photo-remove').click();
    await tick();
    document.body.querySelector('#confirm-no').click();
    await tick(); await tick();
    assert.equal(calls.filter((c) => c.url.includes('/members/7/photo')).length, 0, 'no DELETE on cancel');
    assert.ok(el.querySelector('#md-photo-wrap').querySelector('img'), 'photo still renders after cancel');
  } finally { restore(); }
});
