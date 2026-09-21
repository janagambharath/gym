/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Add Member Screen
   Parity with Android AddMemberScreen.tsx
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest, getCachedSession } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatCurrency, formatDate, getGymTodayISO } from '../utils.js';

/** Map gym timezone to a phone country prefix */
function getCountryPrefix(timezone) {
  if (!timezone) return '+91';
  const tz = timezone.toLowerCase();
  if (tz.startsWith('asia/kolkata') || tz.startsWith('asia/calcutta') || tz === 'ist') return '+91';
  if (tz.startsWith('america/')) return '+1';
  if (tz.startsWith('europe/london')) return '+44';
  if (tz.startsWith('asia/dubai')) return '+971';
  if (tz.startsWith('asia/singapore')) return '+65';
  return '+91';
}

function calculateEndDate(startDateStr, durationDays) {
  if (!startDateStr) return '';
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return '';
  const duration = Number(durationDays) || 30;
  const end = new Date(start.getTime() + duration * 86400000);
  return end.toISOString().split('T')[0];
}

export default {
  async mount(el) {
    const session = getCachedSession();
    const countryPrefix = getCountryPrefix(session?.gymTimezone);

    // Fetch active plans
    let plans = [];
    try {
      const settingsRes = await apiRequest('/api/mobile/v1/settings');
      if (settingsRes.ok && settingsRes.data?.plans) {
        plans = settingsRes.data.plans;
      }
    } catch (e) {
      console.error('Failed to load plans:', e);
    }

    let selectedPlanId = plans.length > 0 ? plans[0].id : null;
    let today = getGymTodayISO();
    let initialEndDate = calculateEndDate(today, plans.find(p => p.id === selectedPlanId)?.duration_days || 30);

    el.innerHTML = `
      ${renderHeader({ title: 'Add Member', showBack: true })}
      <div class="scroll-view">
        <div class="scroll-content" style="padding:var(--sp-lg);gap:var(--sp-lg);display:flex;flex-direction:column;max-width:640px;margin:0 auto;width:100%">

          <!-- Error Alert Banner -->
          <div id="am-error-banner" class="form-error-banner" style="display:none">
            <span style="flex-shrink:0">${icon('alert', 18, 'var(--critical)')}</span>
            <span id="am-error-message" style="flex:1"></span>
          </div>

          <form id="am-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">

            <!-- Member Information Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('person', 20, 'var(--brand)')}
                <span>Member Information</span>
              </div>
              <div class="form-section-sub">Basic contact details for the member</div>

              <div class="form-group" style="margin-top:var(--sp-xs)">
                <label class="form-label" for="am-fullname">Full Name *</label>
                <input class="form-input" id="am-fullname" type="text" placeholder="e.g. Rahul Sharma" autocomplete="off" required>
                <span class="field-error-text" id="am-fullname-error">Name is required.</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="am-phone">Phone Number *</label>
                <input class="form-input" id="am-phone" type="tel" value="${countryPrefix} " placeholder="${countryPrefix} 9876543210" autocomplete="off" required>
                <span class="field-error-text" id="am-phone-error">Phone number is required (min 10 digits).</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="am-email">Email Address <span style="font-weight:normal;color:var(--text-secondary)">(optional)</span></label>
                <input class="form-input" id="am-email" type="email" placeholder="e.g. rahul@example.com" autocomplete="off">
              </div>

              <div class="form-group">
                <label class="form-label" for="am-gender">Gender <span style="font-weight:normal;color:var(--text-secondary)">(optional)</span></label>
                <select class="form-input" id="am-gender">
                  <option value="">Select gender...</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <!-- Membership Plan Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('star', 20, 'var(--brand)')}
                <span>Membership Plan</span>
              </div>
              <div class="form-section-sub">Select duration and plan terms</div>

              ${plans.length > 0 ? `
                <div class="plan-selector-grid" id="am-plan-grid">
                  ${plans.map(p => `
                    <div class="plan-selector-card ${p.id === selectedPlanId ? 'selected' : ''}" data-plan-id="${p.id}" data-duration="${p.duration_days}">
                      <div class="plan-card-check">${icon('check', 16)}</div>
                      <div class="plan-card-name">${escapeHtml(p.name)}</div>
                      <div class="plan-card-meta">${p.duration_days} Days</div>
                      <div class="plan-card-price">${formatCurrency(p.price)}</div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="font-size:var(--fs-sm);color:var(--text-secondary);padding:var(--sp-sm) 0">
                  No plans configured. You can still set start date.
                </div>
              `}

              <div class="form-group" style="margin-top:var(--sp-sm)">
                <label class="form-label" for="am-start">Start Date</label>
                <input class="form-input" id="am-start" type="date" value="${today}">
              </div>

              <!-- Calculated Expiry Box -->
              <div class="calculated-expiry-box" id="am-expiry-preview">
                <span style="flex-shrink:0">${icon('calendar', 18, 'var(--brand)')}</span>
                <span id="am-expiry-text">
                  Expires on: <strong>${formatDate(initialEndDate)}</strong> (${plans.find(p => p.id === selectedPlanId)?.duration_days || 30} days)
                </span>
              </div>
            </div>

            <!-- Notes Card -->
            <div class="form-section-card">
              <div class="form-section-title">
                ${icon('edit', 20, 'var(--brand)')}
                <span>Additional Notes</span>
              </div>
              <div class="form-group" style="margin-top:var(--sp-xs)">
                <textarea class="form-input" id="am-notes" rows="3" placeholder="Fitness goals, medical conditions, referrals, etc. (optional)"></textarea>
              </div>
            </div>

            <!-- Submit Button -->
            <button type="submit" class="btn btn-primary btn-lg btn-full" id="am-submit" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm);margin-top:var(--sp-sm);height:50px;font-size:var(--fs-base)">
              ${icon('personAdd', 20, 'white')}
              <span id="am-btn-label">Add Member</span>
            </button>

          </form>
        </div>
      </div>
    `;

    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    // Handle Plan Selection Click
    const planGrid = el.querySelector('#am-plan-grid');
    const updateExpiryPreview = () => {
      const selectedPlan = plans.find(p => p.id === selectedPlanId);
      const duration = selectedPlan ? selectedPlan.duration_days : 30;
      const startDate = el.querySelector('#am-start').value || today;
      const calculatedEnd = calculateEndDate(startDate, duration);
      const textEl = el.querySelector('#am-expiry-text');
      if (textEl) {
        textEl.innerHTML = `Expires on: <strong>${formatDate(calculatedEnd)}</strong> (${duration} days)`;
      }
      return calculatedEnd;
    };

    if (planGrid) {
      planGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.plan-selector-card');
        if (!card) return;
        planGrid.querySelectorAll('.plan-selector-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPlanId = Number(card.dataset.planId);
        updateExpiryPreview();
      });
    }

    el.querySelector('#am-start').addEventListener('change', updateExpiryPreview);

    // Live validation clears
    const fullNameInput = el.querySelector('#am-fullname');
    const phoneInput = el.querySelector('#am-phone');
    const nameError = el.querySelector('#am-fullname-error');
    const phoneError = el.querySelector('#am-phone-error');
    const errorBanner = el.querySelector('#am-error-banner');
    const errorMessage = el.querySelector('#am-error-message');

    fullNameInput.addEventListener('input', () => {
      nameError.classList.remove('visible');
      errorBanner.style.display = 'none';
    });

    phoneInput.addEventListener('input', () => {
      phoneError.classList.remove('visible');
      errorBanner.style.display = 'none';
    });

    // Form Submission
    el.querySelector('#am-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const fullName = fullNameInput.value.trim();
      const rawPhone = phoneInput.value.trim();
      const email = el.querySelector('#am-email').value.trim();
      const gender = el.querySelector('#am-gender').value;
      const startDate = el.querySelector('#am-start').value || today;
      const notes = el.querySelector('#am-notes').value.trim();

      let hasError = false;
      if (!fullName) {
        nameError.classList.add('visible');
        hasError = true;
      }

      const cleanDigits = rawPhone.replace(/\D/g, '');
      if (!rawPhone || cleanDigits.length < 10) {
        phoneError.classList.add('visible');
        hasError = true;
      }

      if (hasError) return;

      const submitBtn = el.querySelector('#am-submit');
      const btnLabel = el.querySelector('#am-btn-label');
      submitBtn.disabled = true;
      btnLabel.textContent = 'Adding Member...';
      errorBanner.style.display = 'none';

      // Phone normalization matching Android & backend helper
      const normalizedPhone = rawPhone.startsWith('+')
        ? rawPhone
        : (cleanDigits.length === 10 ? `${countryPrefix}${cleanDigits}` : `+${cleanDigits}`);

      const selectedPlan = plans.find(p => p.id === selectedPlanId);
      const duration = selectedPlan ? selectedPlan.duration_days : 30;
      const endDate = calculateEndDate(startDate, duration);

      const body = {
        full_name: fullName,
        name: fullName, // backward compatibility
        phone: normalizedPhone,
        email: email || null,
        gender: gender || null,
        plan_id: selectedPlanId ? Number(selectedPlanId) : null,
        membership_start: startDate,
        membership_end: endDate,
        notes: notes || null,
      };

      try {
        const res = await apiRequest('/api/mobile/v1/members', { method: 'POST', body });
        if (res.ok) {
          showToast('Member added successfully!', 'success');
          // Navigate to member detail
          navigate.replace('member-detail', { member: JSON.stringify(res.data) });
        } else {
          if (res.error?.status === 401) {
            handleLogout();
            return;
          }
          const msg = res.error?.message || 'Failed to add member. Please try again.';
          errorMessage.textContent = msg;
          errorBanner.style.display = 'flex';
          showToast(msg, 'error');
          submitBtn.disabled = false;
          btnLabel.textContent = 'Add Member';
        }
      } catch (err) {
        errorMessage.textContent = err.message || 'An unexpected network error occurred.';
        errorBanner.style.display = 'flex';
        showToast('Network error', 'error');
        submitBtn.disabled = false;
        btnLabel.textContent = 'Add Member';
      }
    });
  }
};
