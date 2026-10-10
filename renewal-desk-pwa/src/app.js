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
let desktopNavEl = null;
let activeTab = 'dashboard';

// ─── Tab Configuration ───────────────────────────────────────────────

const TAB_CONFIG = {
  dashboard: { screen: 'dashboard', label: 'Dashboard' },
  revenue: { screen: 'rrr-list', label: 'Revenue', params: { pillar: 'revenue' } },
  retain: { screen: 'rrr-list', label: 'Retain', params: { pillar: 'retain' } },
  recover: { screen: 'rrr-list', label: 'Recover', params: { pillar: 'recover' } },
  members: { screen: 'members', label: 'Members' },
};

// ─── Screen Registration ─────────────────────────────────────────────

function registerScreens() {
  // Auth
  router.register('login', () => import('./screens/login.js'));
  router.register('signup', () => import('./screens/signup.js'));
  router.register('member-login', () => import('./screens/member-login.js'));

  // Tabs
  router.register('dashboard', () => import('./screens/rrr-dashboard.js'), { auth: true });
  router.register('rrr-list', () => import('./screens/rrr-list.js'), { auth: true });
  router.register('rrr-integrations', () => import('./screens/rrr-integrations.js'), { auth: true });
  router.register('rrr-mappings', () => import('./screens/rrr-mappings.js'), { auth: true });
  router.register('rrr-rules', () => import('./screens/rrr-rules.js'), { auth: true });
  router.register('members', () => import('./screens/members.js'), { auth: true });
  router.register('renewals', () => import('./screens/renewals.js'), { auth: true });
  router.register('payments', () => import('./screens/payments.js'), { auth: true });
  router.register('settings', () => import('./screens/settings.js'), { auth: true });
  router.register('owner-leads', () => import('./screens/owner-leads.js'), { auth: true });
  router.register('owner-finance', () => import('./screens/owner-finance.js'), { auth: true });

  // Stack screens
  router.register('member-detail', () => import('./screens/member-detail.js'), { auth: true });
  router.register('add-member', () => import('./screens/add-member.js'), { auth: true });
  router.register('edit-member', () => import('./screens/edit-member.js'), { auth: true });
  router.register('renew-member', () => import('./screens/renew-member.js'), { auth: true });
  router.register('record-payment', () => import('./screens/record-payment.js'), { auth: true });
  router.register('payment-detail', () => import('./screens/payment-detail.js'), { auth: true });
  router.register('payment-setup', () => import('./screens/payment-setup.js'), { auth: true });
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
    <aside id="desktop-owner-nav" class="desktop-owner-nav" aria-label="Owner navigation"></aside>
    <div id="screen-container" style="flex:1;position:relative;overflow:hidden"></div>
    <div id="tab-bar-container"></div>
  `;
  screenContainer = document.getElementById('screen-container');
  tabBarEl = document.getElementById('tab-bar-container');
  desktopNavEl = document.getElementById('desktop-owner-nav');
  renderDesktopNavigation();
  router.init(screenContainer);
}

const DESKTOP_NAVIGATION = [
  { label: 'Growth', items: [
    { tab: 'dashboard', label: 'Overview', icon: 'dashboard' },
    { tab: 'revenue', label: 'Revenue', icon: 'stats' },
    { tab: 'retain', label: 'Retain', icon: 'shield' },
    { tab: 'recover', label: 'Recover', icon: 'renewals' },
  ]},
  { label: 'Operations', items: [
    { tab: 'members', label: 'Members', icon: 'members' },
    { screen: 'renewals', label: 'Renewals', icon: 'renewals' },
    { screen: 'payments', label: 'Payments', icon: 'payments' },
    { screen: 'owner-finance', label: 'Daily collections', icon: 'wallet' },
    { screen: 'owner-leads', label: 'Leads & trials', icon: 'members' },
    { screen: 'access', label: 'Access control', icon: 'access' },
  ]},
  { label: 'Engagement', items: [
    { screen: 'campaigns', label: 'Campaigns', icon: 'megaphone' },
    { screen: 'inbox', label: 'Inbox', icon: 'inbox' },
    { screen: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  ]},
];

function renderDesktopNavigation() {
  if (!desktopNavEl) return;
  desktopNavEl.innerHTML = `
    <div class="desktop-nav-brand"><span class="desktop-nav-mark">RRR</span><div><b>RRR</b><span>Gym Growth System</span></div></div>
    <button class="desktop-new-member" data-screen="add-member">${icon('add', 18)} Add member</button>
    <div class="desktop-nav-scroll">${DESKTOP_NAVIGATION.map(section => `<section><p>${section.label}</p>${section.items.map(item => `<button class="desktop-nav-item ${item.tab === activeTab ? 'is-active' : ''}" ${item.tab ? `data-tab="${item.tab}"` : `data-screen="${item.screen}"`}>${icon(item.icon, 19)}<span>${item.label}</span></button>`).join('')}</section>`).join('')}</div>
    <div class="desktop-nav-footer"><button class="desktop-nav-item" data-screen="rrr-integrations">${icon('fitness', 19)}<span>Integrations</span></button><button class="desktop-nav-item" data-screen="reports">${icon('report', 19)}<span>Reports</span></button><button class="desktop-nav-item" data-screen="settings">${icon('settings', 19)}<span>Settings</span></button></div>`;
  desktopNavEl.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  desktopNavEl.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => navigate.push(button.dataset.screen)));
}

function showTabBar(tab) {
  activeTab = tab;
  renderDesktopNavigation();
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
}

function hideTabBar() {
  if (tabBarEl) tabBarEl.style.display = 'none';
}

async function switchTab(tabId, recordHistory = true) {
  const config = TAB_CONFIG[tabId];
  if (!config) return;
  if (recordHistory && activeTab && activeTab !== tabId) {
    router.history.push({ type: 'tab', tabId: activeTab });
  }
  activeTab = tabId;
  showTabBar(tabId);
  await router.switchTab(tabId, config.screen, config.params || {});
}

// ─── Navigation API (used by screens) ────────────────────────────────

export const navigate = {
  push: (screenId, params) => router.push(screenId, params),
  pop: () => router.back(),
  back: () => router.back(),
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
  router.onSwitchTab = (tabId) => switchTab(tabId, false);

  // Restore session
  const session = restoreSession();

  if (session) {
    await showMainApp();
  } else {
    showAuthFlow();
  }

  checkInstallPrompt();
}
