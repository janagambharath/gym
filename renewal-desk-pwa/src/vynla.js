/* Dedicated VYNLA member PWA.  It deliberately keeps member credentials
   separate from Renewal Desk owner credentials. */

const SESSION_KEY = 'vynla.member-session.v1';
const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://gym-production-910c.up.railway.app' : window.location.origin;
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
let session;

function loadSession() {
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
  return session?.token ? session : null;
}
function saveSession(data) { session = data; localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function clearSession() { session = null; localStorage.removeItem(SESSION_KEY); }

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.public ? {} : session?.token ? { Authorization: `Bearer ${session.token}` } : {}) };
  try {
    const response = await fetch(`${API}${path}`, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
    const body = await response.json();
    if (!response.ok || !body.success) {
      return { ok: false, error: typeof body.error === 'string' ? body.error : body.error?.message || body.message || 'Request failed.' };
    }
    return { ok: true, data: body.data || body };
  } catch { return { ok: false, error: 'Could not reach the server. Check your connection.' }; }
}

function shell(content) {
  document.getElementById('app').innerHTML = `<main style="min-height:100vh;background:#f8fafc;color:#14213d;font-family:Inter,system-ui,sans-serif">${content}</main>`;
}
function notice(message, type = 'error') {
  const styles = {
    error: 'background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;',
    warning: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d;',
    success: 'background:#dcfce7;color:#166534;border:1px solid #86efac;',
    info: 'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;'
  };
  const current = styles[type] || styles.info;
  return `<div style="margin:14px 0;padding:12px 14px;border-radius:10px;font-size:14px;line-height:1.45;${current}">${esc(message)}</div>`;
}

let resendTimer = null;

function renderLogin(message = '') {
  if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
  document.title = 'VYNLA — Member App';
  shell(`<section style="max-width:430px;margin:auto;padding:48px 24px"><div style="text-align:center;margin-bottom:34px"><img src="/icons/icon-192.png" alt="VYNLA" style="width:72px;height:72px;border-radius:20px"><h1 style="margin:14px 0 6px;color:#2563eb">VYNLA</h1><p style="color:#64748b">Your gym membership, in your pocket</p></div><div id="card" style="background:white;border-radius:20px;padding:24px;box-shadow:0 8px 30px #0f172a12"><h2 id="login-title">Member sign in</h2><p id="login-copy" style="color:#64748b">Enter your registered mobile number to receive a WhatsApp verification code.</p>${message ? notice(message, 'error') : ''}<form id="phone-form"><label style="display:block;font-weight:600;margin:18px 0 6px">Mobile number</label><input id="phone" inputmode="tel" autocomplete="tel" placeholder="9876543210" required style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px"><button id="send-code-btn" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:16px;cursor:pointer">Send WhatsApp code</button></form></div><p style="text-align:center;color:#64748b;font-size:13px;margin-top:22px">Ask your gym if your mobile number is not recognised.<br><a href="/" style="color:#2563eb;text-decoration:none;display:inline-block;margin-top:10px;font-weight:600">Gym owner or staff? Go to Renewal Desk →</a></p></section>`);
  document.querySelector('#phone-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const phoneInput = document.querySelector('#phone');
    const sendBtn = document.querySelector('#send-code-btn');
    const phone = phoneInput.value.trim();
    if (!phone) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending code…';
    const result = await api('/api/member/v1/auth/request-otp', { method: 'POST', body: { phone }, public: true });
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send WhatsApp code';
    if (!result.ok) return renderLogin(result.error);
    const data = result.data || {};
    renderOtp(phone, data.challenge || data.challenge_token, {
      delivery_ok: data.delivery_ok,
      delivery_warning: data.delivery_warning,
      delivery_error: data.delivery_error,
      wa_chat_url: data.wa_chat_url,
      gym_name: data.gym_name,
      test_otp: data.test_otp,
    });
  });
}

