/* WhatsApp Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton, renderErrorState, showToast, renderSectionHeader } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatDateTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({ title:'WhatsApp', showBack:true })}<div class="scroll-view" id="wa-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const [statusRes, logRes] = await Promise.all([apiRequest('/api/mobile/v1/whatsapp/status'), apiRequest('/api/mobile/v1/whatsapp/logs?page_size=20')]);
  const scroll = el.querySelector('#wa-scroll');
  const s = statusRes.ok ? statusRes.data : {};
  const logs = logRes.ok ? logRes.data.logs || logRes.data.messages || [] : [];
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-lg)">
        ${icon('whatsapp', 28, 'var(--whatsapp)')}
        <div style="flex:1"><div style="font-weight:var(--fw-bold)">WhatsApp Connection</div></div>
        ${renderBadge(s.connected ? 'Connected' : 'Disconnected')}
      </div>
      ${s.phone_number ? renderInfoRow('Phone', s.phone_number) : ''}
      ${renderInfoRow('Auto Reminders', s.auto_reminders ? 'Enabled' : 'Disabled')}
      ${s.messages_sent_today != null ? renderInfoRow('Sent Today', String(s.messages_sent_today)) : ''}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;gap:var(--sp-sm)">
      <button class="btn btn-whatsapp" style="flex:1" id="wa-broadcast">${icon('send',16,'white')} Broadcast</button>
      <button class="btn btn-outline" style="flex:1" id="wa-campaigns">${icon('megaphone',16)} Campaigns</button>
    </div>
    ${logs.length > 0 ? `${renderSectionHeader('Recent Messages')}
      <div class="card" style="margin:0 var(--sp-lg)">${logs.slice(0,15).map(l=>`
        <div class="list-item"><div class="list-item-content">
          <div class="list-item-title">${escapeHtml(l.member_name||l.phone||'Unknown')}</div>
          <div class="list-item-subtitle truncate">${escapeHtml(l.template||l.message_type||'Message')}</div>
        </div><div class="list-item-right">
          <span style="font-size:var(--fs-xs);color:var(--muted)">${formatDateTime(l.sent_at||l.created_at)}</span>
          ${renderBadge(l.status||'sent')}
        </div></div>`).join('')}</div>` : ''}
  </div>`;
  el.querySelector('#wa-broadcast')?.addEventListener('click',()=>navigate.push('campaign-create'));
  el.querySelector('#wa-campaigns')?.addEventListener('click',()=>navigate.push('campaigns'));
}};
