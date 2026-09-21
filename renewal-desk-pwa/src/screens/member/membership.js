/* Member Membership Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton } from '../../components.js';
import { formatDate, formatCurrency, escapeHtml } from '../../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Membership',showBack:true})}<div class="scroll-view" id="mm-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/member/v1/membership');
  const scroll = el.querySelector('#mm-scroll');
  const d = res.ok ? res.data : {};
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Current Plan</h3>
      ${renderInfoRow('Plan', d.plan_name||'—')}
      ${renderInfoRow('Status', d.status||'—')}
      ${renderInfoRow('Start Date', formatDate(d.start_date))}
      ${renderInfoRow('End Date', formatDate(d.end_date))}
      ${d.days_remaining!=null ? renderInfoRow('Days Left', String(d.days_remaining)) : ''}
    </div></div>
    ${d.history && d.history.length ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Renewal History</h3>
      ${d.history.map(h=>`<div class="info-row"><span class="info-row-label">${formatDate(h.renewed_on||h.start_date)}</span><span class="info-row-value">${escapeHtml(h.plan_name||'—')} — ${formatCurrency(h.amount||'0')}</span></div>`).join('')}
    </div></div>` : ''}
  </div>`;
}};
