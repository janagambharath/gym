/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Edit Member Screen
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { icon } from '../icons.js';

export default {
  async mount(el, params) {
    const memberId = params?.memberId;
    if (!memberId) {
      navigate.pop();
      return;
    }

    const res = await apiRequest(`/api/mobile/v1/members/${memberId}`);
    if (!res.ok) {
      el.innerHTML = `
        ${renderHeader({ title: 'Edit Member', showBack: true })}
        <div class="empty-state">
          <div class="empty-state-title">Member not found</div>
          <button class="btn btn-primary" id="em-back-btn" style="margin-top:var(--sp-md)">Go Back</button>
        </div>
      `;
      bindHeaderEvents(el, { onBack: () => navigate.pop() });
      el.querySelector('#em-back-btn')?.addEventListener('click', () => navigate.pop());
      return;
    }

    const m = res.data;
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const plans = settingsRes.ok ? (settingsRes.data.plans || []) : [];

    el.innerHTML = `
      ${renderHeader({ title: 'Edit Member', showBack: true })}
      <div class="scroll-view">
        <div class="scroll-content" style="padding:var(--sp-lg);gap:var(--sp-lg);display:flex;flex-direction:column;max-width:640px;margin:0 auto;width:100%">

          <div id="em-error-banner" class="form-error-banner" style="display:none">
            <span style="flex-shrink:0">${icon('alert', 18, 'var(--critical)')}</span>
            <span id="em-error-message" style="flex:1"></span>
          </div>

          <form id="em-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">

            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('person', 20, 'var(--brand)')}
                <span>Member Information</span>
              </div>

              ${renderFormField({ id: 'em-name', label: 'Full Name', value: m.full_name, required: true })}
              ${renderFormField({ id: 'em-phone', label: 'Phone Number', type: 'tel', value: m.phone, required: true })}
              ${renderFormField({ id: 'em-email', label: 'Email Address', type: 'email', value: m.email || '' })}
              ${renderFormField({
                id: 'em-gender',
                label: 'Gender',
                value: m.gender || '',
                options: [
                  { value: 'Male', label: 'Male' },
                  { value: 'Female', label: 'Female' },
                  { value: 'Other', label: 'Other' },
                ],
              })}
            </div>

            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('star', 20, 'var(--brand)')}
                <span>Membership Details</span>
              </div>

              ${renderFormField({
                id: 'em-plan',
                label: 'Assigned Plan',
                value: m.plan?.id || '',
                options: plans.map(p => ({ value: p.id, label: `${p.name} (${p.duration_days}d)` })),
              })}
              ${renderFormField({ id: 'em-start', label: 'Start Date', type: 'date', value: m.membership_start || '' })}
              ${renderFormField({ id: 'em-end', label: 'End Date', type: 'date', value: m.membership_end || '' })}
            </div>

            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('edit', 20, 'var(--brand)')}
                <span>Notes</span>
              </div>
              ${renderFormField({ id: 'em-notes', type: 'textarea', value: m.notes || '', placeholder: 'Additional notes...' })}
            </div>

            <button type="submit" class="btn btn-primary btn-lg btn-full" id="em-submit" style="height:50px;font-size:var(--fs-base)">
              Save Changes
            </button>
          </form>
        </div>
      </div>
    `;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    el.querySelector('#em-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = el.querySelector('#em-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving Changes...';

      const fullName = el.querySelector('#em-name').value.trim();
      const phone = el.querySelector('#em-phone').value.trim();
      const email = el.querySelector('#em-email').value.trim() || null;
      const gender = el.querySelector('#em-gender').value || null;
      const planVal = el.querySelector('#em-plan').value;
      const startDate = el.querySelector('#em-start').value || null;
      const endDate = el.querySelector('#em-end').value || null;
      const notes = el.querySelector('#em-notes').value.trim() || null;

      const body = {
        full_name: fullName,
        name: fullName,
        phone,
        email,
        gender,
        plan_id: planVal ? Number(planVal) : null,
        membership_start: startDate,
        membership_end: endDate,
        notes,
      };

      try {
        const r = await apiRequest(`/api/mobile/v1/members/${memberId}`, { method: 'PATCH', body });
        if (r.ok) {
          showToast('Member updated successfully!', 'success');
          navigate.pop();
        } else {
          if (r.error?.status === 401) {
            handleLogout();
            return;
          }
          const msg = r.error?.message || 'Failed to update member.';
          const errorBanner = el.querySelector('#em-error-banner');
          const errorMsg = el.querySelector('#em-error-message');
          if (errorBanner && errorMsg) {
            errorMsg.textContent = msg;
            errorBanner.style.display = 'flex';
          }
          showToast(msg, 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
        }
      } catch (err) {
        showToast('Network error updating member', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
      }
    });
  }
};
