/* Bot Setup Screen — synced to backend contract (bot.py) */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderErrorState, showToast } from '../components.js';
export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = `${renderHeader({title:'Bot Setup',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content" id="bs-wrap"><div style="padding:var(--sp-lg)">Loading…</div></div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const wrap = el.querySelector('#bs-wrap');
  const res = await apiRequest('/api/mobile/v1/bot/config');
  if (!res.ok) {
    // V8-M9: a failed load used to render a blank form — Save then sent
    // every field as null and the backend wiped the whole bot config.
    // Never render the form (or its Save button) until the load succeeds.
    wrap.innerHTML = renderErrorState(res.error?.message || 'Could not load the bot configuration.');
    wrap.querySelector('#retry-btn')?.addEventListener('click', () => load(el));
    return;
  }
  const c = res.data.config || {};
  wrap.innerHTML = `
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({id:'bs-greet',label:'Greeting Message',type:'textarea',value:c.greeting_message||'',placeholder:'Hello! Welcome to our gym. How can I help you?'})}
      ${renderFormField({id:'bs-hours',label:'Opening Hours',value:c.opening_hours||'',placeholder:'Mon-Sat 6AM-10PM'})}
      ${renderFormField({id:'bs-map',label:'Google Maps Link',value:c.map_link||'',placeholder:'https://maps.google.com/…'})}
      ${renderFormField({id:'bs-reg',label:'Registration Link',value:c.registration_link||'',placeholder:'https://…'})}
      ${renderFormField({id:'bs-trial-price',label:'Trial Price (₹)',value:c.trial_price||'',placeholder:'0.00'})}
      ${renderFormField({id:'bs-trial-days',label:'Trial Duration (days)',value:c.trial_duration_days||'',placeholder:'1'})}
      <button type="submit" class="btn btn-primary btn-full" id="bs-save">Save Configuration</button>
    </form>`;
  el.querySelector('#bs-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const btn = el.querySelector('#bs-save');
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await apiRequest('/api/mobile/v1/bot/config',{method:'PATCH',body:{
      greeting_message:el.querySelector('#bs-greet').value.trim()||null,
      opening_hours:el.querySelector('#bs-hours').value.trim()||null,
      map_link:el.querySelector('#bs-map').value.trim()||null,
      registration_link:el.querySelector('#bs-reg').value.trim()||null,
      trial_price:el.querySelector('#bs-trial-price').value.trim()||null,
      trial_duration_days:el.querySelector('#bs-trial-days').value.trim()||null }});
    showToast(r.ok?'Saved!':r.error.message, r.ok?'success':'error');
    btn.disabled = false; btn.textContent = 'Save Configuration';
  });
}
