/* Access Control Screen */
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderBadge, renderEmptyState, renderSectionHeader, renderAvatar } from '../components.js';
import { icon } from '../icons.js';
import { formatDateTime, formatInteger, escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    let currentTab = 'all'; // 'all' | 'inside' | 'entry' | 'exit' | 'denied'
    let summaryData = null;

    async function loadData() {
      const scroll = el.querySelector('#ac-scroll');
      if (!scroll) return;

      // Parallel fetch summary + current tab feed
      const summaryPromise = apiRequest('/api/mobile/v1/access/summary');
      const feedPromise = currentTab === 'inside'
        ? apiRequest('/api/mobile/v1/access/inside?per_page=50')
        : apiRequest(`/api/mobile/v1/access/events?per_page=25${currentTab === 'all' ? '' : `&type=${currentTab}`}`);

      const [summaryRes, feedRes] = await Promise.all([summaryPromise, feedPromise]);
      const s = summaryRes.ok ? summaryRes.data : (summaryData || {});
      summaryData = s;

      const events = feedRes.ok ? (feedRes.data?.events || feedRes.data?.log || []) : [];
      const insideMembers = feedRes.ok ? (feedRes.data?.members || []) : [];

      const lastEventText = s.last_event_at ? formatDateTime(s.last_event_at) : (s.last_heartbeat ? `Heartbeat: ${formatDateTime(s.last_heartbeat)}` : '');

      scroll.innerHTML = `
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online ? 'var(--success)' : 'var(--muted)'}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${s.device_online ? 'Device Online' : 'Device Offline'}</span>
                ${s.device_name ? `<span style="font-size:var(--fs-xs);color:var(--muted)">· ${escapeHtml(s.device_name)}</span>` : ''}
              </div>
              ${lastEventText ? `<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${escapeHtml(lastEventText)}</div>` : '<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatInteger(s.inside_now || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--success)">${formatInteger(s.entries_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${formatInteger(s.exits_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>
            </div>

            ${s.denied_today > 0 ? `
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${icon('alert', 18, 'var(--critical)')}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${formatInteger(s.denied_today)} access denied event${s.denied_today > 1 ? 's' : ''} today</span>
                </div>
                ${icon('forward', 14, 'var(--critical)')}
              </div>
            ` : ''}
          </div>

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[
              { id: 'all', label: 'All' },
              { id: 'inside', label: `Inside (${s.inside_now || 0})` },
              { id: 'entry', label: 'Entries' },
              { id: 'exit', label: 'Exits' },
              { id: 'denied', label: 'Denied' },
            ].map(t => `
              <button class="btn btn-sm ${currentTab === t.id ? 'btn-primary' : 'btn-secondary'}" data-tab="${t.id}" style="border-radius:var(--r-full);white-space:nowrap;padding:4px 12px;font-size:var(--fs-xs)">
                ${t.label}
              </button>
            `).join('')}
          </div>

          <!-- List Section -->
          ${currentTab === 'inside' ? `
            ${insideMembers.length > 0 ? `
              <div class="card" style="margin:0 var(--sp-lg)">
                ${insideMembers.map(m => `
                  <div class="list-item">
                    ${renderAvatar(m.full_name || 'Member', 'md')}
                    <div class="list-item-content">
                      <div class="list-item-title">${escapeHtml(m.full_name || 'Member')}</div>
                      <div class="list-item-subtitle">${m.phone ? escapeHtml(m.phone) + ' · ' : ''}Entered ${m.entered_at ? formatDateTime(m.entered_at) : 'recently'}</div>
                    </div>
                    ${renderBadge(m.status || 'Active')}
                  </div>
                `).join('')}
              </div>
            ` : renderEmptyState({ icon: 'access', title: 'No members inside', text: 'Members currently inside the gym will appear here' })}
          ` : `
            ${events.length > 0 ? `
              <div class="card" style="margin:0 var(--sp-lg)">
                ${events.map(l => {
                  const type = (l.event_type || 'ENTRY').toUpperCase();
                  const isEntry = type === 'ENTRY' || type === 'ATTENDANCE';
                  const isExit = type === 'EXIT';
                  const isDenied = type === 'ACCESS_DENIED';
                  const bg = isDenied ? 'var(--critical-surface)' : (isEntry ? 'var(--success-surface)' : 'var(--gray-100)');
                  const iconColor = isDenied ? 'var(--critical)' : (isEntry ? 'var(--success)' : 'var(--muted)');
                  const iconName = isDenied ? 'alert' : (isEntry ? 'forward' : 'back');
                  const badgeType = isDenied ? 'expired' : (isEntry ? 'active' : 'info');
                  const badgeText = isDenied ? 'Denied' : (type === 'ATTENDANCE' ? 'Check In' : (isEntry ? 'Entry' : 'Exit'));

                  return `
                    <div class="list-item">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${icon(iconName, 16, iconColor)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${escapeHtml(l.member_name || 'Unknown')}</div>
                        <div class="list-item-subtitle">${formatDateTime(l.event_timestamp || l.timestamp || l.created_at)}${l.device_name ? ` · ${escapeHtml(l.device_name)}` : ''}</div>
                      </div>
                      <span class="badge badge-${badgeType}">${badgeText}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : renderEmptyState({ icon: 'access', title: 'No events', text: 'Access events will appear here' })}
          `}
        </div>
      `;

      // Bind filter buttons
      scroll.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          currentTab = btn.dataset.tab;
          scroll.innerHTML = renderListSkeleton();
          loadData();
        });
      });

      // Quick stat clicks
      scroll.querySelector('#stat-inside')?.addEventListener('click', () => { currentTab = 'inside'; loadData(); });
      scroll.querySelector('#stat-entries')?.addEventListener('click', () => { currentTab = 'entry'; loadData(); });
      scroll.querySelector('#stat-exits')?.addEventListener('click', () => { currentTab = 'exit'; loadData(); });
      scroll.querySelector('#banner-denied')?.addEventListener('click', () => { currentTab = 'denied'; loadData(); });
    }

    el.innerHTML = `
      ${renderHeader({
        title: 'Access Control',
        showBack: true,
        actions: [{ icon: 'refresh', label: 'Refresh', onClick: () => loadData() }],
      })}
      <div class="scroll-view" id="ac-scroll">${renderListSkeleton()}</div>
    `;

    bindHeaderEvents(el, {
      onBack: () => navigate.pop(),
      actions: [{ icon: 'refresh', onClick: () => loadData() }],
    });

    await loadData();
  }
};
