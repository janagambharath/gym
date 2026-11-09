/* Bot Test Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
export default { mount(el) {
  let messages = [{ role:'bot', text:'Hello! I\'m your AI receptionist. How can I help you today?' }];
  // V10-L20: sendMessage used to re-render the whole screen on every
  // send and every reply, destroying the input (focus lost after every
  // message) and letting rapid sends interleave. Append bubbles in
  // place instead, and disable Send while a reply is in flight.
  let sending = false;
  const render = () => {
    el.innerHTML = `${renderHeader({title:'Test Bot',showBack:true})}
      <div class="scroll-view" id="bt-scroll"><div class="chat-container" id="bt-chat">
        ${messages.map(m=>`<div class="chat-bubble ${m.role==='bot'?'bot':'outgoing'}">${escapeHtml(m.text)}</div>`).join('')}
      </div></div>
      <div style="padding:var(--sp-sm) var(--sp-lg) calc(var(--sp-sm)+var(--safe-bottom));background:var(--card);border-top:1px solid var(--border);display:flex;gap:var(--sp-sm)">
        <input class="form-input" id="bt-input" placeholder="Type a test message..." style="flex:1;min-height:40px">
        <button class="btn btn-primary btn-icon" id="bt-send">${icon('send',18,'white')}</button>
      </div>`;
    bindHeaderEvents(el, { onBack:()=>navigate.pop() });
    const scroll = el.querySelector('#bt-scroll'); scroll.scrollTop = scroll.scrollHeight;
    el.querySelector('#bt-send').addEventListener('click', sendMessage);
    el.querySelector('#bt-input').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendMessage(); });
  };
  async function sendMessage() {
    if (sending) return;
    const input = el.querySelector('#bt-input'); const text = input.value.trim();
    if (!text) return;
    sending = true;
    const sendBtn = el.querySelector('#bt-send');
    if (sendBtn) sendBtn.disabled = true;
    input.value = '';
    messages.push({role:'user',text});
    const chat = el.querySelector('#bt-chat');
    const scroll = el.querySelector('#bt-scroll');
    // Append in place — the input element survives, so focus is kept.
    chat.insertAdjacentHTML('beforeend', `<div class="chat-bubble outgoing">${escapeHtml(text)}</div>`);
    scroll.scrollTop = scroll.scrollHeight;
    const r = await apiRequest('/api/mobile/v1/bot/test',{method:'POST',body:{message:text}});
    const reply = (r.ok && r.data.response) ? r.data.response : 'Sorry, I couldn\'t process that. Please try again.';
    messages.push({role:'bot',text:reply});
    chat.insertAdjacentHTML('beforeend', `<div class="chat-bubble bot">${escapeHtml(reply)}</div>`);
    scroll.scrollTop = scroll.scrollHeight;
    sending = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
  render();
}};
