/* Renewals Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMemberCard, renderListSkeleton, renderEmptyState, renderErrorState, renderSectionHeader, showToast } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatInteger } from '../utils.js';

let expiredShown = 20;

export default {
  async mount(el) {
    el.innerHTML = `
      ${renderHeader({ title: 'Renewals', showBack: true, actions: [{ icon: 'megaphone', label: 'Campaigns' }] })}
      <div class="scroll-view" id="renewals-list">${renderListSkeleton()}</div>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('campaigns') }] });

    // V11-L15: background (live-refresh) failures used to be fully
    // silent — a stale renewals list sat indefinitely while the owner
    // believed it was live. Toast once (mirror members.js/payments.js).
    let bgErrorShown = false;
    async function load(background = false, keepExpiredCount = false) {
    if (!background && !keepExpiredCount) expiredShown = 20;
    const [upRes, expRes] = await Promise.all([
      apiRequest('/api/mobile/v1/renewals/upcoming'),
      apiRequest('/api/mobile/v1/renewals/expired'),
    ]);

    const scroll = el.querySelector('#renewals-list');
    if (!upRes.ok && !expRes.ok) {
      // V11-L15: a background total failure used to return silently too
      // (the toast below only covered partial failures) — toast once.
      if (background) {
        if (!bgErrorShown) { bgErrorShown = true; showToast('Could not refresh renewals — showing the last loaded list.', 'error'); }
        return;
      }
      scroll.innerHTML = renderErrorState(upRes.error?.message || 'Failed to load');
      // V9-M6: the total-failure Try Again button was dead — no
      // #retry-btn binding was ever attached. Bind it to reload.
      scroll.querySelector('#retry-btn')?.addEventListener('click', () => load());
      return;
    }

    if (background && (!upRes.ok || !expRes.ok)) {
      if (!bgErrorShown) { bgErrorShown = true; showToast('Could not refresh renewals — showing the last loaded list.', 'error'); }
      return;
    }
    bgErrorShown = false;
    // V9-M6: a single-leg failure used to silently hide that section — if
    // the other leg was empty the screen claimed "All members are up to
    // date!". Surface the failed leg instead of hiding it.
    const failedLegs = [];
    if (!upRes.ok) failedLegs.push(`upcoming renewals (${upRes.error?.message || 'could not load'})`);
    if (!expRes.ok) failedLegs.push(`expired members (${expRes.error?.message || 'could not load'})`);
    const upcoming = upRes.ok ? (upRes.data.members || []) : [];
    const expired = expRes.ok ? (expRes.data.members || []) : [];
    if (failedLegs.length && upcoming.length === 0 && expired.length === 0) {
      // Nothing renderable and a leg failed: do not show the false
      // "All members are up to date!" empty state.
      scroll.innerHTML = renderErrorState(`Could not load ${failedLegs.join(' and ')}.`);
      scroll.querySelector('#retry-btn')?.addEventListener('click', () => load());
      return;
    }
    const expiringToday = upcoming.filter(m => m.days_until_expiry === 0);
    const expiringWeek = upcoming.filter(m => m.days_until_expiry > 0 && m.days_until_expiry <= 7);
    const expiringLater = upcoming.filter(m => m.days_until_expiry > 7);

    if (upcoming.length === 0 && expired.length === 0) {
      scroll.innerHTML = renderEmptyState({ icon: 'renewals', title: 'No renewals', text: 'All members are up to date!' });
      return;
    }

    let html = '<div class="scroll-content">';
    if (failedLegs.length) {
      html += `<div style="padding:var(--sp-lg) var(--sp-lg) 0"><div class="empty-state" style="padding:var(--sp-md)"><div class="empty-state-text">Could not load ${escapeHtml(failedLegs.join(' and '))} — the list below may be incomplete.</div><button class="btn btn-primary" id="rn-leg-retry">Try Again</button></div></div>`;
    }
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

    scroll.querySelector('#rn-leg-retry')?.addEventListener('click', () => load());
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
