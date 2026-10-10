/* WhatsApp Setup Screen — guided connection flow */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Connect WhatsApp',showBack:true})}<div class="scroll-view" id="ws-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const scroll = el.querySelector('#ws-scroll');
  const statusRes = await apiRequest('/api/mobile/v1/whatsapp/connection-status');
  const st = statusRes.ok ? statusRes.data : {};
  const connected = st.status === 'CONNECTED';
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:64px;height:64px;border-radius:var(--r-full);background:${connected?'var(--success-surface)':'var(--warning-surface)'};display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${icon('whatsapp',32, connected?'var(--success)':'var(--warning)')}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${connected?'WhatsApp Connected':'Connect WhatsApp'}</h3>
      <p style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:var(--sp-lg)">${escapeHtml(st.status_description||'Connect your WhatsApp Business number to send automated renewal reminders.')}</p>
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
    const url = `${base}/api/mobile/v1/whatsapp/embedded-signup-page?handshake=${encodeURIComponent(d.signup_handshake||'')}&gym_id=${d.gym_id||''}&gym_name=${encodeURIComponent(d.gym_name||'')}&meta_app_id=${encodeURIComponent(d.meta_app_id||'')}`;
    window.open(url, '_blank');
    showToast('Complete the Meta setup in the new tab, then return here.','success');
    btn.disabled = false; btn.innerHTML = `${icon('whatsapp',18,'white')} Start Setup`;
  });
}};
