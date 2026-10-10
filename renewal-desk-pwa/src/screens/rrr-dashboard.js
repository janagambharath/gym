import { apiRequest, getCachedSession } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatCurrency, formatInteger } from '../utils.js';
import { icon } from '../icons.js';

const pillarMeta = {
  revenue: { title: 'Revenue', eyebrow: 'Grow existing value', detail: 'Renewals, upgrades and payments to win', color: 'green', icon: 'trendUp' },
  retain: { title: 'Retain', eyebrow: 'Protect recurring revenue', detail: 'Members whose attendance or payments need attention', color: 'amber', icon: 'shield' },
  recover: { title: 'Recover', eyebrow: 'Bring people back', detail: 'Recently expired or inactive members to re-engage', color: 'red', icon: 'renewals' },
};

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Building your owner workspace…</div>';
  const [result, todayResult] = await Promise.all([
    apiRequest('/api/mobile/v1/rrr/dashboard'),
    apiRequest('/api/mobile/v1/owner/today'),
  ]);
  if (!result.ok) {
    el.innerHTML = `<div class="rrr-empty"><h2>Your dashboard is temporarily unavailable</h2><p>${escapeHtml(result.error?.message || 'Please try again.')}</p><button id="rrr-retry">Retry</button></div>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const data = result.data;
  const session = getCachedSession();
  const gymName = session?.tenantName || 'Your Gym';
  const ownerName = session?.userName || 'Owner';
  const integration = data.integration;
  const integrationName = integration?.type === 'adms_direct' ? 'Direct Cloud' : 'eBioServer';
  const priorityCount = ['revenue', 'retain', 'recover'].reduce((total, key) => total + (data.pillars[key]?.count || 0), 0);
  const today = todayResult.ok ? todayResult.data : null;

  el.innerHTML = `<main class="rrr-page rrr-dashboard-page">
    <header class="rrr-workspace-bar">
      <button class="rrr-gym-switcher" id="rrr-members">${icon('business', 18)}<span><b>${escapeHtml(gymName)}</b><small>Owner workspace</small></span>${icon('chevronDown', 16)}</button>
      <div class="rrr-header-actions"><button class="rrr-icon-button" id="rrr-inbox" aria-label="Open inbox">${icon('inbox', 19)}</button><button class="rrr-add-button" id="rrr-add-member">${icon('add', 18, 'white')} Add member</button><button class="rrr-owner-avatar" id="rrr-avatar" aria-label="Open settings">${escapeHtml(ownerName.slice(0, 2).toUpperCase())}</button></div>
    </header>
    <section class="rrr-dashboard-hero">
      <div><span class="rrr-eyebrow">TODAY AT ${escapeHtml(gymName).toUpperCase()}</span><h1>Run the gym. Grow the business.</h1><p>${priorityCount ? `${formatInteger(priorityCount)} member opportunities need your attention.` : 'Everything looks clear. New signals will appear as members check in, pay and renew.'}</p></div>
      <button id="rrr-integrations" class="rrr-device-status ${integration?.status === 'connected' ? 'connected' : ''}"><i></i><span>${integration?.status === 'connected' ? `${integrationName} live` : 'Attendance needs setup'}</span>${icon('chevronRight', 16)}</button>
    </section>
    <section class="rrr-kpis rrr-owner-kpis">
      <article id="rrr-kpi-members" class="rrr-kpi-tappable"><span class="rrr-kpi-icon green">${icon('members', 20)}</span><div><strong>${formatInteger(data.members.total)}</strong><span>Total members</span></div><small>${formatInteger(data.members.active || 0)} active</small></article>
      <article id="rrr-kpi-attendance" class="rrr-kpi-tappable"><span class="rrr-kpi-icon blue">${icon('stats', 20)}</span><div><strong>${data.members.attendance_rate}%</strong><span>30-day attendance</span></div><small>${integration?.status === 'connected' ? 'Live signal' : 'Awaiting device'}</small></article>
      <article id="rrr-kpi-mapping" class="rrr-kpi-tappable"><span class="rrr-kpi-icon amber">${icon('warning', 20)}</span><div><strong>${formatInteger(data.unmapped_count)}</strong><span>Identity reviews</span></div><small>${data.unmapped_count ? 'Map punches now →' : 'All caught up'}</small></article>
      <article id="rrr-kpi-pipeline" class="rrr-kpi-tappable"><span class="rrr-kpi-icon violet">${icon('wallet', 20)}</span><div><strong>${formatCurrency(Object.values(data.pillars).reduce((sum, pillar) => sum + Number(pillar.potential_revenue || 0), 0))}</strong><span>Growth pipeline</span></div><small>Potential value</small></article>
    </section>
    ${today ? ownerToday(today) : ''}
    ${setupChecklist(data)}
    <section class="rrr-growth-section"><div class="rrr-section-heading"><div><span class="rrr-eyebrow">GROWTH ENGINE</span><h2>Where to focus next</h2></div><button id="rrr-rules">Tune signals ${icon('settings', 15)}</button></div><div class="rrr-pillars">${['revenue', 'retain', 'recover'].map(key => pillar(data, key)).join('')}</div></section>
    <section class="rrr-owner-grid">
      <article class="rrr-panel rrr-impact-panel"><div class="rrr-panel-head"><div><h2>Growth impact</h2><p>Potential value waiting in your member base</p></div><span>Live</span></div><div class="rrr-impact-bars">${['revenue', 'retain', 'recover'].map(key => impactBar(data, key)).join('')}</div></article>
      <article class="rrr-panel rrr-quick-actions"><div class="rrr-panel-head"><div><h2>Quick actions</h2><p>Keep the front desk moving</p></div></div><button data-action="add">${icon('personAdd', 19)} Add new member ${icon('chevronRight', 17)}</button><button data-action="payment">${icon('cash', 19)} Record a payment ${icon('chevronRight', 17)}</button><button data-action="campaign">${icon('whatsapp', 19)} Start WhatsApp campaign ${icon('chevronRight', 17)}</button><button data-action="access">${icon('access', 19)} Review access control ${icon('chevronRight', 17)}</button></article>
    </section>
    <section class="rrr-list-grid">${['revenue', 'retain', 'recover'].map(key => list(data.pillars[key]?.items || [], key)).join('')}</section>
  </main>`;
  el.querySelector('#rrr-integrations')?.addEventListener('click', () => navigate.push('rrr-integrations'));
  el.querySelector('#rrr-kpi-mapping')?.addEventListener('click', () => navigate.push('rrr-mappings'));
  el.querySelector('#rrr-kpi-members')?.addEventListener('click', () => navigate.switchTab('members'));
  el.querySelector('#rrr-kpi-attendance')?.addEventListener('click', () => navigate.push('access'));
  el.querySelector('#rrr-kpi-pipeline')?.addEventListener('click', () => navigate.push('rrr-list', { pillar: 'revenue' }));
  el.querySelector('#rrr-rules')?.addEventListener('click', () => navigate.push('rrr-rules'));
  el.querySelector('#rrr-members')?.addEventListener('click', () => navigate.switchTab('members'));
  el.querySelector('#rrr-inbox')?.addEventListener('click', () => navigate.push('inbox'));
  el.querySelector('#rrr-add-member')?.addEventListener('click', () => navigate.push('add-member'));
  el.querySelector('#rrr-avatar')?.addEventListener('click', () => navigate.push('settings'));
  el.querySelectorAll('[data-setup]').forEach(button => button.addEventListener('click', () => navigate.push(button.dataset.setup)));
  el.querySelectorAll('[data-pillar]').forEach(button => button.addEventListener('click', () => navigate.push('rrr-list', { pillar: button.dataset.pillar })));
  el.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const destinations = { add: 'add-member', payment: 'record-payment', campaign: 'campaign-create', access: 'access' };
    navigate.push(destinations[button.dataset.action]);
  }));
  el.querySelectorAll('[data-owner-route]').forEach(button => button.addEventListener('click', () => {
    const route = button.dataset.ownerRoute;
    if (route === 'rrr-list') navigate.push('rrr-list', { pillar: button.dataset.ownerPillar || 'revenue' });
    else if (route) navigate.push(route);
  }));
}

function pillar(data, key) {
  const m = pillarMeta[key];
  const title = key === 'revenue' ? 'Opportunities' : key === 'retain' ? 'At-risk members' : 'Inactive / expired';
  return `<article class="rrr-pillar ${m.color}"><div class="rrr-pillar-top"><span>${icon(m.icon, 22)}</span><div><b>${m.title}</b><p>${m.eyebrow}</p></div></div><div class="rrr-pillar-bottom"><strong>${formatInteger(data.count)}</strong><span>${title}</span><em>${formatCurrency(data.potential_revenue)} potential</em><p>${m.detail}</p><button data-pillar="${key}">View members ${icon('chevronRight', 15)}</button></div></article>`;
}

function impactBar(data, key) {
  const m = pillarMeta[key];
  const value = Number(data.pillars[key]?.potential_revenue || 0);
  const max = Math.max(...Object.values(data.pillars).map(item => Number(item.potential_revenue || 0)), 1);
  return `<div class="rrr-impact-row"><div><span class="rrr-impact-dot ${m.color}"></span><b>${m.title}</b></div><div class="rrr-impact-track"><i class="${m.color}" style="width:${Math.max(8, Math.round(value / max * 100))}%"></i></div><strong>${formatCurrency(value)}</strong></div>`;
}

function list(items, key) {
  const m = pillarMeta[key];
  return `<article class="rrr-panel rrr-member-list"><div class="rrr-panel-head"><div><h2>${m.title}</h2><p>${m.eyebrow}</p></div><button data-pillar="${key}">View all</button></div>${items.length ? items.map(item => `<div class="rrr-member-row"><span class="rrr-member-dot ${m.color}"></span><div><b>${escapeHtml(item.member.name)}</b><span>${escapeHtml(item.reason)}</span></div><strong>${formatCurrency(item.potential_revenue)}</strong></div>`).join('') : '<p class="rrr-no-data">No action needed right now.</p>'}</article>`;
}

function setupChecklist(data) {
  const steps = [
    { done: (data.plans_count || 0) > 0, label: 'Add membership plans', desc: 'Pricing & durations', screen: 'plans' },
    { done: (data.members?.total || 0) > 0, label: 'Add your members', desc: 'Or import from CSV', screen: 'member-import' },
    { done: !!data.whatsapp_connected, label: 'Connect WhatsApp', desc: 'Automated reminders', screen: 'whatsapp-setup' },
    { done: !!data.payment_setup_done, label: 'Set up payments', desc: 'UPI ID & QR code', screen: 'payment-setup' },
    { done: data.integration?.status === 'connected', label: 'Pair biometric device', desc: 'Attendance & access', screen: 'rrr-integrations' },
  ];
  const pending = steps.filter(s => !s.done);
  if (pending.length === 0) return '';
  return `<section class="rrr-panel" style="margin:0 var(--sp-lg) var(--sp-lg)"><div class="rrr-panel-head"><div><h2>Get set up</h2><p>${pending.length} step${pending.length>1?'s':''} left to launch your gym</p></div></div>
    ${steps.map(s => `<button class="list-item" data-setup="${s.screen}" style="width:100%;text-align:left;${s.done?'opacity:0.55':''}">
      <div style="width:28px;height:28px;border-radius:var(--r-full);background:${s.done?'var(--success-surface)':'var(--brand-subtle)'};display:flex;align-items:center;justify-content:center">${icon(s.done?'check':'chevronRight', 16, s.done?'var(--success)':'var(--brand)')}</div>
      <div class="list-item-content"><div class="list-item-title">${escapeHtml(s.label)}</div><div class="list-item-subtitle">${escapeHtml(s.desc)}</div></div>
    </button>`).join('')}</section>`;
}

function ownerToday(today) {
  const actions = today.actions || [];
  const topActions = actions.slice(0, 5);
  return `<section class="rrr-owner-today"><div class="rrr-today-heading"><div><span class="rrr-eyebrow">OWNER TODAY</span><h2>Make the next shift count</h2><p>Collections, people and live systems in one honest queue.</p></div><button data-owner-route="owner-finance">Daily collections ${icon('chevronRight', 15)}</button></div><div class="rrr-today-grid"><article class="rrr-today-collections"><span>Collected today</span><strong>${formatCurrency(today.collections?.total || 0)}</strong><div><b>${formatCurrency(today.collections?.expected_cash || 0)}</b><small>cash expected</small></div><div class="rrr-cash-close ${today.cash_close?.closed ? 'closed' : ''}">${today.cash_close?.closed ? `${icon('check', 14)} Cash close recorded` : `${icon('warning', 14)} Cash close not recorded`}</div><button data-owner-route="owner-finance">${today.cash_close?.closed ? 'Review cash close' : 'Close cash now'} ${icon('chevronRight', 15)}</button></article><article class="rrr-today-queue"><div class="rrr-panel-head"><div><h2>Priority queue</h2><p>${topActions.length ? 'Work these before the shift ends.' : 'No urgent work is waiting.'}</p></div><span>${actions.reduce((sum, item) => sum + Number(item.count || 0), 0)}</span></div>${topActions.length ? topActions.map(action => `<button class="rrr-today-action ${action.priority}" data-owner-route="${escapeHtml(action.route)}" ${action.pillar ? `data-owner-pillar="${escapeHtml(action.pillar)}"` : ''}><i>${icon(action.kind === 'lead' ? 'phone' : action.kind === 'payment' ? 'payments' : action.kind === 'trial' ? 'calendar' : action.kind === 'mapping' ? 'members' : action.kind === 'integration' ? 'fitness' : 'warning', 16)}</i><div><b>${escapeHtml(action.title)}</b><span>${escapeHtml(action.detail)}</span></div><strong>${formatInteger(action.count)}</strong>${icon('chevronRight', 15)}</button>`).join('') : '<p class="rrr-no-data">Start by adding a member or recording a payment.</p>'}</article></div></section>`;
}
