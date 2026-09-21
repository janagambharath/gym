/* Payment Setup Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderInfoRow, showToast } from '../components.js';
export default { async mount(el) {
  const res = await apiRequest('/api/mobile/v1/settings');
  const ps = res.ok ? res.data.payment_settings || {} : {};
  el.innerHTML = `${renderHeader({ title: 'Payment Setup', showBack: true })}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="ps-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({ id:'ps-upi', label:'UPI ID', value:ps.upi_id||'', placeholder:'yourname@upi' })}
      ${renderFormField({ id:'ps-label', label:'Payment Label', value:ps.payment_label||'', placeholder:'Displayed to members' })}
      ${renderFormField({ id:'ps-inst', label:'Instructions', type:'textarea', value:ps.instructions||'', placeholder:'Payment instructions for members' })}
      <button type="submit" class="btn btn-primary btn-full">Save Settings</button>
    </form></div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  el.querySelector('#ps-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await apiRequest('/api/mobile/v1/settings/payment', { method:'PATCH', body:{
      upi_id: el.querySelector('#ps-upi').value.trim()||null, payment_label: el.querySelector('#ps-label').value.trim()||null,
      instructions: el.querySelector('#ps-inst').value.trim()||null }});
    showToast(r.ok?'Saved!':r.error.message, r.ok?'success':'error');
  });
}};
