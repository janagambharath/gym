/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Client-side SPA Router
   Hash-based routing for iOS Safari PWA compatibility
   ═══════════════════════════════════════════════════════════════════════ */

import { activateScreen, disposeScreen } from './live-refresh.js';

/** @typedef {{ mount: (container: HTMLElement, params?: Record<string,string>) => void|Promise<void>, unmount?: () => void, pause?: () => void, resume?: (container: HTMLElement) => void }} Screen */

class Router {
  constructor() {
    /** @type {Map<string, () => Promise<{default: Screen}>>} */
    this.routes = new Map();
    /** @type {{ screenId: string, params: Record<string,string>, element: HTMLElement, screen: Screen|null }[]} */
    this.stack = [];
    /** @type {HTMLElement|null} */
    this.container = null;
    /** @type {string|null} */
    this.currentTab = null;
    /** @type {Map<string, { screenId: string, params: Record<string,string>, element: HTMLElement, screen: Screen|null }[]>} */
    this.tabStacks = new Map();
    /** @type {(() => void)|null} */
    this.onAuthRequired = null;
    /** @type {Set<string>} */
    this.authRequired = new Set();
    /** @type {(() => boolean)|null} */
    this.isAuthenticated = null;
    /** @type {((tabId: string) => void)|null} */
    this.onSwitchTab = null;
    /** @type {((depth: number) => void)|null} */
    this.onDepthChange = null;
  }

  _notifyDepth() {
    try { this.onDepthChange?.(this.stack.length); } catch { /* ignore */ }
  }

  get depth() {
    return this.stack.length;
  }

  get current() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  /** @param {HTMLElement} container */
  init(container) {
    this.container = container;
    if (typeof window !== 'undefined' && window.history) {
      // Anchor the base entry so OS back/gesture walks our stack instead of
      // exiting the app. Every push() adds an entry; popstate pops one level.
      try { window.history.replaceState({ rdDepth: 0 }, ''); } catch { /* ignore */ }
      window.addEventListener('popstate', () => {
        const before = this.stack.length;
        this._popStack();
        // V3-L35: at a tab root there is nothing to pop — re-anchor so the
        // OS back gesture stays in the app instead of exiting it.
        if (this.stack.length === before && this.stack.length <= 1) {
          try { window.history.pushState({ rdDepth: this.stack.length }, ''); } catch { /* ignore */ }
        }
      });
    }
  }

  /**
   * @param {string} screenId
   * @param {() => Promise<{default: Screen}>} loader
   * @param {{ auth?: boolean }} [opts]
   */
  register(screenId, loader, opts = {}) {
    this.routes.set(screenId, loader);
    if (opts.auth) this.authRequired.add(screenId);
  }

