/* Access Control Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest, checkInMember } from '../api.js';
import { navigate } from '../app.js';
import { router } from '../router.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderAvatar, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js';
import { formatDateTime, formatInteger, escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    // M8: drop any orphaned quick-assign sheet (OS-back can strand it on document.body)
    document.getElementById('quick-assign-overlay')?.remove();
    let currentTab = 'all'; // 'all' | 'entry' | 'exit' | 'denied'
    let summaryData = null;
    let requestId = 0;
    // Feed pagination (V3-M21): page/total survive background refreshes.
    let page = 1, totalEvents = 0, totalPages = 1, allEvents = [];
    let insideMembers = [], insideTotal = 0;
    let feedErrorShown = false;

    // One feed row — shared by the full render and load-more appends so
    // appended rows look and behave exactly like the first page.
    function eventRowHtml(l) {
      const type = (l.event_type || 'ENTRY').toUpperCase();
      const isEntry = type === 'ENTRY' || type === 'ATTENDANCE';
      const isDenied = type === 'ACCESS_DENIED';
      const bg = isDenied ? 'var(--critical-surface)' : (isEntry ? 'var(--success-surface)' : 'var(--gray-100)');
      const iconColor = isDenied ? 'var(--critical)' : (isEntry ? 'var(--success)' : 'var(--muted)');
      const iconName = isDenied ? 'alert' : (isEntry ? 'forward' : 'back');
      const badgeType = isDenied ? 'expired' : (isEntry ? 'active' : 'info');
      const badgeText = isDenied ? 'Denied' : (type === 'ATTENDANCE' ? 'Check In' : (isEntry ? 'Entry' : 'Exit'));
      // Terminal ID for unmapped punches — the ADMS leg sends
      // biometric_user_id, the AccessEvent leg sends
      // device_enroll_number (now also aliased). Without it
      // staff only see "Unknown" and can't tell IDs apart.
      const bioId = l.biometric_user_id || l.device_enroll_number;
      const isUnknown = !l.member_id && bioId;
      const title = l.member_id
        ? escapeHtml(l.member_name || 'Unknown')
        : (bioId ? `Unknown · ID ${escapeHtml(bioId)}` : 'Unknown');
      return `
        <div class="list-item" style="cursor:pointer" data-event-member-id="${l.member_id || ''}" data-bio-id="${(!l.member_id && bioId) ? escapeHtml(bioId) : ''}">
          <div style="width:34px;height:34px;border-radius:var(--r-full);background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${icon(iconName, 16, iconColor)}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${title}${isUnknown ? ' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>' : ''}</div>
            <div class="list-item-subtitle">${formatDateTime(l.event_timestamp || l.timestamp || l.created_at)}${l.device_name ? ` · ${escapeHtml(l.device_name)}` : ''}</div>
          </div>
          <span class="badge badge-${badgeType}">${badgeText}</span>
        </div>
      `;
    }

    function wireEventRows(container) {
      container.querySelectorAll('[data-event-member-id]').forEach(row => {
        if (row.dataset.wired) return;
        row.dataset.wired = '1';
        row.addEventListener('click', () => {
          const mid = row.dataset.eventMemberId;
          const bioId = row.dataset.bioId;
          if (mid) {
            navigate.push('member-detail', { memberId: mid });
          } else if (bioId) {
            openQuickAssign(bioId);
          }
        });
      });

      // Check Out buttons — live targets are the Inside-now rows (V3-L23).
      container.querySelectorAll('[data-checkout-id]').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const mid = btn.dataset.checkoutId;
          const name = btn.dataset.checkoutName;
          btn.disabled = true;
          btn.textContent = 'Checking out...';
          const res = await checkInMember(mid, 'EXIT');
          if (res.ok) {
            showToast(`${name} checked out`, 'success');
            await loadData();
          } else {
            showToast(res.error?.message || 'Check-out failed', 'error');
            btn.disabled = false;
            btn.textContent = 'Check Out';
          }
        });
      });
    }

    async function loadMoreEvents() {
      if (page >= totalPages) return;
      const btn = el.querySelector('#ac-load-more');
      if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
      const next = page + 1;
      const res = await apiRequest(`/api/mobile/v1/access/events?page=${next}&per_page=25${currentTab === 'all' ? '' : `&type=${currentTab}`}`);
      if (!res.ok) {
        showToast(res.error?.message || 'Could not load more events.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Load more events'; }
        return;
      }
      page = res.data?.pagination?.page ?? next;
      totalPages = res.data?.pagination?.total_pages ?? totalPages;
      totalEvents = res.data?.pagination?.total ?? totalEvents;
      const more = res.data?.events || res.data?.log || [];
      allEvents = [...allEvents, ...more];
      // Append rows in place — a full re-render would reset scroll.
      const card = el.querySelector('#ac-events-card');
      if (card) {
        card.insertAdjacentHTML('beforeend', more.map(eventRowHtml).join(''));
        wireEventRows(card);
      }
      const count = el.querySelector('#ac-feed-count');
      if (count) count.textContent = `Showing ${allEvents.length} of ${totalEvents} events`;
      const wrap = el.querySelector('#ac-more-wrap');
      if (wrap) wrap.style.display = page < totalPages ? '' : 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Load more events'; }
    }

    async function loadData() {
      const id = ++requestId;
      const scroll = el.querySelector('#ac-scroll');
      if (!scroll) return;

      // Parallel fetch summary + inside-now + current tab feed. A background
      // refresh re-fetches pages 1..page so a loaded-more feed keeps its
      // place (members-list pattern) instead of snapping back to page 1.
      const feedUrl = (p) => `/api/mobile/v1/access/events?page=${p}&per_page=25${currentTab === 'all' ? '' : `&type=${currentTab}`}`;
      const [summaryRes, insideRes, ...feedPages] = await Promise.all([
        apiRequest('/api/mobile/v1/access/summary'),
        apiRequest('/api/mobile/v1/access/inside?per_page=50'),
        ...Array.from({ length: page }, (_, i) => apiRequest(feedUrl(i + 1))),
      ]);
      if (id !== requestId || el.dataset.screenDisposed === 'true') return;
      const feedRes = feedPages.find(r => !r.ok) || feedPages[feedPages.length - 1];
      if (!summaryRes.ok && !feedRes.ok && summaryData) return;
      // A background feed failure used to return silently, leaving a stale
      // feed with no error — surface it once until a refresh succeeds.
      if (!feedRes.ok) {
        if (!feedErrorShown) { feedErrorShown = true; showToast('Could not refresh the access feed — showing the last loaded events.', 'error'); }
        if (summaryData) return;
      } else {
        feedErrorShown = false;
      }
      const s = summaryRes.ok ? summaryRes.data : (summaryData || {});
      summaryData = s;

      // /access/events never returns a members list — inside-now comes from
      // the dedicated /access/inside endpoint (the old feedRes.data.members
      // read was always []).
      const events = feedRes.ok ? (feedRes.data?.events || feedRes.data?.log || []) : [];
      const pg = feedRes.ok ? (feedRes.data?.pagination || {}) : {};
      totalEvents = pg.total ?? events.length;
      totalPages = pg.total_pages ?? 1;
      page = pg.page ?? page;
      allEvents = feedPages.slice(0, -1).flatMap(r => (r.ok ? (r.data?.events || r.data?.log || []) : [])).concat(events);
      insideMembers = insideRes.ok ? (insideRes.data?.members || []) : [];
      insideTotal = insideRes.ok ? (insideRes.data?.pagination?.total ?? insideMembers.length) : 0;

      const lastEventText = s.last_event_at ? formatDateTime(s.last_event_at) : (s.last_heartbeat ? `Heartbeat: ${formatDateTime(s.last_heartbeat)}` : '');

      scroll.innerHTML = `
        <div class="scroll-content">
          <!-- Summary Card -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body" style="text-align:center">
              <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online ? 'var(--success)' : 'var(--muted)'}"></span>
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${s.device_online ? 'Biometric Device Online' : 'Biometric Device Offline'}</span>
                ${s.device_name ? `<span style="font-size:var(--fs-xs);color:var(--muted)">· ${escapeHtml(s.device_name)}</span>` : ''}
              </div>
              ${lastEventText ? `<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${escapeHtml(lastEventText)}</div>` : '<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatInteger(s.entries_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${formatInteger(s.exits_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              ${s.remote_unlock_available ? `
              <!-- Remote Physical Gate Control -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn" id="btn-remote-unlock" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs);background:#16a34a;color:white;border:none">
                  🔓 Unlock Gate
                </button>
              </div>
              ` : ''}
            </div>

            ${!s.adms_integration_id ? `
            <!-- Hardware Bridge Controls (only when NOT on Direct Cloud) -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Hardware Bridge Controls</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${s.bridge_online ? '#dcfce7' : '#fee2e2'};color:${s.bridge_online ? '#15803d' : '#b91c1c'}">
                  ${s.bridge_online ? 'BRIDGE ONLINE' : 'BRIDGE OFFLINE'}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-xs)">
                <button class="btn btn-secondary btn-sm" id="btn-reconcile-all" style="font-size:var(--fs-xs);padding:6px 10px">🔄 Re-sync Members</button>
                <button class="btn btn-secondary btn-sm" id="btn-bridge-pairing" style="font-size:var(--fs-xs);padding:6px 10px">🔑 Pairing Code</button>
              </div>
            </div>
            ` : ''}

            ${s.adms_integration_id ? `
            <!-- Direct Cloud (ADMS) Status -->
            <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:var(--fw-bold);font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);letter-spacing:0.5px">Direct Cloud Terminal</div>
                <span style="font-size:10px;font-weight:var(--fw-bold);padding:2px 8px;border-radius:12px;background:${s.adms_online ? '#dcfce7' : '#fee2e2'};color:${s.adms_online ? '#15803d' : '#b91c1c'}">
                  ${s.adms_online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              ${s.adms_device_name ? `<div style="font-size:var(--fs-xs);color:var(--muted)">${escapeHtml(s.adms_device_name)}</div>` : ''}
              <p style="font-size:var(--fs-xs);color:var(--muted);margin:0">${s.adms_online
                ? (s.adms_commands_enabled
                  ? 'Terminal polled recently. Membership block/restore commands are enabled.'
                  : 'Terminal polled recently, but automatic membership commands are not enabled yet.')
                : `No recent terminal poll${s.adms_last_seen_at ? ` (last seen ${escapeHtml(formatDateTime(s.adms_last_seen_at))})` : ''}. It cannot receive block/unblock commands until it reconnects.`}</p>
            </div>
            ` : ''}

            ${s.failed_commands > 0 ? `
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${icon('alert', 16, '#B45309')}
                  <span><strong>${formatInteger(s.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
                  <button class="btn btn-sm" id="btn-clear-failed" style="font-size:var(--fs-xs);padding:4px 10px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA">Clear</button>
                </div>
              </div>
            ` : ''}

            ${s.denied_today > 0 ? `
              <div class="card" id="banner-denied" style="margin-top:var(--sp-md);padding:var(--sp-md);background:var(--critical-surface);border-color:var(--critical-border);display:flex;align-items:center;justify-content:space-between;cursor:pointer">
                <div style="display:flex;align-items:center;gap:var(--sp-sm)">
                  ${icon('alert', 18, 'var(--critical)')}
                  <span style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--critical)">${formatInteger(s.denied_today)} access denied event${s.denied_today > 1 ? 's' : ''} today</span>
                </div>
                ${icon('forward', 14, 'var(--critical)')}
              </div>
            ` : ''}

            ${!s.device_online && (s.inside_now || 0) === 0 && (s.entries_today || 0) === 0 ? `
              <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);background:var(--gray-50, #f8f9fa);border:1px dashed var(--border);border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--muted);text-align:center">
                💡 Tip: Tap <b>"+ Check In Member"</b> above to log attendance manually anytime, or connect your biometric turnstile/machine.
              </div>
            ` : ''}
          </div>

          <!-- Inside Now (V3-M21) — from /access/inside, not the feed -->
          ${insideMembers.length ? `
            <div class="card" style="margin:var(--sp-md) var(--sp-lg) 0">
              <div style="padding:var(--sp-md) var(--sp-md) var(--sp-xs);font-weight:var(--fw-bold);font-size:var(--fs-sm)">Inside now (${insideTotal})</div>
              ${insideMembers.map(m => `
                <div class="list-item" style="cursor:pointer" data-event-member-id="${m.id}">
                  ${renderAvatar(m.full_name || 'Member', 'sm')}
                  <div class="list-item-content">
                    <div class="list-item-title">${escapeHtml(m.full_name)}</div>
                    <div class="list-item-subtitle">Entered ${m.entered_at ? formatDateTime(m.entered_at) : '—'}</div>
                  </div>
                  <button class="btn btn-secondary btn-sm" data-checkout-id="${m.id}" data-checkout-name="${escapeHtml(m.full_name)}">Check Out</button>
                </div>`).join('')}
            </div>` : ''}

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[
              { id: 'all', label: 'All Events' },
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
          ${`
            ${allEvents.length > 0 ? `
              <div class="card" id="ac-events-card" style="margin:0 var(--sp-lg)">
                ${allEvents.map(eventRowHtml).join('')}
              </div>
              <div id="ac-feed-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center">Showing ${allEvents.length} of ${totalEvents} events</div>
              ${page < totalPages ? `<div id="ac-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ac-load-more">Load more events</button></div>` : ''}
            ` : renderEmptyState({ icon: 'access', title: 'No events', text: 'Live access and check-in events will appear here' })}
          `}
        </div>
      `;

      // Bind filter buttons
      scroll.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          currentTab = btn.dataset.tab;
          page = 1; allEvents = [];
          scroll.innerHTML = renderListSkeleton();
          loadData();
        });
      });

      // Load more (V3-M21)
      scroll.querySelector('#ac-load-more')?.addEventListener('click', loadMoreEvents);

      // Quick stat clicks
      scroll.querySelector('#stat-entries')?.addEventListener('click', () => { currentTab = 'entry'; page = 1; allEvents = []; loadData(); });
      scroll.querySelector('#stat-exits')?.addEventListener('click', () => { currentTab = 'exit'; page = 1; allEvents = []; loadData(); });
      scroll.querySelector('#banner-denied')?.addEventListener('click', () => { currentTab = 'denied'; page = 1; allEvents = []; loadData(); });

      // Remote Turnstile / Door Unlock
      const unlockBtn = scroll.querySelector('#btn-remote-unlock');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', async () => {
          if (!window.confirm('Unlock the gym gate for 5 seconds?')) return;
          unlockBtn.disabled = true;
          unlockBtn.textContent = 'Sending unlock...';
          const res = await apiRequest('/api/mobile/v1/access/remote-unlock', {
            method: 'POST',
            body: { delay_seconds: 5, confirm: true },
          });
          if (res.ok) {
            showToast(res.data?.message || 'Unlock command queued. Waiting for terminal acknowledgement.', 'success');
          } else {
            showToast(res.error?.message || 'Could not unlock door', 'error');
          }
          unlockBtn.disabled = false;
          unlockBtn.textContent = '🔓 Unlock Gate';
        });
      }

      // Re-sync all members to biometric device
      const recBtn = scroll.querySelector('#btn-reconcile-all');
      if (recBtn) {
        recBtn.addEventListener('click', async () => {
          recBtn.disabled = true;
          recBtn.textContent = 'Syncing...';
          const res = await apiRequest('/api/mobile/v1/access/reconcile', { method: 'POST' });
          if (res.ok) {
            showToast(res.data?.message || 'Re-sync queued for device', 'success');
            await loadData();
          } else {
            showToast(res.error?.message || 'Re-sync failed', 'error');
          }
          recBtn.disabled = false;
          recBtn.textContent = '🔄 Re-sync Members';
        });
      }

      // Generate Bridge Pairing Code
      const pairBtn = scroll.querySelector('#btn-bridge-pairing');
      if (pairBtn) {
        pairBtn.addEventListener('click', async () => {
          pairBtn.disabled = true;
          const res = await apiRequest('/api/mobile/v1/settings/bridge/pairing-code', { method: 'POST' });
          pairBtn.disabled = false;
          if (res.ok && res.data?.pairing_code) {
            await showConfirm({
              title: 'Bridge Pairing Code',
              message: `Your 6-digit pairing code is:\n\n${res.data.pairing_code}\n\nValid for 10 minutes. Enter this code into RenewalDeskConnector.exe on your gym PC to connect.`,
              confirmText: 'Done',
            });
          } else {
            showToast(res.error?.message || 'Could not generate pairing code', 'error');
          }
        });
      }

      // Retry Failed Biometric Syncs
      scroll.querySelector('#btn-retry-sync')?.addEventListener('click', async () => {
        const btn = scroll.querySelector('#btn-retry-sync');        if (btn) btn.disabled = true;
        const res = await apiRequest('/api/mobile/v1/access/retry-sync', { method: 'POST' });
        if (res.ok) {
          showToast(res.data?.message || 'Commands queued for retry', 'success');
          await loadData();
        } else {
          showToast(res.error?.message || 'Could not retry syncs', 'error');
          if (btn) btn.disabled = false;
        }
      });

      // Clear Failed Biometric Commands (irreversible — for bridge migration)
      scroll.querySelector('#btn-clear-failed')?.addEventListener('click', async () => {
        if (!confirm('Permanently delete all failed biometric commands? This cannot be undone.')) return;
        const btn = scroll.querySelector('#btn-clear-failed');        if (btn) btn.disabled = true;
        const res = await apiRequest('/api/mobile/v1/access/clear-failed', { method: 'POST' });
        if (res.ok) {
          showToast(res.data?.message || 'Failed commands cleared', 'success');
          await loadData();
        } else {
          showToast(res.error?.message || 'Could not clear commands', 'error');
          if (btn) btn.disabled = false;
        }
      });

      // Member rows + Check Out buttons (inside-now list and feed rows).
      // NOTE (V3-L23): the old [data-member-link] binding was dead — no
      // element ever carried that attribute (rows use
      // data-event-member-id) — so it was removed, not re-bound.
      wireEventRows(scroll);
    }

    function openCheckinModal() {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay center';
      modal.innerHTML = `
        <div class="confirm-dialog" style="max-width:440px;width:90%;max-height:85vh;display:flex;flex-direction:column;padding:var(--sp-lg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
            <div style="font-weight:var(--fw-bold);font-size:var(--fs-lg)">Manual Check In</div>
            <button id="modal-close" style="background:none;border:none;cursor:pointer;padding:4px">${icon('close', 20, 'var(--muted)')}</button>
          </div>
          <div style="margin-bottom:var(--sp-md)">
            <input type="text" id="checkin-search" class="form-input" placeholder="Search member by name or phone..." style="width:100%" autofocus />
          </div>
          <div id="checkin-members-list" style="overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:var(--sp-xs)">
            <div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">Loading active members...</div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#modal-close').onclick = () => modal.remove();
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

      const searchInput = modal.querySelector('#checkin-search');
      const listContainer = modal.querySelector('#checkin-members-list');
      let debounceTimeout = null;

      async function fetchAndRenderMembers(query = '') {
        // V3-L22: the search query used to drop the status=active filter,
        // so searching could surface expired members for check-in.
        const url = `/api/mobile/v1/members?page_size=20&status=active${query ? `&q=${encodeURIComponent(query)}` : ''}`;
        const res = await apiRequest(url);
        if (!res.ok) {
          listContainer.innerHTML = `<div style="text-align:center;padding:var(--sp-md);color:var(--critical)">Failed to load members</div>`;
          return;
        }
        const members = res.data?.members || [];
        if (members.length === 0) {
          listContainer.innerHTML = `<div style="text-align:center;padding:var(--sp-lg);color:var(--muted)">No members found matching "${escapeHtml(query)}"</div>`;
          return;
        }

        listContainer.innerHTML = members.map(m => `
          <div class="card card-body" style="padding:var(--sp-sm) var(--sp-md);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
            <div style="display:flex;align-items:center;gap:var(--sp-sm);min-width:0;flex:1">
              ${renderAvatar(m.full_name || 'Member', 'sm')}
              <div style="min-width:0">
                <div style="font-weight:var(--fw-semibold);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.full_name)}</div>
                <div style="font-size:var(--fs-xs);color:var(--muted)">${escapeHtml(m.phone || '')}${m.plan ? ` · ${escapeHtml(m.plan.name)}` : ''}</div>
              </div>
            </div>
            <button class="btn btn-primary btn-sm btn-do-checkin" data-mid="${m.id}" data-mname="${escapeHtml(m.full_name)}" style="border-radius:var(--r-full);padding:4px 12px;font-size:var(--fs-xs);flex-shrink:0">
              Check In
            </button>
          </div>
        `).join('');

        listContainer.querySelectorAll('.btn-do-checkin').forEach(btn => {
          btn.addEventListener('click', async () => {
            const mid = btn.dataset.mid;
            const name = btn.dataset.mname;
            btn.disabled = true;
            btn.textContent = 'Checking in...';
            const res = await checkInMember(mid, 'ENTRY');
            if (res.ok) {
              showToast(`${name} checked in successfully!`, 'success');
              modal.remove();
              await loadData();
            } else {
              showToast(res.error?.message || 'Check-in failed', 'error');
              btn.disabled = false;
              btn.textContent = 'Check In';
            }
          });
        });
      }

      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          fetchAndRenderMembers(e.target.value.trim());
        }, 300);
      });

      fetchAndRenderMembers();
    }

    el.innerHTML = `
      ${renderHeader({
        title: 'Live Access',
        showBack: router.depth > 1,
        actions: [
          { icon: 'access', label: 'Check In', onClick: () => openCheckinModal() },
          { icon: 'refresh', label: 'Refresh', onClick: () => loadData() },
        ],
      })}
      <div class="scroll-view" id="ac-scroll">${renderListSkeleton()}</div>
    `;

    bindHeaderEvents(el, {
      onBack: () => {
        navigate.pop();
      },
      actions: [
        { icon: 'access', onClick: () => openCheckinModal() },
        { icon: 'refresh', onClick: () => loadData() },
      ],
    });

    await loadData();

    attachLiveRefresh(el, loadData, 15000);
    
    // Expose refresh for quick-assign sheet and other external triggers
    window.__refreshAccess = () => { if (document.body.contains(el)) loadData(); };
  },
  async unmount() {
    window.__refreshAccess = null;
  }
};

// Quick-assign: tap an unmapped "User X" punch → pick member → link instantly.
async function openQuickAssign(bioId) {
  const overlay = document.createElement('div');
  overlay.id = 'quick-assign-overlay';
  overlay.innerHTML = `
    <div class="qa-sheet">
      <div class="qa-handle"></div>
      <h3>Who is biometric ID ${escapeHtml(bioId)}?</h3>
      <p class="qa-sub">Pick the member — all their punches get linked.</p>
      <input id="qa-search" type="search" placeholder="Type member name…" autocomplete="off">
      <div id="qa-results"><div class="qa-loading">Loading members…</div></div>
      <button id="qa-close" class="qa-close">Cancel</button>
    </div>
    <style>
      #quick-assign-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100; display: flex; align-items: flex-end; animation: qaFade 0.2s; }
      @keyframes qaFade { from { opacity: 0; } }
      .qa-sheet { background: #fff; width: 100%; border-radius: 20px 20px 0 0; padding: 12px 20px calc(20px + env(safe-area-inset-bottom)); max-height: 75vh; display: flex; flex-direction: column; animation: qaSlide 0.25s; }
      @keyframes qaSlide { from { transform: translateY(40px); } }
      .qa-handle { width: 40px; height: 4px; background: #e2e8f0; border-radius: 2px; margin: 0 auto 12px; }
      .qa-sheet h3 { margin: 0 0 4px 0; font-size: 18px; font-weight: 800; }
      .qa-sub { margin: 0 0 12px 0; font-size: 13px; color: #64748b; }
      #qa-search { width: 100%; padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 15px; box-sizing: border-box; margin-bottom: 8px; }
      #qa-search:focus { outline: none; border-color: #3b82f6; }
      #qa-results { overflow-y: auto; flex: 1; min-height: 120px; }
      .qa-row { padding: 13px 4px; border-bottom: 1px solid #f1f5f9; font-size: 15px; cursor: pointer; }
      .qa-row:active { background: #eff6ff; }
      .qa-row b { font-weight: 700; }
      .qa-row span { color: #64748b; font-size: 13px; margin-left: 6px; }
      .qa-loading, .qa-empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 14px; }
      .qa-close { margin-top: 12px; width: 100%; padding: 13px; border: none; background: #f1f5f9; border-radius: 12px; font-weight: 700; font-size: 15px; color: #475569; cursor: pointer; }
    </style>`;
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#qa-close').addEventListener('click', close);
  
  let members = [];
  let qaPage = 1;
  let qaTotal = 0;
  let qaQuery = '';
  let qaLoading = false;
  let qaLinking = false;
  const resultsEl = overlay.querySelector('#qa-results');
  const searchEl = overlay.querySelector('#qa-search');

  const renderResults = () => {
    const rows = members.map(m => `<div class="qa-row" data-qa-pick="${m.id}"><b>${escapeHtml(m.full_name)}</b>${m.phone ? `<span>${escapeHtml(m.phone)}</span>` : ''}</div>`).join('');
    const more = members.length < qaTotal
      ? `<button id="qa-more" style="width:100%;padding:12px;border:none;background:none;color:#2563eb;font-weight:700;font-size:14px;cursor:pointer">Show more (${members.length} of ${qaTotal})</button>`
      : (members.length ? `<div style="padding:10px;text-align:center;color:#94a3b8;font-size:12px">Showing ${members.length} of ${qaTotal} members</div>` : '');
    resultsEl.innerHTML = (members.length || more)
      ? rows + more
      : '<div class="qa-empty">No members found</div>';
    resultsEl.querySelectorAll('[data-qa-pick]').forEach(row => {
      row.addEventListener('click', async () => {
        // V3-L21: a double-tap used to fire the link twice.
        if (qaLinking) return;
        qaLinking = true;
        const memberId = Number(row.dataset.qaPick);
        row.style.background = '#dcfce7';
        const res = await apiRequest('/api/mobile/v1/rrr/mappings/bulk-resolve', {
          method: 'POST', body: { mappings: [{ external_id: bioId, member_id: memberId }] },
        });
        if (res.ok && res.data.linked === 1) {
          showToast(`ID ${bioId} linked ✓`);
          close();
          // Refresh the access feed to show the name
          if (window.__refreshAccess) window.__refreshAccess();
        } else {
          showToast(res.error?.message || 'Link failed — try again', 'error');
          row.style.background = '';
          qaLinking = false;
        }
      });
    });
    resultsEl.querySelector('#qa-more')?.addEventListener('click', () => {
      qaPage += 1;
      loadQaMembers(false);
    });
  };

  async function loadQaMembers(reset) {
    if (qaLoading) return;
    qaLoading = true;
    if (reset) { qaPage = 1; members = []; }
    const res = await apiRequest(`/api/mobile/v1/members?page=${qaPage}&page_size=30${qaQuery ? `&q=${encodeURIComponent(qaQuery)}` : ''}`);
    qaLoading = false;
    if (res.ok) {
      const got = res.data.members || [];
      qaTotal = res.data.pagination?.total ?? (reset ? got.length : members.length + got.length);
      const seen = new Set(members.map(m => m.id));
      members = reset ? got : [...members, ...got.filter(m => !seen.has(m.id))];
    }
    renderResults();
  }

  let memberSearchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(memberSearchTimer);
    memberSearchTimer = setTimeout(() => {
      qaQuery = searchEl.value.trim();
      loadQaMembers(true);
    }, 300);
  });

  loadQaMembers(true);
  // Focus synchronously (no setTimeout) so iOS opens the keyboard —
  // setTimeout breaks the user-gesture chain.
  searchEl.focus();
}
