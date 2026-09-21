/* Member Self-Renew Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../../components.js';
import { icon } from '../../icons.js'; import { formatCurrency, escapeHtml } from '../../utils.js';
export default { async mount(el) {
  const res = await apiRequest('/api/member/v1/plans');
  const plans = res.ok ? res.data.plans||res.data||[] : [];
  el.innerHTML = `${renderHeader({title:'Renew Membership',showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <div style="text-align:center;margin-bottom:var(--sp-xxl)">
      <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${icon('renewals',32,'var(--brand)')}</div>
      <h3>Select a plan to renew</h3>
    </div>
    <div style="display:flex;flex-direction:column;gap:var(--sp-md)">
      ${plans.map(p=>`<div class="card card-body" style="cursor:pointer;transition:all 0.15s" data-plan='${escapeHtml(JSON.stringify(p))}'>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:var(--fw-bold)">${escapeHtml(p.name)}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${p.duration_days} days</div></div>
          <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--brand)">${formatCurrency(p.price)}</div>
        </div>
      </div>`).join('')}
    </div>
    ${plans.length===0?`<div class="empty-state"><div class="empty-state-title">No plans available</div></div>`:''}
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelectorAll('[data-plan]').forEach(card=>card.addEventListener('click',async()=>{
    const plan = JSON.parse(card.dataset.plan);
    const r = await apiRequest('/api/member/v1/renew',{method:'POST',body:{plan_id:plan.id}});
    if (r.ok) { showToast('Renewal request submitted!','success'); navigate.pop(); }
    else showToast(r.error.message,'error');
  }));
}};
