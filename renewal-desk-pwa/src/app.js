/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Main Application Controller
   ═══════════════════════════════════════════════════════════════════════ */

import { router } from './router.js';
import { restoreSession, getCachedSession, logout as apiLogout } from './api.js';
import { renderTabBar, renderInstallPrompt } from './components.js';
import { icon } from './icons.js';

// ─── State ───────────────────────────────────────────────────────────

let appEl = null;
let screenContainer = null;
let tabBarEl = null;
let activeTab = 'dashboard';

// ─── Tab Configuration ───────────────────────────────────────────────

const TAB_CONFIG = {
  dashboard: { screen: 'dashboard', label: 'Home' },
  members: { screen: 'members', label: 'Members' },
  renewals: { screen: 'renewals', label: 'Renewals' },
  payments: { screen: 'payments', label: 'Payments' },
  more: { screen: 'settings', label: 'More' },
};

// ─── Screen Registration ─────────────────────────────────────────────

function registerScreens() {
  // Auth
  router.register('login', () => import('./screens/login.js'));
  router.register('signup', () => import('./screens/signup.js'));
  router.register('member-login', () => import('./screens/member-login.js'));

  // Tabs
  router.register('dashboard', () => import('./screens/dashboard.js'), { auth: true });
  router.register('members', () => import('./screens/members.js'), { auth: true });
  router.register('renewals', () => import('./screens/renewals.js'), { auth: true });
  router.register('payments', () => import('./screens/payments.js'), { auth: true });
  router.register('settings', () => import('./screens/settings.js'), { auth: true });

  // Stack screens
  router.register('member-detail', () => import('./screens/member-detail.js'), { auth: true });
  router.register('add-member', () => import('./screens/add-member.js'), { auth: true });
  router.register('edit-member', () => import('./screens/edit-member.js'), { auth: true });
  router.register('renew-member', () => import('./screens/renew-member.js'), { auth: true });
  router.register('record-payment', () => import('./screens/record-payment.js'), { auth: true });
  router.register('payment-detail', () => import('./screens/payment-detail.js'), { auth: true });
  router.register('payment-setup', () => import('./screens/payment-setup.js'), { auth: true });
  router.register('fast-renewal', () => import('./screens/fast-renewal.js'), { auth: true });
  router.register('plans', () => import('./screens/plans.js'), { auth: true });
  router.register('staff', () => import('./screens/staff.js'), { auth: true });
  router.register('reports', () => import('./screens/reports.js'), { auth: true });
  router.register('notifications', () => import('./screens/notifications.js'), { auth: true });
  router.register('inbox', () => import('./screens/inbox.js'), { auth: true });
  router.register('subscription', () => import('./screens/subscription.js'), { auth: true });
  router.register('access', () => import('./screens/access.js'), { auth: true });
  router.register('whatsapp', () => import('./screens/whatsapp.js'), { auth: true });
  router.register('bot-overview', () => import('./screens/bot-overview.js'), { auth: true });
  router.register('bot-conversations', () => import('./screens/bot-conversations.js'), { auth: true });
  router.register('bot-conversation-detail', () => import('./screens/bot-conversation-detail.js'), { auth: true });
  router.register('bot-leads', () => import('./screens/bot-leads.js'), { auth: true });
  router.register('bot-lead-detail', () => import('./screens/bot-lead-detail.js'), { auth: true });
  router.register('bot-setup', () => import('./screens/bot-setup.js'), { auth: true });
  router.register('bot-test', () => import('./screens/bot-test.js'), { auth: true });
  router.register('campaigns', () => import('./screens/campaigns.js'), { auth: true });
  router.register('campaign-create', () => import('./screens/campaign-create.js'), { auth: true });
  router.register('campaign-detail', () => import('./screens/campaign-detail.js'), { auth: true });
  router.register('import-members', () => import('./screens/import-members.js'), { auth: true });
  router.register('member-import', () => import('./screens/member-import.js'), { auth: true });
  router.register('member-scan', () => import('./screens/member-scan.js'), { auth: true });
  router.register('member-scan-review', () => import('./screens/member-scan-review.js'), { auth: true });

  // Member-facing
  router.register('member-home', () => import('./screens/member/home.js'));
  router.register('member-membership', () => import('./screens/member/membership.js'));
  router.register('member-payments', () => import('./screens/member/payments.js'));
  router.register('member-profile', () => import('./screens/member/profile.js'));
  router.register('member-access', () => import('./screens/member/access.js'));
  router.register('member-renew', () => import('./screens/member/renew.js'));
}

