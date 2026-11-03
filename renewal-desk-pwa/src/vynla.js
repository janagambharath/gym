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
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = { Accept: 'application/json', ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(options.public ? {} : session?.token ? { Authorization: `Bearer ${session.token}` } : {}) };
  try {
    const response = await fetch(`${API}${path}`, { method: options.method || 'GET', headers, body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined });
    const body = await response.json();
    if (!response.ok || !body.success) {
      return { ok: false, status: response.status, error: typeof body.error === 'string' ? body.error : body.error?.message || body.message || 'Request failed.' };
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

const pageDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const pageDateTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
function memberNav(active) {
  const tabs = [['home','Home'],['membership','Plan'],['attendance','Visits'],['payments','Payments'],['profile','Profile']];
  return `<nav aria-label="Member app" style="position:fixed;z-index:20;bottom:0;left:50%;transform:translateX(-50%);width:min(100%,640px);display:flex;justify-content:space-around;gap:4px;background:#fff;border-top:1px solid #e2e8f0;padding:10px 4px max(10px,env(safe-area-inset-bottom));box-shadow:0 -5px 18px #0f172a0c">${tabs.map(([key,label])=>`<button type="button" data-vynla-page="${key}" aria-current="${active===key?'page':'false'}" style="flex:1;border:0;background:none;color:${active===key?'#2563eb':'#64748b'};font-weight:${active===key?'700':'600'};font-size:12px;padding:7px 2px">${label}</button>`).join('')}</nav>`;
}
function bindMemberNav() {
  document.querySelectorAll('[data-vynla-page]').forEach((button)=>button.addEventListener('click',()=>{
    const routes = {home:renderHome,membership:renderMembership,attendance:renderAttendance,payments:renderPayments,profile:renderProfile};
    routes[button.dataset.vynlaPage]?.();
  }));
}
function memberPage(active, content) {
  shell(`<div style="max-width:640px;min-height:100vh;margin:auto;padding-bottom:76px">${content}${memberNav(active)}</div>`);
  bindMemberNav();
}
function memberLoadError(active, message, retry) {
  memberPage(active, `<section style="padding:24px"><h1 style="font-size:24px">Couldn’t load this page</h1>${notice(message,'warning')}<button id="member-retry" style="width:100%;padding:14px;background:#2563eb;color:white;border:0;border-radius:11px;font-weight:700">Try again</button></section>`);
  document.querySelector('#member-retry').onclick = retry;
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
  if (!result.ok) {
    if (result.status === 401) { clearSession(); return renderLogin(result.error); }
    return memberLoadError('home',result.error,renderHome);
  }
  const d = result.data, member = d.member || {}, gym = d.gym || {}, branding = d.branding || {};
  const access = await api('/api/member/v1/access?per_page=1');
  const photo = member.profile_photo_url ? `<img src="${esc(member.profile_photo_url)}" alt="${esc(member.full_name||'Member')} profile" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #ffffff99">` : `<div aria-hidden="true" style="width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:#ffffff30;font-size:28px;font-weight:800">${esc((member.full_name||'M').slice(0,1).toUpperCase())}</div>`;
  const days = member.days_left;
  const banners = (branding.announcements||[]).slice(0,3).map((item)=>`<article style="padding:14px 16px;background:#eff6ff;border-radius:14px;margin-top:10px"><strong>${esc(item.title||'Gym update')}</strong><p style="margin:6px 0 0;color:#475569;line-height:1.45">${esc(item.message||'')}</p></article>`).join('');
  const offers = (branding.offers||[]).slice(0,3).map((item)=>`<article style="padding:14px 16px;background:#f0fdf4;border-radius:14px;margin-top:10px"><strong>${esc(item.title||'Gym offer')}</strong><p style="margin:6px 0 0;color:#475569;line-height:1.45">${esc(item.description||'')}</p></article>`).join('');
  memberPage('home', `<header style="padding:28px 22px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:0 0 26px 26px"><div style="display:flex;align-items:center;gap:14px">${photo}<div><div style="font-size:13px;opacity:.85">${esc(gym.name || branding.gym_name || 'Your Gym')}</div><h1 style="font-size:24px;margin:5px 0">Hi, ${esc((member.full_name || session.member?.full_name || 'Member').split(' ')[0])}</h1></div></div><div style="display:flex;align-items:end;gap:10px;margin-top:22px"><strong style="font-size:44px;line-height:1">${days == null ? '—' : Math.max(days,0)}</strong><span style="padding-bottom:4px;opacity:.9">${member.is_expired?'membership expired':'days remaining'}</span></div><div style="margin-top:12px;display:inline-block;padding:6px 10px;background:#ffffff22;border-radius:999px;font-size:12px;font-weight:700">${esc(String(member.status||'active').toUpperCase())}</div></header><section style="padding:18px"><article style="background:#fff;border-radius:18px;padding:18px;box-shadow:0 3px 14px #0f172a0c"><div style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:.08em">CURRENT MEMBERSHIP</div><h2 style="margin:7px 0">${esc(member.plan_name || 'Membership')}</h2><div>${pageDate(member.membership_start)} – ${pageDate(member.membership_end)}</div><div style="color:#64748b;margin-top:7px">${esc(member.plan_price ? money(member.plan_price) : '')}</div></article>${d.pending_payment ? notice(`Payment ${money(d.pending_payment.amount)} is waiting for gym confirmation.`, 'warning') : ''}<div style="display:flex;gap:10px;margin-top:14px"><div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px"><strong style="font-size:22px">${access.ok ? access.data.summary?.today_entries||0 : '—'}</strong><div style="color:#64748b;font-size:12px;margin-top:3px">Visits today</div></div><div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px"><strong style="font-size:16px">${pageDate(access.ok ? access.data.summary?.last_visit : null)}</strong><div style="color:#64748b;font-size:12px;margin-top:3px">Last visit</div></div></div><button id="renew" style="width:100%;margin-top:14px;padding:15px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:700;font-size:16px">Renew membership</button>${gym.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gym.name||''} ${gym.address}`)}" style="display:block;margin-top:12px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;color:#1d4ed8;text-decoration:none">📍 ${esc(gym.address)} · Get directions</a>` : ''}${banners ? `<h2 style="font-size:18px;margin:24px 0 8px">Gym updates</h2>${banners}` : ''}${offers ? `<h2 style="font-size:18px;margin:24px 0 8px">Member offers</h2>${offers}` : ''}<button id="signout" style="margin:22px 0 4px;padding:10px 0;border:0;background:none;color:#64748b">Sign out</button></section>`);
  document.querySelector('#renew').onclick = () => renderRenew();
  document.querySelector('#signout').onclick = () => { clearSession(); renderLogin(); };
}

async function renderProfile() {
  shell('<div style="padding:48px;text-align:center">Loading profile…</div>'); const result = await api('/api/member/v1/profile');
  if (!result.ok) { if(result.status===401){clearSession();return renderLogin(result.error);} return memberLoadError('profile',result.error,renderProfile); } const d = result.data, m = d.member || {}, gym = d.gym || {};
  const avatar = m.profile_photo_url ? `<img src="${esc(m.profile_photo_url)}" alt="Profile photo" style="width:104px;height:104px;border-radius:50%;object-fit:cover">` : `<div style="width:104px;height:104px;border-radius:50%;display:grid;place-items:center;background:#dbeafe;color:#1d4ed8;font-size:38px;font-weight:800">${esc((m.full_name||'M').slice(0,1).toUpperCase())}</div>`;
  memberPage('profile', `<section style="padding:22px"><h1 style="font-size:26px;margin:6px 0 18px">My profile</h1><article style="background:#fff;border-radius:18px;padding:20px;text-align:center;box-shadow:0 3px 14px #0f172a0c"><div>${avatar}</div><h2 style="margin:12px 0 4px">${esc(m.full_name||'Member')}</h2><div style="color:#64748b">${esc(m.phone||'')}</div><label for="photo" style="display:inline-block;margin-top:14px;padding:10px 14px;background:#eff6ff;color:#1d4ed8;border-radius:10px;font-weight:700;cursor:pointer">${m.profile_photo_url?'Change photo':'Add profile photo'}</label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp" style="display:none">${m.profile_photo_url?'<button id="remove-photo" style="display:block;margin:10px auto 0;border:0;background:none;color:#b91c1c">Remove photo</button>':''}<p style="font-size:12px;color:#64748b;margin:12px 0 0">JPEG, PNG, or WebP · up to 3 MB</p></article><form id="profile-form" style="background:#fff;border-radius:18px;padding:18px;margin-top:14px"><h2 style="font-size:17px;margin:0 0 14px">Contact details</h2><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Email</label><input name="email" type="email" maxlength="255" value="${esc(m.email||'')}" placeholder="you@example.com" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px"><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Address</label><textarea name="address" maxlength="2000" rows="3" placeholder="Your address" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px">${esc(m.address||'')}</textarea><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Gender (optional)</label><select name="gender" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:white;font-size:16px"><option value="" ${!m.gender?'selected':''}>Prefer not to say</option>${['female','male','other'].map((value)=>`<option value="${value}" ${String(m.gender||'').toLowerCase()===value?'selected':''}>${value[0].toUpperCase()+value.slice(1)}</option>`).join('')}</select><button id="save-profile" style="width:100%;margin-top:16px;padding:14px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:700">Save details</button><p style="font-size:12px;color:#64748b;line-height:1.45">Your name and phone are managed by your gym so your membership and access records stay matched.</p></form><article style="background:#fff;border-radius:18px;padding:18px;margin-top:14px"><h2 style="font-size:17px;margin:0 0 8px">${esc(gym.name||'Your gym')}</h2><div style="color:#64748b">${esc(gym.phone||'Phone not provided')}</div><div style="color:#64748b;margin-top:6px">${esc(gym.address||'Address not provided')}</div>${gym.phone?`<a href="tel:${esc(gym.phone)}" style="display:inline-block;margin-top:12px;color:#1d4ed8">Call the gym</a>`:''}</article><button id="signout" style="margin-top:16px;padding:12px;border:0;background:none;color:#64748b">Sign out</button></section>`);
  document.querySelector('#photo').addEventListener('change', async (event)=>{
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 3*1024*1024) { alert('Choose a JPEG, PNG, or WebP photo up to 3 MB.'); return; }
    const form = new FormData(); form.append('photo',file);
    const uploaded = await api('/api/member/v1/profile/photo',{method:'POST',body:form});
    if (!uploaded.ok) { alert(uploaded.error); return; }
    await renderProfile();
  });
  document.querySelector('#remove-photo')?.addEventListener('click',async()=>{
    if (!window.confirm('Remove your profile photo?')) return;
    const removed = await api('/api/member/v1/profile/photo',{method:'DELETE'});
    if (!removed.ok) { alert(removed.error); return; }
    await renderProfile();
  });
  document.querySelector('#profile-form').addEventListener('submit',async(event)=>{
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const saved=await api('/api/member/v1/profile',{method:'PUT',body:{email:form.get('email')||null,address:form.get('address')||null,gender:form.get('gender')||null}});
    if (!saved.ok) { alert(saved.error); return; }
    alert('Your details were saved.'); await renderProfile();
  });
  document.querySelector('#signout').onclick=()=>{clearSession();renderLogin();};
}

