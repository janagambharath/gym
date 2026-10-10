import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;
let searchTimer = null;

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading unresolved biometric punches…</div>';
  const unresolved = await apiRequest('/api/mobile/v1/rrr/mappings/unresolved');
  if (!unresolved.ok) {
    el.innerHTML = '<main class="rrr-page rrr-detail"><h1>Mapping review unavailable</h1><p>Retry after reconnecting to RRR.</p><button id="rrr-retry">Retry</button></main>';
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const events = unresolved.data.events || [];
  const groups = groupById(events);
  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Biometric mapping review</span></div></header>
    <h1>Unmapped punches</h1>
    <p>Mapping an external biometric ID to the correct member replays all retained punches for that ID.</p>
    <label class="rrr-search">Search members<input id="rrr-member-search" type="search" placeholder="Type a name or phone…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <p id="rrr-search-meta" class="rrr-muted-copy"></p>
    <section class="rrr-panel" id="rrr-groups">${groupsHtml(groups, [])}</section>
    <p id="rrr-map-error" class="rrr-form-error" role="alert"></p>
  </main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
  const searchInput = el.querySelector('#rrr-member-search');
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshMembers(el, groups, searchInput.value.trim()), 300);
  });
  await refreshMembers(el, groups, '');
}

function groupById(events) {
  const map = new Map();
  for (const e of events) {
    const key = e.biometric_user_id;
    if (!map.has(key)) map.set(key, { id: key, count: 0, latest: e.punch_time, source: e.source, device: e.device_serial });
    const g = map.get(key);
    g.count += 1;
    if (e.punch_time > g.latest) { g.latest = e.punch_time; g.source = e.source; g.device = e.device_serial; }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (b.latest > a.latest ? 1 : -1));
}

function groupsHtml(groups, people) {
  if (!groups.length) return '<p class="rrr-no-data">No unresolved biometric punches. New unknown IDs will appear here automatically.</p>';
  const options = people.map(p => `<option value="${p.id}">${esc(p.full_name)} · ${esc(p.phone || '')}</option>`).join('');
  return groups.map(g => `<article class="rrr-opportunity" data-group="${esc(g.id)}">
    <div><h2>Biometric ID ${esc(g.id)}</h2><p>${g.count} punch${g.count === 1 ? '' : 'es'} · ${esc(g.source || '')} · ${esc(g.device || 'device unknown')} · latest ${esc(new Date(g.latest).toLocaleString())}</p></div>
    <div><select data-map-select><option value="">Choose member…</option>${options}</select>
    <button data-resolve="${encodeURIComponent(g.id)}">Map ID & replay</button></div>
  </article>`).join('');
}

async function fetchMembers(query) {
  const params = new URLSearchParams({ page: '1', page_size: '100' });
  if (query) params.set('q', query);
  const r = await apiRequest(`/api/mobile/v1/members?${params.toString()}`);
  return r.ok ? r.data.members || [] : [];
}

async function refreshMembers(el, groups, query) {
  const meta = el.querySelector('#rrr-search-meta');
  const people = await fetchMembers(query);
  if (meta) meta.textContent = query
    ? `${people.length} member${people.length === 1 ? '' : 's'} match "${query}"`
    : (people.length >= 100 ? 'Showing first 100 members — search to narrow down.' : '');
  const section = el.querySelector('#rrr-groups');
  if (section) {
    section.innerHTML = groupsHtml(groups, people);
    wireResolve(el, groups);
  }
}

function wireResolve(el, groups) {
  el.querySelectorAll('[data-resolve]').forEach(button => {
    if (button.dataset.wired) return;
    button.dataset.wired = '1';
    button.addEventListener('click', async () => {
      const errorEl = el.querySelector('#rrr-map-error');
      const select = button.closest('.rrr-opportunity').querySelector('[data-map-select]');
      if (!select.value) { errorEl.textContent = 'Choose the matching member first.'; select.focus(); return; }
      errorEl.textContent = '';
      button.disabled = true;
      const response = await apiRequest(`/api/mobile/v1/rrr/mappings/${button.dataset.resolve}`, {
        method: 'POST', body: { member_id: Number(select.value) },
      });
      if (response.ok) await load(el);
      else {
        button.disabled = false;
        errorEl.textContent = esc(response?.error?.message || 'Mapping failed. Try again.');
      }
    });
  });
}
