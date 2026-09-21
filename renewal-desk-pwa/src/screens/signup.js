/* Signup Screen */
import { signup } from '../api.js';
import { handleLogin, navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { icon } from '../icons.js';

export default {
  mount(el) {
    el.innerHTML = `
      ${renderHeader({ title: 'Create Account', showBack: true })}
      <div class="scroll-view">
        <div class="scroll-content" style="padding:var(--sp-xxl)">
          <div id="signup-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">
            ${icon('alert', 16)} <span id="signup-error-text"></span>
          </div>
          <form id="signup-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
            ${renderFormField({ id: 's-name', label: 'Full Name', placeholder: 'John Doe', required: true })}
            ${renderFormField({ id: 's-email', label: 'Email', type: 'email', placeholder: 'you@example.com', required: true })}
            ${renderFormField({ id: 's-phone', label: 'Phone', type: 'tel', placeholder: '+91 98765 43210', required: true })}
            ${renderFormField({ id: 's-password', label: 'Password', type: 'password', placeholder: 'Min 6 characters', required: true })}
            ${renderFormField({ id: 's-gym', label: 'Gym Name', placeholder: 'My Fitness Studio', required: true })}
            ${renderFormField({ id: 's-country', label: 'Country', options: [
              { value: 'India', label: 'India' }, { value: 'UAE', label: 'UAE' },
              { value: 'United States', label: 'United States' }, { value: 'United Kingdom', label: 'United Kingdom' },
              { value: 'Australia', label: 'Australia' },
            ], required: true })}
            <button type="submit" class="btn btn-primary btn-lg btn-full" id="signup-submit">Create Account</button>
          </form>
        </div>
      </div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    el.querySelector('#signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#signup-submit');
      btn.disabled = true; btn.textContent = 'Creating...';
      const res = await signup({
        fullName: el.querySelector('#s-name').value.trim(),
        email: el.querySelector('#s-email').value.trim(),
        phone: el.querySelector('#s-phone').value.trim(),
        password: el.querySelector('#s-password').value,
        gymName: el.querySelector('#s-gym').value.trim(),
        country: el.querySelector('#s-country').value,
      });
      if (res.ok) { showToast('Account created!', 'success'); handleLogin(); }
      else {
        el.querySelector('#signup-error-text').textContent = res.error.message;
        el.querySelector('#signup-error').classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Create Account';
      }
    });
  }
};