// ─── App Shell ───────────────────────────────────────────────────────

function renderAppShell() {
  appEl.innerHTML = `
    <nav id="desktop-sidebar" class="desktop-sidebar"></nav>
    <div id="screen-container" style="flex:1;position:relative;overflow:hidden"></div>
    <div id="tab-bar-container"></div>
  `;
  screenContainer = document.getElementById('screen-container');
  tabBarEl = document.getElementById('tab-bar-container');
  router.init(screenContainer);
}

function renderDesktopSidebar(activeTab) {
  const sidebar = document.getElementById('desktop-sidebar');
  if (!sidebar) return;
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'members', label: 'Members', icon: 'members' },
    { id: 'renewals', label: 'Renewals', icon: 'renewals' },
    { id: 'payments', label: 'Payments', icon: 'payments' },
    { id: 'more', label: 'Settings', icon: 'settings' },
  ];
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <img src="/icons/logo.png" alt="Renewal Desk" class="sidebar-logo">
      <span class="sidebar-brand-text">Renewal Desk</span>
    </div>
    <div class="sidebar-nav">
      ${items.map(t => `
        <button class="sidebar-item ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
          ${icon(t.icon, 20)}
          <span>${t.label}</span>
        </button>
      `).join('')}
    </div>
    <div class="sidebar-footer">
      <div style="font-size:var(--fs-xs);color:var(--muted)">© Renewal Desk</div>
    </div>
  `;
  sidebar.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId && tabId !== activeTab) switchTab(tabId);
    });
  });
}

function showTabBar(tab) {
  activeTab = tab;
  tabBarEl.innerHTML = renderTabBar(tab);
  tabBarEl.style.display = '';

  // Bind tab clicks
  tabBarEl.querySelectorAll('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId && tabId !== activeTab) {
        switchTab(tabId);
      }
    });
  });

  // Also update desktop sidebar
  renderDesktopSidebar(tab);
}

function hideTabBar() {
  if (tabBarEl) tabBarEl.style.display = 'none';
  const sidebar = document.getElementById('desktop-sidebar');
  if (sidebar) sidebar.innerHTML = '';
}

async function switchTab(tabId) {
  const config = TAB_CONFIG[tabId];
  if (!config) return;
  activeTab = tabId;
  showTabBar(tabId);
  await router.switchTab(tabId, config.screen);
}

// ─── Navigation API (used by screens) ────────────────────────────────

export const navigate = {
  push: (screenId, params) => router.push(screenId, params),
  pop: () => router.pop(),
  switchTab,
  replace: (screenId, params) => router.push(screenId, params, { replace: true }),
  toLogin: () => showAuthFlow(),
  toApp: () => showMainApp(),
};

// ─── Auth & Main App Flows ───────────────────────────────────────────

function showAuthFlow() {
  router.clear();
  hideTabBar();
  router.push('login', {}, { animate: false });
}

async function showMainApp() {
  router.clear();
  activeTab = 'dashboard';
  showTabBar('dashboard');
  await router.switchTab('dashboard', 'dashboard');
}

export async function handleLogout() {
  await apiLogout();
  showAuthFlow();
}

export function handleLogin() {
  showMainApp();
}

// ─── iOS Install Prompt ──────────────────────────────────────────────

function checkInstallPrompt() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('rd-install-dismissed');

  if (isIos && !isStandalone && !dismissed) {
    setTimeout(() => {
      const prompt = document.createElement('div');
      prompt.innerHTML = renderInstallPrompt();
      document.body.appendChild(prompt);

      document.getElementById('install-dismiss')?.addEventListener('click', () => {
        localStorage.setItem('rd-install-dismissed', '1');
        prompt.remove();
      });
      document.getElementById('install-got-it')?.addEventListener('click', () => {
        localStorage.setItem('rd-install-dismissed', '1');
        prompt.remove();
      });
    }, 3000);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────

export async function boot() {
  appEl = document.getElementById('app');
  if (!appEl) return;

  renderAppShell();
  registerScreens();

  // Auth guard
  router.isAuthenticated = () => !!getCachedSession();
  router.onAuthRequired = () => showAuthFlow();

  // Restore session
  const session = restoreSession();

  if (session) {
    await showMainApp();
  } else {
    showAuthFlow();
  }

  checkInstallPrompt();
}
