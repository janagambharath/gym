/* Record Payment Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { icon } from '../icons.js'; import { debounce, uuid, escapeHtml } from '../utils.js';
export default { async mount(el, params) {
  const preId = params?.memberId; let members = [], selectedMember = null;
  const settingsRes = await apiRequest('/api/mobile/v1/settings');
  const plans = settingsRes.ok ? settingsRes.data.plans || [] : [];
  if (preId) { const r = await apiRequest(`/api/mobile/v1/members/${preId}`); if (r.ok) selectedMember = r.data; }
  const render = () => {
    el.innerHTML = `${renderHeader({ title: 'Record Payment', showBack: true })}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
      <form id="rp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
        ${selectedMember ? `<div class="card card-body" style="display:flex;align-items:center;gap:var(--sp-md)">
          <div style="font-weight:var(--fw-bold);flex:1">${escapeHtml(selectedMember.full_name)}<br><span style="font-size:var(--fs-sm);color:var(--muted)">${escapeHtml(selectedMember.phone)}</span></div>
          <button type="button" class="btn btn-sm btn-secondary" id="rp-change">Change</button></div>` :
          `<div class="form-group"><label class="form-label">Search Member *</label>
            <div class="search-bar"><span class="search-icon">${icon('search',16)}</span><input type="text" placeholder="Search by name or phone..." id="rp-search"></div>
            <div id="rp-results"></div></div>`}
        ${renderFormField({ id: 'rp-plan', label: 'Plan', value: selectedMember?.plan?.id || '', options: plans.map(p=>({value:p.id,label:`${p.name} — ${p.duration_days}d`})) })}
        ${renderFormField({ id: 'rp-amount', label: 'Amount', type: 'number', value: selectedMember?.plan?.price || '', required: true })}
        ${renderFormField({ id: 'rp-method', label: 'Method', value: 'cash', options: [{value:'cash',label:'Cash'},{value:'upi',label:'UPI'},{value:'card',label:'Card'},{value:'online',label:'Online'},{value:'other',label:'Other'}], required: true })}
        ${renderFormField({ id: 'rp-ref', label: 'Reference', placeholder: 'Transaction ID (optional)' })}
        ${renderFormField({ id: 'rp-notes', label: 'Notes', type: 'textarea', placeholder: 'Optional' })}
        <button type="submit" class="btn btn-primary btn-lg btn-full" id="rp-submit">${icon('wallet',18,'white')} Record Payment</button>
      </form></div></div>`;
    bindHeaderEvents(el, { onBack: () => navigate.pop() });
    el.querySelector('#rp-change')?.addEventListener('click', () => { selectedMember = null; render(); });
    const searchInput = el.querySelector('#rp-search');
    if (searchInput) {
      const doSearch = debounce(async (q) => {
        if (!q) { el.querySelector('#rp-results').innerHTML = ''; return; }
        const r = await apiRequest(`/api/mobile/v1/members?q=${encodeURIComponent(q)}&page_size=5`);
        if (!r.ok) return;
        el.querySelector('#rp-results').innerHTML = (r.data.members||[]).map(m => `<div class="list-item" data-mid="${m.id}" style="cursor:pointer"><div class="list-item-title">${escapeHtml(m.full_name)}</div><div class="list-item-subtitle">${escapeHtml(m.phone)}</div></div>`).join('');
        el.querySelectorAll('[data-mid]').forEach(item => item.addEventListener('click', () => {
          selectedMember = (r.data.members||[]).find(x => String(x.id)===item.dataset.mid); render();
        }));
      }, 300);
      searchInput.addEventListener('input', (e) => doSearch(e.target.value.trim()));
    }
    el.querySelector('#rp-plan')?.addEventListener('change', (e) => { const p = plans.find(x=>String(x.id)===e.target.value); if(p) el.querySelector('#rp-amount').value = p.price; });
    el.querySelector('#rp-form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!selectedMember) { showToast('Please select a member', 'error'); return; }
      const btn = el.querySelector('#rp-submit'); btn.disabled = true;
      const body = { member_id: selectedMember.id, amount: el.querySelector('#rp-amount').value,
        method: el.querySelector('#rp-method').value, plan_id: el.querySelector('#rp-plan').value ? Number(el.querySelector('#rp-plan').value) : null,
        reference: el.querySelector('#rp-ref').value.trim()||null, notes: el.querySelector('#rp-notes').value.trim()||null };
      const r = await apiRequest('/api/mobile/v1/payments', { method:'POST', body, headers:{'Idempotency-Key':uuid()} });
      if (r.ok) { showToast('Payment recorded!','success'); navigate.pop(); } else { showToast(r.error.message,'error'); btn.disabled=false; }
    });
  }; render();
}};
