/* Fast Renewal Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { formatCurrency, escapeHtml } from '../utils.js';
export default { mount(el, params) {
  const p = params || {};
  el.innerHTML = `${renderHeader({ title:'Confirm Renewal', showBack:true })}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl);text-align:center">
    <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${icon('check',32,'var(--success)')}</div>
    <h2 style="margin-bottom:var(--sp-sm)">Renewal Payment</h2>
    <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);margin-bottom:var(--sp-xxl)">${escapeHtml(p.memberName||'Member')} — ${formatCurrency(p.amount||'0')}</p>
    <div class="card card-body" style="text-align:left;margin-bottom:var(--sp-xxl)">
      ${p.planName ? `<div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${escapeHtml(p.planName)}</span></div>` : ''}
      ${p.paymentMethod ? `<div class="info-row"><span class="info-row-label">Method</span><span class="info-row-value">${escapeHtml(p.paymentMethod)}</span></div>` : ''}
      ${p.membershipEnd ? `<div class="info-row"><span class="info-row-label">New Expiry</span><span class="info-row-value">${escapeHtml(p.membershipEnd)}</span></div>` : ''}
    </div>
    <button class="btn btn-success btn-lg btn-full" id="fr-confirm">${icon('check',18,'white')} Confirm Renewal</button>
  </div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  el.querySelector('#fr-confirm')?.addEventListener('click', async () => {
    const r = await apiRequest(`/api/mobile/v1/payments/${p.paymentId}/verify`, { method:'POST' });
    showToast(r.ok?'Renewal confirmed!':r.error.message, r.ok?'success':'error');
    if (r.ok) navigate.pop();
  });
}};
