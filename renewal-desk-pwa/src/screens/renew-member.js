/* Renew Member Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderAvatar, renderBadge, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatCurrency, formatDate, uuid, getMemberDisplayStatus } from '../utils.js';
export default { async mount(el, params) {
    const idempotencyKey = uuid(); // one key per form mount, reused across retries
  const member = params?.member ? JSON.parse(params.member) : null;
  if (!member) { el.innerHTML = '<div class="empty-state"><div class="empty-state-title">No member selected</div></div>'; return; }
  const settingsRes = await apiRequest('/api/mobile/v1/settings');
  const plans = settingsRes.ok ? settingsRes.data.plans || [] : [];
  const status = getMemberDisplayStatus(member);
  el.innerHTML = `${renderHeader({ title: 'Renew Membership', showBack: true })}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <div class="card card-body" style="margin-bottom:var(--sp-xl);display:flex;align-items:center;gap:var(--sp-md)">
      ${renderAvatar(member.full_name)} <div><div style="font-weight:var(--fw-bold)">${escapeHtml(member.full_name)}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${escapeHtml(member.phone)}</div></div>
      <div style="margin-left:auto">${renderBadge(status)}</div></div>
    <form id="renew-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({ id: 'rn-plan', label: 'Plan', value: member.plan?.id || '', options: plans.map(p => ({value:p.id,label:`${p.name} — ${formatCurrency(p.price)} / ${p.duration_days}d`})), required: true })}
      ${renderFormField({ id: 'rn-amount', label: 'Amount', type: 'number', value: member.plan?.price || '', required: true })}
      ${renderFormField({ id: 'rn-method', label: 'Payment Method', value: 'cash', options: [{value:'cash',label:'Cash'},{value:'upi',label:'UPI'},{value:'card',label:'Card'},{value:'online',label:'Online'},{value:'other',label:'Other'}], required: true })}
      ${renderFormField({ id: 'rn-ref', label: 'Reference / Transaction ID', placeholder: 'Optional' })}
      ${renderFormField({ id: 'rn-notes', label: 'Notes', type: 'textarea', placeholder: 'Optional' })}
      <label style="display:flex;align-items:flex-start;gap:var(--sp-sm);font-size:var(--fs-sm);color:var(--text-secondary);cursor:pointer">
        <input type="checkbox" id="rn-confirm" style="margin-top:3px;width:18px;height:18px;accent-color:var(--brand)">
        <span>I confirm the plan and amount above are correct and approved for ${escapeHtml(member.full_name)}.</span>
      </label>
      <button type="submit" class="btn btn-primary btn-lg btn-full" id="rn-submit" disabled>${icon('renewals', 18, 'white')} Renew & Record Payment</button>
    </form></div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  // Auto-fill amount on plan change
  el.querySelector('#rn-plan').addEventListener('change', (e) => {
    const plan = plans.find(p => String(p.id) === e.target.value);
    if (plan) el.querySelector('#rn-amount').value = plan.price;
  });
  el.querySelector('#rn-confirm').addEventListener('change', (e) => {
    el.querySelector('#rn-submit').disabled = !e.target.checked;
  });
  el.querySelector('#renew-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#rn-submit'); btn.disabled = true; btn.textContent = 'Processing...';
    const body = { member_id: member.id, plan_id: Number(el.querySelector('#rn-plan').value),
      amount: el.querySelector('#rn-amount').value, method: el.querySelector('#rn-method').value,
      reference: el.querySelector('#rn-ref').value.trim() || null, notes: el.querySelector('#rn-notes').value.trim() || null };
    const res = await apiRequest('/api/mobile/v1/payments', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
    if (res.ok) { showToast('Renewal recorded!', 'success'); navigate.pop(); } 
    else { showToast(res.error.message, 'error'); btn.disabled = false; btn.textContent = 'Renew & Record Payment'; }
  });
}};
