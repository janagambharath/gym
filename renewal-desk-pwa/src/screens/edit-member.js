/* Edit Member Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
export default { async mount(el, params) {
  const memberId = params?.memberId;
  const res = await apiRequest(`/api/mobile/v1/members/${memberId}`);
  if (!res.ok) { el.innerHTML = `<div class="empty-state"><div class="empty-state-title">Member not found</div></div>`; return; }
  const m = res.data;
  const settingsRes = await apiRequest('/api/mobile/v1/settings');
  const plans = settingsRes.ok ? settingsRes.data.plans || [] : [];
  el.innerHTML = `${renderHeader({ title: 'Edit Member', showBack: true })}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({ id: 'em-name', label: 'Full Name', value: m.full_name, required: true })}
      ${renderFormField({ id: 'em-phone', label: 'Phone', type: 'tel', value: m.phone, required: true })}
      ${renderFormField({ id: 'em-email', label: 'Email', type: 'email', value: m.email || '' })}
      ${renderFormField({ id: 'em-gender', label: 'Gender', value: m.gender || '', options: [{value:'Male',label:'Male'},{value:'Female',label:'Female'},{value:'Other',label:'Other'}] })}
      ${renderFormField({ id: 'em-plan', label: 'Plan', value: m.plan?.id || '', options: plans.map(p => ({value:p.id,label:p.name})) })}
      ${renderFormField({ id: 'em-notes', label: 'Notes', type: 'textarea', value: m.notes || '' })}
      <button type="submit" class="btn btn-primary btn-lg btn-full">Save Changes</button>
    </form></div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  el.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: el.querySelector('#em-name').value.trim(), phone: el.querySelector('#em-phone').value.trim(),
      email: el.querySelector('#em-email').value.trim() || null, gender: el.querySelector('#em-gender').value || null,
      plan_id: el.querySelector('#em-plan').value ? Number(el.querySelector('#em-plan').value) : null,
      notes: el.querySelector('#em-notes').value.trim() || null };
    const r = await apiRequest(`/api/mobile/v1/members/${memberId}`, { method: 'PATCH', body });
    if (r.ok) { showToast('Saved!', 'success'); navigate.pop(); } else showToast(r.error.message, 'error');
  });
}};
