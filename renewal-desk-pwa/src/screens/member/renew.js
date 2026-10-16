/* Member Self-Renew Screen - QR + I Have Paid */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../../components.js';
import { icon } from '../../icons.js'; import { formatCurrency, escapeHtml } from '../../utils.js';
export default { async mount(el) {
  const plansRes = await apiRequest('/api/member/v1/plans');
  const plans = plansRes.ok ? plansRes.data.plans||plansRes.data||[] : [];
  const payRes = await apiRequest('/api/member/v1/payment-info');
  const payInfo = payRes.ok ? payRes.data : {};
  
  let selectedPlan = plans[0] || null;
  let customAmount = '';
  
  function render() {
    el.innerHTML = `${renderHeader({title:'Renew Membership',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
      <div style="text-align:center;margin-bottom:var(--sp-xl)">
        <h3>Renew your membership</h3>
        <p style="color:var(--muted);font-size:var(--fs-sm)">Pay via UPI, then tap "I have paid"</p>
      </div>
      ${plans.length > 1 ? `<div style="margin-bottom:var(--sp-lg)">
        <label style="font-size:var(--fs-sm);color:var(--muted)">Select plan</label>
        <div style="display:flex;flex-direction:column;gap:var(--sp-sm);margin-top:var(--sp-xs)">
          ${plans.map((p,i)=>`<div class="card card-body" style="cursor:pointer;${selectedPlan?.id===p.id?'border:2px solid var(--brand);':''}" data-plan-idx="${i}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-weight:var(--fw-bold)">${escapeHtml(p.name)}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${p.duration_days} days</div></div>
              <div style="font-weight:var(--fw-extrabold);color:var(--brand)">${formatCurrency(p.price)}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="card card-body" style="margin-top:var(--sp-md)">
        <label style="font-size:var(--fs-sm);color:var(--muted)">Or enter custom amount</label>
        <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-xs);align-items:center">
          <span style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">₹</span>
          <input type="number" id="custom-amount" placeholder="Enter amount" min="1"
            style="flex:1;padding:var(--sp-md);border:1px solid var(--border);border-radius:var(--r-md);font-size:var(--fs-lg)"
            value="${customAmount||''}"/>
        </div>
      </div>
      ${selectedPlan && !customAmount ? `<div class="card card-body" style="text-align:center">
        <div style="font-size:var(--fs-sm);color:var(--muted)">Amount to pay</div>
        <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand);margin:var(--sp-sm) 0">${formatCurrency(customAmount||selectedPlan.price)}</div>
        <div style="font-size:var(--fs-sm)">${escapeHtml(selectedPlan.name)} · ${selectedPlan.duration_days} days</div>
      </div>` : ''}
      ${payInfo.qr_public_url ? `<div class="card card-body" style="text-align:center;margin-top:var(--sp-lg)">
        <img src="${escapeHtml(payInfo.qr_public_url)}" alt="Payment QR" style="max-width:220px;border-radius:var(--r-md)"/>
        ${payInfo.upi_id ? `<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:var(--muted)">${escapeHtml(payInfo.upi_id)}</div>` : ''}
        ${payInfo.instructions ? `<div style="margin-top:var(--sp-xs);font-size:var(--fs-sm)">${escapeHtml(payInfo.instructions)}</div>` : ''}
      </div>` : `<div class="empty-state"><div class="empty-state-title">QR not configured</div><div class="empty-state-text">Ask your gym for payment details</div></div>`}
      <button class="btn btn-primary btn-block" id="paid-btn" style="margin-top:var(--sp-xl)" ${(!selectedPlan&&!customAmount)?'disabled':''}>
        ${icon('check',20,'white')} I have paid ${(customAmount||selectedPlan?.price)?formatCurrency(customAmount||selectedPlan.price):''}
      </button>
    </div></div>`;
    bindHeaderEvents(el, { onBack:()=>navigate.pop() });
    
    el.querySelectorAll('[data-plan-idx]').forEach(card=>card.addEventListener('click',()=>{
      selectedPlan = plans[parseInt(card.dataset.planIdx)];
      render();
    }));
    
    el.querySelector('#custom-amount')?.addEventListener('input',(e)=>{
      customAmount = e.target.value;
      const btn = el.querySelector('#paid-btn');
      if (btn) {
        btn.disabled = !selectedPlan && !customAmount;
        btn.innerHTML = `${icon('check',20,'white')} I have paid ${(customAmount||selectedPlan?.price)?formatCurrency(customAmount||selectedPlan.price):''}`;
      }
    });
    
    el.querySelector('#paid-btn')?.addEventListener('click', async()=>{
      if (!selectedPlan && !customAmount) return;
      const body = selectedPlan ? {plan_id:selectedPlan.id} : {};
      if (customAmount) body.custom_amount = parseFloat(customAmount);
      const r = await apiRequest('/api/member/v1/renew',{method:'POST',body});
      if (r.ok) { showToast('Payment notified! Gym will verify soon.','success'); navigate.pop(); }
      else showToast(r.error?.message||'Failed','error');
    });
  }
  render();
}};