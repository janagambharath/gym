import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatCurrency } from '../utils.js';

const labels = { revenue: 'Revenue Opportunities', retain: 'At Risk Members', recover: 'Inactive / Expired Members' };

export default { async mount(el, params = {}) { await load(el, params.pillar || 'revenue'); } };

async function load(el, pillar) {
  el.innerHTML = '<div class="rrr-loading">Loading RRR actions…</div>';
  const result = await apiRequest(`/api/mobile/v1/rrr/opportunities?pillar=${encodeURIComponent(pillar)}`);
  if (!result.ok) { el.innerHTML = '<div class="rrr-empty">Unable to load opportunities.</div>'; return; }
  const items = result.data.opportunities || [];
  el.innerHTML = `<main class="rrr-page rrr-detail"><header class="rrr-header"><button id="rrr-back">←</button><div class="rrr-brand"><b>RRR</b><span>${labels[pillar]}</span></div></header><h1>${labels[pillar]}</h1><p>Every action is calculated from your stored member, payment, and attendance data.</p><section class="rrr-panel">${items.length ? items.map(item => `<article class="rrr-opportunity"><div><h2>${escapeHtml(item.member.name)}</h2><p>${escapeHtml(item.reason)}</p><small>${escapeHtml(item.priority)} priority · ${escapeHtml(item.status)}</small></div><div><strong>${formatCurrency(item.potential_revenue)}</strong><button data-status="actioned" data-id="${item.id}">Mark actioned</button><button data-status="closed" data-id="${item.id}">Close as recovered</button><button data-status="dismissed" data-id="${item.id}">Dismiss</button></div></article>`).join('') : '<p class="rrr-no-data">No open opportunities.</p>'}</section></main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelectorAll('[data-status]').forEach(btn => btn.addEventListener('click', async () => {
    const status = btn.dataset.status;
    const outcome = status === 'closed' ? prompt('Verified recovered revenue amount (₹):', '0') : null;
    if (status === 'closed' && outcome === null) return;
    const response = await apiRequest(`/api/mobile/v1/rrr/opportunities/${btn.dataset.id}`, { method: 'PATCH', body: { status, ...(status === 'closed' ? { outcome_revenue: outcome } : {}) } });
    if (response.ok) load(el, pillar);
  }));
}
