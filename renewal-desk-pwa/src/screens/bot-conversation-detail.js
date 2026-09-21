/* Bot Conversation Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatDateTime } from '../utils.js';
export default { async mount(el, params) {
  const cid = params?.conversationId;
  el.innerHTML = `${renderHeader({title:'Conversation',showBack:true})}<div class="scroll-view" id="bcd-scroll"><div class="full-loader"><div class="spinner"></div></div></div>
    <div style="padding:var(--sp-sm) var(--sp-lg) calc(var(--sp-sm)+var(--safe-bottom));background:var(--card);border-top:1px solid var(--border);display:flex;gap:var(--sp-sm)">
      <input class="form-input" id="bcd-input" placeholder="Type a reply..." style="flex:1;min-height:40px">
      <button class="btn btn-primary btn-icon" id="bcd-send">${icon('send',18,'white')}</button>
    </div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest(`/api/mobile/v1/bot/conversations/${cid}`);
  const scroll = el.querySelector('#bcd-scroll');
  if (!res.ok) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Not found</div></div>`; return; }
  const msgs = res.data.messages || [];
  scroll.innerHTML = `<div class="chat-container">${msgs.map(m=>`
    <div class="chat-bubble ${m.role==='bot'?'bot':m.role==='customer'||m.role==='user'?'incoming':'outgoing'}">
      ${escapeHtml(m.content||m.text||'')}
      <div class="chat-bubble-time">${formatDateTime(m.timestamp||m.created_at)}</div>
    </div>`).join('')}</div>`;
  scroll.scrollTop = scroll.scrollHeight;
  // Actions
  el.querySelector('#bcd-send')?.addEventListener('click', async () => {
    const input = el.querySelector('#bcd-input'); const text = input.value.trim();
    if (!text) return; input.value = '';
    const r = await apiRequest(`/api/mobile/v1/bot/conversations/${cid}/reply`, { method:'POST', body:{message:text} });
    showToast(r.ok?'Sent!':r.error.message, r.ok?'success':'error');
    if (r.ok) { // Re-render
      const chat = scroll.querySelector('.chat-container');
      chat.insertAdjacentHTML('beforeend', `<div class="chat-bubble outgoing">${escapeHtml(text)}<div class="chat-bubble-time">Just now</div></div>`);
      scroll.scrollTop = scroll.scrollHeight;
    }
  });
}};
