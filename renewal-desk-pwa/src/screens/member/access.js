/* Member Access (Attendance) Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState } from '../../components.js';
import { icon } from '../../icons.js'; import { formatDateTime } from '../../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Attendance',showBack:true})}<div class="scroll-view" id="ma-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/member/v1/access');
  const list = el.querySelector('#ma-list');
  const events = res.ok ? res.data.events||res.data||[] : [];
  if (!Array.isArray(events)||events.length===0) { list.innerHTML = renderEmptyState({icon:'access',title:'No attendance records',text:'Your gym visits will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${events.map(e=>`
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:var(--r-full);background:${e.event_type==='entry'?'var(--success-surface)':'var(--gray-100)'};display:flex;align-items:center;justify-content:center">
        ${icon(e.event_type==='entry'?'forward':'back',14,e.event_type==='entry'?'var(--success)':'var(--muted)')}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${e.event_type==='entry'?'Check In':'Check Out'}</div>
        <div class="list-item-subtitle">${formatDateTime(e.timestamp||e.created_at)}</div>
      </div>
    </div>`).join('')}</div></div>`;
}};
