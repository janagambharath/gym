/* Member Scan Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js';
import { uuid } from '../utils.js';
export default { mount(el) {
  // V10-H2: the old screen POSTed multipart FormData (`image`) to
  // /members/scan, but the backend only reads JSON `images[]` — every
  // scan 400d with "Please provide at least one document image",
  // right after the owner took a photo. Read the image as base64
  // client-side and POST JSON {images: [dataUrl]} instead.
  el.innerHTML = `${renderHeader({title:'Scan Document',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content" style="text-align:center">
    <div style="width:80px;height:80px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-xl)">${icon('camera',36,'var(--success)')}</div>
    <h3 style="margin-bottom:var(--sp-sm)">Scan a Register Page</h3>
    <p style="color:var(--text-secondary);margin-bottom:var(--sp-xxl)">Take a photo of your physical member register. AI will extract member details automatically.</p>
    <label class="btn btn-primary btn-lg btn-full" id="ms-photo-label" style="cursor:pointer">
      ${icon('camera',18,'white')} Take Photo
      <input type="file" accept="image/*" capture="environment" id="ms-file" style="display:none">
    </label>
    <div style="margin-top:var(--sp-lg)">
      <label class="btn btn-secondary btn-full" id="ms-gallery-label" style="cursor:pointer">
        ${icon('upload',16)} Choose from Gallery
        <input type="file" accept="image/*" id="ms-gallery" style="display:none">
      </label>
    </div>
    <div id="ms-preview" class="hidden" style="margin-top:var(--sp-xl)"></div>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  let scanning = false;
  // V11-L18: ONE stable key per scan session (screen mount), reused
  // across retries of the same scan. The old code minted uuid() fresh
  // inside handleFile on every attempt — contradicting its own comment
  // — so a retry after a lost response could not replay and paid for a
  // second vision call.
  const scanKey = uuid();
  const setPickersEnabled = (enabled) => {
    for (const id of ['#ms-file', '#ms-gallery']) {
      const input = el.querySelector(id);
      if (input) input.disabled = !enabled;
    }
    for (const id of ['#ms-photo-label', '#ms-gallery-label']) {
      const label = el.querySelector(id);
      if (label) label.style.opacity = enabled ? '' : '0.5';
    }
  };
  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
  const handleFile = async (file) => {
    if (!file || scanning) return;
    scanning = true;
    setPickersEnabled(false);
    const preview = el.querySelector('#ms-preview');
    preview.classList.remove('hidden');
    preview.innerHTML = `<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">Analyzing image with AI...</div></div>`;
    try {
      const dataUrl = await readAsDataUrl(file);
      // The scanKey above is stable for this scan session — the backend
      // records the key only on success (scope scan_member_records), so
      // a failed scan never blocks a retry, while a retry after a lost
      // response replays instead of paying for a second vision call.
      // V12-P2: the OpenRouter vision call routinely outruns apiRequest's
      // 15 s default — the old multipart upload it replaced in v10 had a
      // 60 s budget. Give the scan 120 s so a slow page reports its real
      // result instead of a timeout (and a retry inside the first call's
      // window cannot pay for a second vision call).
      const data = await apiRequest('/api/mobile/v1/members/scan', {
        method: 'POST',
        body: { images: [dataUrl] },
        headers: { 'Idempotency-Key': scanKey },
        timeoutMs: 120000,
      });
      if (data.ok && data.data?.members) { navigate.replace('member-scan-review', { members: JSON.stringify(data.data.members) }); return; }
      showToast(data.error?.message || 'Scan failed', 'error');
      preview.classList.add('hidden');
    } catch {
      showToast('Could not read that image — try again', 'error');
      preview.classList.add('hidden');
    } finally {
      scanning = false;
      setPickersEnabled(true);
    }
  };
  el.querySelector('#ms-file').addEventListener('change',(e)=>handleFile(e.target.files[0]));
  el.querySelector('#ms-gallery').addEventListener('change',(e)=>handleFile(e.target.files[0]));
}};
