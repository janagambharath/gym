/* Edit Member Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';

export default {
  async mount(el, params) {
    const memberId = params?.memberId;
    const res = await apiRequest(`/api/mobile/v1/members/${memberId}`);
    if (!res.ok) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-title">Member not found</div></div>`;
      return;
    }
    const m = res.data;
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const plans = settingsRes.ok ? (settingsRes.data.plans || []) : [];

    el.innerHTML = `
      ${renderHeader({ title: 'Edit Member', showBack: true })}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="edit-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${renderFormField({ id: 'em-name', label: 'Full Name', value: m.full_name, required: true })}
          ${renderFormField({ id: 'em-phone', label: 'Phone', type: 'tel', value: m.phone, required: true })}
          ${renderFormField({ id: 'em-email', label: 'Email', type: 'email', value: m.email || '' })}
          ${renderFormField({ id: 'em-gender', label: 'Gender', value: m.gender || '', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }] })}
          ${renderFormField({ id: 'em-address', label: 'Address', type: 'textarea', value: m.address || '' })}
          ${renderFormField({ id: 'em-plan', label: 'Plan', value: m.plan?.id || '', options: plans.map(p => ({ value: p.id, label: p.name })) })}
          ${renderFormField({ id: 'em-start', label: 'Start Date', type: 'date', value: m.membership_start || '' })}
          <div class="form-group">
            <label class="form-label">End Date (auto-calculated)</label>
            <div id="em-end-display" class="form-input" style="background:var(--bg-muted,#f1f5f9);color:var(--muted);">—</div>
            <span class="form-hint">Calculated from Plan + Start Date. To grant extra days, use the owner override.</span>
          </div>
          ${renderFormField({ id: 'em-notes', label: 'Notes', type: 'textarea', value: m.notes || '' })}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    // End date is auto-calculated from Plan + Start (never hand-typed).
    // Uses the renewal convention: end = start + duration - 1.
    const calcEnd = () => {
      const planId = el.querySelector('#em-plan')?.value ? Number(el.querySelector('#em-plan').value) : null;
      const startDate = el.querySelector('#em-start')?.value || null;
      const display = el.querySelector('#em-end-display');
      if (!planId || !startDate) { if (display) display.textContent = '—'; return null; }
      const plan = plans.find(p => p.id === planId);
      if (!plan?.duration_days) { if (display) display.textContent = '—'; return null; }
      const d = new Date(startDate);
      d.setDate(d.getDate() + Number(plan.duration_days) - 1);
      const endDate = d.toISOString().slice(0, 10);
      if (display) display.textContent = endDate;
      return endDate;
    };
    el.querySelector('#em-plan')?.addEventListener('change', calcEnd);
    el.querySelector('#em-start')?.addEventListener('change', calcEnd);
    calcEnd();

    el.querySelector('#edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#em-submit');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const name = el.querySelector('#em-name').value.trim();
      const phone = el.querySelector('#em-phone').value.trim();

      const startDate = el.querySelector('#em-start').value || null;
      const endDate = calcEnd();
      if (startDate && endDate && endDate < startDate) {
        showToast('End date cannot be before start date', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
        return;
      }

      const body = {
        full_name: name,
        name: name,
        phone: phone,
        email: el.querySelector('#em-email').value.trim() || null,
        gender: el.querySelector('#em-gender').value || null,
        plan_id: el.querySelector('#em-plan').value ? Number(el.querySelector('#em-plan').value) : null,
        notes: el.querySelector('#em-notes').value.trim() || null,
        address: el.querySelector('#em-address').value.trim() || null,
      };
      if (startDate) body.membership_start = startDate;
      if (endDate) body.membership_end = endDate;

      const r = await apiRequest(`/api/mobile/v1/members/${memberId}`, { method: 'PATCH', body });
      if (r.ok) {
        showToast('Saved!', 'success');
        window.dispatchEvent(new CustomEvent('member-updated', { detail: r.data }));
        navigate.pop();
      } else {
        if (r.error?.status === 401) {
          handleLogout();
          return;
        }
        showToast(r.error.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });
  }
};
