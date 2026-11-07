/* Payments Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderPaymentCard, renderListSkeleton, renderEmptyState, renderErrorState, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js';
import { formatCurrency, formatInteger, dedupeByKey, formatTime } from '../utils.js';

export default {
  async mount(el) {
    let payments = [], page = 1, total = 0, filter = 'all', loading = false, search = '';

    el.innerHTML = `
      ${renderHeader({ title: 'Payments', showBack: true, actions: [{ icon: 'add', label: 'Record' }] })}
      <div id="pay-summary"></div>
      <div style="padding:0 var(--sp-lg) var(--sp-sm)">
        <input id="pay-search" class="search-input" type="search" placeholder="Search member, amount, reference…" autocomplete="off">
      </div>
      <div class="filter-chips" id="pay-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="pending">Pending</button>
        <button class="filter-chip" data-filter="verified">Verified</button>
        <button class="filter-chip" data-filter="rejected">Rejected</button>
      </div>
      <div class="scroll-view" id="payments-list">${renderListSkeleton()}</div>
      <button class="fab" id="fab-pay">${icon('add', 24, 'white')}</button>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('record-payment') }] });
    el.querySelector('#fab-pay').addEventListener('click', () => navigate.push('record-payment'));
    let searchTimer;
    el.querySelector('#pay-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { search = e.target.value; page = 1; loadPayments(); }, 400);
    });

    el.querySelector('#pay-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filter = chip.dataset.filter; page = 1; payments = [];
      loadPayments();
    });

    let requestId = 0;
    // V6-L25: background (live-refresh) failures used to be silent —
    // toast once and stamp the count line with the last good time.
    let bgErrorShown = false, lastGoodAt = null;
    function stampStale() {
      const countEl = el.querySelector('#pay-count');
      if (countEl && lastGoodAt) countEl.textContent = `Showing ${formatInteger(payments.length)} of ${formatInteger(total)} payment${total !== 1 ? 's' : ''} · last updated ${formatTime(lastGoodAt)}`;
    }
    async function loadPayments(background = false, append = false) {
      if (background && loading) return;
      if (append && (loading || payments.length >= total)) return;
      const id = ++requestId;
      loading = true;
      const listEl = el.querySelector('#payments-list');
      if (!background && !append) listEl.innerHTML = renderListSkeleton();
      // V4-L19: fetch the NEXT page without moving `page` first.
      const fetchPage = append ? page + 1 : page;
      let url = `/api/mobile/v1/payments?page=${fetchPage}&page_size=20`;
      if (filter !== 'all') url += `&status=${filter}`;
      if (search.trim()) url += `&q=${encodeURIComponent(search.trim())}`;
      // Background refresh re-fetches every page loaded so far (like
      // members.js) — refetching only page 1 would drop pages 2+.
      const pageUrls = background
        ? Array.from({ length: fetchPage }, (_, i) => url.replace(`page=${fetchPage}&`, `page=${i + 1}&`))
        : [url];
      const [res, sumRes] = await Promise.all([
        Promise.all(pageUrls.map(u => apiRequest(u))).then(results => {
          const first = results.find(r => !r.ok) || results[0];
          if (!first.ok) return first;
          return { ok: true, data: { payments: results.flatMap(r => r.data.payments || []), pagination: results[0].data.pagination } };
        }),
        page === 1 ? apiRequest('/api/mobile/v1/payments/summary') : Promise.resolve(null),
      ]);
      if (id !== requestId) return;
      loading = false;
      if (!res.ok) {
        if (res.error.status === 401) return handleLogout();
        // V4-L19: an append failure must toast and keep the loaded list —
        // rendering the error state here used to wipe it.
        if (append) { showToast(res.error?.message || 'Could not load more payments.', 'error'); return; }
        if (background) {
          if (!bgErrorShown) { bgErrorShown = true; showToast('Could not refresh the payment list — showing the last loaded payments.', 'error'); }
          stampStale();
          return;
        }
        listEl.innerHTML = renderErrorState(res.error.message);
        // V9-L8: the first-load Try Again button was dead — no #retry-btn
        // binding was ever attached. Bind it to reload the list.
        listEl.querySelector('#retry-btn')?.addEventListener('click', () => loadPayments());
        return;
      }
      bgErrorShown = false;
      lastGoodAt = new Date();
      // V5-M11: dedupe by id — a new payment landing between page fetches
      // shifts rows and the boundary row renders twice (same for the
      // background flatMap over pages 1..N).
      const newPayments = res.data.payments || [];
      payments = append ? dedupeByKey([...payments, ...newPayments], (p) => p.id) : dedupeByKey(newPayments, (p) => p.id);
      total = res.data.pagination?.total ?? payments.length;
      if (append) page = fetchPage;

      if (sumRes?.ok) {
        const s = sumRes.data;
        el.querySelector('#pay-summary').innerHTML = `
          <div style="padding:var(--sp-lg);display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--sp-sm)">
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--success)">${formatCurrency(s.today?.total_collected || '0')}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--status-pending)">${s.pending?.count || 0}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
            </div>
            <div class="card card-body" style="text-align:center;padding:var(--sp-md)">
              <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold)">${formatInteger(s.today?.payment_count || 0)}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
            </div>
          </div>`;
      }

      if (payments.length === 0) {
        listEl.innerHTML = renderEmptyState({ icon: 'payments', title: 'No payments', text: filter !== 'all' ? `No ${filter} payments found` : 'Record your first payment' });
        return;
      }
      const showingAll = payments.length >= total;
      listEl.innerHTML = `<div class="scroll-content">
        <div id="pay-count" style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">Showing ${formatInteger(payments.length)} of ${formatInteger(total)} payment${total !== 1 ? 's' : ''}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${payments.map(p => renderPaymentCard(p)).join('')}</div>
        ${showingAll ? '' : `<div style="padding:var(--sp-lg);text-align:center"><button class="btn btn-secondary" id="pay-more">Load more</button></div>`}
      </div>`;
      listEl.querySelectorAll('[data-payment-id]').forEach(card => {
        card.addEventListener('click', () => navigate.push('payment-detail', { paymentId: card.dataset.paymentId }));
      });
      // V4-L19: loadPayments advances the page itself, only after a
      // successful fetch — pre-incrementing here silently skipped a
      // failed page.
      listEl.querySelector('#pay-more')?.addEventListener('click', () => { loadPayments(false, true); });
    }

    // Infinite scroll: load the next server page as the owner reaches the end.
    el.querySelector('#payments-list').addEventListener('scroll', (e) => {
      const listEl = e.currentTarget;
      if (loading || payments.length >= total) return;
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 200) {
        loadPayments(false, true);
      }
    });

    await loadPayments();
    attachLiveRefresh(el, () => loadPayments(true), 30000, () => clearTimeout(searchTimer));
  }
};
