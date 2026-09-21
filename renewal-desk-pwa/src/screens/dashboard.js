/* ═══════════════════════════════════════════════════════════════════════
   Dashboard Screen — Full-featured, matching Android app exactly
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest, getCachedSession } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMetricCard, renderSectionHeader, renderMemberCard, renderPaymentCard, renderDashboardSkeleton, renderErrorState, showToast, renderAvatar } from '../components.js';
import { icon } from '../icons.js';
import { formatCurrency, formatInteger, getGreeting, escapeHtml, getDaysText, getMemberDisplayStatus, formatDate } from '../utils.js';

/** @type {import('../router.js').Screen} */
export default {
  async mount(el) {
    const session = getCachedSession();
    const gymName = session?.tenantName || 'Your Gym';
    const userName = session?.userName || '';

    // Initial skeleton
    el.innerHTML = `
      <div class="app-header has-safe-top dash-top-bar">
        <div class="dash-brand-block">
          <img src="/icons/logo.png" alt="Renewal Desk" class="dash-brand-logo">
          <span class="dash-brand-name">Renewal Desk</span>
        </div>
        ${gymName ? `
          <div class="dash-gym-pill">
            ${icon('fitness', 14, 'var(--text-secondary)')}
            <span class="dash-gym-name">${escapeHtml(gymName)}</span>
          </div>
        ` : ''}
        <div class="header-right">
          <button class="header-action" id="dash-notifications-btn" aria-label="Notifications">${icon('notifications', 22)}</button>
          <button class="header-action avatar-action" id="dash-settings-btn" aria-label="Settings">${renderAvatar(userName || gymName, 'sm')}</button>
        </div>
      </div>
      <div class="scroll-view" id="dash-scroll">
        ${renderDashboardSkeleton()}
      </div>`;

    el.querySelector('#dash-notifications-btn')?.addEventListener('click', () => navigate.push('notifications'));
    el.querySelector('#dash-settings-btn')?.addEventListener('click', () => navigate.push('settings'));

    // Fetch data
    await loadDashboard(el);
  }
};

