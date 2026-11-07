/* Record Payment Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderErrorState, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js'; import { debounce, uuid, escapeHtml, formatDate } from '../utils.js';

// Same guarded version as renew-member.js: an invalid stored gym timezone
// must never throw during mount and block recording payments (B-M9).
function dateKeyInTimezone(value, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (type) => parts.find((item) => item.type === type)?.value || '';
    const key = `${part('year')}-${part('month')}-${part('day')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  } catch { /* invalid timezone — fall through to local date */ }
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export default { async mount(el, params) { await mountRecord(el, params); } };

async function mountRecord(el, params) {
    const idempotencyKey = uuid(); // one key per form mount, reused across retries
  const preId = params?.memberId; let members = [], selectedMember = null;
  const settingsRes = await apiRequest('/api/mobile/v1/settings');
  if (!settingsRes.ok) {
    // V9-L6: a settings failure used to render plans=[] → false "No plans
    // yet", an Asia/Kolkata timezone fallback that shifts minStartDate for
    // non-IST gyms, and a POST with plan_id: null. Fail loudly with retry
    // instead — same gate as renew-member.js V8-L24.
    el.innerHTML = `${renderHeader({ title: 'Record Payment', showBack: true })}<div class="scroll-view"><div class="scroll-content form-scroll-content">${renderErrorState(settingsRes.error?.message || 'Could not load membership plans.')}</div></div>`;
    bindHeaderEvents(el, { onBack: () => navigate.pop() });
    el.querySelector('#retry-btn')?.addEventListener('click', () => mountRecord(el, params));
    return;
  }
  const plans = settingsRes.data.plans || [];
  const timezone = settingsRes.data.gym?.timezone || 'Asia/Kolkata';
  const today = dateKeyInTimezone(new Date(), timezone);
  if (preId) { const r = await apiRequest(`/api/mobile/v1/members/${preId}`); if (r.ok) selectedMember = r.data; }
  // Draft typed values survive re-render (member pick / "Change") — M24.
  let draft = {};
  const captureDraft = () => {
    if (!el.querySelector('#rp-form')) return;
    draft = {
      plan: el.querySelector('#rp-plan')?.value || '',
      startDate: el.querySelector('#rp-start-date')?.value || '',
      amount: el.querySelector('#rp-amount')?.value || '',
      method: el.querySelector('#rp-method')?.value || '',
      ref: el.querySelector('#rp-ref')?.value || '',
      notes: el.querySelector('#rp-notes')?.value || '',
    };
  };
  const render = () => {
    captureDraft();
    const minStartDate = selectedMember?.membership_end && selectedMember.membership_end >= today
      ? addDays(selectedMember.membership_end, 1)
      : today;
    el.innerHTML = `${renderHeader({ title: 'Record Payment', showBack: true })}<div class="scroll-view"><div class="scroll-content form-scroll-content">
      <form id="rp-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
        ${selectedMember ? `<div class="card card-body" style="display:flex;align-items:center;gap:var(--sp-md)">
          <div style="font-weight:var(--fw-bold);flex:1">${escapeHtml(selectedMember.full_name)}<br><span style="font-size:var(--fs-sm);color:var(--muted)">${escapeHtml(selectedMember.phone)}</span></div>
          <button type="button" class="btn btn-sm btn-secondary" id="rp-change">Change</button></div>` :
          `<div class="form-group"><label class="form-label">Search Member *</label>
            <div class="search-bar"><span class="search-icon">${icon('search',16)}</span><input type="text" placeholder="Search by name or phone..." id="rp-search"></div>
            <div id="rp-results"></div></div>`}
        ${plans.length === 0 ? `<div class="form-hint">No plans yet — create one in Plans to renew with a plan.</div>` : ''}
        ${renderFormField({ id: 'rp-plan', label: 'Plan', value: draft.plan || selectedMember?.plan?.id || '', options: plans.map(p=>({value:p.id,label:`${p.name} — ${p.duration_days}d`})) })}
        ${renderFormField({ id: 'rp-start-date', label: 'Membership start date', type: 'date', value: draft.startDate || minStartDate, required: true, hint: selectedMember?.membership_end && selectedMember.membership_end >= today ? `Next available date: ${formatDate(minStartDate)}. The current paid period stays intact.` : 'Choose the date this renewal should begin.' })}
        <div class="form-hint" id="rp-end-preview" style="margin-top:-var(--sp-md)"></div>
        ${renderFormField({ id: 'rp-amount', label: 'Amount', type: 'number', value: draft.amount || selectedMember?.plan?.price || '', required: true })}
        ${renderFormField({ id: 'rp-method', label: 'Method', value: draft.method || 'cash', options: [{value:'cash',label:'Cash'},{value:'upi',label:'UPI'},{value:'card',label:'Card'},{value:'online',label:'Online'},{value:'other',label:'Other'}], required: true })}
        ${renderFormField({ id: 'rp-ref', label: 'Reference', placeholder: 'Transaction ID (optional)', value: draft.ref || '' })}
        ${renderFormField({ id: 'rp-notes', label: 'Notes', type: 'textarea', placeholder: 'Optional', value: draft.notes || '' })}
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
    const updateEndPreview = () => {
      const selectedPlan = plans.find(p => String(p.id) === el.querySelector('#rp-plan')?.value);
      const startDate = el.querySelector('#rp-start-date').value;
      // V9-L6: no plan selected must not preview a 30-day default — the
      // preview is meaningless without a plan duration.
      if (!selectedPlan) { el.querySelector('#rp-end-preview').textContent = ''; return; }
      const days = selectedPlan.duration_days;
      const endDate = startDate ? addDays(startDate, days - 1) : '';
      el.querySelector('#rp-end-preview').textContent = endDate ? `Membership ends ${formatDate(endDate)} (${days} days).` : '';
    };
    // Only active members get a minimum start date (protects their paid
    // period). Expired members can backdate — e.g. paid Nov 1, recorded
    // Nov 5 — mirroring renew-member.js (V3-M19). The server still rejects
    // a renewal that would already be expired.
    if (selectedMember?.membership_end && selectedMember.membership_end >= today) {
      el.querySelector('#rp-start-date').min = minStartDate;
    }
    el.querySelector('#rp-start-date').addEventListener('change', updateEndPreview);
    el.querySelector('#rp-plan')?.addEventListener('change', updateEndPreview);
    updateEndPreview();
    el.querySelector('#rp-form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!selectedMember) { showToast('Please select a member', 'error'); return; }
      // V9-L6: never POST plan_id: null — without a plan the renewal has
      // no duration and the server would record a plan-less payment.
      const planValue = el.querySelector('#rp-plan').value;
      if (!planValue) { showToast('Please select a membership plan', 'error'); return; }
      const btn = el.querySelector('#rp-submit'); btn.disabled = true;
      const body = { member_id: selectedMember.id, amount: el.querySelector('#rp-amount').value,
        method: el.querySelector('#rp-method').value, plan_id: Number(planValue),
        renewal_start_date: el.querySelector('#rp-start-date').value,
        reference: el.querySelector('#rp-ref').value.trim()||null, notes: el.querySelector('#rp-notes').value.trim()||null };
      const r = await apiRequest('/api/mobile/v1/payments', { method:'POST', body, headers:{'Idempotency-Key': idempotencyKey} });
      if (r.ok) {
        showToast('Payment recorded!','success');
        const waUrl = r.data?.whatsapp_url || r.data?.receipt?.whatsapp_url;
        if (waUrl) {
          const share = await showConfirm({ title: 'Receipt Ready', message: 'Payment recorded successfully! Send the digital receipt via WhatsApp?', confirmText: 'Send Receipt' });
          if (share) window.open(waUrl, '_blank');
        }
        navigate.pop();
      } else {
        showToast(r.error.message,'error');
        btn.disabled=false;
      }
    });
  }; render();
}