async function renderMembership() {
  shell('<div style="padding:48px;text-align:center">Loading membership…</div>');
  const result=await api('/api/member/v1/membership'); if(!result.ok){if(result.status===401){clearSession();return renderLogin(result.error);} return memberLoadError('membership',result.error,renderMembership);}
  const d=result.data||{},m=d.membership||{},history=d.renewal_history||[];
  memberPage('membership',`<section style="padding:22px"><h1 style="font-size:26px">Membership</h1><article style="background:#fff;border-radius:18px;padding:20px;margin-top:14px"><div style="font-size:12px;color:#64748b;font-weight:700">CURRENT PLAN</div><h2>${esc(m.plan_name||'Membership')}</h2><div>${esc(String(m.status||'').toUpperCase())} · ${esc(m.days_left==null?'—':`${Math.max(m.days_left,0)} days left`)}</div><div style="color:#64748b;margin-top:12px">Started ${pageDate(m.membership_start)}<br>Valid through ${pageDate(m.membership_end)}</div><div style="font-weight:700;margin-top:12px">${m.plan_price?money(m.plan_price):''} ${m.plan_duration_days?`· ${m.plan_duration_days} days`:''}</div><button id="renew" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:11px;background:#2563eb;color:white;font-weight:700">Renew membership</button></article><h2 style="font-size:18px;margin:24px 0 10px">Renewal history</h2>${history.length?history.map((item)=>`<article style="background:#fff;border-radius:14px;padding:15px;margin-top:9px"><strong>${esc(item.plan_name||'Renewal')}</strong><div style="color:#64748b;margin-top:6px">${pageDate(item.new_start)} – ${pageDate(item.new_end)}</div><div style="margin-top:6px">${money(item.amount)}</div></article>`).join(''):'<p style="color:#64748b">Your confirmed renewals will appear here.</p>'}</section>`);
  document.querySelector('#renew').onclick=renderRenew;
}

