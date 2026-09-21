/* Payment Setup Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';

export default {
  async mount(el) {
    const res = await apiRequest('/api/mobile/v1/settings/payment');
    const ps = res.ok && res.data ? res.data : {};

    el.innerHTML = `
      ${renderHeader({ title: 'Payment Setup', showBack: true })}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="ps-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${renderFormField({ id: 'ps-upi', label: 'UPI ID / VPA *', value: ps.upi_id || '', placeholder: 'e.g. yourgym@okhdfcbank', required: true })}
          ${renderFormField({ id: 'ps-label', label: 'Payment Label', value: ps.payment_label || '', placeholder: 'Displayed to members (e.g. Gym Name)' })}
          ${renderFormField({ id: 'ps-inst', label: 'Instructions', type: 'textarea', value: ps.instructions || '', placeholder: 'Payment instructions for members' })}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="ps-submit">Save Settings</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    el.querySelector('#ps-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const upiInput = el.querySelector('#ps-upi');
      const upiVal = upiInput.value.trim();

      if (!upiVal) {
        showToast('Please enter a UPI ID', 'error');
        upiInput.focus();
        return;
      }

      if (!upiVal.includes('@')) {
        showToast('Invalid UPI ID format (must contain @, e.g. name@okaxis)', 'error');
        upiInput.focus();
        return;
      }

      const btn = el.querySelector('#ps-submit');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const body = {
        upi_id: upiVal,
        payment_label: el.querySelector('#ps-label').value.trim() || null,
        instructions: el.querySelector('#ps-inst').value.trim() || null,
        is_active: true,
      };

      try {
        const r = await apiRequest('/api/mobile/v1/settings/payment', { method: 'PUT', body });
        if (r.ok) {
          showToast('Payment settings saved successfully!', 'success');
          setTimeout(() => navigate.pop(), 500);
        } else {
          if (r.error?.status === 401) {
            handleLogout();
            return;
          }
          showToast(r.error?.message || 'Failed to save payment settings', 'error');
          btn.disabled = false;
          btn.textContent = 'Save Settings';
        }
      } catch (err) {
        showToast(err.message || 'Network error', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Settings';
      }
    });
  }
};
