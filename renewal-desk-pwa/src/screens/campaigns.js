/* Campaigns Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderBadge } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatDateTime, formatInteger, SEGMENT_LABELS } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Campaigns',showBack:true,actions:[{icon:'add',label:'New'}]})}<div class="scroll-view" id="cp-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop(), actions:[{onClick:()=>navigate.push('campaign-create')}] });
  const res = await apiRequest('/api/mobile/v1/campaigns');
  const list = el.querySelector('#cp-list');
  const campaigns = res.ok ? res.data.campaigns||res.data||[] : [];
  if (!Array.isArray(campaigns)||campaigns.length===0) { list.innerHTML = renderEmptyState({icon:'megaphone',title:'No campaigns',text:'Create your first WhatsApp campaign',actionText:'New Campaign',actionId:'cp-new'}); list.querySelector('#cp-new')?.addEventListener('click',()=>navigate.push('campaign-create')); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${campaigns.map(c=>`
    <div class="list-item" data-cid="${c.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-lg);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${icon('megaphone',18,'var(--brand)')}</div>
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(c.name||SEGMENT_LABELS[c.segment]||'Campaign')}</div>
        <div class="list-item-subtitle">${escapeHtml(SEGMENT_LABELS[c.segment]||c.segment||'')} · ${formatInteger(c.recipient_count||0)} recipients</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${formatDateTime(c.created_at)}</span>
        ${renderBadge(c.status||'draft')}
      </div>
    </div>`).join('')}</div></div>`;
  list.querySelectorAll('[data-cid]').forEach(i=>i.addEventListener('click',()=>navigate.push('campaign-detail',{campaignId:i.dataset.cid})));
}};
