/* Access Control Screen */
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
    let refreshTimer = null;

    async function loadData() {
      const scroll = el.querySelector('#ac-scroll');
      if (!scroll) return;

      // Parallel fetch summary + current tab feed
      const summaryPromise = apiRequest('/api/mobile/v1/access/summary');
      const feedPromise = apiRequest(`/api/mobile/v1/access/events?per_page=25${currentTab === 'all' ? '' : `&type=${currentTab}`}`);

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
                    <div class="list-item" style="cursor:pointer" data-event-member-id="${l.member_id || ''}" data-bio-id="${(!l.member_id && l.biometric_user_id) ? escapeHtml(l.biometric_user_id) : ''}">
                      <div style="width:34px;height:34px;border-radius:var(--r-full);background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        ${icon(iconName, 16, iconColor)}
                      </div>
                      <div class="list-item-content">
                        <div class="list-item-title">${escapeHtml(l.member_name || 'Unknown')}${(!l.member_id && l.biometric_user_id) ? ' <span style="font-size:11px;color:#3b82f6;font-weight:700">· tap to assign</span>' : ''}</div>
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
      scroll.querySelector('#stat-entries')?.addEventListener('click', () => { currentTab = 'entry'; loadData(); });
      scroll.querySelector('#stat-exits')?.addEventListener('click', () => { currentTab = 'exit'; loadData(); });
      scroll.querySelector('#banner-denied')?.addEventListener('click', () => { currentTab = 'denied'; loadData(); });

      // Remote Turnstile / Door Unlock
      const unlockBtn = scroll.querySelector('#btn-remote-unlock');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', async () => {
          unlockBtn.disabled = true;
          unlockBtn.textContent = 'Unlocking...';
          const res = await apiRequest('/api/mobile/v1/access/remote-unlock', {
            method: 'POST',
            body: { delay_seconds: 5 },
          });
          if (res.ok) {
            showToast('🔓 Turnstile / Door unlocked for 5s!', 'success');
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
          const bioId = row.dataset.bioId;
          if (mid) {
            navigate.push('member-detail', { memberId: mid });
          } else if (bioId) {
            openQuickAssign(bioId);
          }
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
        const url = `/api/mobile/v1/members?page_size=20${query ? `&q=${encodeURIComponent(query)}` : '&status=active'}`;
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
        navigate.pop();
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
  const resultsEl = overlay.querySelector('#qa-results');
  const searchEl = overlay.querySelector('#qa-search');
  
  const renderResults = (q) => {
    const query = (q || '').toLowerCase().trim();
    const filtered = query
      ? members.filter(m => m.full_name.toLowerCase().includes(query) || (m.phone || '').includes(query)).slice(0, 30)
      : members.slice(0, 30);
    resultsEl.innerHTML = filtered.length
      ? filtered.map(m => `<div class="qa-row" data-qa-pick="${m.id}"><b>${escapeHtml(m.full_name)}</b>${m.phone ? `<span>${escapeHtml(m.phone)}</span>` : ''}</div>`).join('')
      : '<div class="qa-empty">No members found</div>';
    resultsEl.querySelectorAll('[data-qa-pick]').forEach(row => {
      row.addEventListener('click', async () => {
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
          showToast('Link failed — try again');
          row.style.background = '';
        }
      });
    });
  };
  
  searchEl.addEventListener('input', () => renderResults(searchEl.value));
  
  const res = await apiRequest('/api/mobile/v1/members?page=1&page_size=500');
  members = res.ok ? (res.data.members || []) : [];
  renderResults('');
  // Focus synchronously (no setTimeout) so iOS opens the keyboard —
  // setTimeout breaks the user-gesture chain.
  searchEl.focus();
}
