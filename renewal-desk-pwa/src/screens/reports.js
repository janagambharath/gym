/* Reports Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderInfoRow } from '../components.js';
import { icon } from '../icons.js'; import { formatCurrency, formatInteger } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Reports',showBack:true})}<div class="scroll-view" id="rpt-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/reports/summary');
  const scroll = el.querySelector('#rpt-scroll');
  if (!res.ok) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${res.error.message}</div></div>`; return; }
  const d = res.data;
  const section = (title, data) => `<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${title}</div>
      ${data.map(([k,v])=>renderInfoRow(k,v)).join('')}</div></div>`;
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${formatInteger(d.total_active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${formatInteger(d.total_expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${formatInteger(d.total_members||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${formatInteger(d.new_members_this_month||0)}</div><div class="metric-card-label">New This Month</div></div>
      </div>
    </div>
    ${section('Revenue', [
      ['Today', formatCurrency(d.revenue_today||'0')],
      ['This Week', formatCurrency(d.revenue_week||'0')],
      ['This Month', formatCurrency(d.revenue_month||'0')],
    ])}
    ${d.renewals ? section('Renewals', [
      ['Renewed This Month', formatInteger(d.renewals.renewed_this_month||0)],
      ['Recovery Rate', (d.renewals.recovery_rate||'0')+'%'],
    ]) : ''}
    ${d.whatsapp ? section('WhatsApp', [
      ['Messages Sent Today', formatInteger(d.whatsapp.sent_today||0)],
      ['Total Sent', formatInteger(d.whatsapp.total_sent||0)],
    ]) : ''}
  </div>`;
}};