async function renderAttendance(page=1,prior=[]) {
  if(page===1)shell('<div style="padding:48px;text-align:center">Loading attendance…</div>');
  const result=await api(`/api/member/v1/access?page=${page}&per_page=20`);
  if(!result.ok){if(page===1){if(result.status===401){clearSession();renderLogin(result.error);}else memberLoadError('attendance',result.error,()=>renderAttendance(page,prior));}else alert(result.error);return;}
  const data=result.data||{},summary=data.summary||{},events=[...prior,...(data.events||[])];
  const rows=events.map((event)=>{const type=String(event.event_type||'').toUpperCase();const label=type==='ENTRY'?'Gym entry':type==='EXIT'?'Gym exit':type.includes('DENIED')?'Access denied':'Attendance recorded';const color=type==='ENTRY'?'#059669':type.includes('DENIED')?'#dc2626':'#475569';return `<article style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:14px;margin-top:9px"><div style="width:10px;height:10px;border-radius:50%;background:${color}"></div><div style="flex:1"><strong>${label}</strong><div style="margin-top:4px;color:#64748b;font-size:13px">${pageDateTime(event.timestamp)}${event.device_name?` · ${esc(event.device_name)}`:''}</div></div></article>`;}).join('');
  memberPage('attendance',`<section style="padding:22px"><h1 style="font-size:26px">Attendance</h1><p style="margin:5px 0 16px;color:#64748b">Your visits recorded by your gym’s access system.</p><article style="display:flex;background:#fff;border-radius:16px;padding:15px;text-align:center"><div style="flex:1"><strong style="font-size:24px">${summary.today_entries||0}</strong><div style="color:#64748b;font-size:12px">Entries today</div></div><div style="flex:1"><strong style="font-size:24px">${summary.today_exits||0}</strong><div style="color:#64748b;font-size:12px">Exits today</div></div><div style="flex:1"><strong style="font-size:14px">${summary.is_inside?'Inside':'Outside'}</strong><div style="color:#64748b;font-size:12px">Current state</div></div></article><div style="margin-top:14px">${rows||'<article style="background:#fff;border-radius:16px;padding:22px;text-align:center;color:#64748b">No visits have been recorded yet.</article>'}</div>${page<data.pagination?.total_pages?`<button id="older" style="width:100%;margin-top:14px;padding:13px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font-weight:700">Load older visits</button>`:''}<p style="font-size:12px;color:#94a3b8;margin-top:14px">Last visit: ${pageDateTime(summary.last_visit)}</p></section>`);
  document.querySelector('#older')?.addEventListener('click',()=>renderAttendance(page+1,events));
}

