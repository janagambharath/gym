/* ═══════════════════════════════════════════════════════════════════════
   Dashboard Screen — 1:1 Complete Parity with Renewal Desk Android App
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest, getCachedSession } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderDashboardSkeleton, renderErrorState, renderAvatar, renderBadge } from '../components.js';
import { icon } from '../icons.js';
import { formatCurrency, formatInteger, getGreeting, escapeHtml, getDaysText, getMemberDisplayStatus, formatDate } from '../utils.js';

/** @type {import('../router.js').Screen} */
export default {
  async mount(el) {
    const session = getCachedSession();
    const gymName = session?.tenantName || 'My Gym';
    const userName = session?.userName || '';

    // Initial skeleton header
    el.innerHTML = `
      <div class="app-header has-safe-top dash-top-bar">
        <div class="dash-brand-block">
          <img src="/icons/logo.png" alt="Renewal Desk" class="dash-brand-logo">
          <span class="dash-brand-name">Renewal Desk</span>
        </div>
        ${gymName ? `
          <div class="dash-gym-pill" id="dash-gym-selector">
            ${icon('fitness', 14, 'var(--text-secondary)')}
            <span class="dash-gym-name">${escapeHtml(gymName)}</span>
            ${icon('forward', 12, 'var(--muted)')}
          </div>
        ` : ''}
        <div class="header-right">
          <button class="header-action" id="dash-notifications-btn" aria-label="Notifications" style="position:relative">
            ${icon('notifications', 22)}
            <span class="notification-dot" id="dash-notification-dot" style="display:none"></span>
          </button>
          <button class="header-action avatar-action" id="dash-settings-btn" aria-label="Settings">${renderAvatar(userName || gymName, 'sm')}</button>
        </div>
      </div>
      <div class="scroll-view" id="dash-scroll">
        ${renderDashboardSkeleton()}
      </div>`;

    el.querySelector('#dash-notifications-btn')?.addEventListener('click', () => navigate.push('notifications'));
    el.querySelector('#dash-settings-btn')?.addEventListener('click', () => navigate.push('settings'));
    el.querySelector('#dash-gym-selector')?.addEventListener('click', () => navigate.push('settings'));

    // Fetch live dashboard & onboarding data
    await loadDashboard(el);
  }
};

