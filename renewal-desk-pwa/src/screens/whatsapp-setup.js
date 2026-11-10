/* WhatsApp Setup Screen — guided connection flow */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderErrorState, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
// V3-L29: the visibilitychange listener must be removed on unmount, or it
// keeps refetching (and holding `el`) after the screen is gone.
let onVisible = null;
// W-H8: true while a Meta setup tab opened from Start Setup is outstanding,
// so the return-from-tab check can explain a still-not-connected state.
let setupOpened = false;
// W-H8: true once a return-from-tab check found the gym still not
// connected — renderStatus re-attaches the explanation on every render
// until the gym connects or a new setup starts.
let returnNoticePending = false;
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Connect WhatsApp',showBack:true})}<div class="scroll-view" id="ws-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const scroll = el.querySelector('#ws-scroll');
  async function renderStatus() {
  const statusRes = await apiRequest('/api/mobile/v1/whatsapp/connection-status');
  if (!statusRes.ok) {
    // V9-M5: a status-load failure used to render "Connect WhatsApp" +
    // Start Setup as fact. A failed load is not "not connected" — show
    // the error with retry instead (same pattern as whatsapp.js V8-M13).
    scroll.innerHTML = `<div class="scroll-content"><div style="padding:var(--sp-lg)">${renderErrorState(statusRes.error?.message || 'Could not load the WhatsApp connection status.')}</div></div>`;
    scroll.querySelector('#retry-btn')?.addEventListener('click', renderStatus);
    return { ok: false, connected: false };
  }
  const st = statusRes.data || {};
  const connected = st.status === 'CONNECTED';
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:64px;height:64px;border-radius:var(--r-full);background:${connected?'var(--success-surface)':'var(--warning-surface)'};display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${icon('whatsapp',32, connected?'var(--success)':'var(--warning)')}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${connected?'WhatsApp Connected':'Connect WhatsApp'}</h3>
      <p style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:var(--sp-lg)">${escapeHtml(st.status_description||'Connect your WhatsApp Business number to send automated renewal reminders.')}</p>
      <button class="btn btn-secondary btn-full" id="ws-check" style="margin-bottom:var(--sp-md)">Check status</button>
      ${!connected?`<button class="btn btn-whatsapp btn-lg btn-full" id="ws-start">${icon('whatsapp',18,'white')} Start Setup</button>
      <div style="margin-top:var(--sp-lg);text-align:left">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">How it works</div>
        ${['Connect your WhatsApp Business number via Meta','We send renewal reminders automatically','Members reply and you see it in Inbox'].map((s,i)=>`<div style="display:flex;gap:var(--sp-md);margin-bottom:var(--sp-sm);font-size:var(--fs-sm)"><span style="font-weight:var(--fw-bold);color:var(--brand)">${i+1}.</span><span>${s}</span></div>`).join('')}
      </div>`:`
      <div style="font-size:var(--fs-sm);color:var(--text-secondary)">Phone: ${escapeHtml(st.business_phone_number||'—')}</div>
      <p style="font-size:var(--fs-sm);color:var(--success);margin-top:var(--sp-sm)">${escapeHtml(st.next_action||'')}</p>`}
    </div></div>
  </div>`;
  el.querySelector('#ws-start')?.addEventListener('click', async () => {
    const btn = el.querySelector('#ws-start'); btn.disabled = true; btn.textContent = 'Preparing…';
    const cfg = await apiRequest('/api/mobile/v1/whatsapp/onboarding-config');
    if (!cfg.ok) { showToast(cfg.error?.message||'Setup is not available right now','error'); btn.disabled = false; btn.innerHTML = `${icon('whatsapp',18,'white')} Start Setup`; return; }
    // Hand off to the Meta embedded-signup page with the short-lived handshake token.
    const d = cfg.data || {};
    const base = window.location.origin;
    const url = `${base}/api/mobile/v1/whatsapp/embedded-signup-page?handshake=${encodeURIComponent(d.signup_handshake||'')}&config_id=${encodeURIComponent(d.config_id||'')}&meta_app_id=${encodeURIComponent(d.meta_app_id||'')}`;
    // W-L4: a blocked popup used to toast success for a tab that never opened.
    const tab = window.open(url, '_blank');
    if (!tab) {
      showToast('Your browser blocked the setup tab — allow popups for this site, then tap Start Setup again.','error');
      btn.disabled = false; btn.innerHTML = `${icon('whatsapp',18,'white')} Start Setup`;
      return;
    }
    // W-H8: remember a setup was opened, so the return-from-tab check can
    // explain a still-not-connected state instead of silently re-rendering.
    setupOpened = true;
    returnNoticePending = false;
    showToast('Complete the Meta setup in the new tab, then return here.','success');
    btn.disabled = false; btn.innerHTML = `${icon('whatsapp',18,'white')} Start Setup`;
  });
  // After returning from Meta, the owner can re-check instead of trusting
  // the stale "not connected" state (M32).
  el.querySelector('#ws-check')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Checking…';
    await renderStatus();
  });
  // W-H8: the failure explanation survives re-renders (manual re-check,
  // second return) until the gym connects or a new setup starts.
  if (!connected && returnNoticePending) {
    el.querySelector('#ws-return-notice')?.remove();
    scroll.insertAdjacentHTML('beforeend', `<div id="ws-return-notice" class="card card-body" style="margin-top:var(--sp-md);border-color:var(--warning);text-align:left"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-xs)">WhatsApp still isn't connected</div><div style="font-size:var(--fs-sm);color:var(--text-secondary)">The Meta setup may not have finished, or the connection failed. Tap Start Setup to try again, or Check status to re-check.</div></div>`);
  }
  return { ok: true, connected };
  }
  setupOpened = false;
  returnNoticePending = false;
  await renderStatus();
  // Refetch when the tab becomes visible again (returning from Meta).
  // W-H8: if a setup was opened and the gym is STILL not connected on
  // return, say so with retry guidance — a silent re-render of
  // "Connect WhatsApp" is exactly the unexplained incident state.
  if (onVisible) document.removeEventListener('visibilitychange', onVisible);
  onVisible = async () => {
    if (document.hidden || !el.isConnected) return;
    const res = await renderStatus();
    if (!res || !res.ok) return;
    if (res.connected) { setupOpened = false; returnNoticePending = false; return; }
    if (!setupOpened) return;
    setupOpened = false;
    returnNoticePending = true;
    await renderStatus();
  };
  document.addEventListener('visibilitychange', onVisible);
},
  unmount() {
    if (onVisible) { document.removeEventListener('visibilitychange', onVisible); onVisible = null; }
  },
};
