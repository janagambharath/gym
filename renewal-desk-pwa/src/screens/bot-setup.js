/* Bot Setup Screen — synced to backend contract (bot.py) */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
export default { async mount(el) {
  const res = await apiRequest('/api/mobile/v1/bot/config');
  const c = res.ok ? (res.data.config || {}) : {};
  el.innerHTML = `${renderHeader({title:'Bot Setup',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({id:'bs-greet',label:'Greeting Message',type:'textarea',value:c.greeting_message||'',placeholder:'Hello! Welcome to our gym. How can I help you?'})}
      ${renderFormField({id:'bs-hours',label:'Opening Hours',value:c.opening_hours||'',placeholder:'Mon-Sat 6AM-10PM'})}
      ${renderFormField({id:'bs-map',label:'Google Maps Link',value:c.map_link||'',placeholder:'https://maps.google.com/…'})}
      ${renderFormField({id:'bs-reg',label:'Registration Link',value:c.registration_link||'',placeholder:'https://…'})}
      ${renderFormField({id:'bs-trial-price',label:'Trial Price (₹)',value:c.trial_price||'',placeholder:'0.00'})}
      ${renderFormField({id:'bs-trial-days',label:'Trial Duration (days)',value:c.trial_duration_days||'',placeholder:'1'})}
      <button type="submit" class="btn btn-primary btn-full">Save Configuration</button>
    </form>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#bs-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const r = await apiRequest('/api/mobile/v1/bot/config',{method:'PATCH',body:{
      greeting_message:el.querySelector('#bs-greet').value.trim()||null,
      opening_hours:el.querySelector('#bs-hours').value.trim()||null,
      map_link:el.querySelector('#bs-map').value.trim()||null,
      registration_link:el.querySelector('#bs-reg').value.trim()||null,
      trial_price:el.querySelector('#bs-trial-price').value.trim()||null,
      trial_duration_days:el.querySelector('#bs-trial-days').value.trim()||null }});
    showToast(r.ok?'Saved!':r.error.message, r.ok?'success':'error');
  });
}};
