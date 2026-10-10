import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatCurrency } from '../utils.js';
import { icon } from '../icons.js';
import { showToast } from '../components.js';

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading today’s collections…</div>';
  const result = await apiRequest('/api/mobile/v1/owner/finance');
  if (!result.ok) {
    el.innerHTML = `<main class="owner-ops-page"><div class="rrr-empty"><h2>Collections unavailable</h2><p>${escapeHtml(result.error?.message || 'Please try again.')}</p><button id="finance-retry">Retry</button></div></main>`;
    el.querySelector('#finance-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const data = result.data;
  const methods = Object.entries(data.today.by_method || {});
  el.innerHTML = `<main class="rrr-page owner-ops-page">
    <header class="rrr-workspace-bar"><button class="owner-back" id="finance-back">${icon('back', 18)} Dashboard</button></header>
    <section class="owner-page-hero"><div><span class="rrr-eyebrow">OWNER FINANCE</span><h1>Daily collections</h1><p>Reconcile verified payments, cash, and exceptions before the day closes.</p></div><div class="owner-finance-total"><span>Collected today</span><b>${formatCurrency(data.today.total)}</b></div></section>
    <section class="owner-finance-grid"><article class="owner-finance-card"><span>Cash expected</span><b>${formatCurrency(data.today.expected_cash)}</b><small>Verified cash payments</small></article><article class="owner-finance-card"><span>Pending verification</span><b>${formatCurrency(data.pending_verification)}</b><small>Review before closing</small></article><article class="owner-finance-card"><span>Last 7 days</span><b>${formatCurrency(data.last_7_days.total)}</b><small>Verified collections</small></article></section>
    <section class="rrr-panel owner-method-panel"><div class="rrr-panel-head"><div><h2>Today by payment method</h2><p>Only verified payments are included.</p></div></div>${methods.length ? methods.map(([method, value]) => `<div class="owner-method-row"><span>${icon(method === 'cash' ? 'cash' : 'wallet', 18)} ${escapeHtml(method.replace('_', ' '))}</span><b>${formatCurrency(value)}</b></div>`).join('') : '<p class="rrr-no-data">No verified payments recorded today.</p>'}</section>
    <section class="rrr-panel owner-cash-close"><div class="rrr-panel-head"><div><h2>${data.cash_close.closed ? 'Cash close recorded' : 'Close cash for today'}</h2><p>${data.cash_close.closed ? `Counted ${formatCurrency(data.cash_close.counted_cash)} · variance ${formatCurrency(data.cash_close.variance)}` : 'Enter the physical cash counted at the desk. This does not change payment records.'}</p></div></div><form id="cash-close-form" class="owner-close-form"><label>Physical cash counted<input type="number" min="0" step="0.01" required name="counted_cash" value="${data.cash_close.closed ? escapeHtml(data.cash_close.counted_cash) : escapeHtml(data.today.expected_cash)}"></label><label>Notes<textarea rows="2" name="notes" maxlength="1000" placeholder="Optional: float, refund, or variance explanation">${escapeHtml(data.cash_close.notes || '')}</textarea></label><button class="rrr-add-button" type="submit">${data.cash_close.closed ? 'Update cash close' : 'Record cash close'}</button></form></section>
  </main>`;
  el.querySelector('#finance-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelector('#cash-close-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const btn = event.currentTarget.querySelector('[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const form = new FormData(event.currentTarget);
      const response = await apiRequest('/api/mobile/v1/owner/cash-close', { method: 'POST', body: { counted_cash: form.get('counted_cash'), notes: form.get('notes') } });
      if (response.ok) { showToast(`Cash close saved. Variance: ${formatCurrency(response.data.variance)}`, 'success'); await load(el); }
      else showToast(response.error?.message || 'Could not save cash close.', 'error');
    } finally { btn.disabled = false; }
  });
}
