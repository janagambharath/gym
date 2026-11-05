/* Member Payments Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge } from '../../components.js';
import { formatDate, formatCurrency, escapeHtml } from '../../utils.js';
import { attachLiveRefresh } from '../../live-refresh.js';
let mpPage = 1;
let mpTotalPages = 1;
let mpPayments = [];
export default { async mount(el) {
  mpPage = 1; mpPayments = [];
  await load(el);
  attachLiveRefresh(el, () => load(el, true));
} };
async function load(el, background = false) {
  if (!background) el.innerHTML = `${renderHeader({title:'My Payments',showBack:true})}<div class="scroll-view" id="mp-list">${renderListSkeleton()}</div>`;
  if (!background) bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  let res;
  if (background) {
    const pages = await Promise.all(Array.from({ length: mpPage }, (_, i) =>
      apiRequest(`/api/member/v1/payments?page=${i + 1}&per_page=20`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) mpPayments = pages.flatMap(r => r.data.payments || []);
  } else {
    res = await apiRequest(`/api/member/v1/payments?page=${mpPage}&per_page=20`);
    if (res.ok) mpPayments = [...mpPayments, ...(res.data.payments || [])];
  }
  if (el.dataset.screenDisposed === 'true' || (background && !res.ok)) return;
  const list = el.querySelector('#mp-list');
  const total = res.ok ? (res.data.pagination?.total ?? null) : null;
  mpTotalPages = res.ok ? (res.data.pagination?.total_pages ?? 1) : 1;
  const payments = mpPayments;
  if (!Array.isArray(payments)||payments.length===0) { list.innerHTML = renderEmptyState({icon:'wallet',title:'No payments',text:'Your payment history will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${payments.map(p=>`
    <div class="list-item"><div class="list-item-content">
      <div class="list-item-title">${formatCurrency(p.amount)}</div>
      <div class="list-item-subtitle">${escapeHtml(p.method||'')} · ${formatDate(p.paid_on||p.created_at)}</div>
    </div>${renderBadge(p.status||'paid')}</div>`).join('')}</div>
    ${total != null ? `<div style="text-align:center;font-size:var(--fs-sm);color:var(--muted);padding:var(--sp-sm)">Showing ${payments.length} of ${total} payments</div>` : ''}
    ${mpPage < mpTotalPages ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="mp-more">Load more</button></div>` : ''}
  </div>`;
  list.querySelector('#mp-more')?.addEventListener('click', () => { mpPage++; load(el); });
}
