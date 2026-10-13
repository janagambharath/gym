import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading members…</div>';
  
  // Get members with enroll numbers
  const res = await apiRequest('/api/mobile/v1/members?page=1&page_size=500');
  if (!res.ok) {
    el.innerHTML = '<main class="rrr-page"><h1>Failed to load</h1><button onclick="history.back()">Back</button></main>';
    return;
  }
  
  const members = (res.data.members || []).filter(m => m.device_enroll_number);
  
  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header">
      <button id="rrr-back" class="rrr-back-btn">← Back</button>
      <div class="rrr-brand"><b>RRR</b><span>Terminal members</span></div>
    </header>
    
    <div class="rrr-del-hero">
      <h1>Delete from Terminal</h1>
      <p>Select members to remove from the biometric terminal. They won't be able to punch until re-added.</p>
    </div>
    
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
          <input type="checkbox" class="rrr-del-check" value="${m.id}" data-enroll="${esc(m.device_enroll_number || '')}">
          <div class="rrr-del-info">
            <div class="rrr-del-name">${esc(m.full_name || m.first_name || 'Unknown')}</div>
            <div class="rrr-del-meta">ID ${esc(m.device_enroll_number || '')} · ${esc(m.status || '')} ${m.membership_end ? '· ends ' + esc(m.membership_end) : ''}</div>
          </div>
          ${m.status === 'expired' ? '<span class="rrr-expired-badge">EXPIRED</span>' : ''}
        </label>
      `).join('') || '<p class="rrr-no-data">No members with terminal enroll numbers.</p>'}
    </div>
    
    <div class="rrr-del-footer">
      <button id="rrr-delete-btn" class="rrr-delete-btn" disabled>🗑️ Delete Selected</button>
    </div>
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
  
  const selectAll = el.querySelector('#rrr-select-all');
  const checkboxes = el.querySelectorAll('.rrr-del-check');
  const countEl = el.querySelector('#rrr-selected-count');
  const deleteBtn = el.querySelector('#rrr-delete-btn');
  
  function updateCount() {
    const checked = el.querySelectorAll('.rrr-del-check:checked').length;
    countEl.textContent = `${checked} selected`;
    deleteBtn.disabled = checked === 0;
    deleteBtn.textContent = checked ? `🗑️ Delete ${checked} from Terminal` : '🗑️ Delete Selected';
    selectAll.checked = checked === checkboxes.length && checked > 0;
    selectAll.indeterminate = checked > 0 && checked < checkboxes.length;
  }
  
  selectAll?.addEventListener('change', () => {
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateCount();
  });
  
  checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
  
  deleteBtn?.addEventListener('click', async () => {
    const selected = [...el.querySelectorAll('.rrr-del-check:checked')].map(cb => ({
      id: cb.value,
      enroll: cb.dataset.enroll
    }));
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} member(s) from the terminal? They won't be able to punch.`)) return;
    
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    const resultEl = el.querySelector('#rrr-del-result');
    
    let success = 0, failed = 0;
    for (const s of selected) {
      try {
        const res = await apiRequest(`/api/mobile/v1/rrr/members/${s.id}/remove-from-terminal`, { method: 'POST' });
        if (res.ok) success++;
        else failed++;
      } catch(e) { failed++; }
    }
    
    resultEl.innerHTML = `<p style="padding:16px;text-align:center;font-weight:600;color:${failed ? '#d97706' : '#16a34a'};">
      ${failed ? `✓ ${success} deleted, ⚠ ${failed} failed` : `✓ All ${success} queued for deletion`}
    </p>`;
    setTimeout(() => load(el), 2000);
  });
}
