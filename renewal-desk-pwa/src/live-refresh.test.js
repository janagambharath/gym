import test from 'node:test';
import assert from 'node:assert/strict';
import { activateScreen, attachLiveRefresh, disposeScreen } from './live-refresh.js';
import { router } from './router.js';

class Element {
  dataset = {}; style = {}; scrollTop = 0; children = []; isConnected = false;
  classList = { add() {}, remove() {} };
  appendChild(child) { this.children.push(child); child.isConnected = true; }
  remove() { this.isConnected = false; }
  querySelectorAll() { return []; }
}

function setup(t) {
  const document = new EventTarget();
  const window = new EventTarget();
  document.visibilityState = 'visible';
  document.activeElement = null;
  document.querySelector = () => null;
  document.createElement = () => new Element();
  document.body = { contains: el => el.isConnected };
  window.scrollY = 0;
  window.scrollTo = () => {};
  const timers = new Map();
  let clock = 10000, id = 0;
  const original = new Map();
  for (const [key, value] of Object.entries({ document, window, navigator: { onLine: true },
    setInterval: fn => { timers.set(++id, fn); return id; },
    clearInterval: key => timers.delete(key),
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const now = Date.now;
  Date.now = () => clock;
  t.after(() => {
    router.clear();
    Date.now = now;
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { document, window, timers, advance: () => { clock += 15000; },
    tick: async () => { clock += 15000; await Promise.all([...timers.values()].map(fn => fn())); } };
}

test('refresh pauses while hidden or offline and resumes on foreground/reconnect', async t => {
  const env = setup(t), el = new Element();
  el.isConnected = true;
  let calls = 0;
  attachLiveRefresh(el, async () => { calls += 1; });
  await env.tick();
  assert.equal(calls, 1);
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await env.tick();
  assert.equal(calls, 1);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(calls, 2);
  navigator.onLine = false;
  env.window.dispatchEvent(new Event('offline'));
  await env.tick();
  assert.equal(calls, 2);
  navigator.onLine = true;
  env.window.dispatchEvent(new Event('online'));
  await Promise.resolve();
  assert.equal(calls, 3);
  disposeScreen(el);
  assert.equal(env.timers.size, 0);
});

test('editing and in-flight requests do not cause overlapping refreshes', async t => {
  const env = setup(t), el = new Element();
  el.isConnected = true;
  let calls = 0, finish;
  attachLiveRefresh(el, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  env.document.activeElement = { matches: () => true };
  await env.tick();
  assert.equal(calls, 0);
  env.document.activeElement = null;
  const pending = env.tick();
  await env.tick();
  assert.equal(calls, 1);
  finish();
  await pending;
  activateScreen(el, false);
  await env.tick();
  assert.equal(calls, 1);
  disposeScreen(el);
});

test('tab restore and back navigation restart refresh without remounting screens', async t => {
  const env = setup(t);
  router.init(new Element());
  let mounts = 0, refreshes = 0, cleanups = 0;
  router.register('live-test', async () => ({ default: { mount(el) {
    mounts++;
    attachLiveRefresh(el, async () => { refreshes++; }, 15000, () => { cleanups++; });
  } } }));
  router.register('plain-test', async () => ({ default: { mount() {} } }));
  await router.switchTab('one', 'live-test');
  await env.tick();
  await router.switchTab('two', 'plain-test');
  await env.tick();
  assert.equal(refreshes, 1);
  assert.equal(cleanups, 0);
  await router.switchTab('one', 'live-test');
  assert.equal(mounts, 1);
  assert.equal(refreshes, 2);
  await router.push('plain-test', {}, { animate: false });
  await env.tick();
  assert.equal(refreshes, 2);
  router._popStack();
  assert.equal(refreshes, 3);
  await router.switchTab('two', 'plain-test');
  router.clear();
  assert.equal(cleanups, 1);
  assert.equal(env.timers.size, 0);
});

test('late completion of a disposed screen cannot register a new timer', t => {
  const env = setup(t), el = new Element();
  disposeScreen(el);
  let cleanups = 0;
  attachLiveRefresh(el, () => {}, 15000, () => { cleanups++; });
  assert.equal(env.timers.size, 0);
  assert.equal(cleanups, 1);
});
