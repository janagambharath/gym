/* Member Import (CSV) Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js';
import { uuid, escapeHtml } from '../utils.js';
export default { mount(el) {
  // V10-H1: the old screen POSTed multipart FormData (`file`) to
  // /members/import, but the backend only reads JSON `csv_text` — every
  // import 422d with "Fix every invalid or duplicate row", blaming the
  // owner's rows. Read the file client-side, POST {csv_text} JSON to
  // /members/import/preview first and render the real counts, then POST
  // the same text as JSON to /members/import. CSV-only: the backend
  // cannot parse .xlsx, so it is dropped from the file picker.
  let csvText = '';
  let importKey = uuid(); // one stable key per selected file, reused on retry
  el.innerHTML = `${renderHeader({title:'Upload CSV',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content" style="text-align:center">
    <div id="mi-dropzone" style="position:relative;border:2px dashed var(--border);border-radius:var(--r-xl);padding:var(--sp-4xl);margin-bottom:var(--sp-xl)">
      ${icon('upload',40,'var(--muted)')}
      <p style="margin-top:var(--sp-lg);color:var(--text-secondary)">Tap to select a CSV file</p>
      <input type="file" accept=".csv" id="mi-file" style="position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;cursor:pointer">
    </div>
    <button class="btn btn-secondary btn-full" id="mi-pick" style="margin-bottom:var(--sp-xl)">${icon('upload',16)} Choose CSV file</button>
    <button class="btn btn-secondary btn-full" id="mi-scan" style="margin-bottom:var(--sp-xl)">${icon('camera',16)} Scan a register page instead</button>
    <div id="mi-preview" class="hidden"></div>
    <button class="btn btn-primary btn-full hidden" id="mi-submit">${icon('upload',18,'white')} Import Members</button>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#mi-pick').addEventListener('click', () => el.querySelector('#mi-file').click());
  el.querySelector('#mi-scan').addEventListener('click', () => navigate.push('member-scan'));
  el.querySelector('#mi-file').addEventListener('change',async(e)=>{
    const file = e.target.files[0]; if (!file) return;
    const preview = el.querySelector('#mi-preview');
    const submitBtn = el.querySelector('#mi-submit');
    submitBtn.classList.add('hidden');
    preview.classList.remove('hidden');
    preview.innerHTML = `<div class="card card-body" style="text-align:left"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">File: ${escapeHtml(file.name)}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${(file.size/1024).toFixed(1)} KB — checking rows…</div></div>`;
    try {
      csvText = await file.text();
    } catch {
      csvText = '';
      preview.innerHTML = `<div class="card card-body" style="text-align:left"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">File: ${escapeHtml(file.name)}</div><div style="font-size:var(--fs-sm);color:var(--critical)">Could not read this file — pick it again.</div></div>`;
      showToast('Could not read that file', 'error');
      return;
    }
    importKey = uuid();
    const data = await apiRequest('/api/mobile/v1/members/import/preview', { method: 'POST', body: { csv_text: csvText } });
    if (!data.ok) {
      preview.innerHTML = `<div class="card card-body" style="text-align:left"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">File: ${escapeHtml(file.name)}</div><div style="font-size:var(--fs-sm);color:var(--critical)">${escapeHtml(data.error?.message || 'Could not check this file.')}</div></div>`;
      showToast(data.error?.message || 'Could not check this file', 'error');
      return;
    }
    const p = data.data || {};
    const summary = p.summary || {};
    const total = summary.total ?? 0;
    const valid = summary.valid ?? 0;
    const invalid = summary.invalid ?? 0;
    const duplicates = summary.duplicates ?? 0;
    const fileErrors = p.file_errors || [];
    // The import endpoint 422s unless every row is valid, so only offer
    // Import on a clean preview — never let the owner tap into a
    // guaranteed failure.
    const clean = fileErrors.length === 0 && invalid === 0 && duplicates === 0 && valid > 0;
    preview.innerHTML = `<div class="card card-body" style="text-align:left">
      <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">File: ${escapeHtml(file.name)}</div>
      <div style="font-size:var(--fs-sm);color:var(--muted)">${(file.size/1024).toFixed(1)} KB</div>
      <div style="font-size:var(--fs-sm);margin-top:var(--sp-sm)">${total} rows · ${valid} valid · ${invalid} invalid · ${duplicates} duplicates</div>
      ${fileErrors.map(err => `<div style="font-size:var(--fs-sm);color:var(--critical);margin-top:var(--sp-xs)">${escapeHtml(err)}</div>`).join('')}
      ${!clean && valid > 0 ? '<div style="font-size:var(--fs-sm);color:var(--warning);margin-top:var(--sp-xs)">Fix every invalid or duplicate row before importing — no members were imported.</div>' : ''}
      ${!clean && valid === 0 && fileErrors.length === 0 ? '<div style="font-size:var(--fs-sm);color:var(--warning);margin-top:var(--sp-xs)">No valid rows to import.</div>' : ''}
    </div>`;
    if (clean) submitBtn.classList.remove('hidden');
  });
  el.querySelector('#mi-submit').addEventListener('click',async()=>{
    if (!csvText) return;
    const btn = el.querySelector('#mi-submit'); btn.disabled = true; btn.textContent = 'Importing...';
    const data = await apiRequest('/api/mobile/v1/members/import', { method: 'POST', body: { csv_text: csvText }, headers: { 'Idempotency-Key': importKey } });
    if (data.ok) { showToast(`${data.data?.imported||0} members imported!`,'success'); navigate.pop(); }
    else showToast(data.error?.message||'Import failed','error');
    btn.disabled = false; btn.textContent = 'Import Members';
  });
}};
