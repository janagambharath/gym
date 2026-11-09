import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { showToast } from '../components.js';
import { escapeHtml, dedupeByKey } from '../utils.js';

let delPage = 1;
let delTotal = 0;
let delTotalPages = 1;
let delQuery = '';
let delMembers = [];
// V11-L23: ids whose deactivate failed — kept checked across the reload
// so the owner can retry just those instead of re-running the batch.
let delFailedIds = new Set();
// Names + reasons for the last failed batch, re-rendered after the reload
// (the reload replaces #rrr-del-result, so the list lives here).
let delLastFailures = [];

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;

async function load(el, append = false) {
  if (!append) {
    delPage = 1;
    delMembers = [];
    el.innerHTML = '<div class="rrr-loading">Loading members…</div>';
  }

  // V5-L23: fetch-then-advance — the old click handler pre-incremented
  // delPage, so a failed "Load more" silently skipped a page, and the
  // append had no dedupe. The page moves only on success now.
  const fetchPage = append ? delPage + 1 : delPage;
  const res = await apiRequest(`/api/mobile/v1/members?page=${fetchPage}&page_size=50${delQuery ? `&q=${encodeURIComponent(delQuery)}` : ''}`);
  if (!res.ok) {
    if (append) { showToast(res.error?.message || 'Could not load more members.', 'error'); return; }
    // V8-L25: the failure state had no retry and no error detail (Back only).
    el.innerHTML = `<main class="rrr-page"><h1>Could not load members</h1><p>${esc(res.error?.message || 'Check your connection and try again.')}</p><button class="rrr-btn" id="rrr-retry">Try again</button> <button class="rrr-btn rrr-btn-outline" id="rrr-back">Back</button></main>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
    return;
  }

  delTotal = res.data.pagination?.total ?? 0;
  delTotalPages = res.data.pagination?.total_pages ?? 1;
  if (append) delPage = fetchPage;
  delMembers = append
    ? dedupeByKey([...delMembers, ...(res.data.members || [])], (m) => m.id)
    : dedupeByKey(res.data.members || [], (m) => m.id);
  const members = delMembers;
  
  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Deactivate Members</h1>
      <p>Select members to deactivate in Renewal Desk. Deactivation ends their membership and blocks terminal access — their records are kept, not permanently deleted. To permanently erase a member, use the admin panel.</p>
    </div>
    <div style="margin-bottom:var(--sp-md)"><input class="form-input" id="rrr-del-search" type="search" placeholder="Search by name or phone…" value="${esc(delQuery)}" style="width:100%"></div>
    <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)">Showing ${members.length} of ${delTotal} members</div>
    
    <div class="rrr-del-toolbar">
      <label class="rrr-select-all">
        <input type="checkbox" id="rrr-select-all">
        <span>Select all (${members.length})</span>
      </label>
      <span id="rrr-selected-count" class="rrr-count">0 selected</span>
    </div>
    
    <div class="rrr-del-list" id="rrr-member-list">
      ${members.map(m => `
        <label class="rrr-del-item">
          <input type="checkbox" class="rrr-del-check" value="${m.id}" data-enroll="${esc(m.device_enroll_number || '')}" ${delFailedIds.has(String(m.id)) ? 'checked' : ''}>
          <div class="rrr-del-info">
            <div class="rrr-del-name">${esc(m.full_name || m.first_name || 'Unknown')}</div>
            <div class="rrr-del-meta">ID ${esc(m.device_enroll_number || '')} · ${esc(m.status || '')} ${m.membership_end ? '· ends ' + esc(m.membership_end) : ''}</div>
          </div>
          ${m.status === 'expired' ? '<span class="rrr-expired-badge">EXPIRED</span>' : ''}
        </label>
      `).join('') || '<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Deactivate Selected</button>
    </div>
    ${delPage < delTotalPages ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="rrr-del-more">Load more members</button></div>` : ''}
    <div id="rrr-del-result"></div>
  </main>
  <style>
    .rrr-del-hero h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; }
    .rrr-del-hero p { color: #64748b; font-size: 14px; margin: 0 0 16px 0; line-height: 1.5; }
    .rrr-del-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 8px; position: sticky; top: 0; background: #fff; z-index: 10; }
    .rrr-select-all { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .rrr-select-all input { width: 20px; height: 20px; accent-color: #dc2626; }
    .rrr-count { font-size: 13px; color: #64748b; }
    .rrr-del-list { display: flex; flex-direction: column; }
    .rrr-del-item { display: flex; align-items: center; gap: 12px; padding: 14px 4px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
    .rrr-del-item:active { background: #f8fafc; }
    .rrr-del-check { width: 22px; height: 22px; accent-color: #dc2626; flex-shrink: 0; }
    .rrr-del-info { flex: 1; min-width: 0; }
    .rrr-del-name { font-weight: 600; font-size: 15px; }
    .rrr-del-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
    .rrr-expired-badge { background: #fee2e2; color: #b91c1c; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; }
    .rrr-del-footer { position: sticky; bottom: 0; background: #fff; padding: 16px 0; border-top: 1px solid #e2e8f0; }
    .rrr-delete-btn { width: 100%; background: #dc2626; color: #fff; border: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .rrr-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .rrr-back-btn { background: none; border: none; color: #3b82f6; font-size: 15px; font-weight: 600; cursor: pointer; }
  </style>`;
  
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
  let delSearchTimer;
  el.querySelector('#rrr-del-search')?.addEventListener('input', (e) => {
    clearTimeout(delSearchTimer);
    delSearchTimer = setTimeout(() => { delQuery = e.target.value.trim(); load(el); }, 400);
  });
  // V5-L23: load() advances delPage itself, only on success — the old
  // pre-increment here skipped a page on any append failure.
  el.querySelector('#rrr-del-more')?.addEventListener('click', () => { load(el, true); });
  
  const selectAll = el.querySelector('#rrr-select-all');
  const checkboxes = el.querySelectorAll('.rrr-del-check');
  const countEl = el.querySelector('#rrr-selected-count');
  const deleteBtn = el.querySelector('#rrr-delete-btn');
  
  function updateCount() {
    const checked = el.querySelectorAll('.rrr-del-check:checked').length;
    countEl.textContent = `${checked} selected`;
    deleteBtn.disabled = checked === 0;
    deleteBtn.textContent = checked ? `🗑️ Deactivate ${checked} member${checked === 1 ? '' : 's'}` : '🗑️ Deactivate Selected';
    selectAll.checked = checked === checkboxes.length && checked > 0;
    selectAll.indeterminate = checked > 0 && checked < checkboxes.length;
  }
  
  selectAll?.addEventListener('change', () => {
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateCount();
  });
  
  checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
  // V11-L23: failed members stay checked across the reload (see
  // delFailedIds above) — sync the count/button to match on load, and
  // re-show the last failure list (the reload wipes #rrr-del-result).
  updateCount();
  if (delLastFailures.length) {
    const resultEl = el.querySelector('#rrr-del-result');
    if (resultEl) {
      resultEl.innerHTML = `<div style="padding:16px;font-weight:600;color:#d97706;text-align:center">⚠ ${delLastFailures.length} failed — still selected below<div style="text-align:left;font-weight:400;margin-top:var(--sp-sm)">${delLastFailures.map(f => `<div style="font-size:var(--fs-sm);margin-top:4px">• ${esc(f.name)} — ${esc(f.reason)}</div>`).join('')}</div></div>`;
    }
  }

  deleteBtn?.addEventListener('click', async () => {
    const selected = [...el.querySelectorAll('.rrr-del-check:checked')].map(cb => cb.value);
    if (!selected.length) return;
    if (!confirm(`Deactivate ${selected.length} member(s)? Their membership ends and terminal access is blocked. Records are kept.`)) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deactivating...';
    const resultEl = el.querySelector('#rrr-del-result');

    let success = 0;
    // V11-L23: the old result reported only counts ("✓ N deactivated,
    // ⚠ M failed") — the owner had to guess WHICH members still needed
    // deactivating. Name every failure with its reason.
    const failures = [];
    for (const memberId of selected) {
      const member = delMembers.find(m => String(m.id) === String(memberId));
      const displayName = member?.full_name || member?.first_name || `Member ${memberId}`;
      try {
        const res = await apiRequest(`/api/mobile/v1/members/${memberId}/deactivate`, { method: 'POST' });
        if (res.ok) success++;
        else failures.push({ id: memberId, name: displayName, reason: res.error?.message || 'Failed' });
      } catch (e) { failures.push({ id: memberId, name: displayName, reason: e?.message || 'Request failed' }); }
    }

    delFailedIds = new Set(failures.map(f => String(f.id)));
    delLastFailures = failures;
    resultEl.innerHTML = `<div style="padding:16px;font-weight:600;color:${failures.length ? '#d97706' : '#16a34a'};text-align:center">
      ${failures.length ? `✓ ${success} deactivated, ⚠ ${failures.length} failed` : `✓ All ${success} deactivated`}
      ${failures.length ? `<div style="text-align:left;font-weight:400;margin-top:var(--sp-sm)">${failures.map(f => `<div style="font-size:var(--fs-sm);margin-top:4px">• ${esc(f.name)} — ${esc(f.reason)}</div>`).join('')}</div><div style="font-size:var(--fs-sm);font-weight:400;margin-top:var(--sp-sm)">Failed members stay selected below — fix the cause and tap Deactivate again.</div>` : ''}
    </div>`;
    if (failures.length) {
      // Keep the failure list visible; reload the list (failed members
      // stay checked) instead of wiping the result after 2s.
      deleteBtn.disabled = false;
      deleteBtn.textContent = `🗑️ Deactivate ${failures.length} member${failures.length === 1 ? '' : 's'}`;
      setTimeout(() => load(el), 1500);
    } else {
      setTimeout(() => load(el), 2000);
    }
  });
}
