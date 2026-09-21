/* Bot Conversations Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatRelativeTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Conversations',showBack:true})}<div class="scroll-view" id="bc-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/bot/conversations');
  const list = el.querySelector('#bc-list');
  const convos = res.ok ? res.data.conversations||res.data||[] : [];
  if (!Array.isArray(convos)||convos.length===0) { list.innerHTML = renderEmptyState({icon:'chatbubble',title:'No conversations',text:'Bot conversations will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${convos.map(c=>`
    <div class="list-item" data-cid="${c.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-full);background:${c.needs_handover?'var(--warning-surface)':'var(--brand-subtle)'};display:flex;align-items:center;justify-content:center">
        ${icon(c.needs_handover?'alert':'chatbubble',18,c.needs_handover?'var(--warning)':'var(--brand)')}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(c.customer_name||c.phone||'Unknown')}</div>
        <div class="list-item-subtitle truncate">${escapeHtml(c.last_message||'No messages')}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${formatRelativeTime(c.updated_at||c.created_at)}</span>
        ${c.needs_handover ? renderBadge('Handover') : ''}
      </div>
    </div>`).join('')}</div></div>`;
  list.querySelectorAll('[data-cid]').forEach(item=>item.addEventListener('click',()=>navigate.push('bot-conversation-detail',{conversationId:item.dataset.cid})));
}};
