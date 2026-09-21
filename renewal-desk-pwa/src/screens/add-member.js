/* Add Member Screen */
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { getGymTodayISO } from '../utils.js';

export default {
  async mount(el) {
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const plans = settingsRes.ok ? (settingsRes.data.plans || []) : [];

    el.innerHTML = `
      ${renderHeader({ title: 'Add Member', showBack: true })}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="add-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${renderFormField({ id: 'am-name', label: 'Full Name', placeholder: 'Member name', required: true })}
          ${renderFormField({ id: 'am-phone', label: 'Phone', type: 'tel', placeholder: '9876543210', required: true })}
          ${renderFormField({ id: 'am-email', label: 'Email', type: 'email', placeholder: 'member@example.com' })}
          ${renderFormField({ id: 'am-gender', label: 'Gender', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }] })}
          ${renderFormField({ id: 'am-plan', label: 'Membership Plan', options: plans.map(p => ({ value: p.id, label: `${p.name} — ${p.duration_days} days` })) })}
          ${renderFormField({ id: 'am-start', label: 'Start Date', type: 'date', value: getGymTodayISO() })}
          ${renderFormField({ id: 'am-notes', label: 'Notes', type: 'textarea', placeholder: 'Any notes...' })}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit">Add Member</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    el.querySelector('#add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#am-submit');
      btn.disabled = true; btn.textContent = 'Adding...';
      const body = {
        name: el.querySelector('#am-name').value.trim(),
        phone: el.querySelector('#am-phone').value.trim(),
        email: el.querySelector('#am-email').value.trim() || null,
        gender: el.querySelector('#am-gender').value || null,
        plan_id: el.querySelector('#am-plan').value ? Number(el.querySelector('#am-plan').value) : null,
        membership_start: el.querySelector('#am-start').value || null,
        notes: el.querySelector('#am-notes').value.trim() || null,
      };
      const res = await apiRequest('/api/mobile/v1/members', { method: 'POST', body });
      if (res.ok) {
        showToast('Member added!', 'success');
        navigate.replace('member-detail', { member: JSON.stringify(res.data) });
      } else {
        showToast(res.error.message, 'error');
        btn.disabled = false; btn.textContent = 'Add Member';
      }
    });
  }
};
