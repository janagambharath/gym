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
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${formatInteger(d.members?.active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${formatInteger(d.members?.expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${formatInteger(d.members?.total||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${formatInteger(d.members?.new||0)}</div><div class="metric-card-label">New in Selected Period</div></div>
      </div>
    </div>
    ${section('Revenue', [
      ['Collected (selected period)', formatCurrency(d.revenue?.collected||'0')],
      ['Pending', formatCurrency(d.revenue?.pending||'0')],
      ['At risk (next 7 days)', formatCurrency(d.revenue?.at_risk||'0')],
    ])}
    ${d.renewals ? section('Renewals', [
      ['Renewals in Selected Period', formatInteger(d.renewals.completed||0)],
      ['Renewal rate (members due in period)', (d.renewals.renewal_rate||'0')+'%'],
    ]) : ''}
    ${d.whatsapp ? section('WhatsApp', [
      ['Messages Sent', formatInteger(d.whatsapp.sent||0)],
      ['Failed Messages', formatInteger(d.whatsapp.failed||0)],
    ]) : ''}
  </div>`;
}};
