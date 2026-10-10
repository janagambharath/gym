/* Access Control Screen */
import { apiRequest, checkInMember } from '../api.js';
import { navigate } from '../app.js';
import { router } from '../router.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderBadge, renderEmptyState, renderAvatar, showToast } from '../components.js';
import { icon } from '../icons.js';
import { formatDateTime, formatInteger, escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    let currentTab = 'all'; // 'all' | 'inside' | 'entry' | 'exit' | 'denied'
    let summaryData = null;
    let refreshTimer = null;

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
                <span style="font-weight:var(--fw-bold);font-size:var(--fs-base)">${s.device_online ? 'Biometric Device Online' : 'Biometric Device Offline'}</span>
                ${s.device_name ? `<span style="font-size:var(--fs-xs);color:var(--muted)">· ${escapeHtml(s.device_name)}</span>` : ''}
              </div>
              ${lastEventText ? `<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:var(--sp-md)">Last event: ${escapeHtml(lastEventText)}</div>` : '<div style="margin-bottom:var(--sp-md)"></div>'}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
                <div style="cursor:pointer" id="stat-inside">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--status-active)">${formatInteger(s.inside_now || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div>
                </div>
                <div style="cursor:pointer" id="stat-entries">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatInteger(s.entries_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div>
                </div>
                <div style="cursor:pointer" id="stat-exits">
                  <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--warning)">${formatInteger(s.exits_today || 0)}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div>
                </div>
              </div>

              <!-- Attendance is always explicit. Physical access commands appear only after device commissioning. -->
              <div style="margin-top:var(--sp-lg);padding-top:var(--sp-md);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr;gap:var(--sp-sm)">
                <button class="btn btn-primary" id="btn-open-checkin" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);font-size:var(--fs-xs)">
                  ${icon('access', 16, 'white')} + Check In
                </button>
              </div>
              ${!s.remote_unlock_available ? `<p style="margin:var(--sp-sm) 0 0;font-size:var(--fs-xs);color:var(--muted)">${escapeHtml(s.remote_unlock_reason || 'Physical remote unlock is not commissioned for this device.')}</p>` : ''}
            </div>

            ${s.failed_commands > 0 ? `
              <div class="card" style="margin-top:var(--sp-md);padding:var(--sp-md);background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:space-between">
                <div style="font-size:var(--fs-xs);color:#B45309;display:flex;align-items:center;gap:var(--sp-xs)">
                  ${icon('alert', 16, '#B45309')}
                  <span><strong>${formatInteger(s.failed_commands)} command(s)</strong> failed to sync</span>
                </div>
                <button class="btn btn-sm btn-primary" id="btn-retry-sync" style="font-size:var(--fs-xs);padding:4px 10px">Retry All</button>
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

          <!-- Filter Tabs -->
          <div style="display:flex;gap:var(--sp-xs);padding:0 var(--sp-lg) var(--sp-md);overflow-x:auto;-webkit-overflow-scrolling:touch">
            ${[
              { id: 'all', label: 'All Events' },
              { id: 'inside', label: `Inside (${s.inside_now || 0})` },
              { id: 'entry', label: `Entries (${s.entries_today || 0})` },
              { id: 'exit', label: `Exits (${s.exits_today || 0})` },
              { id: 'denied', label: `Denied (${s.denied_today || 0})` },
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
                  <div class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)">
                    <div style="display:flex;align-items:center;gap:var(--sp-sm);cursor:pointer;flex:1;min-width:0" data-member-link="${m.id}">
                      ${renderAvatar(m.full_name || 'Member', 'md')}
                      <div class="list-item-content" style="min-width:0">
                        <div class="list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.full_name || 'Member')}</div>
                        <div class="list-item-subtitle">${m.phone ? escapeHtml(m.phone) + ' · ' : ''}In ${m.entered_at ? formatDateTime(m.entered_at) : 'recently'}</div>
                      </div>
                    </div>
                    <button class="btn btn-outline btn-sm btn-checkout" data-checkout-id="${m.id}" data-checkout-name="${escapeHtml(m.full_name || 'Member')}" style="padding:4px 10px;font-size:var(--fs-xs);border-radius:var(--r-full);flex-shrink:0">
                      Check Out
                    </button>
                  </div>
                `).join('')}
              </div>
            ` : renderEmptyState({ icon: 'access', title: 'No members inside', text: 'Members currently inside the gym will appear here when checked in' })}
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
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${l.member_id || ''}">
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
            ` : renderEmptyState({ icon: 'access', title: 'No events', text: 'Live access and check-in events will appear here' })}
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

      // Open Check In Modal
      scroll.querySelector('#btn-open-checkin')?.addEventListener('click', () => openCheckinModal());

      // Retry Failed Biometric Syncs
      scroll.querySelector('#btn-retry-sync')?.addEventListener('click', async () => {
        const btn = scroll.querySelector('#btn-retry-sync');
        if (btn) btn.disabled = true;
        const res = await apiRequest('/api/mobile/v1/access/retry-sync', { method: 'POST' });
        if (res.ok) {
          showToast(res.data?.message || 'Commands queued for retry', 'success');
          await loadData();
        } else {
          showToast(res.error?.message || 'Could not retry syncs', 'error');
          if (btn) btn.disabled = false;
        }
      });

      // Bind member link navigation
      scroll.querySelectorAll('[data-member-link]').forEach(row => {
        row.addEventListener('click', () => {
          const mid = row.dataset.memberLink;
          if (mid) navigate.push('member-detail', { memberId: mid });
        });
      });

      scroll.querySelectorAll('[data-event-member-id]').forEach(row => {
        row.addEventListener('click', () => {
          const mid = row.dataset.eventMemberId;
          if (mid) navigate.push('member-detail', { memberId: mid });
        });
      });

      // Bind Check Out buttons
      scroll.querySelectorAll('[data-checkout-id]').forEach(btn => {
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
        const url = `/api/mobile/v1/members?per_page=20${query ? `&search=${encodeURIComponent(query)}` : '&status=active'}`;
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
        if (refreshTimer) clearInterval(refreshTimer);
        if (router.depth > 1) {
          navigate.pop();
        } else {
          navigate.switchTab('home');
        }
      },
      actions: [
        { icon: 'access', onClick: () => openCheckinModal() },
        { icon: 'refresh', onClick: () => loadData() },
      ],
    });

    await loadData();

    // Auto-refresh every 15s to keep live status up to date
    refreshTimer = setInterval(() => {
      if (document.body.contains(el)) {
        loadData();
      } else {
        clearInterval(refreshTimer);
      }
    }, 15000);
  }
};
