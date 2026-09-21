/* Inbox Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderAvatar } from '../components.js';
import { escapeHtml, formatRelativeTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Inbox',showBack:true})}<div class="scroll-view" id="ib-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/inbox');
  const list = el.querySelector('#ib-list');
  const messages = res.ok ? res.data.messages||res.data||[] : [];
  if (!Array.isArray(messages)||messages.length===0) { list.innerHTML = renderEmptyState({icon:'inbox',title:'Inbox empty',text:'No messages yet'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${messages.map(m=>`
    <div class="list-item">
      ${renderAvatar(m.sender_name||m.from||'?')}
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(m.sender_name||m.from||'Unknown')}</div>
        <div class="list-item-subtitle truncate">${escapeHtml(m.preview||m.text||m.message||'')}</div>
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted)">${formatRelativeTime(m.created_at)}</span>
    </div>`).join('')}</div></div>`;
}};
