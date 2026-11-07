import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatDate, formatTime, dedupeByKey } from '../utils.js';
import { showToast } from '../components.js';
import { attachLiveRefresh } from '../live-refresh.js';

export default { async mount(el, params) {
  await load(el, params);
  attachLiveRefresh(el, () => load(el, params, true), 15000);
} };

const esc = escapeHtml;
// V6-L25: background (live-refresh) failures used to be silent — toast once
// and stamp the count line with the last good time.
let attBgErrorShown = false;
let attLastGoodAt = null;
const punchKey = (p) => p.id ?? `${p.punch_time || ''}|${p.direction || ''}|${p.biometric_user_id || ''}`;

let attPage = 1;
let attTotalPages = 1;
let attTotalPunches = 0;
let attPunches = [];

async function load(el, params, background = false, append = false) {
  const memberId = params?.id;
  if (!memberId) {
    el.innerHTML = '<main class="rrr-page"><p>No member specified.</p></main>';
    return;
  }

  if (!background && !append) { attPage = 1; attPunches = []; el.innerHTML = '<div class="rrr-loading">Loading biometric records…</div>'; }

  // V5-M12: fetch-then-advance — the old code incremented attPage in the
  // click handler and load() immediately reset it to 1, so "Load more"
  // re-fetched page 1 forever. The page advances only on success now.
  const fetchPage = append ? attPage + 1 : attPage;

  let res;
  if (background) {
    // Re-fetch every loaded page and rebuild (never append the same page twice).
    const pages = await Promise.all(Array.from({ length: attPage }, (_, i) =>
      apiRequest(`/api/mobile/v1/rrr/member/${memberId}/attendance?page=${i + 1}&per_page=50`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) {
      // V6-L32: dedupe across the re-fetched pages.
      attPunches = dedupeByKey(pages.flatMap(r => r.data.events || []), punchKey);
      attTotalPages = res.data.pagination?.total_pages ?? attTotalPages;
    }
  } else {
    res = await apiRequest(`/api/mobile/v1/rrr/member/${memberId}/attendance?page=${fetchPage}&per_page=50`);
  }
  if (!res.ok) {
    if (background) {
      if (!attBgErrorShown) { attBgErrorShown = true; showToast('Could not refresh the biometric records — showing the last loaded punches.', 'error'); }
      const countEl = el.querySelector('#rrr-att-count');
      if (countEl && attLastGoodAt) countEl.textContent = `Showing ${attPunches.length} of ${attTotalPunches} punches · last updated ${formatTime(attLastGoodAt)}`;
      return;
    }
    if (append) {
      // V5-M12: an append failure must toast and keep the page — the old
      // code reset attPage and re-rendered page 1.
      showToast(res.error?.message || 'Could not load more records.', 'error');
      return;
    }
    el.innerHTML = `<main class="rrr-page rrr-detail">
      <header class="rrr-header"><button id="rrr-back" class="rrr-back-btn">← Member</button></header>
      <h1>Biometric Records</h1>
      <p>Could not load records: ${esc(res.error?.message || 'Unknown error')}</p>
      <button class="btn btn-primary" id="rrr-retry">Try Again</button>
    </main>`;
    el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
    // V8-L25: the failure state had no retry (Back only).
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el, params));
    return;
  }
  attBgErrorShown = false;
  attLastGoodAt = new Date();

  const data = res.data;
  const member = data.member || {};
  if (!background) {
    attTotalPages = data.pagination?.total_pages ?? 1;
    // V6-L32: dedupe the append — a new punch between page fetches shifts
    // rows and the boundary punch renders twice.
    attPunches = append
      ? dedupeByKey([...attPunches, ...(data.events || [])], punchKey)
      : dedupeByKey(data.events || [], punchKey);
    if (append) attPage = fetchPage;
  }
  const punches = attPunches;
  const stats = data.stats || {};
  const totalPunches = stats.total_punches ?? punches.length;
  attTotalPunches = totalPunches;

  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Member</button>
      <div class="rrr-brand"><b>RRR</b><span>Biometric records</span></div>
    </header>
    
    <div class="rrr-att-hero">
      <h1>${esc(member.name || 'Member')}</h1>
      <p class="rrr-att-sub">Biometric ID ${esc(member.enroll_number || '—')}</p>
      <div class="rrr-att-stats">
        <div class="rrr-stat">
          <span class="rrr-stat-num">${totalPunches}</span>
          <span class="rrr-stat-label">Total punches</span>
        </div>
        <div class="rrr-stat">
          <span class="rrr-stat-num">${stats.last_30_days || 0}</span>
          <span class="rrr-stat-label">Last 30 days</span>
        </div>
      </div>
    </div>

    ${punches.length ? `
    <div class="rrr-att-list">
      ${punches.map(p => {
        // V5-L25: punch times in the gym timezone, not the device's.
        const dateStr = formatDate(p.punch_time);
        const timeStr = formatTime(p.punch_time);
        return `<div class="rrr-att-item">
          <div class="rrr-att-icon">→</div>
          <div class="rrr-att-info">
            <div class="rrr-att-date">${dateStr} <span class="rrr-att-time">${timeStr}</span></div>
          <div class="rrr-att-meta">${[p.biometric_user_id ? `ID ${esc(p.biometric_user_id)}` : '', p.device_serial ? esc(p.device_serial) : '', esc(p.verify_method || p.source || 'Entry')].filter(Boolean).join(' · ')}</div>
          </div>
          <span class="rrr-att-badge">${esc(p.direction === "exit" ? "Exit" : "Entry")}</span>
        </div>`;
      }).join('')}
    </div>
    <div style="text-align:center;padding:var(--sp-md)">
      <div id="rrr-att-count" style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${punches.length} of ${totalPunches} punches</div>
      ${attPage < attTotalPages ? `<button class="btn btn-secondary" id="rrr-att-more">Load more</button>` : ''}
    </div>` : `
    <div class="rrr-empty-state">
      <div class="rrr-empty-icon">⌁</div>
      <h2>No punches yet</h2>
      <p>This member hasn't punched on the biometric terminal yet.</p>
    </div>`}
  </main>
  <style>
    .rrr-att-hero { margin-bottom: 20px; }
    .rrr-att-hero h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px 0; }
    .rrr-att-sub { color: #64748b; font-size: 14px; margin: 0 0 16px 0; }
    .rrr-att-stats { display: flex; gap: 12px; }
    .rrr-stat { background: #f1f5f9; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 100px; }
    .rrr-stat-num { display: block; font-size: 24px; font-weight: 800; color: #0f172a; }
    .rrr-stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .rrr-back-btn { background: none; border: none; color: #3b82f6; font-size: 15px; font-weight: 600; cursor: pointer; padding: 8px 0; }
    .rrr-att-list { display: flex; flex-direction: column; }
    .rrr-att-item { display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid #f1f5f9; }
    .rrr-att-icon { width: 40px; height: 40px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
    .rrr-att-info { flex: 1; }
    .rrr-att-date { font-weight: 600; font-size: 14px; }
    .rrr-att-time { color: #64748b; font-weight: 400; }
    .rrr-att-meta { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .rrr-att-badge { background: #dcfce7; color: #16a34a; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; }
    .rrr-empty-state { text-align: center; padding: 48px 24px; }
    .rrr-empty-icon { width: 64px; height: 64px; background: #f1f5f9; color: #94a3b8; font-size: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
    .rrr-empty-state h2 { font-size: 18px; margin: 0 0 8px 0; }
    .rrr-empty-state p { color: #64748b; font-size: 14px; margin: 0; }
  </style>`;

  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
  // V5-M12: load() advances attPage itself, only on success — the old
  // pre-increment here was undone by load()'s reset on every call.
  el.querySelector('#rrr-att-more')?.addEventListener('click', () => { load(el, params, false, true); });
}