  /**
   * Navigate to a screen (push onto stack)
   * @param {string} screenId
   * @param {Record<string,string>} [params]
   * @param {{ replace?: boolean, animate?: boolean }} [opts]
   */
  async push(screenId, params = {}, opts = { animate: true }) {
    if (!this.container) return;

    // Auth guard
    if (this.authRequired.has(screenId) && this.isAuthenticated && !this.isAuthenticated()) {
      this.onAuthRequired?.();
      return;
    }

    const loader = this.routes.get(screenId);
    const prevScreen = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    if (!loader) {
      // V3-M22: an unknown screen used to fail silently (console.error only)
      // leaving a dead tap. Render the same "Something went wrong" state as
      // a chunk-load failure, with a retry.
      console.error(`[Router] Unknown screen: ${screenId}`);
      activateScreen(prevScreen?.element, false);
      try { prevScreen?.screen?.pause?.(); } catch { /* ignore */ }
      this._renderLoadError(screenId, params, opts, 'This page doesn\'t exist in this version of the app. Go back and try again.');
      return;
    }

    // Load the screen module — a rejected import (e.g. a stale cached
    // bundle requesting a pruned chunk) must never leave a blank screen.
    let module;
    try {
      module = await loader();
    } catch (err) {
      console.error(`[Router] chunk load failed for ${screenId}`, err);
      // Pause the previous screen so its live-refresh timers stop firing
      // behind the error screen (V3-M22).
      activateScreen(prevScreen?.element, false);
      try { prevScreen?.screen?.pause?.(); } catch { /* ignore */ }
      this._renderLoadError(screenId, params, opts, 'This page couldn\'t load. Your app may be on an older version — try again.');
      return;
    }
    const screen = module.default;

    // Create screen container
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.screenId = screenId;
    el.style.zIndex = String(10 + this.stack.length);

    activateScreen(prevScreen?.element, false);
    prevScreen?.screen?.pause?.();
    el.dataset.screenActive = 'true';

    if (opts.animate && this.stack.length > 0) {
      el.classList.add('screen-enter');
      if (prevScreen?.element) {
        setTimeout(() => {
          if (this.current?.element === el && prevScreen?.element && document.body.contains(el)) {
            prevScreen.element.style.visibility = 'hidden';
          }
        }, 320);
      }
    } else if (prevScreen?.element) {
      prevScreen.element.style.visibility = 'hidden';
    }

    // If replacing, remove old top
    if (opts.replace && this.stack.length > 0) {
      const old = this.stack.pop();
      disposeScreen(old?.element);
      try { old?.screen?.unmount?.(); } catch { /* ignore */ }
      old?.element?.remove();
    }

    this.container.appendChild(el);
    this.stack.push({ screenId, params, element: el, screen });

    // Keep browser history in step so the OS back button/gesture navigates
    // the app instead of leaving it.
    if (typeof window !== 'undefined' && window.history) {
      try {
        if (opts.replace) window.history.replaceState({ rdDepth: this.stack.length }, '');
        else window.history.pushState({ rdDepth: this.stack.length }, '');
      } catch { /* ignore */ }
    }

    // Mount the screen — a throwing mount must never leave a blank screen.
    try {
      await screen.mount(el, params);
    } catch (err) {
      console.error(`[Router] mount failed for ${screenId}`, err);
      el.innerHTML = `<div style="padding:48px 24px;text-align:center"><div style="font-weight:700;font-size:18px;margin-bottom:8px">Something went wrong</div><div style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">This page couldn't open. Go back and try again.</div><button class="btn btn-primary" id="router-retry">Try Again</button></div>`;
      el.querySelector('#router-retry')?.addEventListener('click', () => {
        this.push(screenId, params, { replace: true, animate: false }).catch((e) => console.error('[Router] retry failed', e));
      });
    }
    this._notifyDepth();

    // Save stack to current tab
    if (this.currentTab) {
      this.tabStacks.set(this.currentTab, [...this.stack]);
    }
  }

  /** Render the "Something went wrong" + retry state shared by the
   *  unknown-screen and chunk-load-failure paths (V3-M22). */
  _renderLoadError(screenId, params, opts, message) {
    // A retry with replace:true must drop the previous error screen first.
    if (opts.replace && this.stack.length > 0) {
      const old = this.stack.pop();
      disposeScreen(old?.element);
      try { old?.screen?.unmount?.(); } catch { /* ignore */ }
      old?.element?.remove();
    }
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.screenId = screenId;
    el.style.zIndex = String(10 + this.stack.length);
    el.innerHTML = `<div style="padding:48px 24px;text-align:center"><div style="font-weight:700;font-size:18px;margin-bottom:8px">Something went wrong</div><div style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">${message}</div><button class="btn btn-primary" id="router-retry">Try Again</button></div>`;
    this.container.appendChild(el);
    this.stack.push({ screenId, params, element: el, screen: null });
    if (typeof window !== 'undefined' && window.history) {
      try {
        if (opts.replace) window.history.replaceState({ rdDepth: this.stack.length }, '');
        else window.history.pushState({ rdDepth: this.stack.length }, '');
      } catch { /* ignore */ }
    }
    el.querySelector('#router-retry')?.addEventListener('click', () => {
      this.push(screenId, params, { replace: true, animate: false }).catch((e) => console.error('[Router] retry failed', e));
    });
    if (this.currentTab) this.tabStacks.set(this.currentTab, [...this.stack]);
    this._notifyDepth();
  }