function renderOtp(phone, initialChallenge, meta = {}, alertNotice = null) {
  if (resendTimer) {
    clearInterval(resendTimer);
    resendTimer = null;
  }

  let currentChallenge = initialChallenge;
  let countdown = 30;

  let bannerHtml = '';
  if (alertNotice) {
    bannerHtml = notice(alertNotice.text, alertNotice.type || 'error');
  } else if (meta.delivery_warning) {
    bannerHtml = notice(meta.delivery_warning, 'warning');
  } else {
    bannerHtml = notice('Verification code sent to your WhatsApp number.', 'success');
  }

  const testOtpCard = meta.test_otp ? `
    <div id="quick-otp-card" style="margin-top:14px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <span style="font-size:12px;color:#1e40af;font-weight:600;display:block">Reviewer / Quick Login Code:</span>
        <strong style="font-size:22px;letter-spacing:4px;color:#1d4ed8">${esc(meta.test_otp)}</strong>
      </div>
      <button type="button" id="fill-otp-btn" style="border:0;background:#2563eb;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">
        Use Code
      </button>
    </div>
  ` : '';

  const waHelpSection = meta.wa_chat_url ? `
    <div style="margin-top:16px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;text-align:center">
      <p style="margin:0 0 10px;font-size:13px;color:#166534">
        Didn't receive the WhatsApp message? Tap below to open chat with your gym, then tap <strong>Resend code</strong>.
      </p>
      <a href="${esc(meta.wa_chat_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;box-sizing:border-box;padding:11px 16px;background:#22c55e;color:#fff;border-radius:10px;font-weight:600;font-size:14px;text-decoration:none">
        💬 Message gym on WhatsApp
      </a>
    </div>
  ` : '';

  shell(`
    <section style="max-width:430px;margin:auto;padding:40px 24px">
      <button id="back" style="border:0;background:none;color:#2563eb;padding:0;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
        ← Change number
      </button>
      <div style="background:white;border-radius:20px;padding:24px;margin-top:16px;box-shadow:0 8px 30px #0f172a12">
        <h2 style="margin:0 0 6px">Verify your number</h2>
        <p style="color:#64748b;font-size:14px;margin:0 0 14px">
          Enter the 6-digit code sent to <strong style="color:#14213d">${esc(phone)}</strong> on WhatsApp.
        </p>
        <div id="otp-banner">${bannerHtml}</div>
        <div id="test-otp-card-container">${testOtpCard}</div>
        <form id="otp-form">
          <label style="display:block;font-weight:600;font-size:14px;margin:16px 0 6px">Verification code</label>
          <input id="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required maxlength="6" autofocus style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #cbd5e1;border-radius:10px;font-size:24px;letter-spacing:8px;text-align:center;font-weight:700">
          <button id="verify-btn" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:16px;cursor:pointer">
            Open VYNLA
          </button>
        </form>

        <div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;padding-top:16px;border-top:1px solid #f1f5f9">
          <span style="font-size:13px;color:#64748b">Didn't get the code?</span>
          <button id="resend-btn" disabled style="border:0;background:none;color:#94a3b8;font-size:13px;font-weight:600;cursor:not-allowed;padding:6px 0">
            Resend in 30s
          </button>
        </div>

        ${waHelpSection}
      </div>
      <p style="text-align:center;color:#64748b;font-size:13px;margin-top:22px">
        Need help? Ask your gym staff for your 6-digit login code.<br>
        <a href="/" style="color:#2563eb;text-decoration:none;display:inline-block;margin-top:8px;font-weight:600">Gym owner or staff? Go to Renewal Desk →</a>
      </p>
    </section>
  `);

  const backBtn = document.querySelector('#back');
  const otpForm = document.querySelector('#otp-form');
  const otpInput = document.querySelector('#otp');
  const verifyBtn = document.querySelector('#verify-btn');
  const resendBtn = document.querySelector('#resend-btn');
  const bannerContainer = document.querySelector('#otp-banner');

  function bindFillOtpBtn() {
    const fillBtn = document.querySelector('#fill-otp-btn');
    if (fillBtn && meta.test_otp) {
      fillBtn.onclick = () => {
        otpInput.value = meta.test_otp;
        otpInput.focus();
      };
    }
  }
  bindFillOtpBtn();

  backBtn.onclick = () => {
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
    renderLogin();
  };

  function updateResendButton() {
    if (!resendBtn) return;
    if (countdown > 0) {
      resendBtn.disabled = true;
      resendBtn.style.color = '#94a3b8';
      resendBtn.style.cursor = 'not-allowed';
      resendBtn.textContent = `Resend in ${countdown}s`;
    } else {
      resendBtn.disabled = false;
      resendBtn.style.color = '#2563eb';
      resendBtn.style.cursor = 'pointer';
      resendBtn.textContent = 'Resend code';
      if (resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
      }
    }
  }

  resendTimer = setInterval(() => {
    countdown -= 1;
    updateResendButton();
  }, 1000);
  updateResendButton();

  resendBtn.onclick = async () => {
    if (countdown > 0) return;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    const result = await api('/api/member/v1/auth/request-otp', { method: 'POST', body: { phone }, public: true });
    if (!result.ok) {
      bannerContainer.innerHTML = notice(result.error, 'error');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
      return;
    }
    const data = result.data || {};
    if (data.challenge || data.challenge_token) {
      currentChallenge = data.challenge || data.challenge_token;
    }
    if (data.wa_chat_url) {
      meta.wa_chat_url = data.wa_chat_url;
    }
    if (data.test_otp) {
      meta.test_otp = data.test_otp;
      const cardContainer = document.querySelector('#test-otp-card-container');
      if (cardContainer) {
        cardContainer.innerHTML = `
          <div id="quick-otp-card" style="margin-top:14px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <span style="font-size:12px;color:#1e40af;font-weight:600;display:block">Reviewer / Quick Login Code:</span>
              <strong style="font-size:22px;letter-spacing:4px;color:#1d4ed8">${esc(meta.test_otp)}</strong>
            </div>
            <button type="button" id="fill-otp-btn" style="border:0;background:#2563eb;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">
              Use Code
            </button>
          </div>
        `;
        bindFillOtpBtn();
      }
    }
    if (data.delivery_warning) {
      bannerContainer.innerHTML = notice(data.delivery_warning, 'warning');
    } else {
      bannerContainer.innerHTML = notice('New verification code sent via WhatsApp!', 'success');
    }
    otpInput.value = '';
    otpInput.focus();
    countdown = 30;
    resendTimer = setInterval(() => {
      countdown -= 1;
      updateResendButton();
    }, 1000);
    updateResendButton();
  };

  otpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const otp = otpInput.value.trim();
    if (!otp) return;
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying…';
    const result = await api('/api/member/v1/auth/verify-otp', {
      method: 'POST',
      body: { phone, otp, challenge: currentChallenge },
      public: true
    });
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Open VYNLA';
    if (!result.ok) {
      bannerContainer.innerHTML = notice(result.error, 'error');
      otpInput.focus();
      return;
    }
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
    saveSession({ token: result.data.token, member: result.data.member });
    renderHome();
  });
}

