/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Client-side SPA Router
   Hash-based routing for iOS Safari PWA compatibility
   ═══════════════════════════════════════════════════════════════════════ */

/** @typedef {{ mount: (container: HTMLElement, params?: Record<string,string>) => void|Promise<void>, unmount?: () => void }} Screen */

class Router {
  constructor() {
    /** @type {Map<string, () => Promise<{default: Screen}>>} */
    this.routes = new Map();
    /** @type {{ screenId: string, params: Record<string,string>, element: HTMLElement }[]} */
    this.stack = [];
    /** @type {HTMLElement|null} */
    this.container = null;
    /** @type {string|null} */
    this.currentTab = null;
    /** @type {Map<string, { screenId: string, params: Record<string,string>, element: HTMLElement }[]>} */
    this.tabStacks = new Map();
    /** @type {{ type: 'push'|'tab', tabId?: string, screenId?: string }[]} */
    this.history = [];
    /** @type {(() => void)|null} */
    this.onAuthRequired = null;
    /** @type {Set<string>} */
    this.authRequired = new Set();
    /** @type {(() => boolean)|null} */
    this.isAuthenticated = null;
    /** @type {((tabId: string) => void)|null} */
    this.onSwitchTab = null;
  }

  /** @param {HTMLElement} container */
  init(container) {
    this.container = container;
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
    if (!loader) {
      console.error(`[Router] Unknown screen: ${screenId}`);
      return;
    }

    // Load the screen module
    const module = await loader();
    const screen = module.default;

    // Create screen container
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.screenId = screenId;

    if (opts.animate && this.stack.length > 0) {
      el.classList.add('screen-enter');
    }

    // If replacing, remove old top
    if (opts.replace && this.stack.length > 0) {
      const old = this.stack.pop();
      old?.element?.remove();
    }

    this.container.appendChild(el);
    this.stack.push({ screenId, params, element: el });

    // Mount the screen
    await screen.mount(el, params);

    // Save stack to current tab
    if (this.currentTab) {
      this.tabStacks.set(this.currentTab, [...this.stack]);
    }
  }

  /** Go back one screen */
  async pop() {
    if (this.stack.length <= 1) return;

    const top = this.stack.pop();
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

  /** Go back one screen or back to previous tab/dashboard */
  async back() {
    if (this.stack.length > 1) {
      await this.pop();
    } else if (this.history.length > 0) {
      const prev = this.history.pop();
      if (prev?.tabId && prev.tabId !== this.currentTab && this.onSwitchTab) {
        this.onSwitchTab(prev.tabId);
      } else if (this.onSwitchTab) {
        this.onSwitchTab('dashboard');
      }
    } else if (this.currentTab && this.currentTab !== 'dashboard' && this.onSwitchTab) {
      this.onSwitchTab('dashboard');
    } else if (window.history.length > 1) {
      window.history.back();
    }
  }

  /** Check if a back action is available */
  canGoBack() {
    return this.stack.length > 1 || this.history.length > 0 || (this.currentTab != null && this.currentTab !== 'dashboard');
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
      entry.element.remove();
    }
    this.stack = [];

    this.currentTab = tabId;

    // Restore saved stack or create new
    const savedStack = this.tabStacks.get(tabId);
    if (savedStack && savedStack.length > 0) {
      for (const entry of savedStack) {
        this.container.appendChild(entry.element);
        this.stack.push(entry);
      }
    } else {
      await this.push(rootScreenId, params, { animate: false });
    }
  }

  /** Clear all stacks and screens */
  clear() {
    for (const entry of this.stack) {
      entry.element.remove();
    }
    this.stack = [];
    this.tabStacks.clear();
    this.currentTab = null;
  }

  /** Get current top screen */
  get current() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Get stack depth */
  get depth() {
    return this.stack.length;
  }
}

export const router = new Router();