async function loadDashboard(el) {
  const scroll = el.querySelector('#dash-scroll');
  if (!scroll) return;
  const session = getCachedSession();
  const userName = session?.userName || '';

  const [dashRes, upcomingRes, paymentsRes] = await Promise.all([
    apiRequest('/api/mobile/v1/dashboard'),
    apiRequest('/api/mobile/v1/renewals/upcoming'),
    apiRequest('/api/mobile/v1/payments?page_size=5'),
  ]);

  if (!dashRes.ok) {
    scroll.innerHTML = renderErrorState(dashRes.error.message, 'dash-retry');
    scroll.querySelector('#dash-retry')?.addEventListener('click', () => loadDashboard(el));
    if (dashRes.error.status === 401) handleLogout();
    return;
  }

  const data = dashRes.data;
  const upcoming = upcomingRes.ok ? upcomingRes.data.members || [] : [];
  const payments = paymentsRes.ok ? (paymentsRes.data.payments || []) : [];

  scroll.innerHTML = `<div class="scroll-content" style="padding:0">
    <div class="dash-greeting-card">
      <div style="font-size:var(--fs-2xl);font-weight:var(--fw-bold);color:var(--text)">${getGreeting()}, ${escapeHtml(userName.split(' ')[0] || 'there')}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px">Here's the live view of what needs your attention today.</div>
    </div>
    <!-- Metrics Grid -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="metric-grid">
        ${renderMetricCard({ label: 'Active', value: formatInteger(data.total_active), iconName: 'members', color: 'var(--status-active)', bgColor: 'var(--status-active-surface)', onClick: 'members-active' })}
        ${renderMetricCard({ label: 'Expiring Soon', value: formatInteger(data.expiring_soon), iconName: 'warning', color: 'var(--status-expiring)', bgColor: 'var(--status-expiring-surface)', onClick: 'renewals' })}
        ${renderMetricCard({ label: 'Expired', value: formatInteger(data.expired), iconName: 'time', color: 'var(--status-expired)', bgColor: 'var(--status-expired-surface)', onClick: 'members-expired' })}
        ${renderMetricCard({ label: 'Pending Pay', value: formatInteger(data.pending_payments), iconName: 'wallet', color: 'var(--status-pending)', bgColor: 'var(--status-pending-surface)', onClick: 'payments-pending' })}
      </div>
    </div>

    <!-- Revenue Card -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="revenue-card">
        <div class="revenue-card-label">Revenue Today</div>
        <div class="revenue-card-value">${formatCurrency(data.revenue_today || '0')}</div>
        <div class="revenue-breakdown">
          <div class="revenue-breakdown-item">
            <div class="revenue-breakdown-label">This Week</div>
            <div class="revenue-breakdown-value">${formatCurrency(data.revenue_week || '0')}</div>
          </div>
          <div class="revenue-breakdown-item">
            <div class="revenue-breakdown-label">This Month</div>
            <div class="revenue-breakdown-value">${formatCurrency(data.revenue_month || '0')}</div>
          </div>
        </div>
      </div>
    </div>

    ${data.recovery_rate ? `
    <!-- Recovery Rate -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-md)">
          <div>
            <div style="font-size:var(--fs-sm);color:var(--text-secondary)">Revenue at Risk</div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--status-expiring)">${formatCurrency(data.recovery_rate.revenue_at_risk)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:var(--fs-sm);color:var(--text-secondary)">Recovered</div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${formatCurrency(data.recovery_rate.revenue_recovered)}</div>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${Math.min(parseFloat(data.recovery_rate.recovery_rate) || 0, 100)}%;background:var(--success)"></div>
        </div>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:var(--sp-xs);text-align:center">${data.recovery_rate.recovery_rate}% recovery rate</div>
      </div>
    </div>` : ''}

    <!-- Quick Actions -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="quick-actions">
        <button class="quick-action" data-action="add-member">
          <div class="quick-action-icon" style="background:var(--brand-subtle)">${icon('add', 20, 'var(--brand)')}</div>
          <div class="quick-action-label">Add Member</div>
        </button>
        <button class="quick-action" data-action="renew">
          <div class="quick-action-icon" style="background:var(--success-surface)">${icon('renewals', 20, 'var(--success)')}</div>
          <div class="quick-action-label">Renew</div>
        </button>
        <button class="quick-action" data-action="payment">
          <div class="quick-action-icon" style="background:var(--status-pending-surface)">${icon('wallet', 20, 'var(--status-pending)')}</div>
          <div class="quick-action-label">Payment</div>
        </button>
        <button class="quick-action" data-action="whatsapp">
          <div class="quick-action-icon" style="background:#dcfce7">${icon('whatsapp', 20, 'var(--whatsapp)')}</div>
          <div class="quick-action-label">WhatsApp</div>
        </button>
      </div>
    </div>

    ${data.bot_summary && data.bot_summary.handover_count > 0 ? `
    <!-- Handover Alert -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" style="background:var(--warning-surface);border-color:var(--warning-border)" data-action="bot-conversations">
        <div style="display:flex;align-items:center;gap:var(--sp-md)">
          ${icon('chatbubble', 24, 'var(--warning)')}
          <div style="flex:1">
            <div style="font-weight:var(--fw-bold);color:var(--warning-dark)">${data.bot_summary.handover_count} customer${data.bot_summary.handover_count > 1 ? 's' : ''} need attention</div>
            <div style="font-size:var(--fs-sm);color:var(--warning)">AI bot has flagged conversations requiring human response</div>
          </div>
          ${icon('chevronRight', 18, 'var(--warning)')}
        </div>
      </div>
    </div>` : ''}

    ${data.todays_actions && data.todays_actions.length > 0 ? `
    <!-- Today's Actions -->
    ${renderSectionHeader("Today's Actions")}
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      ${data.todays_actions.map(a => `
        <div class="card card-body" style="padding:var(--sp-md) var(--sp-lg);cursor:pointer" data-action="action-${a.type}">
          <div style="display:flex;align-items:center;gap:var(--sp-md)">
            <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">
              ${icon(a.type === 'expiring_today' ? 'warning' : a.type === 'pending_payments' ? 'wallet' : 'person', 18, 'var(--brand)')}
            </div>
            <div style="flex:1">
              <div style="font-weight:var(--fw-semibold)">${escapeHtml(a.label)}</div>
              <div style="font-size:var(--fs-sm);color:var(--brand)">${escapeHtml(a.action)}</div>
            </div>
            <span class="badge badge-pending">${a.count}</span>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Upcoming Renewals -->
    ${upcoming.length > 0 ? `
      ${renderSectionHeader('Upcoming Renewals', 'View All', 'view-all-renewals')}
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${upcoming.slice(0, 5).map(m => renderMemberCard(m)).join('')}
      </div>
    ` : ''}

    <!-- Recent Payments -->
    ${payments.length > 0 ? `
      ${renderSectionHeader('Recent Payments', 'View All', 'view-all-payments')}
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${payments.slice(0, 5).map(p => renderPaymentCard(p)).join('')}
      </div>
    ` : ''}

    ${data.access_summary ? `
    <!-- Access Summary -->
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body" data-action="access">
        <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-md)">
          ${icon('access', 20, 'var(--brand)')}
          <div style="font-weight:var(--fw-bold)">Access Control</div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:var(--sp-xs)">
            <span style="width:8px;height:8px;border-radius:50%;background:${data.access_summary.device_online ? 'var(--success)' : 'var(--muted)'}"></span>
            <span style="font-size:var(--fs-xs);color:var(--muted)">${data.access_summary.device_online ? 'Online' : 'Offline'}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-md);text-align:center">
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--brand)">${data.access_summary.inside_now}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
          </div>
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--success)">${data.access_summary.entries_today}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
          </div>
          <div>
            <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${data.access_summary.exits_today}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
          </div>
        </div>
      </div>
    </div>` : ''}

    <div style="height:var(--sp-xxl)"></div>
  </div>`;

  // Bind click events
  scroll.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      switch (action) {
        case 'add-member': navigate.push('add-member'); break;
        case 'renew': navigate.switchTab('renewals'); break;
        case 'payment': navigate.push('record-payment'); break;
        case 'whatsapp': navigate.push('whatsapp'); break;
        case 'bot-conversations': navigate.push('bot-conversations'); break;
        case 'members-active': navigate.switchTab('members'); break;
        case 'members-expired': navigate.switchTab('members'); break;
        case 'renewals': navigate.switchTab('renewals'); break;
        case 'payments-pending': navigate.switchTab('payments'); break;
        case 'access': navigate.push('access'); break;
        case 'action-expiring_today': navigate.switchTab('renewals'); break;
        case 'action-pending_payments': navigate.switchTab('payments'); break;
        case 'action-new_leads': navigate.push('bot-leads'); break;
      }
    });
  });

  scroll.querySelector('#view-all-renewals')?.addEventListener('click', () => navigate.switchTab('renewals'));
  scroll.querySelector('#view-all-payments')?.addEventListener('click', () => navigate.switchTab('payments'));

  // Member card clicks
  scroll.querySelectorAll('[data-member-id]').forEach(card => {
    card.addEventListener('click', () => {
      const memberId = card.dataset.memberId;
      const member = upcoming.find(m => String(m.id) === memberId);
      if (member) navigate.push('member-detail', { member: JSON.stringify(member) });
    });
  });

  // Payment card clicks
  scroll.querySelectorAll('[data-payment-id]').forEach(card => {
    card.addEventListener('click', () => {
      navigate.push('payment-detail', { paymentId: card.dataset.paymentId });
    });
  });
}