async function renderHome() {
  shell('<div style="padding:48px;text-align:center">Loading your membership…</div>');
  const result = await api('/api/member/v1/dashboard');
  if (!result.ok) { clearSession(); return renderLogin(result.error); }
  const d = result.data, member = d.member || {}, gym = d.gym || {}, branding = d.branding || {};
  shell(`<section style="max-width:600px;margin:auto;padding-bottom:34px"><div style="padding:34px 24px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;border-radius:0 0 28px 28px"><div style="font-size:13px;opacity:.8">${esc(gym.name || branding.gym_name || 'Your Gym')}</div><h1 style="margin:8px 0">Hi, ${esc(member.full_name || session.member?.full_name || 'Member')}</h1><div style="font-size:48px;font-weight:800">${member.days_left ?? '—'}</div><div style="opacity:.85">days remaining</div></div><div style="padding:20px"><div style="background:white;border-radius:16px;padding:18px;box-shadow:0 3px 12px #0f172a10"><div style="color:#64748b;font-size:13px">CURRENT MEMBERSHIP</div><h2 style="margin:7px 0">${esc(member.plan_name || 'Membership')}</h2><div>Valid until <strong>${esc(member.membership_end || '—')}</strong></div></div>${gym.address ? `<div style="margin-top:16px;background:#eff6ff;border-radius:14px;padding:15px">📍 <strong>${esc(gym.name || 'Gym')}</strong><br><span style="color:#475569">${esc(gym.address)}</span></div>` : ''}<button id="renew" style="width:100%;margin-top:18px;padding:15px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:700;font-size:16px">Renew membership</button><div style="display:flex;gap:12px;margin-top:12px"><button id="profile" style="flex:1;padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:white">My profile</button><button id="signout" style="flex:1;padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:white">Sign out</button></div></div></section>`);
  document.querySelector('#renew').onclick = () => renderRenew(); document.querySelector('#profile').onclick = () => renderProfile(); document.querySelector('#signout').onclick = () => { clearSession(); renderLogin(); };
}

