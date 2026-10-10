/* Notifications Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatRelativeTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Notifications',showBack:true})}<div class="scroll-view" id="nf-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/mobile/v1/notifications');
  const list = el.querySelector('#nf-list');
  const notifs = res.ok ? res.data.notifications||res.data||[] : [];
  if (!Array.isArray(notifs)||notifs.length===0) { list.innerHTML = renderEmptyState({icon:'notifications',title:'No notifications',text:'You\'re all caught up!'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${notifs.map((n,idx)=>{
    const iconMap = {payment:'wallet',renewal:'renewals',member:'person',whatsapp:'whatsapp',bot:'robot',campaign:'megaphone'};
    const ic = iconMap[n.type]||'notifications';
    return `<div class="list-item" data-idx="${idx}" style="${n.read?'':'background:var(--brand-subtle)'};cursor:pointer">
      <div style="width:36px;height:36px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${icon(ic,16,'var(--brand)')}</div>
      <div class="list-item-content">
        <div class="list-item-title" style="font-weight:${n.read?'var(--fw-normal)':'var(--fw-bold)'}">${escapeHtml(n.title||n.message||'')}</div>
        ${n.body?`<div class="list-item-subtitle">${escapeHtml(n.body)}</div>`:''}
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted);white-space:nowrap">${formatRelativeTime(n.created_at)}</span>
    </div>`;}).join('')}</div></div>`;
  list.querySelectorAll('[data-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const n = notifs[Number(row.dataset.idx)];
      if (!n) return;
      if (n.member_id) navigate.push('member-detail', { memberId: String(n.member_id) });
      else if (n.payment_id) navigate.push('payment-detail', { paymentId: String(n.payment_id) });
      else if (n.conversation_id) navigate.push('bot-conversation-detail', { conversationId: String(n.conversation_id) });
    });
  });
}};
