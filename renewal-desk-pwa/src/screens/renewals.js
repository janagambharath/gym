/* ═══════════════════════════════════════════════════════════════════════
   Renewals Screen — 1:1 Parity with Renewal Desk Android App
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderErrorState, renderAvatar, renderBadge } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatDate, getDaysText, getMemberDisplayStatus } from '../utils.js';

export default {
  async mount(el) {
    el.innerHTML = `
      ${renderHeader({ title: 'Renewals', showBack: false, actions: [{ icon: 'megaphone', label: 'Campaigns' }] })}
      <div class="scroll-view" id="renewals-scroll">
        <div class="scroll-content" id="renewals-content">
          ${renderListSkeleton()}
        </div>
      </div>`;

    bindHeaderEvents(el, {
      onBack: () => navigate.switchTab('dashboard'),
      actions: [{ onClick: () => navigate.push('campaigns') }],
    });

    const [upRes, expRes] = await Promise.all([
      apiRequest('/api/mobile/v1/renewals/upcoming'),
      apiRequest('/api/mobile/v1/renewals/expired'),
    ]);

    const content = el.querySelector('#renewals-content');
    if (!content) return;

    if (!upRes.ok && !expRes.ok) {
      if (upRes.error?.status === 401 || expRes.error?.status === 401) return handleLogout();
      content.innerHTML = renderErrorState(upRes.error?.message || 'Failed to load renewals');
      return;
    }

    const upcoming = upRes.ok ? (upRes.data.members || []) : [];
    const expired = expRes.ok ? (expRes.data.members || []) : [];

    // Split upcoming into "today" and "next 7 days"
    const today = upcoming.filter(m => m.days_until_expiry !== null && m.days_until_expiry <= 0);
    const thisWeek = upcoming.filter(m => m.days_until_expiry !== null && m.days_until_expiry > 0);

    const totalCount = today.length + thisWeek.length + expired.length;

    if (totalCount === 0) {
      content.innerHTML = renderEmptyState({
        icon: 'check',
        title: 'All caught up!',
        text: 'No upcoming renewals or expired memberships at the moment.',
      });
      return;
    }

    let html = `
      <div style="padding:0 var(--sp-lg) var(--sp-sm);font-size:var(--fs-xs);color:var(--muted)">
        ${upcoming.length} upcoming · ${expired.length} expired
      </div>`;

    const renderMemberRow = (m) => {
      const displayStatus = getMemberDisplayStatus(m);
      const daysText = getDaysText(m.days_until_expiry);
      return `
        <div class="upcoming-row-item">
          <div class="upcoming-row-main" data-member-id="${m.id}" style="cursor:pointer">
            ${renderAvatar(m.full_name, 'md')}
            <div class="upcoming-info">
              <div class="upcoming-name">${escapeHtml(m.full_name)}</div>
              <div class="upcoming-detail">${escapeHtml(m.phone || '')} · ${escapeHtml(m.plan?.name || 'Plan not set')}</div>
            </div>
            <div class="upcoming-right">
              <div class="upcoming-date">${formatDate(m.membership_end)}</div>
              ${daysText ? `<div class="upcoming-days">${daysText}</div>` : ''}
              ${renderBadge(displayStatus)}
            </div>
          </div>
          <button class="upcoming-renew-btn" data-renew='${escapeHtml(JSON.stringify(m))}'>Renew</button>
        </div>`;
    };

    // 1. Expiring Today
    if (today.length > 0) {
      html += `
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expired)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Expiring Today</span>
            <span class="badge badge-expired" style="font-size:10px;padding:1px 6px">${today.length}</span>
          </div>
          <div class="card">
            ${today.map(renderMemberRow).join('')}
          </div>
        </div>`;
    }

    // 2. Next 7 Days
    if (thisWeek.length > 0) {
      html += `
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expiring)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Next 7 Days</span>
            <span class="badge badge-pending" style="font-size:10px;padding:1px 6px">${thisWeek.length}</span>
          </div>
          <div class="card">
            ${thisWeek.map(renderMemberRow).join('')}
          </div>
        </div>`;
    }

    // 3. Expired
    if (expired.length > 0) {
      html += `
        <div style="padding:0 var(--sp-lg) var(--sp-md)">
          <div style="display:flex;align-items:center;gap:var(--sp-xs);margin-bottom:var(--sp-xs)">
            <span class="device-dot" style="background:var(--status-expired)"></span>
            <span style="font-weight:var(--fw-bold);font-size:var(--fs-base);color:var(--text)">Expired</span>
            <span class="badge badge-expired" style="font-size:10px;padding:1px 6px">${expired.length}</span>
          </div>
          <div class="card">
            ${expired.map(renderMemberRow).join('')}
          </div>
        </div>`;
    }

    content.innerHTML = html;

    // Events
    content.querySelectorAll('.upcoming-row-main').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.memberId;
        if (id) navigate.push('member-detail', { member: JSON.stringify({ id }) });
      });
    });

    content.querySelectorAll('[data-renew]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate.push('renew-member', { member: btn.dataset.renew });
      });
    });
  }
};
