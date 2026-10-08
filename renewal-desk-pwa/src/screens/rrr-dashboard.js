import { apiRequest, getCachedSession } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatCurrency, formatInteger } from '../utils.js';

const pillarMeta = {
  revenue: { title: 'REVENUE', subtitle: 'Grow revenue from existing members', color: 'green', action: 'Revenue' },
  retain: { title: 'RETAIN', subtitle: 'Prevent potential revenue loss', color: 'amber', action: 'Retain' },
  recover: { title: 'RECOVER', subtitle: 'Bring back lost revenue', color: 'red', action: 'Recover' },
};

export default {
  async mount(el) {
    el.innerHTML = '<div class="rrr-loading">Loading your RRR growth view…</div>';
    await load(el);
  },
};

async function load(el) {
  const result = await apiRequest('/api/mobile/v1/rrr/dashboard');
  if (!result.ok) {
    el.innerHTML = `<div class="rrr-empty"><h2>RRR could not load</h2><p>${escapeHtml(result.error?.message || 'Please try again.')}</p><button id="rrr-retry">Retry</button></div>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const data = result.data;
  const session = getCachedSession();
  const name = session?.tenantName || 'Your Gym';
  const integration = data.integration;
  el.innerHTML = `<main class="rrr-page">
    <header class="rrr-header">
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <button id="rrr-integrations" class="rrr-connection ${integration?.status === 'connected' ? 'connected' : ''}">${integration?.status === 'connected' ? 'eBio Connected' : 'Connect eBioServer'}</button>
    </header>
    <section class="rrr-hero"><h1>Grow more from the members you already have.</h1><p>Revenue. Retain. Recover. The complete gym growth system for ${escapeHtml(name)}.</p></section>
    <section class="rrr-kpis">
      <article><strong>${formatInteger(data.members.total)}</strong><span>Total Members</span></article>
      <article><strong>${data.members.attendance_rate}%</strong><span>Attendance Rate</span></article>
      <article><strong>${formatInteger(data.unmapped_count)}</strong><span>Needs Mapping</span></article>
    </section>
    <section class="rrr-pillars">${['revenue', 'retain', 'recover'].map(key => pillar(data, key)).join('')}</section>
    <section class="rrr-insights">
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Revenue Impact</h2><span>Live pipeline</span></div>
        <div class="rrr-bars">${['revenue','retain','recover'].map(k => `<div><i class="${k}"></i><b>${pillarMeta[k].title}</b><strong>${formatCurrency(data.pillars[k].potential_revenue)}</strong></div>`).join('')}</div>
      </article>
      <article class="rrr-panel"><div class="rrr-panel-head"><h2>Integration Health</h2><span class="${integration?.status === 'connected' ? 'rrr-ok' : 'rrr-warn'}">${escapeHtml(integration?.status || 'Not configured')}</span></div>
        <p>${integration?.device_name ? `${escapeHtml(integration.device_name)} · ` : ''}${integration?.device_serial ? escapeHtml(integration.device_serial) : 'Pair your licensed local eBioServer from the gym PC.'}</p>
        <button id="rrr-health">Manage integration</button>
      </article>
    </section>
    <section class="rrr-list-grid">${['revenue','retain','recover'].map(k => list(data.pillars[k].items, k)).join('')}</section>
  </main>`;
  el.querySelector('#rrr-integrations')?.addEventListener('click', () => navigate.push('rrr-integrations'));
  el.querySelector('#rrr-health')?.addEventListener('click', () => navigate.push('rrr-integrations'));
  el.querySelectorAll('[data-pillar]').forEach(button => button.addEventListener('click', () => navigate.switchTab(button.dataset.pillar)));
}

function pillar(data, key) {
  const m = pillarMeta[key];
  return `<article class="rrr-pillar ${m.color}"><div><h2>${m.title}</h2><p>${m.subtitle}</p></div><div class="rrr-pillar-bottom"><strong>${formatInteger(data.count)}</strong><span>${key === 'revenue' ? 'Opportunities' : key === 'retain' ? 'At-risk Members' : 'Inactive / Expired'}</span><em>${formatCurrency(data.potential_revenue)}</em><button data-pillar="${key}">View all →</button></div></article>`;
}

function list(items, key) {
  const m = pillarMeta[key];
  return `<article class="rrr-panel rrr-member-list"><div class="rrr-panel-head"><h2>${m.title}</h2><button data-pillar="${key}">View all</button></div>${items.length ? items.map(item => `<div class="rrr-member-row"><div><b>${escapeHtml(item.member.name)}</b><span>${escapeHtml(item.reason)}</span></div><strong>${formatCurrency(item.potential_revenue)}</strong></div>`).join('') : '<p class="rrr-no-data">No matching members yet. RRR only shows real data.</p>'}</article>`;
}
