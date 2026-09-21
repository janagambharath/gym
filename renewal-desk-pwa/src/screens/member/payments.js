/* Member Payments Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge } from '../../components.js';
import { formatDate, formatCurrency, escapeHtml } from '../../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'My Payments',showBack:true})}<div class="scroll-view" id="mp-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/member/v1/payments');
  const list = el.querySelector('#mp-list');
  const payments = res.ok ? res.data.payments||res.data||[] : [];
  if (!Array.isArray(payments)||payments.length===0) { list.innerHTML = renderEmptyState({icon:'wallet',title:'No payments',text:'Your payment history will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${payments.map(p=>`
    <div class="list-item"><div class="list-item-content">
      <div class="list-item-title">${formatCurrency(p.amount)}</div>
      <div class="list-item-subtitle">${escapeHtml(p.method||'')} · ${formatDate(p.paid_on||p.created_at)}</div>
    </div>${renderBadge(p.status||'paid')}</div>`).join('')}</div></div>`;
}};
