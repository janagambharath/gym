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
    el.innerHTML = `<main class="rrr-page rrr-detail">
      <h1>Mapping review unavailable</h1>
      <p>Retry after reconnecting to RRR.</p>
      <button id="rrr-retry" class="rrr-btn">Retry</button>
    </main>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const events = unresolved.data.events || [];
  const groups = groupById(events);
  const totalPunches = events.length;
  
  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Integrations</button>
      <div class="rrr-brand"><b>RRR</b><span>Biometric mapping</span></div>
    </header>
    
    <div class="rrr-map-hero">
      <h1>Unmapped punches</h1>
      <p class="rrr-map-sub">These punches couldn't be matched to members automatically. Link them below — high-confidence matches (90%+) are auto-linked when punches arrive.</p>
      ${groups.length ? `
      <div class="rrr-map-stats">
        <div class="rrr-stat">
          <span class="rrr-stat-num">${groups.length}</span>
          <span class="rrr-stat-label">Unmapped IDs</span>
        </div>
        <div class="rrr-stat">
          <span class="rrr-stat-num">${totalPunches}</span>
          <span class="rrr-stat-label">Total punches</span>
        </div>
      </div>` : ''}
    </div>

    ${groups.length ? `
    <label class="rrr-search">
      <span class="rrr-search-label">Find member to link</span>
      <input id="rrr-member-search" type="search" placeholder="Type a name or phone…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </label>
    <p id="rrr-search-meta" class="rrr-muted-copy"></p>
    <section class="rrr-map-list" id="rrr-groups">${groupsHtml(groups, [])}</section>
    ` : `
    <div class="rrr-empty-state">
      <div class="rrr-empty-icon">✓</div>
      <h2>All punches mapped</h2>
      <p>Every biometric punch is linked to a member. New unknown IDs will appear here automatically.</p>
    </div>`}
    <p id="rrr-map-error" class="rrr-form-error" role="alert"></p>
  </main>
  <style>
    .rrr-map-hero { margin-bottom: 20px; }
    .rrr-map-hero h1 { font-size: 28px; font-weight: 800; margin: 0 0 8px 0; letter-spacing: -0.5px; }
    .rrr-map-sub { color: #64748b; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0; }
    .rrr-map-stats { display: flex; gap: 12px; }
    .rrr-stat { background: #f1f5f9; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 100px; }
    .rrr-stat-num { display: block; font-size: 24px; font-weight: 800; color: #0f172a; }
    .rrr-stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .rrr-back-btn { background: none; border: none; color: #3b82f6; font-size: 15px; font-weight: 600; cursor: pointer; padding: 8px 0; }
    .rrr-search-label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    .rrr-map-list { display: flex; flex-direction: column; gap: 12px; }
    .rrr-map-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .rrr-map-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
    .rrr-bio-id { display: flex; align-items: center; gap: 10px; }
    .rrr-bio-badge { background: #fef3c7; color: #92400e; font-weight: 800; font-size: 13px; padding: 6px 12px; border-radius: 20px; }
    .rrr-bio-num { font-size: 20px; font-weight: 800; color: #0f172a; }
    .rrr-punch-count { background: #eff6ff; color: #1d4ed8; font-size: 13px; font-weight: 700; padding: 6px 12px; border-radius: 20px; white-space: nowrap; }
    .rrr-map-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .rrr-meta-chip { font-size: 12px; color: #64748b; background: #f8fafc; padding: 4px 10px; border-radius: 8px; }
    .rrr-map-actions { display: flex; gap: 8px; }
    .rrr-map-select { flex: 1; padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 14px; background: #fff; min-width: 0; }
    .rrr-map-select:focus { outline: none; border-color: #3b82f6; }
    .rrr-map-btn { background: #10b981; color: #fff; border: none; padding: 12px 20px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap; }
    .rrr-map-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .rrr-map-btn:active { transform: scale(0.98); }
    .rrr-empty-state { text-align: center; padding: 48px 24px; }
    .rrr-empty-icon { width: 64px; height: 64px; background: #dcfce7; color: #16a34a; font-size: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-weight: 800; }
    .rrr-empty-state h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px 0; }
    .rrr-empty-state p { color: #64748b; font-size: 14px; margin: 0; }
  </style>`;
  
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
  if (!groups.length) return '';
  const options = people.map(p => `<option value="${p.id}">${esc(p.full_name)} · ${esc(p.phone || '')}</option>`).join('');
  return groups.map(g => {
    const latestDate = new Date(g.latest);
    const dateStr = latestDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const timeStr = latestDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `<article class="rrr-map-card" data-group="${esc(g.id)}">
      <div class="rrr-map-card-top">
        <div class="rrr-bio-id">
          <span class="rrr-bio-badge">BIOMETRIC</span>
          <span class="rrr-bio-num">ID ${esc(g.id)}</span>
        </div>
        <span class="rrr-punch-count">${g.count} punch${g.count === 1 ? '' : 'es'}</span>
      </div>
      <div class="rrr-map-meta">
        <span class="rrr-meta-chip">📅 ${dateStr} ${timeStr}</span>
        ${g.device ? `<span class="rrr-meta-chip">⌁ ${esc(g.device.slice(-6))}</span>` : ''}
      </div>
      <div class="rrr-map-actions">
        <select class="rrr-map-select" data-map-select>
          <option value="">Choose member…</option>${options}
        </select>
        <button class="rrr-map-btn" data-resolve="${encodeURIComponent(g.id)}">Link →</button>
      </div>
    </article>`;
  }).join('');
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
      const card = button.closest('.rrr-map-card');
      const select = card.querySelector('[data-map-select]');
      if (!select.value) { errorEl.textContent = 'Choose the matching member first.'; select.focus(); return; }
      errorEl.textContent = '';
      button.disabled = true;
      button.textContent = 'Linking…';
      const response = await apiRequest(`/api/mobile/v1/rrr/mappings/${button.dataset.resolve}`, {
        method: 'POST', body: { member_id: Number(select.value) },
      });
      if (response.ok) {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        setTimeout(() => load(el), 300);
      } else {
        button.disabled = false;
        button.textContent = 'Link →';
        errorEl.textContent = esc(response?.error?.message || 'Mapping failed. Try again.');
      }
    });
  });
}
