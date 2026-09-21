/* Member Login (OTP) Screen */
import { memberRequestOtp, memberVerifyOtp } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { icon } from '../icons.js';
export default {
  mount(el) {
    let step = 'phone', challengeToken = '', phone = '';
    const render = () => {
      el.innerHTML = `
        ${renderHeader({ title: 'Member Login', showBack: true })}
        <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
          <div style="text-align:center;margin-bottom:var(--sp-xxl)">
            <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--whatsapp);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${icon('whatsapp', 32, 'white')}</div>
            <h2>${step === 'phone' ? 'Enter your phone number' : 'Enter OTP'}</h2>
            <p style="color:var(--text-secondary)">${step === 'phone' ? 'We\'ll send a verification code via WhatsApp' : `Code sent to ${phone}`}</p>
          </div>
          <div id="otp-error" class="error-banner hidden" style="margin-bottom:var(--sp-lg)">${icon('alert', 16)} <span id="otp-error-text"></span></div>
          ${step === 'phone' ? `
            <form id="phone-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${renderFormField({ id: 'ml-phone', label: 'Phone Number', type: 'tel', placeholder: '9876543210', required: true })}
              ${renderFormField({ id: 'ml-slug', label: 'Gym Code', placeholder: 'your-gym-slug', required: true, hint: 'Ask your gym owner for the code' })}
              <button type="submit" class="btn btn-whatsapp btn-lg btn-full">${icon('send', 18, 'white')} Send OTP</button>
            </form>
          ` : `
            <form id="otp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
              ${renderFormField({ id: 'ml-otp', label: 'Verification Code', placeholder: '123456', required: true })}
              <button type="submit" class="btn btn-primary btn-lg btn-full">Verify & Login</button>
              <button type="button" class="btn btn-secondary btn-full" id="otp-back">Change Number</button>
            </form>
          `}
        </div></div>`;
      bindHeaderEvents(el, { onBack: () => navigate.pop() });
      if (step === 'phone') {
        el.querySelector('#phone-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          phone = el.querySelector('#ml-phone').value.trim();
          const slug = el.querySelector('#ml-slug').value.trim();
          const res = await memberRequestOtp(phone, slug);
          if (res.ok) { challengeToken = res.data.challenge_token; step = 'otp'; render(); }
          else { el.querySelector('#otp-error-text').textContent = res.error.message; el.querySelector('#otp-error').classList.remove('hidden'); }
        });
      } else {
        el.querySelector('#otp-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const otp = el.querySelector('#ml-otp').value.trim();
          const res = await memberVerifyOtp(phone, otp, challengeToken);
          if (res.ok) { showToast('Welcome!', 'success'); navigate.push('member-home'); }
          else { el.querySelector('#otp-error-text').textContent = res.error.message; el.querySelector('#otp-error').classList.remove('hidden'); }
        });
        el.querySelector('#otp-back')?.addEventListener('click', () => { step = 'phone'; render(); });
      }
    };
    render();
  }
};
