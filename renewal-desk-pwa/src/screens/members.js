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
      ${renderHeader({ title: 'Members', actions: [{ icon: 'add', label: 'Add' }] })}
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
      <div class="scroll-view" id="members-list">${renderListSkeleton()}</div>
      <button class="fab" id="fab-add">${icon('add', 24, 'white')}</button>`;

    bindHeaderEvents(el, { actions: [{ onClick: () => navigate.push('add-member') }] });
    el.querySelector('#fab-add').addEventListener('click', () => navigate.push('add-member'));

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
      if (filter !== 'all' && filter !== 'expiring') url += `&status=${filter}`;
      const res = await apiRequest(url);
      loading = false;
      if (!res.ok) {
        if (res.error.status === 401) return handleLogout();
        listEl.innerHTML = renderErrorState(res.error.message);
        return;
      }
      const newMembers = res.data.members || [];
      total = res.data.pagination?.total || 0;
      if (filter === 'expiring') {
        const filtered = newMembers.filter(m => m.days_until_expiry != null && m.days_until_expiry >= 0 && m.days_until_expiry <= 7);
        members = append ? [...members, ...filtered] : filtered;
      } else {
        members = append ? [...members, ...newMembers] : newMembers;
      }
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
