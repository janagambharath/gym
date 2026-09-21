/* Subscription Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton } from '../components.js';
import { icon } from '../icons.js'; import { formatDate, formatCurrency, escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Subscription',showBack:true})}<div class="scroll-view" id="sub-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/billing');
  const scroll = el.querySelector('#sub-scroll');
  if (!res.ok) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load subscription</div></div>`; return; }
  const s = res.data;
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${icon('star',28,'var(--brand)')}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${escapeHtml(s.plan_name||s.plan||'Free')}</h3>
      ${renderBadge(s.status||'active')}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Status', s.status||'active')}
      ${s.current_period_end ? renderInfoRow('Next Billing', formatDate(s.current_period_end)) : ''}
      ${s.member_limit ? renderInfoRow('Member Limit', String(s.member_limit)) : ''}
      ${s.members_used != null ? renderInfoRow('Members Used', String(s.members_used)) : ''}
      ${s.amount ? renderInfoRow('Amount', formatCurrency(s.amount)) : ''}
    </div></div>
  </div>`;
}};
