import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;

// Local state
let groups = [];
let allMembers = [];
let selections = new Map(); // biometric_id -> member object
let openPicker = null; // biometric_id with open picker

async function load(el) {
  // Don't clear selections on re-mount — user may be mid-task on 26 IDs
  openPicker = null;
  el.innerHTML = '<div class="rrr-loading">Loading unmapped punches…</div>';
  
  const [unresolved, membersRes] = await Promise.all([
    apiRequest('/api/mobile/v1/rrr/mappings/unresolved'),
    apiRequest('/api/mobile/v1/members?page=1&page_size=500'),
  ]);
  
  if (!unresolved.ok) {
    el.innerHTML = `<main class="rrr-page"><h1>Couldn't load</h1><p>Check your connection and retry.</p><button id="rrr-retry" class="rrr-btn">Retry</button></main>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  
  allMembers = membersRes.ok ? (membersRes.data.members || []) : [];
  groups = groupById(unresolved.data.events || []);
  // Prune selections for IDs that are no longer unmapped (already linked)
  const groupIds = new Set(groups.map(g => g.id));
  for (const bid of selections.keys()) {
    if (!groupIds.has(bid)) selections.delete(bid);
  }
  render(el);
}

function groupById(events) {
  const map = new Map();
  for (const e of events) {
    const key = e.biometric_user_id;
    if (!map.has(key)) map.set(key, { id: key, count: 0, latest: e.punch_time });
    const g = map.get(key);
    g.count += 1;
    if (e.punch_time > g.latest) g.latest = e.punch_time;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function render(el) {
  const totalPunches = groups.reduce((s, g) => s + g.count, 0);
  
  el.innerHTML = `<main class="rrr-page bulk-map-page">
    <header class="rrr-header">
      <button id="bm-back" class="bm-back">‹</button>
      <div class="bm-title">
        <h1>Link biometric IDs</h1>
        <p>${groups.length} IDs · ${totalPunches} punches need a member</p>
      </div>
    </header>
    
    <div class="bm-hint">
      <span class="bm-hint-icon">💡</span>
      <p>Tap an ID, search the member name, tap to assign. Then hit <b>Link all</b> at the bottom.</p>
    </div>
    
    <div class="bm-list" id="bm-list">
      ${groups.map(cardHtml).join('')}
    </div>
    
    <div class="bm-footer" id="bm-footer" style="display:none">
      <div class="bm-footer-info"><span id="bm-count">0</span> ready to link</div>
      <button class="bm-link-all" id="bm-link-all">Link all →</button>
    </div>
    <div class="bm-danger-row">
      <button class="bm-clear-all" id="bm-clear-all">Clear all unmapped entries</button>
    </div>
    
    <div class="bm-progress" id="bm-progress" style="display:none">
      <div class="bm-progress-bar"><div class="bm-progress-fill" id="bm-fill"></div></div>
      <p id="bm-progress-text">Linking…</p>
    </div>
  </main>
  <style>
    .bulk-map-page { padding-bottom: 110px; }
    .bm-back { background: #f1f5f9; border: none; width: 36px; height: 36px; border-radius: 50%; font-size: 22px; color: #334155; cursor: pointer; flex-shrink: 0; }
    .bm-title h1 { font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.3px; }
    .bm-title p { font-size: 13px; color: #64748b; margin: 2px 0 0 0; }
    .bulk-map-page .rrr-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .bm-hint { display: flex; gap: 10px; background: #eff6ff; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .bm-hint-icon { font-size: 18px; flex-shrink: 0; }
    .bm-hint p { font-size: 13px; color: #1e40af; margin: 0; line-height: 1.5; }
    .bm-list { display: flex; flex-direction: column; gap: 10px; }
    .bm-card { background: #fff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 14px 16px; cursor: pointer; transition: border-color 0.15s; }
    .bm-card:active { transform: scale(0.99); }
    .bm-card.ready { border-color: #10b981; background: #f0fdf4; }
    .bm-card-top { display: flex; align-items: center; justify-content: space-between; }
    .bm-id-wrap { display: flex; align-items: center; gap: 10px; }
    .bm-id-badge { background: #fef3c7; color: #92400e; font-weight: 800; font-size: 12px; padding: 5px 10px; border-radius: 16px; }
    .bm-id-num { font-size: 19px; font-weight: 800; }
    .bm-punches { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 5px 10px; border-radius: 12px; font-weight: 600; }
    .bm-assigned { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 14px; }
    .bm-check { width: 22px; height: 22px; background: #10b981; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; flex-shrink: 0; }
    .bm-member-name { font-weight: 700; color: #065f46; }
    .bm-change { font-size: 12px; color: #3b82f6; font-weight: 600; margin-left: auto; }
    .bm-tap-hint { margin-top: 8px; font-size: 13px; color: #94a3b8; }
    .bm-picker { margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .bm-search { width: 100%; padding: 12px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 15px; box-sizing: border-box; }
    .bm-search:focus { outline: none; border-color: #3b82f6; }
    .bm-results { max-height: 220px; overflow-y: auto; margin-top: 8px; border: 1px solid #e2e8f0; border-radius: 10px; }
    .bm-result { padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; }
    .bm-result:last-child { border-bottom: none; }
    .bm-result:active { background: #eff6ff; }
    .bm-result-name { font-weight: 700; }
    .bm-result-phone { color: #64748b; font-size: 12px; margin-left: 6px; }
    .bm-no-results { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }
    .bm-footer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 14px 20px calc(14px + env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -2px 12px rgba(0,0,0,0.06); z-index: 10; }
    .bm-footer-info { font-size: 14px; font-weight: 700; color: #334155; }
    .bm-footer-info span { color: #10b981; font-size: 18px; }
    .bm-link-all { background: #10b981; color: #fff; border: none; padding: 14px 28px; border-radius: 12px; font-weight: 800; font-size: 15px; cursor: pointer; }
    .bm-link-all:disabled { opacity: 0.5; }
    .bm-link-all:active { transform: scale(0.97); }
    .bm-danger-row { padding: 16px; text-align: center; }
    .bm-clear-all { background: none; border: 1px solid #fca5a5; color: #dc2626; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
    .bm-progress { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 20px; z-index: 11; }
    .bm-progress-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
    .bm-progress-fill { height: 100%; background: #10b981; width: 0%; transition: width 0.3s; border-radius: 4px; }
    .bm-progress p { text-align: center; font-size: 13px; color: #64748b; margin: 10px 0 0 0; }
    .bm-save-one { width: 100%; margin-top: 10px; background: #10b981; color: #fff; border: none; padding: 11px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
    .bm-save-one:active { transform: scale(0.98); }
    .bm-save-one:disabled { opacity: 0.5; }
  </style>`;

  el.querySelector('#bm-back')?.addEventListener('click', () => navigate.back());
  el.querySelector('#bm-link-all')?.addEventListener('click', () => linkAll(el));
  el.querySelector('#bm-clear-all')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL unmapped punch entries?\n\nThis cannot be undone. Mapped punches and members are safe.')) return;
    if (!confirm('Final confirm: clear all unmapped entries?')) return;
    const r = await apiRequest('/api/mobile/v1/rrr/attendance/unmapped', { method: 'DELETE' });
    if (r.ok) {
      alert(`Cleared ${r.data.deleted} unmapped entries.`);
      load(el);
    } else {
      alert('Failed: ' + (r.data?.message || r.error || 'unknown error'));
    }
  });
  
  el.querySelectorAll('.bm-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.bm-picker')) return;
      togglePicker(el, card.dataset.bid);
    });
  });
  
  wireSaveButtons(el);
  updateFooter(el);
}

function wireSaveButtons(el) {
  el.querySelectorAll('[data-save-one]').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bid = btn.dataset.saveOne;
      const member = selections.get(bid);
      if (!member) return;
      btn.disabled = true;
      btn.textContent = 'Linking…';
      const res = await apiRequest('/api/mobile/v1/rrr/mappings/bulk-resolve', {
        method: 'POST', body: { mappings: [{ external_id: bid, member_id: member.id }] },
      });
      if (res.ok && res.data.linked === 1) {
        btn.textContent = '✓ Linked';
        selections.delete(bid);
        groups = groups.filter(g => g.id !== bid);
        setTimeout(() => refreshCards(el), 600);
      } else {
        btn.disabled = false;
        btn.textContent = 'Save link';
      }
    });
  });
}

function cardHtml(g) {
  const sel = selections.get(g.id);
  const isOpen = openPicker === g.id;
  const latest = new Date(g.latest);
  const dateStr = latest.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  
  return `<div class="bm-card ${sel ? 'ready' : ''}" data-bid="${esc(g.id)}">
    <div class="bm-card-top">
      <div class="bm-id-wrap">
        <span class="bm-id-badge">BIOMETRIC</span>
        <span class="bm-id-num">ID ${esc(g.id)}</span>
      </div>
      <span class="bm-punches">${g.count} punches · ${dateStr}</span>
    </div>
    ${sel ? `
    <div class="bm-assigned">
      <span class="bm-check">✓</span>
      <span class="bm-member-name">${esc(sel.full_name)}</span>
      <span class="bm-change">change</span>
    </div>
    <button class="bm-save-one" data-save-one="${esc(g.id)}">Save link</button>` : `
    <div class="bm-tap-hint">Tap to assign a member →</div>`}
    ${isOpen ? pickerHtml(g.id) : ''}
  </div>`;
}

function pickerHtml(bid) {
  return `<div class="bm-picker" data-picker="${esc(bid)}">
    <input class="bm-search" data-search="${esc(bid)}" type="search" placeholder="Type member name…" autocomplete="off">
    <div class="bm-results" data-results="${esc(bid)}">${resultsHtml(allMembers.slice(0, 20))}</div>
  </div>`;
}

function resultsHtml(members) {
  if (!members.length) return '<div class="bm-no-results">No members found</div>';
  return members.map(m => `
    <div class="bm-result" data-pick="${m.id}" data-bid-name="${esc(m.full_name)}">
      <span class="bm-result-name">${esc(m.full_name)}</span>
      ${m.phone ? `<span class="bm-result-phone">${esc(m.phone)}</span>` : ''}
    </div>`).join('');
}

function togglePicker(el, bid) {
  openPicker = openPicker === bid ? null : bid;
  refreshCards(el);
}

function refreshCards(el) {
  const list = el.querySelector('#bm-list');
  if (!list) return;
  list.innerHTML = groups.map(cardHtml).join('');
  
  el.querySelectorAll('.bm-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.bm-picker')) return;
      togglePicker(el, card.dataset.bid);
    });
  });
  
  el.querySelectorAll('[data-search]').forEach(input => {
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      const bid = input.dataset.search;
      const results = el.querySelector(`[data-results="${CSS.escape(bid)}"]`);
      if (!results) return;
      const filtered = q
        ? allMembers.filter(m => m.full_name.toLowerCase().includes(q) || (m.phone || '').includes(q)).slice(0, 20)
        : allMembers.slice(0, 20);
      results.innerHTML = resultsHtml(filtered);
      wirePicks(el);
    });
    // Focus and prevent card toggle
    input.addEventListener('click', e => e.stopPropagation());
  });
  
  wirePicks(el);
  wireSaveButtons(el);
  updateFooter(el);
}

function wirePicks(el) {
  el.querySelectorAll('[data-pick]').forEach(row => {
    if (row.dataset.wired) return;
    row.dataset.wired = '1';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = Number(row.dataset.pick);
      const member = allMembers.find(m => m.id === memberId);
      if (!member) return;
      // Find which card this picker belongs to
      const picker = row.closest('[data-picker]');
      const bid = picker?.dataset.picker;
      if (bid) {
        selections.set(bid, member);
        openPicker = null;
        refreshCards(el);
      }
    });
  });
}

function updateFooter(el) {
  const footer = el.querySelector('#bm-footer');
  const count = el.querySelector('#bm-count');
  if (!footer || !count) return;
  const n = selections.size;
  count.textContent = n;
  footer.style.display = n > 0 ? 'flex' : 'none';
}

async function linkAll(el) {
  const footer = el.querySelector('#bm-footer');
  const progress = el.querySelector('#bm-progress');
  const fill = el.querySelector('#bm-fill');
  const progressText = el.querySelector('#bm-progress-text');
  const btn = el.querySelector('#bm-link-all');
  
  if (footer) footer.style.display = 'none';
  if (progress) progress.style.display = 'block';
  if (btn) btn.disabled = true;
  
  const mappings = [...selections.entries()].map(([external_id, m]) => ({
    external_id, member_id: m.id,
  }));
  
  if (progressText) progressText.textContent = `Linking ${mappings.length} IDs…`;
  
  const res = await apiRequest('/api/mobile/v1/rrr/mappings/bulk-resolve', {
    method: 'POST', body: { mappings },
  });
  
  if (fill) fill.style.width = '100%';
  
  if (res.ok) {
    const linked = res.data.linked || 0;
    const failed = (res.data.results || []).filter(r => !r.ok);
    if (failed.length) {
      if (progressText) progressText.textContent = `✓ Linked ${linked}, ${failed.length} failed: IDs ${failed.map(f => f.external_id).join(', ')}`;
      // Keep failed selections so user can retry
      for (const f of failed) {
        // selections already has them; just ensure they're still there
      }
      // Remove successfully linked from selections
      for (const r of (res.data.results || [])) {
        if (r.ok) selections.delete(r.external_id);
      }
      setTimeout(() => load(el), 2500);
    } else {
      if (progressText) progressText.textContent = `✓ Linked ${linked} of ${mappings.length}`;
      selections.clear();
      setTimeout(() => load(el), 1200);
    }
  } else {
    if (progressText) progressText.textContent = 'Something went wrong. Try again.';
    if (btn) btn.disabled = false;
    setTimeout(() => { if (progress) progress.style.display = 'none'; updateFooter(el); }, 2000);
  }
}
