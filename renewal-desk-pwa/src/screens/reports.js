/* Reports Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderInfoRow } from '../components.js';
import { icon } from '../icons.js'; import { formatCurrency, formatInteger, escapeHtml } from '../utils.js';
const PERIODS = [
  { value: 'today', label: 'Today', windowLabel: 'Today' },
  { value: '7d', label: 'Last 7 days', windowLabel: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days', windowLabel: 'Last 30 days' },
];
export default { async mount(el) {
  let period = '30d';
  el.innerHTML = `${renderHeader({title:'Reports',showBack:true})}
    <div class="filter-chips" id="rpt-periods" style="padding:var(--sp-sm) var(--sp-lg)">
      ${PERIODS.map(p => `<button class="filter-chip ${p.value === period ? 'active' : ''}" data-period="${p.value}">${p.label}</button>`).join('')}
    </div>
    <div class="scroll-view" id="rpt-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#rpt-periods').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-period]');
    if (!chip || chip.dataset.period === period) return;
    period = chip.dataset.period;
    el.querySelectorAll('#rpt-periods .filter-chip').forEach(c => c.classList.toggle('active', c === chip));
    load();
  });
  async function load() {
  const scroll = el.querySelector('#rpt-scroll');
  const res = await apiRequest(`/api/mobile/v1/reports/summary?period=${period}`);
  // V3-L27: the error state had no retry — same pattern as the router retry.
  // V5-L26: the server error message was interpolated into innerHTML
  // unescaped — the only unescaped error interpolation in src/.
  if (!res.ok) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${escapeHtml(res.error.message)}</div><button class="btn btn-primary" id="rpt-retry" style="margin-top:var(--sp-md)">Try Again</button></div>`; scroll.querySelector('#rpt-retry')?.addEventListener('click', load); return; }
  const d = res.data;
  const windowLabel = PERIODS.find(p => p.value === period)?.windowLabel || 'Last 30 days';
  const section = (title, data) => `<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${title}</div>
      ${data.map(([k,v])=>renderInfoRow(k,v)).join('')}</div></div>`;
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${formatInteger(d.members?.active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${formatInteger(d.members?.expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${formatInteger(d.members?.total||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${formatInteger(d.members?.new||0)}</div><div class="metric-card-label">New in ${windowLabel}</div></div>
      </div>
    </div>
    ${section('Revenue', [
      [`Collected (${windowLabel.toLowerCase()})`, formatCurrency(d.revenue?.collected||'0')],
      ['Pending', formatCurrency(d.revenue?.pending||'0')],
      ['At risk (next 7 days)', formatCurrency(d.revenue?.at_risk||'0')],
    ])}
    ${d.renewals ? section('Renewals', [
      [`Renewals in ${windowLabel}`, formatInteger(d.renewals.completed||0)],
      ['Renewal rate (members due in period)', (d.renewals.renewal_rate||'0')+'%'],
    ]) : ''}
    ${d.whatsapp ? section('WhatsApp', [
      ['Messages Sent', formatInteger(d.whatsapp.sent||0)],
      ['Failed Messages', formatInteger(d.whatsapp.failed||0)],
    ]) : ''}
  </div>`;
  }
  await load();
}};
