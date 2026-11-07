/* Edit Member Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderErrorState, showToast } from '../components.js';
import { escapeHtml } from '../utils.js';

export default {
  async mount(el, params) { await load(el, params); }
};

async function load(el, params) {
    const memberId = params?.memberId;
    const res = await apiRequest(`/api/mobile/v1/members/${memberId}`);
    if (!res.ok) {
      // V8-L19: any load failure used to read as "Member not found" with no
      // retry. Only a 404 is genuinely missing; anything else is an error.
      if (res.error?.status === 404) {
        el.innerHTML = `<div class="empty-state"><div class="empty-state-title">Member not found</div></div>`;
        return;
      }
      el.innerHTML = renderErrorState(res.error?.message || 'Could not load this member.');
      el.querySelector('#retry-btn')?.addEventListener('click', () => load(el, params));
      return;
    }
    const m = res.data;
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const plansFailed = !settingsRes.ok;
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
          ${plansFailed ? `<div class="empty-state" style="padding:var(--sp-md)"><div class="empty-state-text">Could not load the membership plans (${escapeHtml(settingsRes.error?.message || 'check your connection')}) — saving is blocked so the member's plan can't be silently unassigned.</div><button class="btn btn-primary" id="em-plans-retry">Try Again</button></div>` : ''}
          ${renderFormField({ id: 'em-start', label: 'Start Date', type: 'date', value: m.membership_start || '' })}
          <div class="form-group">
            <label class="form-label">End Date (auto-calculated)</label>
            <div id="em-end-display" class="form-input" style="background:var(--bg-muted,#f1f5f9);color:var(--muted);">—</div>
            <span class="form-hint">Calculated from Plan + Start Date. If dates don't match payments, fix them in <button type="button" id="em-date-repair" style="color:var(--brand);text-decoration:underline;padding:0">Date Repair</button>.</span>
          </div>
          ${renderFormField({ id: 'em-notes', label: 'Notes', type: 'textarea', value: m.notes || '' })}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit">Save Changes</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });
    el.querySelector('#em-date-repair')?.addEventListener('click', () => navigate.push('date-repair'));
    // V8-M11: when the plans leg failed the dropdown is empty and submit
    // would send plan_id: null, silently unassigning the member's plan.
    // Block Save until the plans load succeeds.
    el.querySelector('#em-plans-retry')?.addEventListener('click', () => load(el, params));
    if (plansFailed) {
      const submitBtn = el.querySelector('#em-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Plans failed to load — Save blocked'; }
    }

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
      // Match the Start Date field's human-readable format; keep ISO for PATCH.
      const [year, month, day] = endDate.split('-').map(Number);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (display) display.textContent = `${day} ${months[month - 1]} ${year}`;
      return endDate;
    };
    el.querySelector('#em-plan')?.addEventListener('change', calcEnd);
    el.querySelector('#em-start')?.addEventListener('change', calcEnd);
    calcEnd();

    el.querySelector('#edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      // V8-M11 second guard (defence in depth — the button is disabled
      // too, but a programmatic submit must not slip past either).
      if (plansFailed) { showToast('Membership plans failed to load — retry before saving.', 'error'); return; }
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
