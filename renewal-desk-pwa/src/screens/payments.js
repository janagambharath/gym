/* ═══════════════════════════════════════════════════════════════════════
   Payments Screen — 1:1 Parity with Renewal Desk Android App
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderPaymentCard, renderListSkeleton, renderEmptyState, renderErrorState, showToast, showConfirm, renderAvatar, renderBadge } from '../components.js';
import { icon } from '../icons.js';
import { formatCurrency, formatInteger, formatDate, escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    let payments = [], page = 1, total = 0, statusFilter = 'all', channelFilter = 'all', searchQuery = '', loading = false;

    el.innerHTML = `
      ${renderHeader({ title: 'Payments', showBack: false, actions: [{ icon: 'add', label: 'Record' }] })}
      <div class="scroll-view" id="payments-scroll">
        <div class="scroll-content">
          <!-- Summary Cards -->
          <div id="pay-summary" style="padding:0 var(--sp-lg) var(--sp-sm)"></div>

          <!-- Search & Filters -->
          <div style="padding:0 var(--sp-lg) var(--sp-sm)">
            <div class="search-box" style="margin-bottom:var(--sp-sm)">
              ${icon('search', 18, 'var(--muted)')}
              <input type="text" class="search-input" id="pay-search-input" placeholder="Search by member or phone...">
            </div>
            <div class="filter-chips" id="pay-status-chips" style="margin-bottom:var(--sp-xs)">
              <button class="filter-chip active" data-filter="all">All</button>
              <button class="filter-chip" data-filter="pending">Pending</button>
              <button class="filter-chip" data-filter="verified">Verified</button>
              <button class="filter-chip" data-filter="rejected">Rejected</button>
            </div>
          </div>

          <!-- Payment List Container -->
          <div id="payments-list" style="padding:0 var(--sp-lg) var(--sp-lg)">
            ${renderListSkeleton()}
          </div>
        </div>
      </div>
      <button class="fab" id="fab-pay" aria-label="Record Payment">${icon('add', 24, '#ffffff')}</button>`;

    bindHeaderEvents(el, {
      onBack: () => navigate.switchTab('dashboard'),
      actions: [{ onClick: () => navigate.push('record-payment') }],
    });

    el.querySelector('#fab-pay')?.addEventListener('click', () => navigate.push('record-payment'));

    // Status filter chips
    el.querySelector('#pay-status-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      el.querySelectorAll('#pay-status-chips .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      statusFilter = chip.dataset.filter;
      page = 1;
      loadPayments();
    });

    // Search input
    let searchTimer;
    el.querySelector('#pay-search-input')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = e.target.value.trim();
        page = 1;
        loadPayments();
      }, 300);
    });

    async function loadPayments() {
      loading = true;
      const listEl = el.querySelector('#payments-list');
      if (!listEl) return;
      listEl.innerHTML = renderListSkeleton();

      let url = `/api/mobile/v1/payments?page=${page}&page_size=20`;
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      if (channelFilter !== 'all') url += `&channel=${channelFilter}`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

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
        const summaryEl = el.querySelector('#pay-summary');
        if (summaryEl) {
          summaryEl.innerHTML = `
            <div class="card card-body" style="padding:var(--sp-md)">
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-sm);text-align:center">
                <div>
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--success)">${formatCurrency(s.today?.total_collected || '0')}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Today</div>
                </div>
                <div style="border-left:1px solid var(--border);border-right:1px solid var(--border)">
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--status-pending)">${s.pending?.count || 0}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Pending</div>
                </div>
                <div>
                  <div style="font-size:var(--fs-xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatInteger(s.today?.payment_count || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Count</div>
                </div>
              </div>
            </div>`;
        }
      }

      if (payments.length === 0) {
        listEl.innerHTML = renderEmptyState({
          icon: 'payments',
          title: 'No payments found',
          text: statusFilter !== 'all' ? `No ${statusFilter} payments matching current filters` : 'Record your first member payment fee collection',
        });
        return;
      }

      listEl.innerHTML = `
        <div style="padding-bottom:var(--sp-xs);font-size:var(--fs-xs);color:var(--muted)">${formatInteger(total)} payment${total !== 1 ? 's' : ''}</div>
        <div class="card">
          ${payments.map(p => {
            const isPending = p.status === 'pending' || p.status === 'processing';
            const isOnline = p.channel === 'online';

            return `
              <div class="list-item" data-payment-id="${p.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:var(--sp-sm);padding:var(--sp-md)">
                <div style="display:flex;align-items:center;gap:var(--sp-md)">
                  ${renderAvatar(p.member_name || 'M', 'md')}
                  <div class="list-item-content">
                    <div style="display:flex;align-items:center;gap:var(--sp-xs)">
                      <span class="list-item-title">${escapeHtml(p.member_name || `Member #${p.member_id}`)}</span>
                      <span class="badge ${isOnline ? 'badge-active' : 'badge-info'}" style="font-size:9px;padding:1px 6px">${isOnline ? 'VYNLA' : 'Counter'}</span>
                    </div>
                    ${p.member_phone ? `<div style="font-size:var(--fs-xs);color:var(--muted)">${escapeHtml(p.member_phone)}</div>` : ''}
                    <div class="list-item-subtitle">${escapeHtml(p.method?.toUpperCase() || 'PAYMENT')} · ${formatDate(p.paid_on || p.created_at)}</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:var(--fs-lg);font-weight:var(--fw-extrabold);color:var(--text)">${formatCurrency(p.amount)}</div>
                    ${renderBadge(p.status)}
                  </div>
                </div>
                ${isPending ? `
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-xs);border-top:1px solid var(--border-light);padding-top:var(--sp-sm)">
                    <button class="btn btn-outline btn-sm" data-action="reject-payment" data-id="${p.id}" style="flex:1;color:var(--critical);border-color:var(--critical-border)">Reject</button>
                    <button class="btn btn-primary btn-sm" data-action="verify-payment" data-id="${p.id}" style="flex:1">Verify Payment</button>
                  </div>
                ` : ''}
              </div>`;
          }).join('')}
        </div>`;

      // Item navigation
      listEl.querySelectorAll('[data-payment-id]').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          navigate.push('payment-detail', { paymentId: card.dataset.paymentId });
        });
      });

      // Quick inline verify / reject
      listEl.querySelectorAll('[data-action="verify-payment"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const pid = btn.dataset.id;
          const yes = await showConfirm({ title: 'Verify Payment', message: 'Verify this payment and renew the member membership?', confirmText: 'Verify' });
          if (!yes) return;
          const res = await apiRequest(`/api/mobile/v1/payments/${pid}/verify`, { method: 'POST' });
          if (res.ok) {
            showToast('Payment verified successfully!', 'success');
            loadPayments();
          } else {
            showToast(res.error?.message || 'Verification failed', 'error');
          }
        });
      });

      listEl.querySelectorAll('[data-action="reject-payment"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const pid = btn.dataset.id;
          const yes = await showConfirm({ title: 'Reject Payment', message: 'Are you sure you want to reject this payment record?', confirmText: 'Reject', destructive: true });
          if (!yes) return;
          const res = await apiRequest(`/api/mobile/v1/payments/${pid}/reject`, { method: 'POST' });
          if (res.ok) {
            showToast('Payment rejected', 'success');
            loadPayments();
          } else {
            showToast(res.error?.message || 'Rejection failed', 'error');
          }
        });
      });
    }

    await loadPayments();
  }
};
