/* Gym Profile Screen — edit gym name, contact, address, timezone */
import { apiRequest, refreshSessionFromSettings } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, renderErrorState, showToast } from '../components.js';
import { escapeHtml, isValidTimezone } from '../utils.js';

// V10-M5: the timezone was a free-text input with no validation — the
// invalid stored value 'india' (Yodha) got in through a path like this.
// A <select> of real IANA zones makes a bad value untypeable; the submit
// still validates with isValidTimezone() as defence in depth.
const TIMEZONE_OPTIONS = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka',
  'Asia/Karachi', 'Asia/Colombo', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'Europe/London', 'Europe/Paris',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
];
export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = `${renderHeader({title:'Gym Profile',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content" id="gp-form-wrap"><div style="padding:var(--sp-lg)">Loading…</div></div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const wrap = el.querySelector('#gp-form-wrap');
  const res = await apiRequest('/api/mobile/v1/settings');
  if (!res.ok) {
    // V8-M10: a failed load used to render a blank form — Save then cleared
    // email/phone/address and forced the timezone to Asia/Kolkata.
    // Never render the form (or its Save button) until the load succeeds.
    wrap.innerHTML = renderErrorState(res.error?.message || 'Could not load the gym profile.');
    wrap.querySelector('#retry-btn')?.addEventListener('click', () => load(el));
    return;
  }
  // The settings endpoint returns { gym, plans, payment_settings } — the
  // gym's own fields live under data.gym, not data.settings. Reading the
  // wrong level rendered a blank form and Save then wiped the gym's
  // contact fields with nulls (Yodha, 2026-11-07). Never render the form
  // without the gym object.
  const s = res.data && res.data.gym;
  if (!s) {
    wrap.innerHTML = renderErrorState('Could not load the gym profile.');
    wrap.querySelector('#retry-btn')?.addEventListener('click', () => load(el));
    return;
  }
  const currentTz = s.timezone || 'Asia/Kolkata';
  const tzOptions = TIMEZONE_OPTIONS.map(tz => ({ value: tz, label: tz }));
  if (!TIMEZONE_OPTIONS.includes(currentTz)) {
    // Keep the gym's stored value visible (labelled as-is) even when it
    // is not a known zone — the owner can see what is stored and pick a
    // valid replacement; submit refuses to save an invalid value.
    tzOptions.push({ value: currentTz, label: `${currentTz} (current)` });
  }
  wrap.innerHTML = `
    <form id="gp-form" style="display:flex;flex-direction:column;gap:var(--sp-md);padding:var(--sp-lg)">
      ${renderFormField({id:'gp-name',label:'Gym Name',value:s.name||'',required:true})}
      ${renderFormField({id:'gp-email',label:'Email',type:'email',value:s.email||''})}
      ${renderFormField({id:'gp-phone',label:'Phone',type:'tel',value:s.phone||''})}
      ${renderFormField({id:'gp-address',label:'Address',type:'textarea',value:s.address||''})}
      ${renderFormField({id:'gp-timezone',label:'Timezone',value:currentTz,options:tzOptions})}
      ${!isValidTimezone(currentTz) ? `<div style="font-size:var(--fs-sm);color:var(--warning)">The stored timezone “${escapeHtml(currentTz)}” is not a valid timezone — pick a valid one above before saving.</div>` : ''}
      <button type="submit" class="btn btn-primary btn-lg btn-full" id="gp-save">Save Changes</button>
    </form>`;
  el.querySelector('#gp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#gp-save'); btn.disabled = true; btn.textContent = 'Saving…';
    const timezone = el.querySelector('#gp-timezone').value.trim() || 'Asia/Kolkata';
    if (!isValidTimezone(timezone)) {
      // V10-M5: refuse + name the bad value instead of saving it and
      // silently breaking every gym-time display again.
      showToast(`“${timezone}” is not a valid timezone — pick one from the list.`, 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
      return;
    }
    const body = {
      name: el.querySelector('#gp-name').value.trim(),
      email: el.querySelector('#gp-email').value.trim(),
      phone: el.querySelector('#gp-phone').value.trim(),
      address: el.querySelector('#gp-address').value.trim(),
      timezone,
    };
    if (!body.name) { showToast('Gym name is required','error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }
    const r = await apiRequest('/api/mobile/v1/settings', { method:'PATCH', body });
    btn.disabled = false; btn.textContent = 'Save Changes';
    if (r.ok) {
      // V12-P3: the PATCH returns no gym object, so re-read /settings
      // into the cached session — otherwise the new name/timezone stays
      // invisible on every screen until the next sign-in. A failed
      // refresh never blocks the success toast: the save itself worked.
      await refreshSessionFromSettings();
      showToast('Gym profile updated','success'); navigate.pop();
    }
    else showToast(r.error?.message||'Could not save','error');
  });
}
