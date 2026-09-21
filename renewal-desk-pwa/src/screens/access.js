/* Access Control Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderBadge, renderEmptyState, renderSectionHeader, renderAvatar } from '../components.js';
import { icon } from '../icons.js'; import { formatDateTime, formatInteger, escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Access Control',showBack:true})}<div class="scroll-view" id="ac-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const [statusRes, logRes] = await Promise.all([apiRequest('/api/mobile/v1/access/status'), apiRequest('/api/mobile/v1/access/log?page_size=20')]);
  const scroll = el.querySelector('#ac-scroll');
  const s = statusRes.ok ? statusRes.data : {};
  const logs = logRes.ok ? logRes.data.events||logRes.data.log||[] : [];
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="card card-body" style="text-align:center">
        <div style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-bottom:var(--sp-lg)">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.device_online?'var(--success)':'var(--muted)'}"></span>
          <span style="font-weight:var(--fw-bold)">${s.device_online?'Device Online':'Device Offline'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-lg)">
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatInteger(s.inside_now||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Inside Now</div></div>
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--success)">${formatInteger(s.entries_today||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Entries</div></div>
          <div><div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--text-secondary)">${formatInteger(s.exits_today||0)}</div><div style="font-size:var(--fs-xs);color:var(--muted)">Exits</div></div>
        </div>
      </div>
    </div>
    ${logs.length > 0 ? `${renderSectionHeader('Event Log')}
      <div class="card" style="margin:0 var(--sp-lg)">${logs.map(l=>`
        <div class="list-item">
          <div style="width:32px;height:32px;border-radius:var(--r-full);background:${l.event_type==='entry'?'var(--success-surface)':'var(--gray-100)'};display:flex;align-items:center;justify-content:center">
            ${icon(l.event_type==='entry'?'forward':'back',14,l.event_type==='entry'?'var(--success)':'var(--muted)')}
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${escapeHtml(l.member_name||'Unknown')}</div>
            <div class="list-item-subtitle">${formatDateTime(l.timestamp||l.created_at)}</div>
          </div>
          ${renderBadge(l.event_type||'entry')}
        </div>`).join('')}</div>` : renderEmptyState({icon:'access',title:'No events',text:'Access events will appear here'})}
  </div>`;
}};
