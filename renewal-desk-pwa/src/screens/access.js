/* ═══════════════════════════════════════════════════════════════════════
   Access Control Screen — 1:1 Parity with Renewal Desk Android App
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderBadge, renderEmptyState, renderAvatar } from '../components.js';
import { icon } from '../icons.js';
import { formatDateTime, escapeHtml, formatInteger } from '../utils.js';

export default {
  async mount(el) {
    let activeFilter = 'all';
    let searchQuery = '';
    let summary = null;
    let events = [];

    el.innerHTML = `
      ${renderHeader({ title: 'Live Access', showBack: false })}
      <div class="scroll-view" id="access-scroll">
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:0 var(--sp-lg) var(--sp-md)">
            <div class="card card-body" id="access-summary-card">
              <div class="access-device-status-row" style="margin-bottom:var(--sp-sm)">
                <span class="device-dot" id="acc-device-dot" style="background:var(--muted)"></span>
                <span style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-medium)" id="acc-device-text">Biometric Device: Offline</span>
                <span style="font-size:var(--fs-xs);color:var(--muted);margin-left:auto" id="acc-device-sync"></span>
              </div>
              <div class="access-stats-grid">
                <div class="access-tile" data-filter="inside" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--success)" id="acc-val-inside">0</div>
                  <div class="access-tile-label">Inside Now</div>
                </div>
                <div class="access-tile bordered" data-filter="entry" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--brand)" id="acc-val-entries">0</div>
                  <div class="access-tile-label">Entries Today</div>
                </div>
                <div class="access-tile bordered" data-filter="exit" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--warning)" id="acc-val-exits">0</div>
                  <div class="access-tile-label">Exits Today</div>
                </div>
                <div class="access-tile bordered" data-filter="denied" style="cursor:pointer">
                  <div class="access-tile-value" style="color:var(--critical)" id="acc-val-denied">0</div>
                  <div class="access-tile-label">Denied</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Search & Filter Chips -->
          <div style="padding:0 var(--sp-lg) var(--sp-sm)">
            <div class="search-box" style="margin-bottom:var(--sp-sm)">
              ${icon('search', 18, 'var(--muted)')}
              <input type="text" class="search-input" id="acc-search-input" placeholder="Search member name...">
            </div>
            <div class="filter-chips" id="acc-filter-chips">
              <button class="filter-chip active" data-tab="all">All</button>
              <button class="filter-chip" data-tab="inside">Inside Now</button>
              <button class="filter-chip" data-tab="entry">Entries</button>
              <button class="filter-chip" data-tab="exit">Exits</button>
              <button class="filter-chip" data-tab="denied">Denied</button>
            </div>
          </div>

          <!-- Events List Container -->
          <div id="access-events-container" style="padding:0 var(--sp-lg) var(--sp-lg)">
            ${renderListSkeleton()}
          </div>
        </div>
      </div>`;

    bindHeaderEvents(el, {
      onBack: () => navigate.switchTab('dashboard'),
    });

    // Filter clicks
    el.querySelector('#acc-filter-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.tab;
      loadEvents();
    });

    // Search
    const searchInput = el.querySelector('#acc-search-input');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadEvents();
      }, 300);
    });

    // Summary tile clicks to filter
    el.querySelectorAll('.access-tile[data-filter]').forEach(tile => {
      tile.addEventListener('click', () => {
        const f = tile.dataset.filter;
        const chip = el.querySelector(`.filter-chip[data-tab="${f}"]`);
        if (chip) {
          el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          activeFilter = f;
          loadEvents();
        }
      });
    });

    // Fetch summary
    async function loadSummary() {
      const res = await apiRequest('/api/mobile/v1/access/summary');
      if (res.ok) {
        summary = res.data;
        const dot = el.querySelector('#acc-device-dot');
        const text = el.querySelector('#acc-device-text');
        const sync = el.querySelector('#acc-device-sync');
        if (dot) dot.style.background = summary.device_online ? 'var(--success)' : 'var(--muted)';
        if (text) text.textContent = `${summary.device_name || 'Biometric Device'}: ${summary.device_online ? 'Online' : 'Offline'}`;
        if (sync && summary.last_event_at) {
          sync.textContent = `Last scan ${new Date(summary.last_event_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
        const valInside = el.querySelector('#acc-val-inside');
        const valEntries = el.querySelector('#acc-val-entries');
        const valExits = el.querySelector('#acc-val-exits');
        const valDenied = el.querySelector('#acc-val-denied');
        if (valInside) valInside.textContent = formatInteger(summary.inside_now || 0);
        if (valEntries) valEntries.textContent = formatInteger(summary.entries_today || 0);
        if (valExits) valExits.textContent = formatInteger(summary.exits_today || 0);
        if (valDenied) valDenied.textContent = formatInteger(summary.denied_today || 0);
      }
    }

    // Fetch events
    async function loadEvents() {
      const container = el.querySelector('#access-events-container');
      if (!container) return;

      if (activeFilter === 'inside') {
        container.innerHTML = renderListSkeleton();
        const res = await apiRequest('/api/mobile/v1/access/inside');
        if (!res.ok) {
          container.innerHTML = renderEmptyState({ icon: 'access', title: 'Could not load members', text: res.error.message });
          return;
        }
        const insideList = res.data.members || [];
        if (insideList.length === 0) {
          container.innerHTML = renderEmptyState({ icon: 'access', title: 'No members inside', text: 'No active gym entries currently open.' });
          return;
        }
        container.innerHTML = `
          <div class="card">
            ${insideList.map(m => `
              <div class="list-item" data-member-id="${m.id}" style="cursor:pointer">
                ${renderAvatar(m.full_name, 'md')}
                <div class="list-item-content">
                  <div class="list-item-title">${escapeHtml(m.full_name)}</div>
                  <div class="list-item-subtitle">Entered at ${new Date(m.entered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <span class="badge badge-active">INSIDE</span>
              </div>
            `).join('')}
          </div>`;
        container.querySelectorAll('[data-member-id]').forEach(row => {
          row.addEventListener('click', () => navigate.push('member-detail', { member: JSON.stringify({ id: row.dataset.memberId }) }));
        });
        return;
      }

      let url = `/api/mobile/v1/access/events?page=1&per_page=30&date=today`;
      if (activeFilter === 'entry') url += '&type=entry';
      else if (activeFilter === 'exit') url += '&type=exit';
      else if (activeFilter === 'denied') url += '&type=denied';
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

      const res = await apiRequest(url);
      if (!res.ok) {
        // Fallback to /api/mobile/v1/access/log if /events not enabled
        const fallback = await apiRequest('/api/mobile/v1/access/log?page_size=30');
        if (fallback.ok) {
          events = fallback.data.events || fallback.data.log || [];
        } else {
          container.innerHTML = renderEmptyState({ icon: 'access', title: 'No access events', text: 'Scans will appear here as members check in.' });
          return;
        }
      } else {
        events = res.data.events || [];
      }

      if (events.length === 0) {
        container.innerHTML = renderEmptyState({ icon: 'access', title: 'No access events', text: 'No access events recorded today for this filter.' });
        return;
      }

      container.innerHTML = `
        <div class="card">
          ${events.map(ev => {
            const isEntry = (ev.event_type || '').toLowerCase().includes('entry') || (ev.event_type || '').toLowerCase().includes('attendance');
            const isDenied = (ev.event_type || '').toLowerCase().includes('denied');
            const badgeClass = isDenied ? 'badge-expired' : isEntry ? 'badge-active' : 'badge-pending';
            const badgeLabel = isDenied ? 'DENIED' : isEntry ? 'ENTRY' : 'EXIT';
            const iconName = isDenied ? 'alert' : isEntry ? 'forward' : 'back';
            const iconColor = isDenied ? 'var(--critical)' : isEntry ? 'var(--success)' : 'var(--warning)';

            return `
              <div class="list-item" data-member-id="${ev.member_id || ''}" style="cursor:pointer">
                <div style="width:36px;height:36px;border-radius:var(--r-full);background:${isDenied ? 'var(--critical-surface)' : isEntry ? 'var(--success-surface)' : 'var(--warning-surface)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  ${icon(iconName, 16, iconColor)}
                </div>
                <div class="list-item-content">
                  <div class="list-item-title">${escapeHtml(ev.member_name || `Member #${ev.member_id || '—'}`)}</div>
                  <div class="list-item-subtitle">${formatDateTime(ev.timestamp || ev.created_at)} ${ev.reason ? `· ${escapeHtml(ev.reason)}` : ''}</div>
                </div>
                <span class="badge ${badgeClass}">${badgeLabel}</span>
              </div>`;
          }).join('')}
        </div>`;

      container.querySelectorAll('[data-member-id]').forEach(row => {
        row.addEventListener('click', () => {
          const mid = row.dataset.memberId;
          if (mid) navigate.push('member-detail', { member: JSON.stringify({ id: mid }) });
        });
      });
    }

    await Promise.all([loadSummary(), loadEvents()]);
  }
};
