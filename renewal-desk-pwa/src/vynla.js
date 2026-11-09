/* Dedicated VYNLA member PWA.  It deliberately keeps member credentials
   separate from Renewal Desk owner credentials. */

import { attachLiveRefresh } from './live-refresh.js';
import { dedupeByKey } from './utils.js';

// V5-L21: dedupe keys for the member attendance/payment lists — a new row
// landing between page fetches shifts rows and the boundary row renders
// twice, on append and in the background flatMap.
const vynlaEventKey = (e) => e.id ?? `${e.timestamp || ''}|${e.event_type || ''}`;
const vynlaPaymentKey = (p) => p.id ?? `${p.paid_on || p.created_at || ''}|${p.amount || ''}|${p.reference || ''}`;

let activePage = null, pageVersion = 0;
let attendancePage = 1, paymentsPage = 1;
const beginPage = name => { activePage = name; return ++pageVersion; };

const SESSION_KEY = 'vynla.member-session.v1';
const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://gym-production-910c.up.railway.app' : window.location.origin;
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
// Gym display prefs, filled from the member dashboard payload when known;
// INR / Asia-Kolkata / en-IN are only the fallback, never a hardcoded assumption.
let gymCurrency = 'INR';
let gymTimezone = 'Asia/Kolkata';
let gymLocale = 'en-IN';
const localeByCountry = { AE: 'en-AE', AU: 'en-AU', GB: 'en-GB', IN: 'en-IN', US: 'en-US' };
function applyGymPrefs(gym) {
  if (!gym) return;
  if (gym.currency) gymCurrency = String(gym.currency).toUpperCase();
  // V9-L12: an invalid stored gym timezone (e.g. 'india') must fall back
  // to Asia/Kolkata explicitly — never leave an invalid zone in place for
  // the pageDate/pageDateTime catch blocks to silently render device-local.
  if (gym.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: gym.timezone });
      gymTimezone = gym.timezone;
    } catch {
      gymTimezone = 'Asia/Kolkata';
    }
  }
  // V3-L28: locale comes from gym settings (explicit locale, else country),
  // never hardcoded — a US gym's members should see US date/number formats.
  if (gym.locale) gymLocale = String(gym.locale);
  else if (gym.country) gymLocale = localeByCountry[String(gym.country).toUpperCase()] || gymLocale;
}
const money = (value) => {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(gymLocale, { style: 'currency', currency: gymCurrency }).format(amount);
  } catch {
    return `${gymCurrency} ${amount.toLocaleString(gymLocale)}`;
  }
};
let session;

