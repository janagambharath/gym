/* Bot Lead Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatDate, formatDateTime } from '../utils.js';
export default { async mount(el, params) {
  const leadId = params?.leadId;
  const res = await apiRequest(`/api/mobile/v1/bot/leads/${leadId}`);
  if (!res.ok) { el.innerHTML = `${renderHeader({title:'Lead',showBack:true})}<div class="empty-state"><div class="empty-state-title">Lead not found</div></div>`; bindHeaderEvents(el,{onBack:()=>navigate.pop()}); return; }
  const l = res.data;
  el.innerHTML = `${renderHeader({title:'Lead Detail',showBack:true})}<div class="scroll-view"><div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)">
      <h2 style="margin-bottom:var(--sp-sm)">${escapeHtml(l.name||l.phone||'Unknown')}</h2>
      ${renderBadge(l.status||'new')}
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Phone', l.phone||'—')}
      ${renderInfoRow('Name', l.name||'—')}
      ${renderInfoRow('Source', l.source||'Bot')}
      ${renderInfoRow('Status', l.status||'new')}
      ${renderInfoRow('Created', formatDateTime(l.created_at))}
      ${l.notes ? renderInfoRow('Notes', l.notes) : ''}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      <button class="btn btn-primary btn-full" id="ld-convert">${icon('add',18,'white')} Convert to Member</button>
      <button class="btn btn-whatsapp btn-full" id="ld-wa">${icon('whatsapp',18,'white')} Send WhatsApp</button>
    </div>
    ${l.transcript && l.transcript.length ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Conversation</div>
      <div class="chat-container" style="padding:0">${l.transcript.map(m=>`<div class="chat-bubble ${m.role==='bot'?'bot':'incoming'}">${escapeHtml(m.content||m.text||'')}</div>`).join('')}</div>
    </div></div>` : ''}
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#ld-convert')?.addEventListener('click',()=>navigate.push('add-member'));
  el.querySelector('#ld-wa')?.addEventListener('click',()=>{ if(l.phone) window.open(`https://wa.me/${l.phone.replace(/\D/g,'')}`,'_blank'); });
}};
