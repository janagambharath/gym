/* Bot Test Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
export default { mount(el) {
  let messages = [{ role:'bot', text:'Hello! I\'m your AI receptionist. How can I help you today?' }];
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
    const input = el.querySelector('#bt-input'); const text = input.value.trim();
    if (!text) return; input.value = '';
    messages.push({role:'user',text}); render();
    const r = await apiRequest('/api/mobile/v1/bot/test',{method:'POST',body:{message:text}});
    if (r.ok && r.data.response) messages.push({role:'bot',text:r.data.response});
    else messages.push({role:'bot',text:'Sorry, I couldn\'t process that. Please try again.'});
    render();
  }
  render();
}};
