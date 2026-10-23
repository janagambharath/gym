/* Member Renewal History Screen
   Per-member records for the owner: current membership, every recorded
   renewal period (from the renewal ledger), and every payment. */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderBadge, renderInfoRow, renderListSkeleton, renderEmptyState, renderErrorState } from '../components.js';
import { escapeHtml, formatDate, formatCurrency, getMemberDisplayStatus, getDaysText } from '../utils.js';

export default {
  async mount(el, params) {
    await load(el, params);
  }
};

async function fetchAllPages(baseUrl, key) {
  const items = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const res = await apiRequest(`${baseUrl}${sep}page=${page}&page_size=100`);
    if (!res.ok) return { ok: false, error: res.error, items };
    const batch = res.data?.[key] || [];
    items.push(...batch);
    total = res.data?.pagination?.total ?? items.length;
    if (batch.length === 0) break;
    page += 1;
  }
  return { ok: true, items };
}

function renderRenewalRow(r) {
  const period = `${formatDate(r.new_start)} → ${formatDate(r.new_end)}`;
  const sub = [period, r.channel].filter(Boolean).join(' · ');
  return `
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(r.plan_name || 'Membership Renewal')}</div>
        <div class="list-item-subtitle">${escapeHtml(sub)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${formatCurrency(r.amount)}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-secondary)">${formatDate(r.created_at)}</span>
      </div>
    </div>`;
}

function renderPaymentRow(p) {
  const sub = [
    p.method,
    formatDate(p.paid_on || p.created_at),
    p.renewal_days ? `${p.renewal_days} days` : null,
    p.reference ? `Ref: ${p.reference}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="list-item" data-payment-id="${p.id}">
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(p.plan_name || 'Payment')}</div>
        <div class="list-item-subtitle">${escapeHtml(sub)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${formatCurrency(p.amount)}</span>
        ${renderBadge(p.status)}
      </div>
    </div>`;
}

async function load(el, params) {
  const memberId = params?.memberId;
  if (!memberId) {
    el.innerHTML = renderErrorState('Member not found');
    return;
  }

  el.innerHTML = `
    ${renderHeader({ title: 'Renewal History', showBack: true })}
    <div class="scroll-view">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });

  const [memberRes, renewalsRes, paymentsRes] = await Promise.all([
    apiRequest(`/api/mobile/v1/members/${memberId}`),
    fetchAllPages(`/api/mobile/v1/renewals?member_id=${memberId}`, 'renewals'),
    fetchAllPages(`/api/mobile/v1/payments?member_id=${memberId}`, 'payments'),
  ]);

  for (const res of [memberRes, renewalsRes, paymentsRes]) {
    if (!res.ok && res.error?.status === 401) return handleLogout();
  }
  if (!memberRes.ok) {
    el.innerHTML = `
      ${renderHeader({ title: 'Renewal History', showBack: true })}
      <div class="scroll-view">${renderErrorState(memberRes.error?.message || 'Member not found')}</div>`;
    bindHeaderEvents(el, { onBack: () => navigate.pop() });
    el.querySelector('#retry-btn')?.addEventListener('click', () => load(el, params));
    return;
  }

  const member = memberRes.data;
  const renewals = renewalsRes.ok ? renewalsRes.items : [];
  const payments = paymentsRes.ok ? paymentsRes.items : [];
  const status = getMemberDisplayStatus(member);
  const daysText = getDaysText(member.days_until_expiry);

  el.innerHTML = `
    ${renderHeader({ title: 'Renewal History', showBack: true })}
    <div class="scroll-view">
      <div class="scroll-content">
        <!-- Current Membership -->
        <div style="padding:var(--sp-lg)">
          <div class="card card-body">
            <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${escapeHtml(member.full_name)}</div>
            ${renderInfoRow('Plan', member.plan?.name || '—')}
            ${renderInfoRow('Period', `${formatDate(member.membership_start)} → ${formatDate(member.membership_end)}`)}
            ${renderInfoRow('Status', renderBadge(status))}
            ${daysText ? renderInfoRow('Days Left', daysText) : ''}
          </div>
        </div>

        <!-- Renewal Periods -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership Renewals${renewals.length ? ` (${renewals.length})` : ''}</div>
          ${!renewalsRes.ok
            ? `<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load renewals.</div>`
            : renewals.length
              ? `<div class="card">${renewals.map(renderRenewalRow).join('')}</div>`
              : `<div style="font-size:var(--fs-sm);color:var(--muted)">No renewals recorded for this member.</div>`}
        </div>

        <!-- Payments -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Payments${payments.length ? ` (${payments.length})` : ''}</div>
          ${!paymentsRes.ok
            ? `<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load payments.</div>`
            : payments.length
              ? `<div class="card">${payments.map(renderPaymentRow).join('')}</div>`
              : renderEmptyState({ icon: 'payments', title: 'No payments', text: `No payments recorded for ${member.full_name}` })}
        </div>
      </div>
    </div>`;

  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  el.querySelectorAll('[data-payment-id]').forEach(row => {
    row.addEventListener('click', () => navigate.push('payment-detail', { paymentId: row.dataset.paymentId }));
  });
}
