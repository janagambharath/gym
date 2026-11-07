/* Inbox Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderErrorState, renderAvatar } from '../components.js';
import { escapeHtml, formatRelativeTime } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Inbox',showBack:true})}<div class="scroll-view" id="ib-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  async function load() {
    const list = el.querySelector('#ib-list');
    if (list) list.innerHTML = renderListSkeleton();
    const res = await apiRequest('/api/mobile/v1/inbox');
    const messages = res.ok ? res.data.messages||res.data||[] : [];
    if (!res.ok) { list.innerHTML = renderErrorState(res.error?.message || 'Failed to load'); list.querySelector('#retry-btn')?.addEventListener('click', load); return; }
    if (!Array.isArray(messages)||messages.length===0) { list.innerHTML = renderEmptyState({icon:'inbox',title:'Inbox empty',text:'No messages yet'}); return; }
  const hasTarget = (m) => Boolean(m.conversation_id || m.member_id || m.payment_id || m.lead_id);
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${messages.map((m,i)=>`
    <div class="list-item" data-idx="${i}" style="cursor:${hasTarget(m) ? 'pointer' : 'default'}">
      ${renderAvatar(m.sender_name||m.from||'?')}
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(m.sender_name||m.from||'Unknown')}</div>
        <div class="list-item-subtitle truncate">${escapeHtml(m.preview||m.text||m.message||'')}</div>
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted)">${formatRelativeTime(m.created_at)}</span>
    </div>`).join('')}</div></div>`;
  list.querySelectorAll('[data-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const m = messages[Number(row.dataset.idx)];
      if (!m) return;
      // Deep-link to whatever this message is about.
      if (m.conversation_id) navigate.push('bot-conversation-detail', { conversationId: String(m.conversation_id) });
      else if (m.member_id) navigate.push('member-detail', { memberId: String(m.member_id) });
      else if (m.payment_id) navigate.push('payment-detail', { paymentId: String(m.payment_id) });
      else if (m.lead_id) navigate.push('bot-lead-detail', { leadId: String(m.lead_id) });
      else {
        // No link target: tapping expands the full message instead of
        // doing nothing (B-L10).
        let body = row.querySelector('.ib-full-body');
        if (body) { body.remove(); return; }
        body = document.createElement('div');
        body.className = 'ib-full-body';
        body.style.cssText = 'padding:var(--sp-sm) var(--sp-lg);font-size:var(--fs-sm);color:var(--text-secondary);white-space:pre-wrap';
        body.textContent = m.text || m.message || m.preview || '';
        row.after(body);
      }
    });
  });
  }
  await load();
}};
