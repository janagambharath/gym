/* Renewals Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMemberCard, renderListSkeleton, renderEmptyState, renderErrorState, renderSectionHeader } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatInteger } from '../utils.js';

let expiredShown = 20;

export default {
  async mount(el) {
    el.innerHTML = `
      ${renderHeader({ title: 'Renewals', showBack: true, actions: [{ icon: 'megaphone', label: 'Campaigns' }] })}
      <div class="scroll-view" id="renewals-list">${renderListSkeleton()}</div>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('campaigns') }] });

    async function load(background = false, keepExpiredCount = false) {
    if (!background && !keepExpiredCount) expiredShown = 20;
    const [upRes, expRes] = await Promise.all([
      apiRequest('/api/mobile/v1/renewals/upcoming'),
      apiRequest('/api/mobile/v1/renewals/expired'),
    ]);

    const scroll = el.querySelector('#renewals-list');
    if (!upRes.ok && !expRes.ok) {
      if (!background) scroll.innerHTML = renderErrorState(upRes.error?.message || 'Failed to load');
      return;
    }

    if (background && (!upRes.ok || !expRes.ok)) return;
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
            <div class="list-item" data-member-id="${m.id}">
              <div class="list-item-content">
                <div class="list-item-title">${escapeHtml(m.full_name)}</div>
                <div class="list-item-subtitle">${escapeHtml(m.phone)} · ${escapeHtml(m.plan?.name || '—')}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <a href="tel:${escapeHtml(m.phone)}" class="btn btn-secondary btn-sm" style="text-decoration:none" data-stop="1" aria-label="Call">${icon('phone', 15)}</a>
                <a href="https://wa.me/${escapeHtml(String(m.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm" style="text-decoration:none" data-stop="1" aria-label="WhatsApp">${icon('whatsapp', 15, 'white')}</a>
                <button class="btn btn-primary btn-sm" data-renew="${m.id}">Renew</button>
              </div>
            </div>
          `).join('')}
        </div>`;
    };

    html += renderSection('Expiring Today', expiringToday);
    html += renderSection('Next 7 Days', expiringWeek);
    html += renderSection('Upcoming', expiringLater);
    html += renderSection('Expired', expired.slice(0, expiredShown));
    if (expired.length > expiredShown) {
      html += `<div style="padding:0 var(--sp-lg) var(--sp-lg);text-align:center"><div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${expiredShown} of ${expired.length} expired members</div><button class="btn btn-secondary" id="exp-more">Show more expired</button></div>`;
    } else if (expired.length) {
      html += `<div style="padding:0 var(--sp-lg) var(--sp-lg);text-align:center;font-size:var(--fs-sm);color:var(--muted)">Showing ${expired.length} of ${expired.length} expired members</div>`;
    }
    html += '</div>';
    scroll.innerHTML = html;

    scroll.querySelector('#exp-more')?.addEventListener('click', () => { expiredShown = expired.length; load(false, true); });
    scroll.querySelectorAll('[data-renew]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate.push('renew-member', { memberId: String(btn.dataset.renew) });
      });
    });
    scroll.querySelectorAll('[data-stop]').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });
    scroll.querySelectorAll('[data-member-id]').forEach(item => {
      item.addEventListener('click', () => navigate.push('member-detail', { memberId: String(item.dataset.memberId) }));
    });
    }
    await load();
    attachLiveRefresh(el, () => load(true));
  }
};
