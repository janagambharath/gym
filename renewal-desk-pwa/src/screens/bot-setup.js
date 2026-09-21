/* Bot Setup Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
export default { async mount(el) {
  const res = await apiRequest('/api/mobile/v1/bot/config');
  const c = res.ok ? res.data : {};
  el.innerHTML = `${renderHeader({title:'Bot Setup',showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <form id="bs-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({id:'bs-greet',label:'Greeting Message',type:'textarea',value:c.greeting_message||'',placeholder:'Hello! Welcome to our gym. How can I help you?'})}
      ${renderFormField({id:'bs-hours',label:'Business Hours',value:c.business_hours||'',placeholder:'Mon-Sat 6AM-10PM'})}
      ${renderFormField({id:'bs-loc',label:'Location / Address',type:'textarea',value:c.location||'',placeholder:'Gym address'})}
      ${renderFormField({id:'bs-trial',label:'Trial Offer',value:c.trial_offer||'',placeholder:'Free 1-day trial available!'})}
      ${renderFormField({id:'bs-faq',label:'FAQ (one per line)',type:'textarea',value:c.faq||'',placeholder:'Q: What are your hours?\\nA: Mon-Sat 6AM-10PM'})}
      <button type="submit" class="btn btn-primary btn-full">Save Configuration</button>
    </form>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#bs-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const r = await apiRequest('/api/mobile/v1/bot/config',{method:'PATCH',body:{
      greeting_message:el.querySelector('#bs-greet').value.trim()||null, business_hours:el.querySelector('#bs-hours').value.trim()||null,
      location:el.querySelector('#bs-loc').value.trim()||null, trial_offer:el.querySelector('#bs-trial').value.trim()||null,
      faq:el.querySelector('#bs-faq').value.trim()||null }});
    showToast(r.ok?'Saved!':r.error.message, r.ok?'success':'error');
  });
}};
