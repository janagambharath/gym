/* Add Member Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast } from '../components.js';
import { formatCurrency, getGymTodayISO } from '../utils.js';

export default {
  async mount(el) {
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const plans = settingsRes.ok ? (settingsRes.data.plans || []) : [];
    const defaultPlan = plans[0];

    el.innerHTML = `
      ${renderHeader({ title: 'Add Member', showBack: true })}
      <div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
        <form id="add-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
          ${renderFormField({ id: 'am-name', label: 'Full Name', placeholder: 'Member name', required: true })}
          ${renderFormField({ id: 'am-phone', label: 'Phone', type: 'tel', placeholder: '9876543210', required: true })}
          ${renderFormField({ id: 'am-email', label: 'Email', type: 'email', placeholder: 'member@example.com' })}
          ${renderFormField({ id: 'am-gender', label: 'Gender', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }] })}
          ${renderFormField({ id: 'am-address', label: 'Address', type: 'textarea', placeholder: 'Member address...' })}
          ${renderFormField({ id: 'am-plan', label: 'Membership Plan', options: plans.map(p => ({ value: p.id, label: `${p.name} — ${p.duration_days} days (${formatCurrency(p.price)})` })) })}
          ${renderFormField({ id: 'am-amount', label: 'Membership Fee (Customizable Money)', type: 'number', step: '0.01', placeholder: '0.00', value: defaultPlan?.price || '' })}
          ${renderFormField({ id: 'am-paid', label: 'Payment Status', options: [{ value: 'paid', label: 'Paid Now' }, { value: 'unpaid', label: 'Collect Later (Unpaid)' }] })}
          ${renderFormField({ id: 'am-method', label: 'Payment Method', options: [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'other', label: 'Other' }] })}
          ${renderFormField({ id: 'am-start', label: 'Start Date', type: 'date', value: getGymTodayISO() })}
          ${renderFormField({ id: 'am-notes', label: 'Notes', type: 'textarea', placeholder: 'Any notes...' })}
          <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit">Add Member</button>
        </form>
      </div></div>`;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    const planSelect = el.querySelector('#am-plan');
    const amountInput = el.querySelector('#am-amount');
    const paidSelect = el.querySelector('#am-paid');
    const methodGroup = el.querySelector('#am-method')?.closest('.form-group');

    if (planSelect && amountInput) {
      planSelect.addEventListener('change', () => {
        const pid = Number(planSelect.value);
        const match = plans.find(p => p.id === pid);
        if (match && match.price) {
          amountInput.value = match.price;
        }
      });
    }

    if (paidSelect && methodGroup) {
      paidSelect.addEventListener('change', () => {
        methodGroup.style.display = paidSelect.value === 'paid' ? 'block' : 'none';
      });
    }

    el.querySelector('#add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('#am-submit');

      const name = el.querySelector('#am-name').value.trim();
      const rawPhone = el.querySelector('#am-phone').value.trim();

      if (!name) {
        showToast('Please enter member name', 'error');
        el.querySelector('#am-name').focus();
        return;
      }

      const cleanDigits = rawPhone.replace(/\D/g, '');
      if (!rawPhone || cleanDigits.length < 10) {
        showToast('Please enter a valid phone number (at least 10 digits)', 'error');
        el.querySelector('#am-phone').focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Adding...';

      const phone = rawPhone.startsWith('+')
        ? rawPhone
        : (cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`);

      const planId = el.querySelector('#am-plan')?.value ? Number(el.querySelector('#am-plan').value) : null;
      const customAmount = el.querySelector('#am-amount')?.value?.trim();
      const isPaid = el.querySelector('#am-paid')?.value !== 'unpaid';
      const paymentMethod = el.querySelector('#am-method')?.value || 'cash';
      const startDate = el.querySelector('#am-start')?.value || getGymTodayISO();
      let endDate = startDate;
      if (planId) {
        const plan = plans.find(p => p.id === planId);
        if (plan?.duration_days) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + Number(plan.duration_days));
          endDate = d.toISOString().slice(0, 10);
        }
      }

      const body = {
        full_name: name,
        name: name,
        phone,
        email: el.querySelector('#am-email')?.value?.trim() || null,
        gender: el.querySelector('#am-gender')?.value || null,
        plan_id: planId,
        membership_start: startDate,
        membership_end: endDate,
        amount: customAmount || undefined,
        paid: isPaid,
        payment_method: isPaid ? paymentMethod : undefined,
        notes: el.querySelector('#am-notes')?.value?.trim() || null,
        address: el.querySelector('#am-address')?.value?.trim() || null,
      };

      try {
        const res = await apiRequest('/api/mobile/v1/members', { method: 'POST', body });
        if (res.ok) {
          showToast('Member added!', 'success');
          navigate.replace('member-detail', { member: JSON.stringify(res.data) });
        } else {
          if (res.error?.status === 401) {
            handleLogout();
            return;
          }
          showToast(res.error?.message || 'Failed to add member', 'error');
          btn.disabled = false;
          btn.textContent = 'Add Member';
        }
      } catch (err) {
        showToast(err.message || 'Network error', 'error');
        btn.disabled = false;
        btn.textContent = 'Add Member';
      }
    });
  }
};
