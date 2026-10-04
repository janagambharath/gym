/* Payment Setup Screen */
import { apiRequest, uploadPaymentQrImage } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';

export default {
  async mount(el) {
    const res = await apiRequest('/api/mobile/v1/settings/payment');
    const ps = res.ok && res.data ? res.data : {};

    el.innerHTML = `
      ${renderHeader({ title: 'Payment Setup', showBack: true })}
      <div class="scroll-view"><div class="scroll-content form-scroll-content">
        <form id="ps-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${renderFormField({ id: 'ps-upi', label: 'UPI ID / VPA *', value: ps.upi_id || '', placeholder: 'e.g. yourgym@okhdfcbank', required: true })}
          ${renderFormField({ id: 'ps-label', label: 'Payment Label', value: ps.payment_label || '', placeholder: 'Displayed to members (e.g. Gym Name)' })}
          ${renderFormField({ id: 'ps-inst', label: 'Instructions', type: 'textarea', value: ps.instructions || '', placeholder: 'Payment instructions for members' })}
          <div class="form-group"><label class="form-label" for="ps-qr">Payment QR image</label><p class="form-hint">Upload a PNG, JPG, or WebP image. Members will see it in VYNLA.</p><input id="ps-qr" class="form-input" type="file" accept="image/png,image/jpeg,image/webp">${ps.qr_public_url ? `<img src="${ps.qr_public_url}" alt="Current payment QR" style="display:block;width:180px;height:180px;object-fit:contain;margin-top:12px;border:1px solid var(--border);border-radius:var(--r-md)">` : ''}</div>
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="ps-submit">Save Settings</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    el.querySelector('#ps-qr').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const upload = await uploadPaymentQrImage(file);
      if (upload.ok) {
        showToast('QR image uploaded. Members can scan it in VYNLA.', 'success');
        if (upload.data.qr_public_url) {
          const preview = document.createElement('img');
          preview.src = upload.data.qr_public_url; preview.alt = 'Payment QR';
          preview.style.cssText = 'display:block;width:180px;height:180px;object-fit:contain;margin-top:12px;border:1px solid var(--border);border-radius:var(--r-md)';
          event.target.insertAdjacentElement('afterend', preview);
        }
      } else showToast(upload.error.message, 'error');
    });

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
