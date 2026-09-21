/* Bot Leads Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge, renderAvatar } from '../components.js';
import { escapeHtml, formatRelativeTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Leads',showBack:true})}<div class="scroll-view" id="bl-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/bot/leads');
  const list = el.querySelector('#bl-list');
  const leads = res.ok ? res.data.leads||res.data||[] : [];
  if (!Array.isArray(leads)||leads.length===0) { list.innerHTML = renderEmptyState({icon:'target',title:'No leads yet',text:'Leads from bot conversations will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${leads.map(l=>`
    <div class="list-item" data-lid="${l.id}">
      ${renderAvatar(l.name||l.phone||'Lead')}
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(l.name||l.phone||'Unknown')}</div>
        <div class="list-item-subtitle">${escapeHtml(l.phone||'')} ${l.source?'· '+escapeHtml(l.source):''}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${formatRelativeTime(l.created_at)}</span>
        ${renderBadge(l.status||'new')}
      </div>
    </div>`).join('')}</div></div>`;
  list.querySelectorAll('[data-lid]').forEach(i=>i.addEventListener('click',()=>navigate.push('bot-lead-detail',{leadId:i.dataset.lid})));
}};
