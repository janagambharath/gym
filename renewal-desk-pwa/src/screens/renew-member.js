/* Renew Member Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderAvatar, renderBadge, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatCurrency, formatDate, uuid, getMemberDisplayStatus } from '../utils.js';

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

function parseMemberParam(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function addDays(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export default { async mount(el, params) {
  try {
    await mountRenew(el, params);
  } catch (err) {
    console.error('[renew-member] mount failed', err);
    el.innerHTML = `<div class="empty-state"><div class="empty-state-title">Renew couldn't open</div><div class="empty-state-text">${escapeHtml(err?.message || 'Something went wrong. Go back and try again.')}</div></div>`;
  }
} };

async function mountRenew(el, params) {
    const idempotencyKey = uuid(); // one key per form mount, reused across retries
  let member = parseMemberParam(params?.member);
  if (!member && params?.memberId) {
    const res = await apiRequest(`/api/mobile/v1/members/${params.memberId}`);
    if (res.ok) member = res.data;
  }
  if (!member) { el.innerHTML = '<div class="empty-state"><div class="empty-state-title">No member selected</div><div class="empty-state-text">Go back to the member list and tap Renew again.</div></div>'; return; }
  const settingsRes = await apiRequest('/api/mobile/v1/settings');
  const plans = settingsRes.ok ? settingsRes.data.plans || [] : [];
  if (plans.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-title">No membership plans yet</div><div class="empty-state-text">Create a plan first, then renew this member.</div><button class="btn btn-primary" id="rn-create-plan">Create a plan</button></div>`;
    el.querySelector('#rn-create-plan')?.addEventListener('click', () => navigate.push('plans'));
    return;
  }
  const timezone = settingsRes.ok ? settingsRes.data.gym?.timezone || 'Asia/Kolkata' : 'Asia/Kolkata';
  const today = dateKeyInTimezone(new Date(), timezone);
  const minStartDate = member.membership_end && member.membership_end >= today
    ? addDays(member.membership_end, 1)
    : today;
  const defaultStartDate = minStartDate;
  const status = getMemberDisplayStatus(member);
  el.innerHTML = `${renderHeader({ title: 'Renew Membership', showBack: true })}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <div class="card card-body" style="margin-bottom:var(--sp-xl);display:flex;align-items:center;gap:var(--sp-md)">
      ${renderAvatar(member.full_name)} <div><div style="font-weight:var(--fw-bold)">${escapeHtml(member.full_name)}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${escapeHtml(member.phone)}</div></div>
      <div style="margin-left:auto">${renderBadge(status)}</div></div>
    <form id="renew-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({ id: 'rn-plan', label: 'Plan', value: member.plan?.id || '', options: plans.map(p => ({value:p.id,label:`${p.name} — ${formatCurrency(p.price)} / ${p.duration_days}d`})), required: true })}
      ${renderFormField({ id: 'rn-start-date', label: 'Membership start date', type: 'date', value: defaultStartDate, required: true, hint: member.membership_end && member.membership_end >= today ? `Next available date: ${formatDate(minStartDate)}. This protects the member's current paid period.` : 'Choose the date this renewal should begin.' })}
      <div class="form-hint" id="rn-end-preview" style="margin-top:-var(--sp-md)"></div>
      ${renderFormField({ id: 'rn-amount', label: 'Amount', type: 'number', value: member.plan?.price || '', required: true })}
      ${renderFormField({ id: 'rn-method', label: 'Payment Method', value: 'cash', options: [{value:'cash',label:'Cash'},{value:'upi',label:'UPI'},{value:'card',label:'Card'},{value:'online',label:'Online'},{value:'other',label:'Other'}], required: true })}
      ${renderFormField({ id: 'rn-ref', label: 'Reference / Transaction ID', placeholder: 'Optional' })}
      ${renderFormField({ id: 'rn-notes', label: 'Notes', type: 'textarea', placeholder: 'Optional' })}
      <button type="submit" class="btn btn-primary btn-lg btn-full" id="rn-submit">${icon('renewals', 18, 'white')} Renew & Record Payment</button>
    </form></div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  // Auto-fill amount on plan change
  const updateEndPreview = () => {
    const selectedPlan = plans.find(p => String(p.id) === el.querySelector('#rn-plan').value);
    const startDate = el.querySelector('#rn-start-date').value;
    const endDate = startDate && selectedPlan ? addDays(startDate, selectedPlan.duration_days - 1) : '';
    el.querySelector('#rn-end-preview').textContent = endDate ? `Membership ends ${formatDate(endDate)} (${selectedPlan.duration_days} days).` : '';
  };
  // Only active members get a minimum start date (protects their paid period).
  // Expired members can backdate — e.g. paid Nov 1, recorded Nov 5. The server
  // still rejects a renewal that would already be expired.
  if (member.membership_end && member.membership_end >= today) {
    el.querySelector('#rn-start-date').min = minStartDate;
  }
  el.querySelector('#rn-start-date').addEventListener('change', updateEndPreview);
  updateEndPreview();
  el.querySelector('#rn-plan').addEventListener('change', (e) => {
    const plan = plans.find(p => String(p.id) === e.target.value);
    if (plan) el.querySelector('#rn-amount').value = plan.price;
    updateEndPreview();
  });
  el.querySelector('#renew-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#rn-submit'); btn.disabled = true; btn.textContent = 'Processing...';
    const paymentMethod = el.querySelector('#rn-method').value;
    const body = { member_id: member.id, plan_id: Number(el.querySelector('#rn-plan').value),
      amount: el.querySelector('#rn-amount').value, method: paymentMethod,
      channel: paymentMethod === 'online' ? 'online' : 'offline',
      auto_verify: paymentMethod !== 'online',
      renewal_start_date: el.querySelector('#rn-start-date').value,
      reference: el.querySelector('#rn-ref').value.trim() || null, notes: el.querySelector('#rn-notes').value.trim() || null };
    const res = await apiRequest('/api/mobile/v1/payments', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
    if (res.ok) {
      showToast(paymentMethod === 'online' ? 'Online renewal payment requested.' : 'Payment verified and renewal recorded.', 'success');
      navigate.pop();
    }
    else { showToast(res.error.message, 'error'); btn.disabled = false; btn.textContent = 'Renew & Record Payment'; }
  });
}