async function renderProfile() {
  shell('<div style="padding:48px;text-align:center">Loading profile…</div>'); const result = await api('/api/member/v1/profile');
  if (!result.ok) return renderHome(); const d = result.data, m = d.member || {}, gym = d.gym || {};
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>My Profile</h1><div style="background:white;border-radius:16px;padding:18px;margin:14px 0"><h2>${esc(m.full_name)}</h2><p>${esc(m.phone || '')}</p><p>${esc(m.email || '')}</p>${m.address ? `<p style="color:#475569">📍 ${esc(m.address)}</p>` : ''}</div><div style="background:white;border-radius:16px;padding:18px"><h2>${esc(gym.name || 'Gym')}</h2><p>Phone: ${esc(gym.phone || '—')}</p><p>Address: ${esc(gym.address || '—')}</p></div></section>`); document.querySelector('#back').onclick = renderHome;
}

async function renderRenew() {
  shell('<div style="padding:48px;text-align:center">Loading payment details…</div>'); const [plans, payment] = await Promise.all([api('/api/member/v1/plans'), api('/api/member/v1/payment-info')]);
  if (!plans.ok || !payment.ok) return renderHome(); const list = plans.data.plans || [], p = payment.data;
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>Renew membership</h1><p style="color:#64748b">Choose a plan, pay using your gym's QR, then submit the payment reference.</p><div id="plans">${list.map((plan) => `<button class="plan" data-id="${plan.id}" data-name="${esc(plan.name)}" data-price="${plan.price}" style="width:100%;text-align:left;margin:10px 0;padding:16px;border:1px solid #cbd5e1;border-radius:14px;background:white"><strong>${esc(plan.name)}</strong><span style="float:right;color:#2563eb;font-weight:700">${money(plan.price)}</span><br><small>${plan.duration_days} days</small></button>`).join('') || notice('No renewal plans are available.', true)}</div><div id="pay" style="display:none;background:white;border-radius:16px;padding:18px;margin-top:16px"><h2 id="plan-name"></h2>${p.qr_public_url ? `<img src="${esc(p.qr_public_url)}" alt="Payment QR" style="width:220px;height:220px;display:block;margin:12px auto;object-fit:contain">` : `<div style="text-align:center;padding:18px;background:#fef3c7;border-radius:12px;margin:12px 0;color:#92400e"><strong>No payment QR available</strong><br>Ask your gym to upload their payment QR code.</div>`}<p><strong>UPI:</strong> ${esc(p.upi_id || 'Contact your gym')}</p><p>${esc(p.instructions || '')}</p><input id="reference" placeholder="UPI transaction reference (optional)" style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:10px"><button id="claim" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:white;font-weight:700">I've made the payment</button></div></section>`);
  document.querySelector('#back').onclick = renderHome; let selected;
  document.querySelectorAll('.plan').forEach((button) => button.onclick = () => { selected = button.dataset.id; document.querySelector('#plan-name').textContent = `${button.dataset.name} — ${money(button.dataset.price)}`; document.querySelector('#pay').style.display = 'block'; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
  document.querySelector('#claim').onclick = async () => { if (!selected) return; const result = await api('/api/member/v1/renew/claim', { method: 'POST', body: { plan_id: Number(selected), reference: document.querySelector('#reference').value.trim() || undefined } }); if (result.ok) { alert('Payment claim submitted. Your gym will verify it shortly.'); renderHome(); } else alert(result.error); };
}

export function bootVynla() { loadSession() ? renderHome() : renderLogin(); }