async function loadDashboard(el) {
  const scroll = el.querySelector('#dash-scroll');
  if (!scroll) return;
  const session = getCachedSession();
  const userName = session?.userName || '';

  const [dashRes, upcomingRes, paymentsRes, onboardingRes] = await Promise.all([
    apiRequest('/api/mobile/v1/dashboard'),
    apiRequest('/api/mobile/v1/renewals/upcoming'),
    apiRequest('/api/mobile/v1/payments?page_size=5'),
    apiRequest('/api/mobile/v1/onboarding/progress'),
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
  const onboarding = onboardingRes.ok ? onboardingRes.data : null;

  const hasAttention = Boolean(
    data && (data.expiring_soon > 0 || data.pending_payments > 0 || data.expired > 0 || (data.bot_summary?.handover_count ?? 0) > 0)
  );

  // Show / hide notification dot
  const dotEl = el.querySelector('#dash-notification-dot');
  if (dotEl) dotEl.style.display = hasAttention ? 'block' : 'none';

  let html = `<div class="scroll-content">`;

  // 1. Greeting
  html += `
    <div class="dash-greeting-card">
      <div style="font-size:var(--fs-2xl);font-weight:var(--fw-bold);color:var(--text)">${getGreeting()}, ${escapeHtml(userName.split(' ')[0] || 'there')}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px">Here's the live view of what needs your attention today.</div>
    </div>`;

  // 2. 🚀 First Action Hero for New Gyms (when total_active === 0)
  if (data.total_active === 0) {
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="first-action-card">
        <div class="first-action-header">
          <div class="first-action-badge">
            ${icon('flash', 12, '#ffffff')}
            <span>GET STARTED</span>
          </div>
          <div class="first-action-title">Bring Your Members In</div>
        </div>
        <div class="first-action-sub">
          Import spreadsheets, scan paper registers, or add members to track upcoming expiries, prevent churn, and collect fees.
        </div>
        <div class="first-action-buttons">
          <button class="first-action-primary-btn" id="hero-import-btn">
            ${icon('upload', 16, '#ffffff')}
            <span>Import Existing Members (Excel / CSV)</span>
          </button>
          <div class="first-action-secondary-row">
            <button class="first-action-secondary-btn" id="hero-scan-btn">
              ${icon('camera', 15, 'var(--brand)')}
              <span>Scan Records</span>
            </button>
            <button class="first-action-secondary-btn" id="hero-add-btn">
              ${icon('add', 15, 'var(--text)')}
              <span>Add Manually</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // 3. 📋 Onboarding Setup Checklist Card
  if (onboarding && !onboarding.is_complete && onboarding.steps && onboarding.steps.length > 0) {
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="onboarding-card" id="onboarding-card">
        <div class="onboarding-header" id="onboarding-toggle" style="cursor:pointer">
          <div class="onboarding-header-left">
            <div class="onboarding-progress-badge">${onboarding.percentage}%</div>
            <div>
              <div style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Set Up Your Gym</div>
              <div style="font-size:var(--fs-xs);color:var(--text-secondary)">${onboarding.completed_count} of ${onboarding.total_count} steps completed</div>
            </div>
          </div>
          <div class="expand-icon-circle" id="onboarding-chevron">
            ${icon('chevronDown', 18, 'var(--text-secondary)')}
          </div>
        </div>
        <div class="onboarding-progress-bg">
          <div class="onboarding-progress-fill" style="width:${Math.max(onboarding.percentage, 5)}%"></div>
        </div>
        <div class="onboarding-steps" id="onboarding-steps-list">
          ${onboarding.steps.map(step => `
            <div class="onboarding-step-row ${step.completed ? 'completed' : ''}" data-step-route="${escapeHtml(step.route || '')}">
              <div class="onboarding-step-icon">
                ${step.completed ? icon('check', 16, 'var(--success)') : icon('time', 16, 'var(--muted)')}
              </div>
              <div class="onboarding-step-copy">
                <div class="onboarding-step-title ${step.completed ? 'title-completed' : ''}">${escapeHtml(step.title)}</div>
                ${!step.completed && step.description ? `<div class="onboarding-step-desc">${escapeHtml(step.description)}</div>` : ''}
              </div>
              ${!step.completed && step.action_label ? `<div class="onboarding-step-action-badge">${escapeHtml(step.action_label)}</div>` : ''}
              ${!step.completed && step.route ? `<div style="margin-left:4px">${icon('forward', 14, 'var(--brand)')}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  // 4. 🚨 Urgent Staff Handover Alert Box
  if (data.bot_summary?.recent_handovers && data.bot_summary.recent_handovers.length > 0) {
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="handover-alert-card">
        <div class="handover-alert-header">
          <div class="handover-badge">
            ${icon('alert', 14, 'var(--critical)')}
            <span>${data.bot_summary.handover_count} STAFF HANDOVER${data.bot_summary.handover_count > 1 ? 'S' : ''} WAITING</span>
          </div>
          <button class="handover-view-all" id="btn-view-all-handovers">View All Chats →</button>
        </div>
        <div class="handover-alert-title">Prospective customers asked to speak with staff</div>
        <div class="handover-list">
          ${data.bot_summary.recent_handovers.map(h => `
            <div class="handover-item" data-action="open-chat" data-convo-id="${h.id}">
              ${renderAvatar(h.customer_name || 'Customer', 'sm')}
              <div class="handover-info">
                <div class="handover-name-row">
                  <span class="handover-name">${escapeHtml(h.customer_name || 'Visitor')}</span>
                  <span class="handover-phone">+${escapeHtml(h.phone || '')}</span>
                </div>
                <div class="handover-message">“${escapeHtml(h.last_message || '')}”</div>
              </div>
              <div class="handover-action-btn">
                <span>Reply</span>
                ${icon('forward', 12, 'var(--brand)')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  // 5. 💰 Revenue Recovery Hero Card (Signature Metric)
  if (data.total_active > 0) {
    const riskAmount = data.revenue_at_risk || data.recovery_rate?.revenue_at_risk || '0';
    const recoveredAmount = data.revenue_recovered?.total_amount || data.recovery_rate?.revenue_recovered || '0';
    const ratePercent = data.recovery_rate?.recovery_rate ?? '0';

    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="revenue-hero-card">
        <div class="revenue-hero-header">
          <div class="revenue-hero-badge">
            ${icon('cash', 12, '#ffffff')}
            <span>REVENUE RECOVERY</span>
          </div>
        </div>
        <div class="revenue-hero-row">
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">At Risk</div>
            <div class="revenue-hero-value" style="color:var(--critical)">${formatCurrency(riskAmount)}</div>
          </div>
          <div class="revenue-hero-divider"></div>
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">Recovered (30d)</div>
            <div class="revenue-hero-value" style="color:var(--success)">${formatCurrency(recoveredAmount)}</div>
          </div>
          <div class="revenue-hero-divider"></div>
          <div class="revenue-hero-stat">
            <div class="revenue-hero-label">Rate</div>
            <div class="revenue-hero-value" style="color:var(--brand)">${ratePercent}%</div>
          </div>
        </div>
        ${data.latest_campaign ? `
          <div class="campaign-callout">
            ${icon('target', 14, 'var(--brand)')}
            <div class="campaign-callout-text">
              Last campaign "${escapeHtml(data.latest_campaign.name)}" → ${data.latest_campaign.total_renewed} renewed
              ${parseFloat(data.latest_campaign.total_revenue_recovered || '0') > 0 ? ` · ${formatCurrency(data.latest_campaign.total_revenue_recovered)}` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    </div>`;
  }

  // 6. ⚡ Today's Actions
  if (data.todays_actions && data.todays_actions.length > 0) {
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="today-actions-card">
        <div class="section-header-compact">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${icon('flash', 18, 'var(--warning)')}
            <span>Today's Actions</span>
          </div>
        </div>
        <div style="margin-top:var(--sp-xs)">
          ${data.todays_actions.map(action => {
            const dotColor = action.type === 'expiring_today' ? 'var(--critical)' : action.type === 'pending_payments' ? 'var(--warning)' : 'var(--brand)';
            return `
              <div class="today-action-item" data-action="today-${escapeHtml(action.action || action.type)}">
                <div class="today-action-dot" style="background:${dotColor}"></div>
                <div class="today-action-label">${escapeHtml(action.label)}</div>
                ${action.count ? `<span class="badge badge-pending" style="margin-right:var(--sp-xs)">${action.count}</span>` : ''}
                ${icon('forward', 14, 'var(--muted)')}
              </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  // 7. Revenue Collected Overview
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-md)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${icon('cash', 18, 'var(--success)')}
          <span>Revenue Collected</span>
        </div>
        <div class="period-pill">Live totals</div>
      </div>
      <div class="revenue-grid-3">
        <div class="revenue-item">
          <div class="revenue-sublabel">Today</div>
          <div class="revenue-mainvalue">${formatCurrency(data.revenue_today || '0')}</div>
        </div>
        <div class="revenue-item bordered">
          <div class="revenue-sublabel">This Week</div>
          <div class="revenue-mainvalue">${formatCurrency(data.revenue_week || '0')}</div>
        </div>
        <div class="revenue-item bordered">
          <div class="revenue-sublabel">This Month</div>
          <div class="revenue-mainvalue">${formatCurrency(data.revenue_month || '0')}</div>
        </div>
      </div>
      ${data.revenue_today === '0' && data.revenue_week === '0' && data.revenue_month === '0' ? `
        <div style="font-size:var(--fs-xs);color:var(--muted);text-align:center;margin-top:var(--sp-sm)">
          No payments recorded yet. Live totals will update as member fee collections are verified.
        </div>
      ` : ''}
      ${data.revenue_at_risk && Number(data.revenue_at_risk) > 0 ? `
        <div class="revenue-at-risk-banner" id="risk-banner" style="cursor:pointer">
          <div class="risk-icon-wrap">
            ${icon('warning', 16, 'var(--critical)')}
          </div>
          <div class="risk-text-wrap">
            <div class="risk-label">Revenue at Risk (7 Days)</div>
            <div class="risk-subtext">${data.expiring_soon || 0} memberships expiring soon</div>
          </div>
          <div class="risk-amount">${formatCurrency(data.revenue_at_risk)}</div>
        </div>
      ` : ''}
    </div>
  </div>`;

  // 8. Key Metrics 2x2 Balanced Grid
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="metric-grid">
      <div class="metric-card" data-action="members-active" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--brand-subtle)">${icon('members', 18, 'var(--brand)')}</div>
        <div class="metric-label">Active Members</div>
        <div class="metric-value">${formatInteger(data.total_active || 0)}</div>
        <div class="metric-detail">${data.total_active === 0 ? 'No members added yet' : 'Current total'}</div>
      </div>
      <div class="metric-card" data-action="renewals" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-expiring-surface)">${icon('time', 18, 'var(--status-expiring)')}</div>
        <div class="metric-label">Expiring Soon</div>
        <div class="metric-value">${formatInteger(data.expiring_soon || 0)}</div>
        <div class="metric-detail" style="color:var(--status-expiring)">${data.expiring_today ? `${data.expiring_today} today` : (data.expiring_soon > 0 ? 'Next 7 days' : 'None expiring')}</div>
      </div>
      <div class="metric-card" data-action="members-expired" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-expired-surface)">${icon('alert', 18, 'var(--status-expired)')}</div>
        <div class="metric-label">Expired</div>
        <div class="metric-value">${formatInteger(data.expired || 0)}</div>
        <div class="metric-detail" style="color:var(--status-expired)">${data.expired > 0 ? 'Need attention' : 'None expired'}</div>
      </div>
      <div class="metric-card" data-action="payments-pending" style="cursor:pointer">
        <div class="metric-icon" style="background:var(--status-pending-surface)">${icon('wallet', 18, 'var(--status-pending)')}</div>
        <div class="metric-label">Pending Payments</div>
        <div class="metric-value">${formatInteger(data.pending_payments || 0)}</div>
        <div class="metric-detail" style="color:var(--status-pending)">${data.pending_payments > 0 ? 'Awaiting review' : 'All clear'}</div>
      </div>
    </div>
  </div>`;

  // 9. 🟢 Live Access Card
  if (data.access_summary) {
    const acc = data.access_summary;
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${icon('access', 18, 'var(--brand)')}
            <span>Live Access</span>
          </div>
          <button class="section-action-btn" id="btn-view-access-feed">View Feed →</button>
        </div>
        <div class="access-device-status-row">
          <span class="device-dot" style="background:${acc.device_online ? 'var(--success)' : 'var(--muted)'}"></span>
          <span style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)">
            ${escapeHtml(acc.device_name || 'Biometric Device')}: ${acc.device_online ? 'Online' : 'Offline'}
          </span>
          ${acc.last_event_at ? `
            <span style="font-size:var(--fs-xs);color:var(--muted);margin-left:auto">
              Last scan ${new Date(acc.last_event_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          ` : ''}
        </div>
        <div class="access-stats-grid">
          <div class="access-tile" id="access-tile-inside" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--success)">${acc.inside_now ?? 0}</div>
            <div class="access-tile-label">Inside Now</div>
          </div>
          <div class="access-tile bordered" id="access-tile-entries" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--brand)">${acc.entries_today ?? 0}</div>
            <div class="access-tile-label">Entries Today</div>
          </div>
          <div class="access-tile bordered" id="access-tile-exits" style="cursor:pointer">
            <div class="access-tile-value" style="color:var(--warning)">${acc.exits_today ?? 0}</div>
            <div class="access-tile-label">Exits Today</div>
          </div>
          ${acc.denied_today > 0 ? `
            <div class="access-tile bordered" id="access-tile-denied" style="cursor:pointer">
              <div class="access-tile-value" style="color:var(--critical)">${acc.denied_today}</div>
              <div class="access-tile-label">Denied</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>`;
  }

  // 10. Inbound Leads & WhatsApp AI Card
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${icon('robot', 18, 'var(--brand)')}
          <span>Inbound Leads & AI Bot</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-leads">View All Leads →</button>
      </div>
      <div class="leads-stats-row">
        <div class="lead-stat-tile" id="lead-stat-total" style="cursor:pointer">
          <div class="lead-stat-val">${data.bot_summary?.total_leads ?? 0}</div>
          <div class="lead-stat-lbl">Total Leads</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-new" style="cursor:pointer">
          <div class="lead-stat-val" style="color:var(--brand)">${data.bot_summary?.new_leads ?? 0}</div>
          <div class="lead-stat-lbl">New Inquiries</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-trials" style="cursor:pointer">
          <div class="lead-stat-val" style="color:var(--success)">${data.bot_summary?.trial_requests ?? 0}</div>
          <div class="lead-stat-lbl">Free Trials</div>
        </div>
        <div class="lead-stat-tile bordered" id="lead-stat-handovers" style="cursor:pointer">
          <div class="lead-stat-val" style="color:${(data.bot_summary?.handover_count ?? 0) > 0 ? 'var(--critical)' : 'var(--text-secondary)'}">
            ${data.bot_summary?.handover_count ?? 0}
          </div>
          <div class="lead-stat-lbl">Handovers</div>
        </div>
      </div>
      <div class="leads-actions-row">
        <button class="btn btn-outline btn-sm" id="btn-open-ai-chats" style="flex:1">
          ${icon('chatbubble', 16, 'var(--brand)')}
          <span>Open AI Chats</span>
        </button>
        <button class="btn btn-primary btn-sm" id="btn-open-broadcast" style="flex:1">
          ${icon('send', 16, '#ffffff')}
          <span>Broadcast / WhatsApp</span>
        </button>
      </div>
    </div>
  </div>`;

  // 11. Attention Required
  if (data.expiring_soon > 0 || data.pending_payments > 0 || data.expired > 0) {
    html += `
    <div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div class="card card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
            ${icon('warning', 18, 'var(--status-expiring)')}
            <span>Attention Required</span>
          </div>
          <button class="section-action-btn" id="btn-view-all-attention">View all →</button>
        </div>
        <div class="attention-grid">
          ${data.expiring_soon > 0 ? `
            <div class="attention-tile" id="attention-tile-expiring" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-expiring)">${data.expiring_soon}</div>
              <div class="attention-lbl">Expiring soon</div>
              ${icon('forward', 12, 'var(--muted)')}
            </div>
          ` : ''}
          ${data.pending_payments > 0 ? `
            <div class="attention-tile" id="attention-tile-pending" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-pending)">${data.pending_payments}</div>
              <div class="attention-lbl">Pending payments</div>
              ${icon('forward', 12, 'var(--muted)')}
            </div>
          ` : ''}
          ${data.expired > 0 ? `
            <div class="attention-tile" id="attention-tile-expired" style="cursor:pointer">
              <div class="attention-val" style="color:var(--status-expired)">${data.expired}</div>
              <div class="attention-lbl">Expired members</div>
              ${icon('forward', 12, 'var(--muted)')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>`;
  }

  // 12. Upcoming Renewals Card
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${icon('renewals', 18, 'var(--brand)')}
          <span>Upcoming Renewals</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-renewals">View All →</button>
      </div>
      ${upcoming.length > 0 ? `
        <div class="upcoming-list">
          ${upcoming.slice(0, 5).map(m => {
            const daysText = getDaysText(m.days_until_expiry);
            return `
              <div class="upcoming-row-item">
                <div class="upcoming-row-main" data-member-id="${m.id}" style="cursor:pointer">
                  ${renderAvatar(m.full_name, 'md')}
                  <div class="upcoming-info">
                    <div class="upcoming-name">${escapeHtml(m.full_name)}</div>
                    <div class="upcoming-detail">${escapeHtml(m.plan?.name || 'Plan not set')} ${m.plan?.duration_days ? `· ${m.plan.duration_days}d` : ''}</div>
                  </div>
                  <div class="upcoming-right">
                    <div class="upcoming-date">${formatDate(m.membership_end)}</div>
                    ${daysText ? `<div class="upcoming-days">${daysText}</div>` : ''}
                    ${renderBadge(getMemberDisplayStatus(m))}
                  </div>
                </div>
                <button class="upcoming-renew-btn" data-renew-member='${escapeHtml(JSON.stringify(m))}'>Renew</button>
              </div>`;
          }).join('')}
        </div>
      ` : `
        <div class="empty-card-box">
          <div class="empty-card-title">No memberships expiring in the next 7 days</div>
          <div class="empty-card-sub">When member expiries approach, they will appear here with 1-tap renewal actions.</div>
        </div>
      `}
    </div>
  </div>`;

  // 13. Recent Payments Card
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-sm)">
        <div style="display:flex;align-items:center;gap:var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-base)">
          ${icon('cash', 18, 'var(--brand)')}
          <span>Recent Payments</span>
        </div>
        <button class="section-action-btn" id="btn-view-all-payments">View All →</button>
      </div>
      ${payments.length > 0 ? `
        <div class="payments-list">
          ${payments.slice(0, 5).map(p => `
            <div class="dash-payment-row" data-payment-id="${p.id}" style="cursor:pointer">
              ${renderAvatar(p.member_name || 'M', 'md')}
              <div class="dash-payment-info">
                <div class="dash-payment-name">${escapeHtml(p.member_name || `Member #${p.member_id}`)}</div>
                <div class="dash-payment-detail">${escapeHtml(p.method?.toUpperCase() || 'PAYMENT')} · ${formatDate(p.paid_on || p.created_at)}</div>
              </div>
              <div class="dash-payment-right">
                <div class="dash-payment-amount">${formatCurrency(p.amount)}</div>
                ${renderBadge(p.status)}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-card-box">
          <div class="empty-card-title">No payments recorded yet</div>
          <div class="empty-card-sub">Tap Payment below to record your first member fee collection.</div>
        </div>
      `}
    </div>
  </div>`;

  // 14. Quick Actions Card
  html += `
  <div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="quick-actions-card">
      <div class="quick-actions-row">
        <button class="quick-action-tile" id="qa-add-member">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${icon('add', 21, 'var(--brand)')}
          </div>
          <span class="quick-action-text">Add Member</span>
        </button>
        <button class="quick-action-tile" id="qa-renew">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${icon('renewals', 21, 'var(--brand)')}
          </div>
          <span class="quick-action-text">Renew</span>
        </button>
        <button class="quick-action-tile" id="qa-payment">
          <div class="quick-action-icon-wrap" style="background:var(--brand-subtle);color:var(--brand)">
            ${icon('wallet', 21, 'var(--brand)')}
          </div>
          <span class="quick-action-text">Payment</span>
        </button>
        <button class="quick-action-tile" id="qa-whatsapp">
          <div class="quick-action-icon-wrap" style="background:#dcfce7;color:var(--whatsapp)">
            ${icon('whatsapp', 21, 'var(--whatsapp)')}
          </div>
          <span class="quick-action-text">WhatsApp</span>
        </button>
      </div>
    </div>
  </div>`;

  html += `</div>`; // Close scroll-content
  scroll.innerHTML = html;

  // ─── Bind Events ───────────────────────────────────────────────────

  // Hero new gym buttons
  el.querySelector('#hero-import-btn')?.addEventListener('click', () => navigate.push('import-members'));
  el.querySelector('#hero-scan-btn')?.addEventListener('click', () => navigate.push('member-scan'));
  el.querySelector('#hero-add-btn')?.addEventListener('click', () => navigate.push('add-member'));

  // Onboarding toggle & steps
  const onboardingCard = el.querySelector('#onboarding-card');
  const toggleBtn = el.querySelector('#onboarding-toggle');
  const stepsList = el.querySelector('#onboarding-steps-list');
  const chevron = el.querySelector('#onboarding-chevron');

  toggleBtn?.addEventListener('click', () => {
    const isHidden = stepsList?.style.display === 'none';
    if (stepsList) stepsList.style.display = isHidden ? 'block' : 'none';
    if (chevron) chevron.innerHTML = isHidden ? icon('chevronUp', 18, 'var(--text-secondary)') : icon('chevronDown', 18, 'var(--text-secondary)');
  });

  el.querySelectorAll('[data-step-route]').forEach(row => {
    row.addEventListener('click', () => {
      const route = row.dataset.stepRoute;
      if (!route) return;
      if (route === 'Subscription') navigate.push('subscription');
      else if (route === 'Settings') navigate.push('settings');
      else if (route === 'Plans') navigate.push('plans');
      else if (route === 'Members') navigate.push('import-members');
      else if (route === 'WhatsApp') navigate.push('whatsapp');
      else if (route === 'PaymentSetup') navigate.push('payment-setup');
      else if (route === 'Renewals') navigate.push('record-payment');
      else if (route === 'Bot') navigate.push('bot-overview');
    });
  });

  // Handovers
  el.querySelector('#btn-view-all-handovers')?.addEventListener('click', () => navigate.push('bot-conversations'));
  el.querySelectorAll('[data-action="open-chat"]').forEach(item => {
    item.addEventListener('click', () => navigate.push('bot-conversations'));
  });

  // Today's actions
  el.querySelectorAll('[data-action^="today-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.action.replace('today-', '');
      if (act === 'renewals' || act === 'expiring_today') navigate.switchTab('renewals');
      else if (act === 'payments' || act === 'pending_payments') navigate.switchTab('payments');
      else if (act === 'inbox' || act === 'new_leads') navigate.push('inbox');
      else navigate.switchTab('renewals');
    });
  });

  // Risk banner
  el.querySelector('#risk-banner')?.addEventListener('click', () => navigate.switchTab('renewals'));

  // Metrics clicks
  el.querySelector('[data-action="members-active"]')?.addEventListener('click', () => navigate.switchTab('members'));
  el.querySelector('[data-action="renewals"]')?.addEventListener('click', () => navigate.switchTab('renewals'));
  el.querySelector('[data-action="members-expired"]')?.addEventListener('click', () => navigate.switchTab('members'));
  el.querySelector('[data-action="payments-pending"]')?.addEventListener('click', () => navigate.switchTab('payments'));

  // Live access feed
  el.querySelector('#btn-view-access-feed')?.addEventListener('click', () => navigate.switchTab('access'));
  el.querySelector('#access-tile-inside')?.addEventListener('click', () => navigate.switchTab('access'));
  el.querySelector('#access-tile-entries')?.addEventListener('click', () => navigate.switchTab('access'));
  el.querySelector('#access-tile-exits')?.addEventListener('click', () => navigate.switchTab('access'));
  el.querySelector('#access-tile-denied')?.addEventListener('click', () => navigate.switchTab('access'));

  // Leads & AI Bot
  el.querySelector('#btn-view-all-leads')?.addEventListener('click', () => navigate.push('bot-leads'));
  el.querySelector('#lead-stat-total')?.addEventListener('click', () => navigate.push('bot-leads'));
  el.querySelector('#lead-stat-new')?.addEventListener('click', () => navigate.push('bot-leads'));
  el.querySelector('#lead-stat-trials')?.addEventListener('click', () => navigate.push('bot-leads'));
  el.querySelector('#lead-stat-handovers')?.addEventListener('click', () => navigate.push('bot-conversations'));
  el.querySelector('#btn-open-ai-chats')?.addEventListener('click', () => navigate.push('bot-conversations'));
  el.querySelector('#btn-open-broadcast')?.addEventListener('click', () => navigate.push('whatsapp'));

  // Attention required
  el.querySelector('#btn-view-all-attention')?.addEventListener('click', () => navigate.switchTab('renewals'));
  el.querySelector('#attention-tile-expiring')?.addEventListener('click', () => navigate.switchTab('renewals'));
  el.querySelector('#attention-tile-pending')?.addEventListener('click', () => navigate.switchTab('payments'));
  el.querySelector('#attention-tile-expired')?.addEventListener('click', () => navigate.switchTab('renewals'));

  // Upcoming renewals
  el.querySelector('#btn-view-all-renewals')?.addEventListener('click', () => navigate.switchTab('renewals'));
  el.querySelectorAll('.upcoming-row-main').forEach(row => {
    row.addEventListener('click', () => {
      const memberId = row.dataset.memberId;
      if (memberId) navigate.push('member-detail', { member: JSON.stringify({ id: memberId }) });
    });
  });
  el.querySelectorAll('[data-renew-member]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate.push('renew-member', { member: btn.dataset.renewMember });
    });
  });

  // Recent payments
  el.querySelector('#btn-view-all-payments')?.addEventListener('click', () => navigate.switchTab('payments'));
  el.querySelectorAll('.dash-payment-row').forEach(row => {
    row.addEventListener('click', () => {
      const paymentId = row.dataset.paymentId;
      if (paymentId) navigate.push('payment-detail', { paymentId });
    });
  });

  // Quick actions
  el.querySelector('#qa-add-member')?.addEventListener('click', () => navigate.push('add-member'));
  el.querySelector('#qa-renew')?.addEventListener('click', () => navigate.switchTab('renewals'));
  el.querySelector('#qa-payment')?.addEventListener('click', () => navigate.push('record-payment'));
  el.querySelector('#qa-whatsapp')?.addEventListener('click', () => navigate.push('whatsapp'));
}