  /** Go back one screen (via browser history; popstate performs the pop). */
  async pop() {
    if (this.stack.length <= 1) return;
    if (typeof window !== 'undefined' && window.history) {
      window.history.back();
      return;
    }
    this._popStack();
  }

  /** Actual internal-stack pop (called by the popstate handler). */
  _popStack() {
    if (this.stack.length <= 1) return;

    const top = this.stack.pop();
    disposeScreen(top?.element);
    const prev = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    if (prev?.element) {
      prev.element.style.visibility = 'visible';
      activateScreen(prev.element, true);
      try { prev.screen?.resume?.(prev.element); } catch (err) { console.error('[Router] resume failed', err); }
    }
    this._notifyDepth();
    try { top?.screen?.unmount?.(); } catch { /* ignore */ }

    if (top) {
      top.element.classList.remove('screen-enter');
      top.element.classList.add('screen-exit');
      setTimeout(() => {
        top.element.remove();
      }, 250);
    }

    // Save stack
    if (this.currentTab) {
      this.tabStacks.set(this.currentTab, [...this.stack]);
    }
  }

  /** Go back one screen within the current tab, or stay at the tab root.
   *  V3-L35: in-app back used to jump to the *previous tab* at a tab root
   *  (via the tab-switch history) — back now returns to the tab root and
   *  stops there; the tab bar is the tab switcher. */
  async back() {
    if (this.stack.length > 1) {
      await this.pop();
    }
    // At a tab root, back is a no-op — never fall through to
    // window.history.back(), which can exit the app, and never switch tabs.
  }

  /** Check if a back action is available */
  canGoBack() {
    return this.stack.length > 1;
  }

  /**
   * Switch to a tab — restores that tab's stack
   * @param {string} tabId
   * @param {string} rootScreenId
   * @param {Record<string,string>} [params]
   */
  async switchTab(tabId, rootScreenId, params = {}) {
    if (!this.container) return;

    // Save current tab stack
    if (this.currentTab) {
      this.tabStacks.set(this.currentTab, [...this.stack]);
    }

    // Clear current screens from DOM
    for (const entry of this.stack) {
      activateScreen(entry.element, false);
      try { entry.screen?.pause?.(); } catch { /* ignore */ }
      entry.element.remove();
    }
    this.stack = [];

    this.currentTab = tabId;

    // Restore saved stack or create new
    const savedStack = this.tabStacks.get(tabId);
    if (savedStack && savedStack.length > 0) {
      for (let i = 0; i < savedStack.length; i++) {
        const entry = savedStack[i];
        entry.element.style.zIndex = String(10 + i);
        entry.element.style.visibility = (i === savedStack.length - 1) ? 'visible' : 'hidden';
        this.container.appendChild(entry.element);
        this.stack.push(entry);
      }
      activateScreen(this.current?.element, true);
      // V3-L18: a throwing resume() used to break the whole tab switch.
      try { this.current?.screen?.resume?.(this.current.element); } catch (err) { console.error('[Router] resume failed', err); }
    } else {
      await this.push(rootScreenId, params, { animate: false });
    }
    // Re-anchor browser history: tab switches wholesale-replace the stack,
    // so stale back entries would pop the wrong screens.
    if (typeof window !== 'undefined' && window.history) {
      try { window.history.replaceState({ rdDepth: this.stack.length }, ''); } catch { /* ignore */ }
    }
    this._notifyDepth();
  }

  /** Clear all stacks and screens */
  clear() {
    const entries = new Set([...this.stack, ...[...this.tabStacks.values()].flat()]);
    for (const entry of entries) {
      disposeScreen(entry.element);
      try { entry.screen?.unmount?.(); } catch { /* ignore */ }
      entry.element.remove();
    }
    this.stack = [];
    this.tabStacks.clear();
    this.currentTab = null;
    if (typeof window !== 'undefined' && window.history) {
      try { window.history.replaceState({ rdDepth: 0 }, ''); } catch { /* ignore */ }
    }
    this._notifyDepth();
  }
}

export const router = new Router();
