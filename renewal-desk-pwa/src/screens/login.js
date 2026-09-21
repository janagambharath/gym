/* ═══════════════════════════════════════════════════════════════════════
   Login Screen
   ═══════════════════════════════════════════════════════════════════════ */

import { login } from '../api.js';
import { handleLogin, navigate } from '../app.js';
import { showToast, renderFormField } from '../components.js';
import { icon } from '../icons.js';

/** @type {import('../router.js').Screen} */
export default {
  mount(el) {
    el.innerHTML = `
      <div class="scroll-view">
        <div style="padding:var(--sp-4xl) var(--sp-xxl);padding-top:calc(var(--safe-top) + var(--sp-4xl));min-height:100%;display:flex;flex-direction:column;justify-content:center">
          
          <!-- Branding -->
          <div style="text-align:center;margin-bottom:var(--sp-4xl)">
            <div style="width:72px;height:72px;border-radius:var(--r-xxl);background:linear-gradient(135deg,var(--brand),var(--brand-dark));display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">
              ${icon('fitness', 36, 'white')}
            </div>
            <h1 style="font-size:var(--fs-5xl);margin-bottom:var(--sp-xs)">Renewal Desk</h1>
            <p style="color:var(--muted);font-size:var(--fs-base);margin:0">Your gym management command center</p>
          </div>

          <!-- Form Card -->
          <div class="card" style="padding:var(--sp-xxl)">
            <h2 style="font-size:var(--fs-3xl);margin-bottom:var(--sp-xs)">Sign in</h2>
            <p style="color:var(--text-secondary);margin-bottom:var(--sp-xl)">Enter your credentials to continue</p>

            <div id="login-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">
              ${icon('alert', 16)} <span id="login-error-text"></span>
            </div>

            <form id="login-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${renderFormField({ id: 'login-email', label: 'Email', type: 'email', placeholder: 'you@example.com', required: true })}
              ${renderFormField({ id: 'login-password', label: 'Password', type: 'password', placeholder: 'Enter your password', required: true })}
              
              <button type="submit" class="btn btn-primary btn-lg btn-full" id="login-submit">
                <span id="login-submit-text">Sign In</span>
                <span id="login-submit-spinner" class="spinner spinner-sm spinner-white hidden"></span>
              </button>
            </form>
          </div>

          <!-- Footer Links -->
          <div style="text-align:center;margin-top:var(--sp-xxl);display:flex;flex-direction:column;gap:var(--sp-md)">
            <button class="btn btn-outline btn-full" id="goto-signup">
              Create a new account
            </button>
            <button style="color:var(--brand);font-size:var(--fs-sm);font-weight:var(--fw-semibold);padding:var(--sp-md)" id="goto-member-login">
              I'm a gym member →
            </button>
          </div>
        </div>
      </div>`;

    // ── Bind Events ──
    const form = el.querySelector('#login-form');
    const errorEl = el.querySelector('#login-error');
    const errorText = el.querySelector('#login-error-text');
    const submitBtn = el.querySelector('#login-submit');
    const submitText = el.querySelector('#login-submit-text');
    const submitSpinner = el.querySelector('#login-submit-spinner');

    function showError(msg) {
      errorText.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.querySelector('#login-email').value.trim();
      const password = el.querySelector('#login-password').value;

      if (!email || !password) {
        showError('Email and password are required.');
        return;
      }

      submitBtn.disabled = true;
      submitText.textContent = 'Signing in...';
      submitSpinner.classList.remove('hidden');
      errorEl.classList.add('hidden');

      const result = await login(email, password);

      if (result.ok) {
        showToast('Welcome back!', 'success');
        handleLogin();
      } else {
        showError(result.error.message);
        submitBtn.disabled = false;
        submitText.textContent = 'Sign In';
        submitSpinner.classList.add('hidden');
      }
    });

    // Clear error on input
    el.querySelectorAll('.form-input').forEach(input => {
      input.addEventListener('input', () => errorEl.classList.add('hidden'));
    });

    el.querySelector('#goto-signup')?.addEventListener('click', () => navigate.push('signup'));
    el.querySelector('#goto-member-login')?.addEventListener('click', () => navigate.push('member-login'));
  }
};
