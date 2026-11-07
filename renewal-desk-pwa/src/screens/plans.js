/* Plans Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast, showConfirm, renderEmptyState, renderErrorState } from '../components.js';
import { icon } from '../icons.js'; import { formatCurrency, escapeHtml, uuid } from '../utils.js';
export default { async mount(el) {
  let plans = [], editing = null, loadError = null;
  async function load() {
    const r = await apiRequest('/api/mobile/v1/settings');
    if (!r.ok) { loadError = r.error?.message || 'Failed to load'; plans = []; }
    else { loadError = null; plans = r.data.plans || []; }
    render();
  }
  function render() {
    // V9-L9: one stable key per form render, reused across retries — a
    // double-click used to fire two POSTs with fresh auto keys each, so
    // the backend created two identical plans.
    const planFormKey = uuid();
    el.innerHTML = `${renderHeader({ title:'Membership Plans', showBack:true, actions:[{icon:'add',label:'Add'}] })}
      <div class="scroll-view"><div class="scroll-content">
        ${loadError ? renderErrorState(loadError, 'plans-retry') :
          plans.length === 0 ? renderEmptyState({icon:'plan',title:'No plans',text:'Create your first membership plan',actionText:'Add Plan',actionId:'add-plan'}) :
          `<div class="card" style="margin:var(--sp-lg)">${plans.map(p=>`
            <div class="list-item" data-id="${p.id}">
              <div class="list-item-content">
                <div class="list-item-title">${escapeHtml(p.name)}</div>
                <div class="list-item-subtitle">${p.duration_days} days</div>
              </div>
              <div style="font-weight:var(--fw-bold)">${formatCurrency(p.price)}</div>
              <button class="btn btn-sm btn-secondary" data-edit="${p.id}">${icon('edit',14)}</button>
              <button class="btn btn-sm btn-secondary" data-del="${p.id}" style="color:var(--critical)">${icon('delete',14)}</button>
            </div>`).join('')}</div>`}
        ${editing !== null ? `<div style="padding:var(--sp-lg)"><div class="card card-body">
          <h3 style="margin-bottom:var(--sp-lg)">${editing.id ? 'Edit':'New'} Plan</h3>
          <form id="plan-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
            ${renderFormField({id:'pl-name',label:'Name',value:editing.name||'',required:true,placeholder:'e.g. Monthly'})}
            ${renderFormField({id:'pl-days',label:'Duration (days)',type:'number',value:editing.duration_days||'30',required:true})}
            ${renderFormField({id:'pl-price',label:'Price',type:'number',value:editing.price||'',required:true})}
            <div style="display:flex;gap:var(--sp-sm)">
              <button type="submit" class="btn btn-primary" style="flex:1">Save</button>
              <button type="button" class="btn btn-secondary" id="plan-cancel">Cancel</button>
            </div>
          </form></div></div>` : ''}
      </div></div>`;
    bindHeaderEvents(el, { onBack:()=>navigate.pop(), actions:[{onClick:()=>{editing={};render();}}] });
    el.querySelector('#plans-retry')?.addEventListener('click', load);
    el.querySelector('#add-plan')?.addEventListener('click',()=>{editing={};render();});
    el.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',(e)=>{e.stopPropagation();editing=plans.find(p=>String(p.id)===b.dataset.edit)||{};render();}));
    el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async(e)=>{e.stopPropagation();
      const yes=await showConfirm({title:'Delete Plan',message:'Remove this plan?',confirmText:'Delete',destructive:true});
      if(yes){const r=await apiRequest(`/api/mobile/v1/plans/${b.dataset.del}`,{method:'DELETE'});showToast(r.ok?'Deleted':r.error.message,r.ok?'success':'error');if(r.ok)load();}
    }));
    el.querySelector('#plan-cancel')?.addEventListener('click',()=>{editing=null;render();});
    el.querySelector('#plan-form')?.addEventListener('submit',async(e)=>{e.preventDefault();
      // V9-L9: disable Save while the POST/PATCH is in flight — a
      // double-click used to create two identical plans.
      const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
      if (submitBtn?.disabled) return;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
      const body={name:el.querySelector('#pl-name').value.trim(),duration_days:Number(el.querySelector('#pl-days').value),price:el.querySelector('#pl-price').value};
      const r = editing.id ? await apiRequest(`/api/mobile/v1/plans/${editing.id}`,{method:'PATCH',body,headers:{'Idempotency-Key':planFormKey}}) : await apiRequest('/api/mobile/v1/plans',{method:'POST',body,headers:{'Idempotency-Key':planFormKey}});
      showToast(r.ok?'Saved!':r.error.message,r.ok?'success':'error');if(r.ok){editing=null;load();}
      else if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    });
  }
  await load();
}};
