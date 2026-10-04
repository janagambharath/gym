/* Dedicated VYNLA member PWA.  It deliberately keeps member credentials
   separate from Renewal Desk owner credentials. */

const SESSION_KEY = 'vynla.member-session.v1';
const API = window.location.hostname === 'localhost' ? 'https://gym-production-910c.up.railway.app' : window.location.origin;
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
function notice(message, error = false) { return `<div style="margin:12px 0;padding:12px;border-radius:10px;background:${error ? '#fee2e2' : '#dcfce7'};color:${error ? '#b91c1c' : '#166534'}">${esc(message)}</div>`; }

function renderLogin(message = '') {
  document.title = 'VYNLA — Member App';
  shell(`<section style="max-width:430px;margin:auto;padding:48px 24px"><div style="text-align:center;margin-bottom:34px"><img src="/icons/icon-192.png" alt="VYNLA" style="width:72px;height:72px;border-radius:20px"><h1 style="margin:14px 0 6px;color:#2563eb">VYNLA</h1><p style="color:#64748b">Your gym membership, in your pocket</p></div><div id="card" style="background:white;border-radius:20px;padding:24px;box-shadow:0 8px 30px #0f172a12"><h2 id="login-title">Member sign in</h2><p id="login-copy" style="color:#64748b">Enter your registered mobile number to receive a WhatsApp code.</p>${message ? notice(message, true) : ''}<form id="phone-form"><label style="display:block;font-weight:600;margin:18px 0 6px">Mobile number</label><input id="phone" inputmode="tel" autocomplete="tel" placeholder="9876543210" required style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px"><button style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:16px">Send WhatsApp code</button></form></div><p style="text-align:center;color:#64748b;font-size:13px;margin-top:22px">Ask your gym if your mobile number is not recognised.</p></section>`);
  document.querySelector('#phone-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phone = document.querySelector('#phone').value.trim();
    const result = await api('/api/member/v1/auth/request-otp', { method: 'POST', body: { phone }, public: true });
    if (!result.ok) return renderLogin(result.error);
    renderOtp(phone, result.data.challenge || result.data.challenge_token);
  });
}

function renderOtp(phone, challenge, message = '') {
  shell(`<section style="max-width:430px;margin:auto;padding:48px 24px"><button id="back" style="border:0;background:none;color:#2563eb;padding:0">← Change number</button><div style="background:white;border-radius:20px;padding:24px;margin-top:18px;box-shadow:0 8px 30px #0f172a12"><h2>Verify your number</h2><p style="color:#64748b">Enter the code sent to ${esc(phone)} on WhatsApp.</p>${message ? notice(message, true) : ''}<form id="otp-form"><label style="display:block;font-weight:600;margin:18px 0 6px">Verification code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required maxlength="6" style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #cbd5e1;border-radius:10px;font-size:20px;letter-spacing:6px"><button style="width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:16px">Open VYNLA</button></form></div></section>`);
  document.querySelector('#back').onclick = () => renderLogin();
  document.querySelector('#otp-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const otp = document.querySelector('#otp').value.trim();
    const result = await api('/api/member/v1/auth/verify-otp', { method: 'POST', body: { phone, otp, challenge }, public: true });
    if (!result.ok) return renderOtp(phone, challenge, result.error);
    saveSession({ token: result.data.token, member: result.data.member }); renderHome();
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
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>My Profile</h1><div style="background:white;border-radius:16px;padding:18px;margin:14px 0"><h2>${esc(m.full_name)}</h2><p>${esc(m.phone || '')}</p><p>${esc(m.email || '')}</p></div><div style="background:white;border-radius:16px;padding:18px"><h2>${esc(gym.name || 'Gym')}</h2><p>Phone: ${esc(gym.phone || '—')}</p><p>Address: ${esc(gym.address || '—')}</p></div></section>`); document.querySelector('#back').onclick = renderHome;
}

async function renderRenew() {
  shell('<div style="padding:48px;text-align:center">Loading payment details…</div>'); const [plans, payment] = await Promise.all([api('/api/member/v1/plans'), api('/api/member/v1/payment-info')]);
  if (!plans.ok || !payment.ok) return renderHome(); const list = plans.data.plans || [], p = payment.data;
  shell(`<section style="max-width:600px;margin:auto;padding:24px"><button id="back" style="border:0;background:none;color:#2563eb">← Home</button><h1>Renew membership</h1><p style="color:#64748b">Choose a plan, pay using your gym's QR, then submit the payment reference.</p><div id="plans">${list.map((plan) => `<button class="plan" data-id="${plan.id}" data-name="${esc(plan.name)}" data-price="${plan.price}" style="width:100%;text-align:left;margin:10px 0;padding:16px;border:1px solid #cbd5e1;border-radius:14px;background:white"><strong>${esc(plan.name)}</strong><span style="float:right;color:#2563eb;font-weight:700">${money(plan.price)}</span><br><small>${plan.duration_days} days</small></button>`).join('') || notice('No renewal plans are available.', true)}</div><div id="pay" style="display:none;background:white;border-radius:16px;padding:18px;margin-top:16px"><h2 id="plan-name"></h2>${p.qr_public_url ? `<img src="${esc(p.qr_public_url)}" alt="Payment QR" style="width:220px;height:220px;display:block;margin:12px auto;object-fit:contain">` : ''}<p><strong>UPI:</strong> ${esc(p.upi_id || 'Contact your gym')}</p><p>${esc(p.instructions || '')}</p><input id="reference" placeholder="UPI transaction reference (optional)" style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:10px"><button id="claim" style="width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:#2563eb;color:white;font-weight:700">I've made the payment</button></div></section>`);
  document.querySelector('#back').onclick = renderHome; let selected;
  document.querySelectorAll('.plan').forEach((button) => button.onclick = () => { selected = button.dataset.id; document.querySelector('#plan-name').textContent = `${button.dataset.name} — ${money(button.dataset.price)}`; document.querySelector('#pay').style.display = 'block'; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
  document.querySelector('#claim').onclick = async () => { if (!selected) return; const result = await api('/api/member/v1/renew/claim', { method: 'POST', body: { plan_id: Number(selected), reference: document.querySelector('#reference').value.trim() || undefined } }); if (result.ok) { alert('Payment claim submitted. Your gym will verify it shortly.'); renderHome(); } else alert(result.error); };
}

export function bootVynla() { loadSession() ? renderHome() : renderLogin(); }
