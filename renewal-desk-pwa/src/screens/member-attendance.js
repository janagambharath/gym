import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';
import { attachLiveRefresh } from '../live-refresh.js';

export default { async mount(el, params) {
  await load(el, params);
  attachLiveRefresh(el, () => load(el, params, true), 15000);
} };

const esc = escapeHtml;

let attPage = 1;
let attTotalPages = 1;
let attPunches = [];

async function load(el, params, background = false) {
  const memberId = params?.id;
  if (!memberId) {
    el.innerHTML = '<main class="rrr-page"><p>No member specified.</p></main>';
    return;
  }

  if (!background) { attPage = 1; attPunches = []; el.innerHTML = '<div class="rrr-loading">Loading biometric records…</div>'; }

  let res;
  if (background) {
    // Re-fetch every loaded page and rebuild (never append the same page twice).
    const pages = await Promise.all(Array.from({ length: attPage }, (_, i) =>
      apiRequest(`/api/mobile/v1/rrr/member/${memberId}/attendance?page=${i + 1}&per_page=50`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) {
      attPunches = pages.flatMap(r => r.data.events || []);
      attTotalPages = res.data.pagination?.total_pages ?? attTotalPages;
    }
  } else {
    res = await apiRequest(`/api/mobile/v1/rrr/member/${memberId}/attendance?page=${attPage}&per_page=50`);
  }
  if (!res.ok) {
    if (background) return;
    el.innerHTML = `<main class="rrr-page rrr-detail">
      <header class="rrr-header"><button id="rrr-back" class="rrr-back-btn">← Member</button></header>
      <h1>Biometric Records</h1>
      <p>Could not load records: ${esc(res.error?.message || 'Unknown error')}</p>
    </main>`;
    el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
    return;
  }

  const data = res.data;
  const member = data.member || {};
  if (!background) {
    attTotalPages = data.pagination?.total_pages ?? 1;
    attPunches = [...attPunches, ...(data.events || [])];
  }
  const punches = attPunches;
  const stats = data.stats || {};
  const totalPunches = stats.total_punches ?? punches.length;

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
        const dt = new Date(p.punch_time);
        const dateStr = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
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
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${punches.length} of ${totalPunches} punches</div>
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
  el.querySelector('#rrr-att-more')?.addEventListener('click', () => { attPage++; load(el, params); });
}