async function renderPayments(page=1,prior=[]) {
  if(page===1)shell('<div style="padding:48px;text-align:center">Loading payments…</div>');
  const result=await api(`/api/member/v1/payments?page=${page}&per_page=20`);
  if(!result.ok){if(page===1){if(result.status===401){clearSession();renderLogin(result.error);}else memberLoadError('payments',result.error,()=>renderPayments(page,prior));}else alert(result.error);return;}
  const data=result.data||{},payments=[...prior,...(data.payments||[])];
  memberPage('payments',`<section style="padding:22px"><h1 style="font-size:26px">Payments</h1><p style="color:#64748b">Payment claims and confirmations from your gym.</p>${payments.length?payments.map((p)=>`<article style="background:#fff;border-radius:15px;padding:16px;margin-top:10px"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${money(p.amount)}</strong><span style="font-size:12px;font-weight:700;color:${String(p.status).toLowerCase()==='verified'?'#059669':String(p.status).toLowerCase()==='pending'?'#b45309':'#475569'}">${esc(String(p.status||'unknown').replaceAll('_',' ').toUpperCase())}</span></div><div style="color:#64748b;font-size:13px;margin-top:7px">${esc(p.method||p.channel||'Payment')} · ${pageDate(p.paid_on||p.created_at)}</div>${p.reference?`<div style="color:#64748b;font-size:12px;margin-top:4px">Reference: ${esc(p.reference)}</div>`:''}${p.notes?`<div style="color:#64748b;font-size:12px;margin-top:4px">${esc(p.notes)}</div>`:''}</article>`).join(''):'<article style="background:#fff;border-radius:16px;padding:22px;text-align:center;color:#64748b">No payment records yet.</article>'}${page<data.pagination?.total_pages?'<button id="older" style="width:100%;margin-top:14px;padding:13px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font-weight:700">Load older payments</button>':''}</section>`);
  document.querySelector('#older')?.addEventListener('click',()=>renderPayments(page+1,payments));
}

