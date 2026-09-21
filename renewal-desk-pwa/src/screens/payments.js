/* Payments Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderPaymentCard, renderListSkeleton, renderEmptyState, renderErrorState, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js';
import { formatCurrency, formatInteger } from '../utils.js';

export default {
  async mount(el) {
    let payments = [], page = 1, total = 0, filter = 'all', loading = false;

    el.innerHTML = `
      ${renderHeader({ title: 'Payments', actions: [{ icon: 'add', label: 'Record' }] })}
      <div id="pay-summary"></div>
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

    el.querySelector('#pay-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filter = chip.dataset.filter; page = 1; payments = [];
      loadPayments();
    });

    async function loadPayments() {
      loading = true;
      const listEl = el.querySelector('#payments-list');
      listEl.innerHTML = renderListSkeleton();
      let url = `/api/mobile/v1/payments?page=${page}&page_size=20`;
      if (filter !== 'all') url += `&status=${filter}`;
      const [res, sumRes] = await Promise.all([
        apiRequest(url),
        page === 1 ? apiRequest('/api/mobile/v1/payments/summary') : Promise.resolve(null),
      ]);
      loading = false;
      if (!res.ok) {
        if (res.error.status === 401) return handleLogout();
        listEl.innerHTML = renderErrorState(res.error.message);
        return;
      }
      payments = res.data.payments || [];
      total = res.data.pagination?.total || 0;

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
      listEl.innerHTML = `<div class="scroll-content">
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${formatInteger(total)} payment${total !== 1 ? 's' : ''}</div>
        <div class="card" style="margin:0 var(--sp-lg)">${payments.map(p => renderPaymentCard(p)).join('')}</div>
      </div>`;
      listEl.querySelectorAll('[data-payment-id]').forEach(card => {
        card.addEventListener('click', () => navigate.push('payment-detail', { paymentId: card.dataset.paymentId }));
      });
    }

    await loadPayments();
  }
};
