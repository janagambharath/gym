/* Members List Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMemberCard, renderListSkeleton, renderEmptyState, renderErrorState } from '../components.js';
import { icon } from '../icons.js';
import { debounce, escapeHtml, formatInteger } from '../utils.js';

export default {
  async mount(el) {
    let members = [], total = 0, page = 1, loading = false, filter = 'all', query = '';

    el.innerHTML = `
      ${renderHeader({ title: 'Members', showBack: true, actions: [{ icon: 'add', label: 'Add' }, { icon: 'upload', label: 'Import' }] })}
      <div style="padding:var(--sp-sm) var(--sp-lg)">
        <div class="search-bar">
          <span class="search-icon">${icon('search', 18)}</span>
          <input type="text" placeholder="Search members..." id="member-search">
        </div>
      </div>
      <div class="filter-chips" id="member-filters">
        <button class="filter-chip active" data-filter="all">All</button>
        <button class="filter-chip" data-filter="active">Active</button>
        <button class="filter-chip" data-filter="expiring">Expiring</button>
        <button class="filter-chip" data-filter="expired">Expired</button>
      </div>
      <div id="member-admin-actions" style="display:flex;gap:8px;padding:0 var(--sp-lg) 8px;flex-wrap:wrap"></div>
      <div class="scroll-view" id="members-list">${renderListSkeleton()}</div>
      <button class="fab" id="fab-add">${icon('add', 24, 'white')}</button>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('add-member') }, { onClick: () => navigate.push('member-import') }] });
    el.querySelector('#fab-add').addEventListener('click', () => navigate.push('add-member'));

    // Admin actions: Restore deleted + Delete expired only
    const adminEl = el.querySelector('#member-admin-actions');
    if (adminEl) {
      adminEl.innerHTML = `
        <button id="btn-restore-deleted" class="filter-chip" style="border-color:#16a34a;color:#16a34a">♻️ Restore Deleted</button>
        <button id="btn-delete-expired" class="filter-chip" style="border-color:#dc2626;color:#dc2626">🗑️ Delete Expired Only</button>
      `;
      el.querySelector('#btn-restore-deleted')?.addEventListener('click', async () => {
        if (!confirm('Restore all deleted members?')) return;
        const btn = el.querySelector('#btn-restore-deleted');
        btn.disabled = true; btn.textContent = 'Restoring...';
        try {
          const res = await apiRequest('/api/mobile/v1/rrr/restore-deleted-members', { method: 'POST' });
          alert(res.ok ? `✓ ${res.data.message}` : 'Failed: ' + (res.error?.message || 'Unknown'));
          if (res.ok) { page = 1; members = []; loadMembers(); }
        } catch(e) { alert('Error: ' + e.message); }
        btn.disabled = false; btn.textContent = '♻️ Restore Deleted';
      });
      el.querySelector('#btn-delete-expired')?.addEventListener('click', async () => {
        if (!confirm('Delete ONLY expired members from Renewal Desk? Active members will NOT be touched.')) return;
        const btn = el.querySelector('#btn-delete-expired');
        btn.disabled = true; btn.textContent = 'Deleting...';
        try {
          // Get expired members first
          const listRes = await apiRequest('/api/mobile/v1/members?status=expired&page=1&page_size=500');
          const expired = listRes.ok ? (listRes.data.members || []) : [];
          if (!expired.length) { alert('No expired members found.'); btn.disabled = false; btn.textContent = '🗑️ Delete Expired Only'; return; }
          if (!confirm(`Found ${expired.length} expired members. Delete them all?`)) { btn.disabled = false; btn.textContent = '🗑️ Delete Expired Only'; return; }
          let ok = 0, fail = 0;
          for (const m of expired) {
            try {
              const r = await apiRequest(`/api/mobile/v1/members/${m.id}/deactivate`, { method: 'POST' });
              r.ok ? ok++ : fail++;
            } catch(e) { fail++; }
          }
          alert(`✓ Deleted ${ok}${fail ? `, ${fail} failed` : ''}`);
          page = 1; members = []; loadMembers();
        } catch(e) { alert('Error: ' + e.message); }
        btn.disabled = false; btn.textContent = '🗑️ Delete Expired Only';
      });
    }

    // Filter chips
    el.querySelector('#member-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filter = chip.dataset.filter;
      page = 1; members = [];
      loadMembers();
    });

    // Search
    const searchInput = el.querySelector('#member-search');
    const doSearch = debounce((q) => { query = q; page = 1; members = []; loadMembers(); }, 400);
    searchInput.addEventListener('input', (e) => doSearch(e.target.value.trim()));

    // Infinite scroll
    const listEl = el.querySelector('#members-list');
    listEl.addEventListener('scroll', () => {
      if (loading || members.length >= total) return;
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 200) {
        page++; loadMembers(true);
      }
    });

    async function loadMembers(append = false) {
      loading = true;
      if (!append) listEl.innerHTML = renderListSkeleton();
      let url = `/api/mobile/v1/members?page=${page}&page_size=20`;
      if (query) url += `&q=${encodeURIComponent(query)}`;
      if (filter === 'expiring') url += `&expiring_within_days=7`;
      else if (filter !== 'all') url += `&status=${filter}`;
      const res = await apiRequest(url);
      loading = false;
      if (!res.ok) {
        if (res.error.status === 401) return handleLogout();
        listEl.innerHTML = renderErrorState(res.error.message);
        return;
      }
      const newMembers = res.data.members || [];
      total = res.data.pagination?.total || 0;
      members = append ? [...members, ...newMembers] : newMembers;
      if (members.length === 0) {
        listEl.innerHTML = renderEmptyState({ icon: 'members', title: 'No members found', text: query ? 'Try a different search term' : 'Add your first member to get started', actionText: !query ? 'Add Member' : undefined, actionId: 'add-empty' });
        listEl.querySelector('#add-empty')?.addEventListener('click', () => navigate.push('add-member'));
      } else {
        listEl.innerHTML = `<div class="scroll-content">
          <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-sm);color:var(--muted)">${formatInteger(filter === 'expiring' ? members.length : total)} member${total !== 1 ? 's' : ''}</div>
          <div class="card" style="margin:0 var(--sp-lg)">${members.map(m => renderMemberCard(m)).join('')}</div>
        </div>`;
        listEl.querySelectorAll('[data-member-id]').forEach(card => {
          card.addEventListener('click', () => {
            const m = members.find(x => String(x.id) === card.dataset.memberId);
            if (m) navigate.push('member-detail', { member: JSON.stringify(m) });
          });
        });
      }
    }

    await loadMembers();
  }
};
