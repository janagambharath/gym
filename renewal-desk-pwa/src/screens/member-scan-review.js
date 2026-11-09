/* Member Scan Review Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, uuid } from '../utils.js';
export default { async mount(el, params) {
  let members = [];
  try { members = params?.members ? JSON.parse(params.members) : []; }
  catch { members = []; }
  if (!Array.isArray(members)) members = [];
  // V11-L24: one stable key per review, reused across retries of the
  // same import (the backend honours scope batch_create_members — a
  // retry after a lost response replays instead of 422ing the whole
  // import as "already belongs").
  const reviewKey = uuid();
  // Plans for the plan picker (same /settings leg as edit-member).
  // A plans-leg failure must not block the review — the plan column
  // falls back to the scanned plan_name text and the scanned plan_id
  // (if any) still ships in the payload.
  let plans = [];
  try {
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    if (settingsRes.ok) plans = settingsRes.data.plans || [];
  } catch { plans = []; }
  // V11-H4: a row is importable only when the scan says so — duplicate
  // rows and not-ready rows used to be submitted anyway, and the
  // atomic batch-create 422d the WHOLE import on the first bad row.
  const isImportable = (m) => m.is_ready !== false && !m.is_duplicate;
  const rowStatus = (m) => {
    if (m.is_duplicate) return 'Duplicate — already a member';
    if (m.is_ready === false) return (m.warnings && m.warnings.length ? m.warnings.join('; ') : 'Not ready — check the details');
    if (m.warnings && m.warnings.length) return m.warnings.join('; ');
    return 'Ready';
  };
  const planOptions = (m) => {
    const opts = [`<option value="">— No plan —</option>`];
    for (const p of plans) opts.push(`<option value="${p.id}"${String(m.plan_id) === String(p.id) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`);
    // The scanned plan may be deleted/inactive — keep it visible so the
    // owner sees what was matched instead of a blank picker (same
    // pattern as edit-member's deleted-plan option).
    if (m.plan_id && !plans.some(p => String(p.id) === String(m.plan_id))) {
      opts.push(`<option value="${escapeHtml(String(m.plan_id))}" selected disabled>${escapeHtml(m.plan_name || 'Unknown plan')} (not available)</option>`);
    }
    return opts.join('');
  };
  const planCell = (m, i) => plans.length
    ? `<select class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" data-idx="${i}" data-field="plan_id">${planOptions(m)}</select>`
    : escapeHtml(m.plan_name || '—');
  const importableCount = () => members.filter(m => isImportable(m) && m.selected !== false).length;
  const skippedCount = () => members.filter(m => !isImportable(m)).length;
  el.innerHTML = `${renderHeader({title:`Review (${members.length})`,showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <div class="card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm)">
        <thead><tr style="background:var(--gray-50)">
          <th style="padding:var(--sp-sm);text-align:left"></th>
          <th style="padding:var(--sp-sm);text-align:left">Name</th>
          <th style="padding:var(--sp-sm);text-align:left">Phone</th>
          <th style="padding:var(--sp-sm);text-align:left">Plan</th>
          <th style="padding:var(--sp-sm);text-align:left">Status</th>
        </tr></thead>
        <tbody>${members.map((m,i)=>`<tr style="border-top:1px solid var(--border-light)">
          <td style="padding:var(--sp-sm)"><input type="checkbox" data-idx="${i}" data-field="selected" ${isImportable(m) && m.selected !== false ? 'checked' : ''} ${isImportable(m) ? '' : 'disabled'}></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${escapeHtml(m.name||'')}" data-idx="${i}" data-field="name"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${escapeHtml(m.phone||'')}" data-idx="${i}" data-field="phone"></td>
          <td style="padding:var(--sp-sm)">${planCell(m, i)}</td>
          <td style="padding:var(--sp-sm);color:${isImportable(m) ? 'var(--text-secondary)' : 'var(--critical)'}">${escapeHtml(rowStatus(m))}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    ${skippedCount() ? `<div style="font-size:var(--fs-sm);color:var(--muted);margin-top:var(--sp-sm)">${skippedCount()} row${skippedCount() === 1 ? '' : 's'} skipped — duplicate or not ready (unchecked above, never submitted).</div>` : ''}
    <div id="sr-errors"></div>
    <button class="btn btn-primary btn-lg btn-full" id="sr-import" style="margin-top:var(--sp-xl)">${icon('upload',18,'white')} Import ${importableCount()} Members</button>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const updateImportButton = () => {
    const btn = el.querySelector('#sr-import');
    if (!btn) return;
    const n = importableCount();
    btn.disabled = n === 0;
    btn.textContent = `Import ${n} Member${n === 1 ? '' : 's'}`;
  };
  // Update on edit (inputs fire `input`, selects fire `change`).
  const onEdit = (e) => {
    const idx = Number(e.target.dataset.idx); const field = e.target.dataset.field;
    if (!members[idx]) return;
    if (field === 'selected') { members[idx].selected = e.target.checked; updateImportButton(); return; }
    // V11-H4: plan edits must write plan_id — the old code wrote
    // members[].plan, which batch-create ignores (plan_id only), so a
    // typed plan silently imported as a plan-less 0-day member.
    if (field === 'plan_id') {
      const v = e.target.value;
      members[idx].plan_id = v === '' ? null : Number(v);
      const plan = plans.find(p => String(p.id) === String(v));
      if (plan) members[idx].plan_name = plan.name;
      return;
    }
    members[idx][field] = e.target.value;
  };
  el.querySelectorAll('[data-idx]').forEach(input => {
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onEdit);
  });
  updateImportButton();
  el.querySelector('#sr-import')?.addEventListener('click',async()=>{
    const btn = el.querySelector('#sr-import'); btn.disabled = true; btn.textContent = 'Importing...';
    // Only checked, importable rows — duplicates / not-ready rows are
    // filtered out here instead of failing the whole atomic import.
    // Ship only the fields batch-create reads (plan_id, not plan).
    const payload = members
      .filter(m => isImportable(m) && m.selected !== false)
      .map(m => ({ name: m.name, phone: m.phone, plan_id: m.plan_id ?? null,
        membership_start: m.membership_start, membership_end: m.membership_end,
        status: m.status, email: m.email || null, gender: m.gender || null, notes: m.notes || null }));
    const r = await apiRequest('/api/mobile/v1/members/batch-create',{method:'POST',body:{members:payload},headers:{'Idempotency-Key':reviewKey}});
    if (r.ok) { showToast(`${r.data?.imported||payload.length} members imported!`,'success'); navigate.pop(); navigate.pop(); }
    else {
      // V11-H4: batch-create returns per-row errors in
      // error.details.errors ({index, name, phone, errors[]}) — surface
      // them so the owner can see WHICH row failed instead of a generic
      // toast for the whole import.
      const rowErrors = r.error?.details?.errors;
      const errBox = el.querySelector('#sr-errors');
      if (Array.isArray(rowErrors) && rowErrors.length && errBox) {
        errBox.innerHTML = `<div class="card card-body" style="background:var(--critical-surface);border-color:var(--critical-border);margin-top:var(--sp-lg)"><div style="font-weight:var(--fw-bold);color:var(--critical)">Some rows could not be imported:</div>${rowErrors.map(e => `<div style="font-size:var(--fs-sm);margin-top:var(--sp-xs)">${escapeHtml(e.name || e.phone || `Row ${e.index}`)} — ${escapeHtml((e.errors || []).join('; '))}</div>`).join('')}</div>`;
      }
      showToast(r.error.message,'error');
      updateImportButton();
    }
  });
}};