async function renderRenew() {
  shell('<div style="padding:48px;text-align:center">Loading payment details…</div>'); const [plans, payment] = await Promise.all([api('/api/member/v1/plans'), api('/api/member/v1/payment-info')]);
  if (!plans.ok || !payment.ok) return renderHome(); const list = plans.data.plans || [], p = payment.data;
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>Renew membership</h1><p style="color:#64748b">Choose a plan, pay using your gym's QR, then submit the payment reference.</p><div id="plans">${list.map((plan) => `<button class="plan" data-id="${plan.id}" data-name="${esc(plan.name)}" data-price="${plan.price}" style="width:100%;text-align:left;margin:10px 0;padding:16px;border:1px solid #cbd5e1;border-radius:14px;background:white"><strong>${esc(plan.name)}</strong><span style="float:right;color:#2563eb;font-weight:700">${money(plan.price)}</span><br><small>${plan.duration_days} days</small></button>`).join('') || notice('No renewal plans are available.', true)}</div><div id="pay" style="display:none;background:white;border-radius:16px;padding:18px;margin-top:16px"><h2 id="plan-name"></h2>${p.qr_public_url ? `<img src="${esc(p.qr_public_url)}" alt="Payment QR" style="width:220px;height:220px;display:block;margin:12px auto;object-fit:contain">` : `<div style="text-align:center;padding:18px;background:#fef3c7;border-radius:12px;margin:12px 0;color:#92400e"><strong>No payment QR available</strong><br>Ask your gym to upload their payment QR code.</div>`}<p><strong>UPI:</strong> ${esc(p.upi_id || 'Contact your gym')}</p><p>${esc(p.instructions || '')}</p><input id="reference" placeholder="UPI transaction reference (optional)" style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:10px"><button id="claim" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:white;font-weight:700">I've made the payment</button></div></section>`);
  document.querySelector('#app main')?.insertAdjacentHTML('beforeend',memberNav('membership')); bindMemberNav();
  document.querySelector('#back').onclick = renderHome; let selected;
  document.querySelectorAll('.plan').forEach((button) => button.onclick = () => { selected = button.dataset.id; document.querySelector('#plan-name').textContent = `${button.dataset.name} — ${money(button.dataset.price)}`; document.querySelector('#pay').style.display = 'block'; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
  document.querySelector('#claim').onclick = async () => { if (!selected) return; const result = await api('/api/member/v1/renew/claim', { method: 'POST', body: { plan_id: Number(selected), reference: document.querySelector('#reference').value.trim() || undefined } }); if (result.ok) { alert('Payment claim submitted. Your gym will verify it shortly.'); renderHome(); } else alert(result.error); };
}

export function bootVynla() { loadSession() ? renderHome() : renderLogin(); }
