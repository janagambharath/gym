/* Renewals Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMemberCard, renderListSkeleton, renderEmptyState, renderErrorState, renderSectionHeader } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatInteger } from '../utils.js';

export default {
  async mount(el) {
    el.innerHTML = `
      ${renderHeader({ title: 'Renewals', actions: [{ icon: 'megaphone', label: 'Campaigns' }] })}
      <div class="scroll-view" id="renewals-list">${renderListSkeleton()}</div>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('campaigns') }] });

    const [upRes, expRes] = await Promise.all([
      apiRequest('/api/mobile/v1/renewals/upcoming'),
      apiRequest('/api/mobile/v1/renewals/expired'),
    ]);

    const scroll = el.querySelector('#renewals-list');
    if (!upRes.ok && !expRes.ok) {
      scroll.innerHTML = renderErrorState(upRes.error?.message || 'Failed to load');
      return;
    }

    const upcoming = upRes.ok ? (upRes.data.members || []) : [];
    const expired = expRes.ok ? (expRes.data.members || []) : [];
    const expiringToday = upcoming.filter(m => m.days_until_expiry === 0);
    const expiringWeek = upcoming.filter(m => m.days_until_expiry > 0 && m.days_until_expiry <= 7);
    const expiringLater = upcoming.filter(m => m.days_until_expiry > 7);

    if (upcoming.length === 0 && expired.length === 0) {
      scroll.innerHTML = renderEmptyState({ icon: 'renewals', title: 'No renewals', text: 'All members are up to date!' });
      return;
    }

    let html = '<div class="scroll-content">';
    const renderSection = (title, members, badgeColor) => {
      if (members.length === 0) return '';
      return `${renderSectionHeader(`${title} (${members.length})`)}
        <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
          ${members.map(m => `
            <div class="list-item" data-member='${escapeHtml(JSON.stringify(m))}'>
              <div class="list-item-content">
                <div class="list-item-title">${escapeHtml(m.full_name)}</div>
                <div class="list-item-subtitle">${escapeHtml(m.phone)} · ${escapeHtml(m.plan?.name || '—')}</div>
              </div>
              <button class="btn btn-primary btn-sm" data-renew='${escapeHtml(JSON.stringify(m))}'>Renew</button>
            </div>
          `).join('')}
        </div>`;
    };

    html += renderSection('Expiring Today', expiringToday);
    html += renderSection('Next 7 Days', expiringWeek);
    html += renderSection('Upcoming', expiringLater);
    html += renderSection('Expired', expired.slice(0, 20));
    html += '</div>';
    scroll.innerHTML = html;

    scroll.querySelectorAll('[data-renew]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate.push('renew-member', { member: btn.dataset.renew });
      });
    });
    scroll.querySelectorAll('[data-member]').forEach(item => {
      item.addEventListener('click', () => navigate.push('member-detail', { member: item.dataset.member }));
    });
  }
};