function loadSession() {
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
  return session?.token ? session : null;
}
function saveSession(data) { session = data; localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
function clearSession() { session = null; localStorage.removeItem(SESSION_KEY); }

// V11-M8: revoke the server session on sign-out, then clear locally.
// POST /api/member/v1/auth/logout revokes the caller's refresh token
// (same shape as the owner logout: refresh token in the body). The call
// is best-effort — the endpoint did not exist yet when this was wired,
// so a failure still signs the member out locally.
async function signOutMember() {
  try { await api('/api/member/v1/auth/logout', { method: 'POST', body: { refresh_token: session?.refreshToken } }); } catch { /* local clear is the fallback */ }
  clearSession();
  renderLogin();
}

let memberRefreshInFlight;
async function refreshMemberSession() {
  if (memberRefreshInFlight) return memberRefreshInFlight;
  if (!session?.refreshToken) {
    clearSession();
    return null;
  }
  memberRefreshInFlight = (async () => {
    try {
      const response = await fetch(`${API}/api/member/v1/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
      if (response.status === 401 || response.status === 403) {
        clearSession();
        return null;
      }
      if (!response.ok) return undefined;
      const body = await response.json();
      if (!body?.success || !body.data?.access_token || !body.data?.refresh_token) return undefined;
      const renewed = { ...session, token: body.data.access_token, refreshToken: body.data.refresh_token };
      saveSession(renewed);
      return renewed;
    } catch {
      return undefined;
    }
  })();
  try { return await memberRefreshInFlight; }
  finally { memberRefreshInFlight = undefined; }
}

async function api(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  // V9-L10: every mutation carries a fresh Idempotency-Key, generated once
  // per api() call so the 401-refresh retry below re-sends the SAME key —
  // the same pattern as the owner client in api.js (V8-L32 fixed Android
  // only; the VYNLA member client never got it). GETs never carry a key.
  const isMutation = String(options.method || 'GET').toUpperCase() !== 'GET';
  const idempotencyKey = isMutation
    ? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `vynla-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    : undefined;
  const makeRequest = async (token) => {
    const headers = { Accept: 'application/json', ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...(!options.public && token ? { Authorization: `Bearer ${token}` } : {}) };
    return fetch(`${API}${path}`, { method: options.method || 'GET', headers, body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined });
  };
  try {
    let response = await makeRequest(session?.token);
    if (response.status === 401 && !options.public) {
      const renewed = await refreshMemberSession();
      if (renewed) response = await makeRequest(renewed.token);
      else if (renewed === null) return { ok: false, status: 401, error: 'Your member session expired. Please sign in again.' };
      else return { ok: false, error: 'Could not refresh your session. Check your connection and retry.' };
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && !options.public) clearSession();
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

// Parse a date value in gym-local calendar space. A bare YYYY-MM-DD date
// must not be read as device-local midnight (V3-L28) — that shifts the day
// for any device whose tz differs from the gym's. Noon UTC is unambiguous
// for every real-world timezone.
const parsePageDate = (value) => {
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T12:00:00.000Z`);
  return new Date(value);
};
const pageDate = (value) => {
  if (!value) return '—';
  const parsed = parsePageDate(value);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  try {
    return new Intl.DateTimeFormat(gymLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: gymTimezone }).format(parsed);
  } catch {
    return parsed.toLocaleDateString(gymLocale, { day: 'numeric', month: 'short', year: 'numeric' });
  }
};
const pageDateTime = (value) => {
  if (!value) return '—';
  const parsed = parsePageDate(value);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  try {
    return new Intl.DateTimeFormat(gymLocale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: gymTimezone }).format(parsed);
  } catch {
    return parsed.toLocaleString(gymLocale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
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

// V11-M11: one-time paused-after-renew notice, set by renderRenew's claim
// handler and consumed once by the next renderHome.
let homeNotice = null;

function renderLogin(message = '') {
  beginPage('login');
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
    // V11-H6: the backend deliberately returns success:true with
    // challenge:null for unknown/staff/multi-gym numbers (V9-L2
    // anti-enumeration). Never enter the OTP step without a challenge —
    // no code is coming and every verify would 400.
    const challenge = data.challenge || data.challenge_token;
    if (!challenge) return renderLogin('No member account found for this number — ask your gym.');
    renderOtp(phone, challenge, {
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
    // V11-H6: a resend that comes back with no challenge means no code
    // is coming — say so instead of repeating the "code sent" banner.
    if (!data.challenge && !data.challenge_token) {
      bannerContainer.innerHTML = notice('No member account found for this number — ask your gym.', 'error');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
      return;
    }
    currentChallenge = data.challenge || data.challenge_token;
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
    saveSession({ token: result.data.token, refreshToken: result.data.refresh_token, member: result.data.member });
    renderHome();
  });
}

async function renderHome(background = false) {
  background = background === true;
  const version = beginPage('home');
  if (!background) shell('<div style="padding:48px;text-align:center">Loading your membership…</div>');
  const result = await api('/api/member/v1/dashboard');
  if (version !== pageVersion) return;
  if (background && !result.ok && result.status !== 401) return;
  if (!result.ok) {
    if (result.status === 401) { clearSession(); return renderLogin(result.error); }
    return memberLoadError('home',result.error,renderHome);
  }
  const d = result.data, member = d.member || {}, gym = d.gym || {}, branding = d.branding || {};
  applyGymPrefs(gym);
  // V11-M11: one-time notice set by renderRenew when a claim succeeded
  // while the member was paused — consumed here, then cleared.
  const pausedRenew = homeNotice;
  homeNotice = null;
  const waDigits = (pausedRenew?.gymPhone || '').replace(/\D/g, '');
  const waNumber = waDigits.length === 10 ? `91${waDigits}` : waDigits;
  const pausedNoticeHtml = pausedRenew ? `<div style="margin:14px 0;padding:14px;border-radius:12px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:14px;line-height:1.55"><strong>Door access is still paused.</strong> Your renewal${pausedRenew.amount ? ` of ${money(pausedRenew.amount)}` : ''} is recorded, but door access stays paused until the gym resumes it.${pausedRenew.gymPhone ? ` <a href="tel:${esc(pausedRenew.gymPhone)}" style="color:#1d4ed8;font-weight:700">Call the gym to resume</a>${waNumber ? ` · <a href="https://wa.me/${waNumber}?text=${encodeURIComponent('Hi, I just renewed my membership but my door access is still paused. Could you please resume it?')}" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8;font-weight:700">WhatsApp the gym</a>` : ''}` : ' Ask your gym to resume access.'}</div>` : '';
  const access = await api('/api/member/v1/access?per_page=1');
  if (version !== pageVersion) return;
  // V11-L47: an expired (7-day) or revoked signed photo URL renders a
  // broken avatar without an error fallback — fall back to initials.
  const initialsHtml = `<div aria-hidden="true" style="width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:#ffffff30;font-size:28px;font-weight:800">${esc((member.full_name||'M').slice(0,1).toUpperCase())}</div>`;
  const photo = member.profile_photo_url ? `<img id="home-photo" src="${esc(member.profile_photo_url)}" alt="${esc(member.full_name||'Member')} profile" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #ffffff99">` : initialsHtml;
  const days = member.days_left;
  const banners = (branding.announcements||[]).slice(0,3).map((item)=>`<article style="padding:14px 16px;background:#eff6ff;border-radius:14px;margin-top:10px"><strong>${esc(item.title||'Gym update')}</strong><p style="margin:6px 0 0;color:#475569;line-height:1.45">${esc(item.message||'')}</p></article>`).join('');
  const offers = (branding.offers||[]).slice(0,3).map((item)=>`<article style="padding:14px 16px;background:#f0fdf4;border-radius:14px;margin-top:10px"><strong>${esc(item.title||'Gym offer')}</strong><p style="margin:6px 0 0;color:#475569;line-height:1.45">${esc(item.description||'')}</p></article>`).join('');
  memberPage('home', `<header style="padding:28px 22px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-radius:0 0 26px 26px"><div style="display:flex;align-items:center;gap:14px">${photo}<div><div style="font-size:13px;opacity:.85">${esc(gym.name || branding.gym_name || 'Your Gym')}</div><h1 style="font-size:24px;margin:5px 0">Hi, ${esc((member.full_name || session.member?.full_name || 'Member').split(' ')[0])}</h1></div></div><div style="display:flex;align-items:end;gap:10px;margin-top:22px"><strong style="font-size:44px;line-height:1">${days == null ? '—' : Math.max(days,0)}</strong><span style="padding-bottom:4px;opacity:.9">${member.is_expired?'membership expired':'days remaining'}</span></div><div style="margin-top:12px;display:inline-block;padding:6px 10px;background:#ffffff22;border-radius:999px;font-size:12px;font-weight:700">${esc(String(member.status||'active').toUpperCase())}</div></header><section style="padding:18px"><article style="background:#fff;border-radius:18px;padding:18px;box-shadow:0 3px 14px #0f172a0c"><div style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:.08em">CURRENT MEMBERSHIP</div><h2 style="margin:7px 0">${esc(member.plan_name || 'Membership')}</h2><div>${pageDate(member.membership_start)} – ${pageDate(member.membership_end)}</div><div style="color:#64748b;margin-top:7px">${esc(member.plan_price ? money(member.plan_price) : '')}</div></article>${d.pending_payment ? notice(`Payment ${money(d.pending_payment.amount)} is waiting for gym confirmation.`, 'warning') : ''}${pausedNoticeHtml}<div style="display:flex;gap:10px;margin-top:14px"><div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px"><strong style="font-size:22px">${access.ok ? access.data.summary?.today_entries||0 : '—'}</strong><div style="color:#64748b;font-size:12px;margin-top:3px">Visits today</div></div><div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px"><strong style="font-size:16px">${pageDate(access.ok ? access.data.summary?.last_visit : null)}</strong><div style="color:#64748b;font-size:12px;margin-top:3px">Last visit</div></div></div><button id="renew" style="width:100%;margin-top:14px;padding:15px;border:0;border-radius:12px;background:#2563eb;color:white;font-weight:700;font-size:16px">Renew membership</button>${gym.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gym.name||''} ${gym.address}`)}" style="display:block;margin-top:12px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;color:#1d4ed8;text-decoration:none">📍 ${esc(gym.address)} · Get directions</a>` : ''}${banners ? `<h2 style="font-size:18px;margin:24px 0 8px">Gym updates</h2>${banners}` : ''}${offers ? `<h2 style="font-size:18px;margin:24px 0 8px">Member offers</h2>${offers}` : ''}<button id="signout" style="margin:22px 0 4px;padding:10px 0;border:0;background:none;color:#64748b">Sign out</button></section>`);
  // V11-L47: replace a failed photo with initials.
  document.querySelector('#home-photo')?.addEventListener('error', (event) => { event.currentTarget.outerHTML = initialsHtml; });
  document.querySelector('#renew').onclick = () => renderRenew();
  document.querySelector('#signout').onclick = signOutMember;
}

async function renderProfile() {
  const version = beginPage('profile');
  shell('<div style="padding:48px;text-align:center">Loading profile…</div>'); const result = await api('/api/member/v1/profile');
  if (version !== pageVersion) return;
  if (!result.ok) { if(result.status===401){clearSession();return renderLogin(result.error);} return memberLoadError('profile',result.error,renderProfile); } const d = result.data, m = d.member || {}, gym = d.gym || {};
  applyGymPrefs(gym);
  // V11-L47: fall back to initials if the signed photo URL expired.
  const profileInitials = `<div style="width:104px;height:104px;border-radius:50%;display:grid;place-items:center;background:#dbeafe;color:#1d4ed8;font-size:38px;font-weight:800">${esc((m.full_name||'M').slice(0,1).toUpperCase())}</div>`;
  const avatar = m.profile_photo_url ? `<img id="profile-photo-img" src="${esc(m.profile_photo_url)}" alt="Profile photo" style="width:104px;height:104px;border-radius:50%;object-fit:cover">` : profileInitials;
  memberPage('profile', `<section style="padding:22px"><h1 style="font-size:26px;margin:6px 0 18px">My profile</h1><article style="background:#fff;border-radius:18px;padding:20px;text-align:center;box-shadow:0 3px 14px #0f172a0c"><div>${avatar}</div><h2 style="margin:12px 0 4px">${esc(m.full_name||'Member')}</h2><div style="color:#64748b">${esc(m.phone||'')}</div><label for="photo" style="display:inline-block;margin-top:14px;padding:10px 14px;background:#eff6ff;color:#1d4ed8;border-radius:10px;font-weight:700;cursor:pointer">${m.profile_photo_url?'Change photo':'Add profile photo'}</label><input id="photo" type="file" accept="image/jpeg,image/png,image/webp" style="display:none">${m.profile_photo_url?'<button id="remove-photo" style="display:block;margin:10px auto 0;border:0;background:none;color:#b91c1c">Remove photo</button>':''}<p style="font-size:12px;color:#64748b;margin:12px 0 0">JPEG, PNG, or WebP · up to 3 MB</p></article><form id="profile-form" style="background:#fff;border-radius:18px;padding:18px;margin-top:14px"><h2 style="font-size:17px;margin:0 0 14px">Contact details</h2><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Email</label><input name="email" type="email" maxlength="255" value="${esc(m.email||'')}" placeholder="you@example.com" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px"><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Address</label><textarea name="address" maxlength="2000" rows="3" placeholder="Your address" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px">${esc(m.address||'')}</textarea><label style="display:block;font-size:13px;font-weight:700;margin:12px 0 6px">Gender (optional)</label><select name="gender" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:white;font-size:16px"><option value="" ${!m.gender?'selected':''}>Prefer not to say</option>${['female','male','other'].map((value)=>`<option value="${value}" ${String(m.gender||'').toLowerCase()===value?'selected':''}>${value[0].toUpperCase()+value.slice(1)}</option>`).join('')}</select><button id="save-profile" style="width:100%;margin-top:16px;padding:14px;border:0;border-radius:11px;background:#2563eb;color:#fff;font-weight:700">Save details</button><p style="font-size:12px;color:#64748b;line-height:1.45">Your name and phone are managed by your gym so your membership and access records stay matched.</p></form><article style="background:#fff;border-radius:18px;padding:18px;margin-top:14px"><h2 style="font-size:17px;margin:0 0 8px">${esc(gym.name||'Your gym')}</h2><div style="color:#64748b">${esc(gym.phone||'Phone not provided')}</div><div style="color:#64748b;margin-top:6px">${esc(gym.address||'Address not provided')}</div>${gym.phone?`<a href="tel:${esc(gym.phone)}" style="display:inline-block;margin-top:12px;color:#1d4ed8">Call the gym</a>`:''}</article><button id="signout" style="margin-top:16px;padding:12px;border:0;background:none;color:#64748b">Sign out</button></section>`);
  // V11-L47: replace a failed photo with initials.
  document.querySelector('#profile-photo-img')?.addEventListener('error', (event) => { event.currentTarget.outerHTML = profileInitials; });
  const photoInput = document.querySelector('#photo');
  const photoLabel = document.querySelector('label[for="photo"]');
  photoInput.addEventListener('change', async (event)=>{
    const file = event.target.files?.[0]; if (!file) return;
    // V11-L40: no in-flight guard meant a second pick mid-upload fired a
    // second POST (two files, last-writer-wins, first orphaned).
    if (photoInput.disabled) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 3*1024*1024) { alert('Choose a JPEG, PNG, or WebP photo up to 3 MB.'); return; }
    const form = new FormData(); form.append('photo',file);
    photoInput.disabled = true;
    if (photoLabel) { photoLabel.style.opacity = '0.5'; photoLabel.style.pointerEvents = 'none'; }
    try {
      const uploaded = await api('/api/member/v1/profile/photo',{method:'POST',body:form});
      if (!uploaded.ok) { alert(uploaded.error); return; }
      await renderProfile();
    } finally {
      // On success renderProfile() replaced this DOM; on failure the
      // re-enable below restores the picker.
      photoInput.disabled = false;
      if (photoLabel) { photoLabel.style.opacity = ''; photoLabel.style.pointerEvents = ''; }
    }
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
  document.querySelector('#signout').onclick=signOutMember;
}

async function renderMembership(background = false) {
  background = background === true;
  const version = beginPage('membership');
  if (!background) shell('<div style="padding:48px;text-align:center">Loading membership…</div>');
  const result=await api('/api/member/v1/membership');
  if (version !== pageVersion || (background && !result.ok && result.status !== 401)) return;
  if(!result.ok){if(result.status===401){clearSession();return renderLogin(result.error);} return memberLoadError('membership',result.error,renderMembership);}
  const d=result.data||{},m=d.membership||{},history=d.renewal_history||[];
  applyGymPrefs(d.gym);
  // V11-H8: mirror the RN demand callout — the gym's discounted renewal
  // offer, with its locked price, on the membership page too.
  const demandBanner = d.active_renewal_demand ? `<article style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:18px;padding:18px;margin-top:14px"><div style="font-size:12px;color:#b45309;font-weight:700">SPECIAL RENEWAL OFFER</div><h2 style="margin:7px 0">${esc(d.active_renewal_demand.plan_name)}</h2><div><span style="text-decoration:line-through;color:#64748b">${money(d.active_renewal_demand.standard_price)}</span> <strong style="font-size:22px">${money(d.active_renewal_demand.final_payable || d.active_renewal_demand.amount)}</strong>${d.active_renewal_demand.savings && Number(d.active_renewal_demand.savings) > 0 ? ` <span style="color:#15803d;font-weight:700">Save ${money(d.active_renewal_demand.savings)}</span>` : ''}</div><button id="renew-demand" style="width:100%;margin-top:14px;padding:14px;border:0;border-radius:11px;background:#2563eb;color:white;font-weight:700">Renew at this price</button></article>` : '';
  memberPage('membership',`<section style="padding:22px"><h1 style="font-size:26px">Membership</h1><article style="background:#fff;border-radius:18px;padding:20px;margin-top:14px"><div style="font-size:12px;color:#64748b;font-weight:700">CURRENT PLAN</div><h2>${esc(m.plan_name||'Membership')}</h2><div>${esc(String(m.status||'').toUpperCase())} · ${esc(m.days_left==null?'—':`${Math.max(m.days_left,0)} days left`)}</div><div style="color:#64748b;margin-top:12px">Started ${pageDate(m.membership_start)}<br>Valid through ${pageDate(m.membership_end)}</div><div style="font-weight:700;margin-top:12px">${m.plan_price?money(m.plan_price):''} ${m.plan_duration_days?`· ${m.plan_duration_days} days`:''}</div><button id="renew" style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:11px;background:#2563eb;color:white;font-weight:700">Renew membership</button></article>${demandBanner}<h2 style="font-size:18px;margin:24px 0 10px">Renewal history</h2>${history.length?history.map((item)=>`<article style="background:#fff;border-radius:14px;padding:15px;margin-top:9px"><strong>${esc(item.plan_name||'Renewal')}</strong><div style="color:#64748b;margin-top:6px">${pageDate(item.new_start)} – ${pageDate(item.new_end)}</div><div style="margin-top:6px">${money(item.amount)}</div></article>`).join(''):'<p style="color:#64748b">Your confirmed renewals will appear here.</p>'}</section>`);
  document.querySelector('#renew').onclick=renderRenew;
  document.querySelector('#renew-demand')?.addEventListener('click', renderRenew);
}

async function renderAttendance(page=1,prior=[],background=false) {
  // V4-L18: re-rendering the whole page used to jump the member back to
  // the top on "Load older visits" — remember the scroll position and
  // restore it after the re-render (page 1 loads start at the top).
  const savedScrollY = page > 1 ? window.scrollY : null;
  const version = beginPage('attendance');
  if(page===1 && !background)shell('<div style="padding:48px;text-align:center">Loading attendance…</div>');
  const results = background
    ? await Promise.all(Array.from({ length: page }, (_, index) => api(`/api/member/v1/access?page=${index + 1}&per_page=20`)))
    : [await api(`/api/member/v1/access?page=${page}&per_page=20`)];
  if (version !== pageVersion) return;
  const result = results.find(item => !item.ok) || results[results.length - 1];
  if (background && !result.ok) {
    if (result.status === 401) { clearSession(); renderLogin(result.error); }
    return;
  }
  if (background) {
    prior = dedupeByKey(results.slice(0, -1).flatMap(item => item.data.events || []), vynlaEventKey);
  }
  attendancePage = page;
  if(!result.ok){if(page===1){if(result.status===401){clearSession();renderLogin(result.error);}else memberLoadError('attendance',result.error,()=>renderAttendance(page,prior));}else {
    // V5-L20: the button was disabled before the fetch and the failure
    // returned without re-enabling it, so "Load older visits" died
    // permanently after one failed fetch. Re-enable it for a retry.
    const olderBtn = document.querySelector('#older');
    if (olderBtn) olderBtn.disabled = false;
    alert(result.error);
  }return;}
  const data=result.data||{},summary=data.summary||{},events=dedupeByKey([...prior,...(data.events||[])], vynlaEventKey);
  const rows=events.map((event)=>{const type=String(event.event_type||'').toUpperCase();const label=type==='ENTRY'?'Gym entry':type==='EXIT'?'Gym exit':type.includes('DENIED')?'Access denied':'Attendance recorded';const color=type==='ENTRY'?'#059669':type.includes('DENIED')?'#dc2626':'#475569';return `<article style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:14px;margin-top:9px"><div style="width:10px;height:10px;border-radius:50%;background:${color}"></div><div style="flex:1"><strong>${label}</strong><div style="margin-top:4px;color:#64748b;font-size:13px">${pageDateTime(event.timestamp)}${event.device_name?` · ${esc(event.device_name)}`:''}</div></div></article>`;}).join('');
  memberPage('attendance',`<section style="padding:22px"><h1 style="font-size:26px">Attendance</h1><p style="margin:5px 0 16px;color:#64748b">Your visits recorded by your gym’s access system.</p><article style="display:flex;background:#fff;border-radius:16px;padding:15px;text-align:center"><div style="flex:1"><strong style="font-size:24px">${summary.today_entries||0}</strong><div style="color:#64748b;font-size:12px">Entries today</div></div><div style="flex:1"><strong style="font-size:24px">${summary.today_exits||0}</strong><div style="color:#64748b;font-size:12px">Exits today</div></div><div style="flex:1"><strong style="font-size:14px">${summary.is_inside?'Inside':'Outside'}</strong><div style="color:#64748b;font-size:12px">Current state</div></div></article><div style="margin-top:14px">${rows||'<article style="background:#fff;border-radius:16px;padding:22px;text-align:center;color:#64748b">No visits have been recorded yet.</article>'}</div>${page<data.pagination?.total_pages?`<button id="older" style="width:100%;margin-top:14px;padding:13px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font-weight:700">Load older visits</button>`:''}<p style="font-size:12px;color:#94a3b8;margin-top:14px">Last visit: ${pageDateTime(summary.last_visit)}</p></section>`);
  if (savedScrollY != null) window.scrollTo(0, savedScrollY);
  const olderBtn = document.querySelector('#older');
  olderBtn?.addEventListener('click',()=>{ if (olderBtn.disabled) return; olderBtn.disabled=true; renderAttendance(page+1,events); });
}

async function renderPayments(page=1,prior=[],background=false) {
  // V4-L18: same scroll-jump fix as renderAttendance — "Load older
  // payments" re-renders the whole page.
  const savedScrollY = page > 1 ? window.scrollY : null;
  const version = beginPage('payments');
  if(page===1 && !background)shell('<div style="padding:48px;text-align:center">Loading payments…</div>');
  const results = background
    ? await Promise.all(Array.from({ length: page }, (_, index) => api(`/api/member/v1/payments?page=${index + 1}&per_page=20`)))
    : [await api(`/api/member/v1/payments?page=${page}&per_page=20`)];
  if (version !== pageVersion) return;
  const result = results.find(item => !item.ok) || results[results.length - 1];
  if (background && !result.ok) {
    if (result.status === 401) { clearSession(); renderLogin(result.error); }
    return;
  }
  if (background) {
    prior = dedupeByKey(results.slice(0, -1).flatMap(item => item.data.payments || []), vynlaPaymentKey);
  }
  paymentsPage = page;
  if(!result.ok){if(page===1){if(result.status===401){clearSession();renderLogin(result.error);}else memberLoadError('payments',result.error,()=>renderPayments(page,prior));}else {
    // V5-L20: same dead-button fix as renderAttendance — re-enable "Load
    // older payments" so a failed fetch is retryable instead of terminal.
    const olderBtn = document.querySelector('#older');
    if (olderBtn) olderBtn.disabled = false;
    alert(result.error);
  }return;}
  const data=result.data||{},payments=dedupeByKey([...prior,...(data.payments||[])], vynlaPaymentKey);
  memberPage('payments',`<section style="padding:22px"><h1 style="font-size:26px">Payments</h1><p style="color:#64748b">Payment claims and confirmations from your gym.</p>${payments.length?payments.map((p)=>`<article style="background:#fff;border-radius:15px;padding:16px;margin-top:10px"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${money(p.amount)}</strong><span style="font-size:12px;font-weight:700;color:${String(p.status).toLowerCase()==='verified'?'#059669':String(p.status).toLowerCase()==='pending'?'#b45309':'#475569'}">${esc(String(p.status||'unknown').replaceAll('_',' ').toUpperCase())}</span></div><div style="color:#64748b;font-size:13px;margin-top:7px">${esc(p.method||p.channel||'Payment')} · ${pageDate(p.paid_on||p.created_at)}</div>${p.reference?`<div style="color:#64748b;font-size:12px;margin-top:4px">Reference: ${esc(p.reference)}</div>`:''}${p.notes?`<div style="color:#64748b;font-size:12px;margin-top:4px">${esc(p.notes)}</div>`:''}</article>`).join(''):'<article style="background:#fff;border-radius:16px;padding:22px;text-align:center;color:#64748b">No payment records yet.</article>'}${page<data.pagination?.total_pages?'<button id="older" style="width:100%;margin-top:14px;padding:13px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font-weight:700">Load older payments</button>':''}</section>`);
  if (savedScrollY != null) window.scrollTo(0, savedScrollY);
  const olderBtn = document.querySelector('#older');
  olderBtn?.addEventListener('click',()=>{ if (olderBtn.disabled) return; olderBtn.disabled=true; renderPayments(page+1,payments); });
}

async function renderRenew() {
  const version = beginPage('renew');
  shell('<div style="padding:48px;text-align:center">Loading payment details…</div>'); const [plans, payment, dash] = await Promise.all([api('/api/member/v1/plans'), api('/api/member/v1/payment-info'), api('/api/member/v1/dashboard')]);
  if (version !== pageVersion) return;
  // V6-L31: a failed plans/payment-info fetch used to silently bounce the
  // member home with no error and no retry. Render an error state with
  // retry, the same memberLoadError pattern as attendance/payments.
  if (!plans.ok || !payment.ok) {
    const err = !plans.ok ? plans.error : payment.error;
    return memberLoadError('membership', err || 'Could not load payment details.', renderRenew);
  }
  const list = plans.data.plans || [], p = payment.data;
  // V11-H8: the staff-created discounted renewal demand is the gym's own
  // offer — surface it with its locked price (mirror of the RN demand
  // card). The dashboard fetch is best-effort: a failed dashboard must
  // not block renewing at plan price.
  const demand = dash.ok ? dash.data.active_renewal_demand : null;
  const demandGymPhone = dash.ok ? (dash.data.gym?.phone || null) : null;
  if (dash.ok && dash.data.gym) applyGymPrefs(dash.data.gym);
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>Renew membership</h1>${demand ? `<article style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:16px;padding:18px;margin-top:14px"><div style="font-size:12px;color:#b45309;font-weight:700">SPECIAL RENEWAL OFFER FROM YOUR GYM</div><h2 style="margin:8px 0 4px">${esc(demand.plan_name)}</h2><div><span style="text-decoration:line-through;color:#64748b">${money(demand.standard_price)}</span> <strong style="font-size:26px">${money(demand.final_payable || demand.amount)}</strong>${demand.savings && Number(demand.savings) > 0 ? ` <span style="color:#15803d;font-weight:700">Save ${money(demand.savings)}</span>` : ''}</div><p style="color:#64748b;margin:10px 0 0">This price is set by your gym and locked for this renewal — the full-price plans below do not apply.</p></article>` : `<p style="color:#64748b">Choose a plan, pay using your gym's QR, then submit the payment reference.</p>`}<div id="plans">${demand ? '' : list.map((plan) => `<button class="plan" data-id="${plan.id}" data-name="${esc(plan.name)}" data-price="${plan.price}" style="width:100%;text-align:left;margin:10px 0;padding:16px;border:1px solid #cbd5e1;border-radius:14px;background:white"><strong>${esc(plan.name)}</strong><span style="float:right;color:#2563eb;font-weight:700">${money(plan.price)}</span><br><small>${plan.duration_days} days</small></button>`).join('') || notice('No renewal plans are available.', true)}</div><div id="pay" style="display:none;background:white;border-radius:16px;padding:18px;margin-top:16px"><h2 id="plan-name"></h2>${p.qr_public_url ? `<img src="${esc(p.qr_public_url)}" alt="Payment QR" style="width:220px;height:220px;display:block;margin:12px auto;object-fit:contain">` : `<div style="text-align:center;padding:18px;background:#fef3c7;border-radius:12px;margin:12px 0;color:#92400e"><strong>No payment QR available</strong><br>Ask your gym to upload their payment QR code.</div>`}<p><strong>UPI:</strong> ${esc(p.upi_id || 'Contact your gym')}</p><p>${esc(p.instructions || '')}</p><input id="reference" placeholder="UPI transaction reference (optional)" style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:10px"><button id="claim" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:white;font-weight:700">I've made the payment</button></div></section>`);
  document.querySelector('#app main')?.insertAdjacentHTML('beforeend',memberNav('membership')); bindMemberNav();
  document.querySelector('#back').onclick = renderHome; let selected;
  document.querySelectorAll('.plan').forEach((button) => button.onclick = () => { selected = button.dataset.id; document.querySelector('#plan-name').textContent = `${button.dataset.name} — ${money(button.dataset.price)}`; document.querySelector('#pay').style.display = 'block'; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
  // V11-H8: with a demand the price is locked — preselect it and show
  // the payment section immediately (no plan list is rendered).
  if (demand) {
    selected = demand.plan_id ? String(demand.plan_id) : undefined;
    document.querySelector('#plan-name').textContent = `${demand.plan_name} — ${money(demand.final_payable || demand.amount)}`;
    document.querySelector('#pay').style.display = 'block';
  }
  document.querySelector('#claim').onclick = async () => {
    if (!selected && !demand) return;
    const btn = document.querySelector('#claim');
    if (btn.disabled) return;
    btn.disabled = true;
    // V11-H8: the amount being paid is the demand's locked price when a
    // demand exists, else the selected plan's price.
    const payableAmount = demand ? (demand.final_payable || demand.amount) : document.querySelector(`.plan[data-id="${selected}"]`)?.dataset.price;
    const result = await api('/api/member/v1/renew/claim', { method: 'POST', body: { plan_id: selected ? Number(selected) : undefined, reference: document.querySelector('#reference').value.trim() || undefined } });
    if (result.ok) {
      // V11-H8: already_pending IS the demand — the member already has a
      // live request, so never report a fresh submission. (The backend's
      // already_pending payload carries no amount; use the locked price
      // the member was paying.)
      const claimData = result.data || {};
      // V11-M11: a paused member's renewal is recorded but the door
      // stays blocked until the gym resumes it — say so on success and
      // carry the resume actions onto the home screen.
      const after = await api('/api/member/v1/dashboard');
      const isPaused = after.ok && String(after.data.member?.status || '').toLowerCase() === 'paused';
      if (isPaused) homeNotice = { amount: claimData.amount || payableAmount, gymPhone: (after.ok && after.data.gym?.phone) || demandGymPhone };
      if (claimData.already_pending) {
        alert(`You already have a pending payment request${payableAmount ? ` for ${money(payableAmount)}` : ''} — the gym will confirm it.${isPaused ? ' Your renewal is recorded, but door access stays paused until the gym resumes it.' : ''}`);
      } else {
        alert(`Payment claim submitted. Your gym will verify it shortly.${isPaused ? ' Note: your membership is paused, so door access stays paused until the gym resumes it — even after this payment is verified.' : ''}`);
      }
      renderHome();
    }
    else { alert(result.error); btn.disabled = false; }
  };
}

export function bootVynla() {
  loadSession() ? renderHome() : renderLogin();
  attachLiveRefresh(document.getElementById('app'), async () => {
    if (!session?.token) return;
    if (activePage === 'home') await renderHome(true);
    else if (activePage === 'membership') await renderMembership(true);
    else if (activePage === 'attendance') await renderAttendance(attendancePage, [], true);
    else if (activePage === 'payments') await renderPayments(paymentsPage, [], true);
    // Profile and renewal are editable forms; leave their drafts intact.
  }, 30000);
}
