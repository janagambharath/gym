/* Gym Profile Screen — edit gym name, contact, address, timezone */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Gym Profile',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content" id="gp-form-wrap"><div style="padding:var(--sp-lg)">Loading…</div></div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const wrap = el.querySelector('#gp-form-wrap');
  const res = await apiRequest('/api/mobile/v1/settings');
  const s = res.ok ? (res.data.settings || res.data) : {};
  wrap.innerHTML = `
    <form id="gp-form" style="display:flex;flex-direction:column;gap:var(--sp-md);padding:var(--sp-lg)">
      ${renderFormField({id:'gp-name',label:'Gym Name',value:escapeHtml(s.name||''),required:true})}
      ${renderFormField({id:'gp-email',label:'Email',type:'email',value:escapeHtml(s.email||'')})}
      ${renderFormField({id:'gp-phone',label:'Phone',type:'tel',value:s.phone||''})}
      ${renderFormField({id:'gp-address',label:'Address',type:'textarea',value:s.address||''})}
      ${renderFormField({id:'gp-timezone',label:'Timezone',value:s.timezone||'Asia/Kolkata'})}
      <button type="submit" class="btn btn-primary btn-lg btn-full" id="gp-save">Save Changes</button>
    </form>`;
  el.querySelector('#gp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#gp-save'); btn.disabled = true; btn.textContent = 'Saving…';
    const body = {
      name: el.querySelector('#gp-name').value.trim(),
      email: el.querySelector('#gp-email').value.trim(),
      phone: el.querySelector('#gp-phone').value.trim(),
      address: el.querySelector('#gp-address').value.trim(),
      timezone: el.querySelector('#gp-timezone').value.trim() || 'Asia/Kolkata',
    };
    if (!body.name) { showToast('Gym name is required','error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }
    const r = await apiRequest('/api/mobile/v1/settings', { method:'PATCH', body });
    btn.disabled = false; btn.textContent = 'Save Changes';
    if (r.ok) { showToast('Gym profile updated','success'); navigate.pop(); }
    else showToast(r.error?.message||'Could not save','error');
  });
}};
