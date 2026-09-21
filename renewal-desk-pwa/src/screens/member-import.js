/* Member Import (CSV) Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js';
export default { mount(el) {
  el.innerHTML = `${renderHeader({title:'Upload CSV',showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl);text-align:center">
    <div style="border:2px dashed var(--border);border-radius:var(--r-xl);padding:var(--sp-4xl);margin-bottom:var(--sp-xl)">
      ${icon('upload',40,'var(--muted)')}
      <p style="margin-top:var(--sp-lg);color:var(--text-secondary)">Tap to select a CSV file</p>
      <input type="file" accept=".csv,.xlsx" id="mi-file" style="position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;cursor:pointer">
    </div>
    <div id="mi-preview" class="hidden"></div>
    <button class="btn btn-primary btn-full hidden" id="mi-submit">${icon('upload',18,'white')} Import Members</button>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#mi-file').addEventListener('change',async(e)=>{
    const file = e.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    const preview = el.querySelector('#mi-preview');
    preview.classList.remove('hidden');
    preview.innerHTML = `<div class="card card-body" style="text-align:left"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">File: ${file.name}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${(file.size/1024).toFixed(1)} KB</div></div>`;
    el.querySelector('#mi-submit').classList.remove('hidden');
  });
  el.querySelector('#mi-submit').addEventListener('click',async()=>{
    const file = el.querySelector('#mi-file').files[0]; if (!file) return;
    const btn = el.querySelector('#mi-submit'); btn.disabled = true; btn.textContent = 'Importing...';
    const formData = new FormData(); formData.append('file', file);
    try {
      const resp = await fetch('https://gym-production-910c.up.railway.app/api/mobile/v1/members/import',{method:'POST',body:formData,
        headers:{'Authorization':`Bearer ${JSON.parse(localStorage.getItem('renewal-desk.pwa-session.v1'))?.accessToken}`}});
      const data = await resp.json();
      if (data.success) { showToast(`${data.data?.imported||0} members imported!`,'success'); navigate.pop(); }
      else showToast(data.error?.message||'Import failed','error');
    } catch { showToast('Import failed','error'); }
    btn.disabled = false; btn.textContent = 'Import Members';
  });
}};
