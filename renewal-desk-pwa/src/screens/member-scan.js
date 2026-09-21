/* Member Scan Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js';
export default { mount(el) {
  el.innerHTML = `${renderHeader({title:'Scan Document',showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl);text-align:center">
    <div style="width:80px;height:80px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-xl)">${icon('camera',36,'var(--success)')}</div>
    <h3 style="margin-bottom:var(--sp-sm)">Scan a Register Page</h3>
    <p style="color:var(--text-secondary);margin-bottom:var(--sp-xxl)">Take a photo of your physical member register. AI will extract member details automatically.</p>
    <label class="btn btn-primary btn-lg btn-full" style="cursor:pointer">
      ${icon('camera',18,'white')} Take Photo
      <input type="file" accept="image/*" capture="environment" id="ms-file" style="display:none">
    </label>
    <div style="margin-top:var(--sp-lg)">
      <label class="btn btn-secondary btn-full" style="cursor:pointer">
        ${icon('upload',16)} Choose from Gallery
        <input type="file" accept="image/*" id="ms-gallery" style="display:none">
      </label>
    </div>
    <div id="ms-preview" class="hidden" style="margin-top:var(--sp-xl)"></div>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const handleFile = async (file) => {
    if (!file) return;
    const preview = el.querySelector('#ms-preview');
    preview.classList.remove('hidden');
    preview.innerHTML = `<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">Analyzing image with AI...</div></div>`;
    const formData = new FormData(); formData.append('image', file);
    try {
      const resp = await fetch('https://gym-production-910c.up.railway.app/api/mobile/v1/members/scan',{method:'POST',body:formData,
        headers:{'Authorization':`Bearer ${JSON.parse(localStorage.getItem('renewal-desk.pwa-session.v1'))?.accessToken}`}});
      const data = await resp.json();
      if (data.success && data.data?.members) { navigate.replace('member-scan-review',{members:JSON.stringify(data.data.members)}); }
      else { showToast(data.error?.message||'Scan failed','error'); preview.classList.add('hidden'); }
    } catch { showToast('Scan failed','error'); preview.classList.add('hidden'); }
  };
  el.querySelector('#ms-file').addEventListener('change',(e)=>handleFile(e.target.files[0]));
  el.querySelector('#ms-gallery').addEventListener('change',(e)=>handleFile(e.target.files[0]));
}};
