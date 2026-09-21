/* Bot Overview Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMenuItem, renderInfoRow, renderMetricCard, renderListSkeleton } from '../components.js';
import { icon } from '../icons.js'; import { formatInteger, escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'AI Receptionist',showBack:true})}<div class="scroll-view" id="bot-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/bot/overview');
  const scroll = el.querySelector('#bot-scroll');
  const d = res.ok ? res.data : {};
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="metric-grid">
      ${renderMetricCard({label:'Conversations',value:formatInteger(d.total_conversations||0),iconName:'chatbubble',color:'var(--brand)',bgColor:'var(--brand-subtle)'})}
      ${renderMetricCard({label:'Leads',value:formatInteger(d.total_leads||0),iconName:'target',color:'var(--success)',bgColor:'var(--success-surface)'})}
      ${renderMetricCard({label:'Handovers',value:formatInteger(d.handover_count||0),iconName:'alert',color:'var(--warning)',bgColor:'var(--warning-surface)'})}
      ${renderMetricCard({label:'Resolution',value:(d.resolution_rate||'0')+'%',iconName:'check',color:'var(--success)',bgColor:'var(--success-surface)'})}
    </div></div>
    <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
      ${renderMenuItem({iconName:'chatbubble',label:'Conversations',desc:'View chat transcripts',onClick:'bot-conversations',iconBg:'var(--brand-subtle)',iconColor:'var(--brand)'})}
      ${renderMenuItem({iconName:'target',label:'Leads',desc:'Potential customers',onClick:'bot-leads',iconBg:'var(--success-surface)',iconColor:'var(--success)'})}
      ${renderMenuItem({iconName:'settings',label:'Bot Setup',desc:'Configure greeting, hours & FAQ',onClick:'bot-setup',iconBg:'var(--gray-100)',iconColor:'var(--gray-600)'})}
      ${renderMenuItem({iconName:'flash',label:'Test Bot',desc:'Try a sandbox conversation',onClick:'bot-test',iconBg:'#ede9fe',iconColor:'#7c3aed'})}
    </div>
  </div>`;
  scroll.querySelectorAll('[data-action]').forEach(i=>i.addEventListener('click',()=>navigate.push(i.dataset.action)));
}};
