/* Member Payments Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge, showToast } from '../../components.js';
import { formatDate, formatCurrency, escapeHtml, formatTime, dedupeByKey } from '../../utils.js';
import { attachLiveRefresh } from '../../live-refresh.js';
let mpPage = 1;
let mpTotalPages = 1;
let mpTotal = 0;
let mpPayments = [];
// V6-L25: background (live-refresh) failures used to be silent — toast once
// and stamp the count line with the last good time.
let mpBgErrorShown = false;
let mpLastGoodAt = null;
const mpPaymentKey = (p) => p.id ?? `${p.paid_on || p.created_at || ''}|${p.amount || ''}|${p.reference || ''}`;
export default { async mount(el) {
  mpPage = 1; mpPayments = [];
  await load(el);
  attachLiveRefresh(el, () => load(el, true));
} };
async function load(el, background = false, append = false) {
  if (!background && !append) {
    mpPage = 1; mpPayments = [];
    el.innerHTML = `${renderHeader({title:'My Payments',showBack:true})}<div class="scroll-view" id="mp-list">${renderListSkeleton()}</div>`;
  }
  if (!background && !append) bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  // V5-L22: fetch-then-advance — the old click handler pre-incremented
  // mpPage, then a failed fetch collapsed totalPages to 1 and hid the
  // button, skipping the page forever. The page moves only on success.
  const fetchPage = append ? mpPage + 1 : mpPage;
  let res;
  if (background) {
    const pages = await Promise.all(Array.from({ length: mpPage }, (_, i) =>
      apiRequest(`/api/member/v1/payments?page=${i + 1}&per_page=20`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) {
      // V6-L32: dedupe across the re-fetched pages.
      mpPayments = dedupeByKey(pages.flatMap(r => r.data.payments || []), mpPaymentKey);
    }
  } else {
    res = await apiRequest(`/api/member/v1/payments?page=${fetchPage}&per_page=20`);
    if (res.ok) {
      // V6-L32: dedupe the append — a new payment between page fetches
      // shifts rows and the boundary payment renders twice.
      mpPayments = append
        ? dedupeByKey([...mpPayments, ...(res.data.payments || [])], mpPaymentKey)
        : dedupeByKey(res.data.payments || [], mpPaymentKey);
      mpPage = fetchPage;
    }
  }
  if (el.dataset.screenDisposed === 'true') return;
  if (!res.ok) {
    if (background) {
      if (!mpBgErrorShown) { mpBgErrorShown = true; showToast('Could not refresh your payments — showing the last loaded payments.', 'error'); }
      const countEl = el.querySelector('#mp-count');
      if (countEl && mpLastGoodAt) countEl.textContent = `Showing ${mpPayments.length} of ${mpTotal} payments · last updated ${formatTime(mpLastGoodAt)}`;
      return;
    }
    if (append) { showToast(res.error?.message || 'Could not load more payments.', 'error'); return; }
    const list = el.querySelector('#mp-list');
    if (list) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load payments</div><div class="empty-state-text">${res.error?.message || 'Check your connection and try again.'}</div><button class="btn btn-primary" id="mp-retry" style="margin-top:var(--sp-md)">Try Again</button></div>`;
      list.querySelector('#mp-retry')?.addEventListener('click', () => load(el));
    }
    return;
  }
  mpBgErrorShown = false;
  mpLastGoodAt = new Date();
  const list = el.querySelector('#mp-list');
  const total = res.data.pagination?.total ?? null;
  mpTotal = total ?? mpPayments.length;
  mpTotalPages = res.data.pagination?.total_pages ?? 1;
  const payments = mpPayments;
  if (!Array.isArray(payments)||payments.length===0) { list.innerHTML = renderEmptyState({icon:'wallet',title:'No payments',text:'Your payment history will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${payments.map(p=>`
    <div class="list-item"><div class="list-item-content">
      <div class="list-item-title">${formatCurrency(p.amount)}</div>
      <div class="list-item-subtitle">${escapeHtml(p.method||'')} · ${formatDate(p.paid_on||p.created_at)}</div>
    </div>${renderBadge(p.status||'paid')}</div>`).join('')}</div>
    ${total != null ? `<div id="mp-count" style="text-align:center;font-size:var(--fs-sm);color:var(--muted);padding:var(--sp-sm)">Showing ${payments.length} of ${total} payments</div>` : ''}
    ${mpPage < mpTotalPages ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="mp-more">Load more</button></div>` : ''}
  </div>`;
  // V5-L22: load() advances mpPage itself, only on success.
  list.querySelector('#mp-more')?.addEventListener('click', () => { load(el, false, true); });
}
