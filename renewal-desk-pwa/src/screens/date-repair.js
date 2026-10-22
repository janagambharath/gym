/* Date Repair Screen (owner only) — members whose membership end date
   does not match their plan + payment history. Scan is read-only;
   nothing changes until the owner selects members and taps Apply. */
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast, showConfirm } from '../components.js';
import { escapeHtml } from '../utils.js';

const esc = escapeHtml;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}

const CLASS_LABELS = {
  ledger_mismatch: 'End date changed outside a payment/renewal',
  span_mismatch: 'Span longer than the plan, no renewal history',
  oversized_renewal: 'A renewal applied more days than the plan allows',
};

export default {
  async mount(el) {
    const load = async () => {
      el.innerHTML = `${renderHeader({ title: 'Date Repair', showBack: true })}<div class="scroll-view"><div class="scroll-content"><p style="color:var(--muted)">Scanning member dates…</p></div></div>`;
      bindHeaderEvents(el, { onBack: () => navigate.pop() });

      const res = await apiRequest('/api/mobile/v1/date-repair/scan');
      if (!res.ok) {
        el.innerHTML = `${renderHeader({ title: 'Date Repair', showBack: true })}<div class="scroll-view"><div class="scroll-content"><div class="empty-state"><div class="empty-state-title">Could not run the scan</div><p>${esc(res.error?.message || 'Owner access required.')}</p></div></div></div>`;
        bindHeaderEvents(el, { onBack: () => navigate.pop() });
        return;
      }

      const flagged = res.data.flagged || [];
      el.innerHTML = `
        ${renderHeader({ title: 'Date Repair', showBack: true })}
        <div class="scroll-view"><div class="scroll-content" style="display:flex;flex-direction:column;gap:var(--sp-md)">
          <div class="card card-body">
            <p style="margin:0">Members whose <b>end date</b> doesn't match their plan and payment history. Review each one — nothing changes until you tap Apply.</p>
          </div>
          ${flagged.length === 0 ? `
            <div class="empty-state"><div class="empty-state-title">All dates look correct</div><p>No members need repair right now.</p></div>
          ` : `
            <p style="margin:0;color:var(--muted)">${flagged.length} member${flagged.length === 1 ? '' : 's'} flagged</p>
            ${flagged.map(f => `
              <label class="card card-body" style="display:flex;gap:var(--sp-md);cursor:pointer">
                <input type="checkbox" class="dr-check" value="${f.member_id}" ${f.confidence === 'high' ? 'checked' : ''} style="width:22px;height:22px;flex-shrink:0;margin-top:2px">
                <span style="flex:1;min-width:0">
                  <b>${esc(f.full_name)}</b> <span style="color:var(--muted)">· ${esc(f.plan_name)} (${f.plan_duration_days}d)</span><br>
                  <span>Now: ${fmtDate(f.membership_start)} → <b>${fmtDate(f.membership_end)}</b> (${f.span_days} days)</span><br>
                  <span>Should be: → <b>${fmtDate(f.proposed_end)}</b></span><br>
                  <span style="color:var(--muted);font-size:var(--fs-sm)">${esc(CLASS_LABELS[f.classification] || f.classification)}. ${esc(f.reason)}</span><br>
                  <span style="color:var(--muted);font-size:var(--fs-sm)">Verified payments: ${f.verified_payments} (₹${Number(f.verified_paid_total || 0).toLocaleString('en-IN')}) · Renewals on record: ${f.ledger_periods}${f.freeze_events ? ` · Freezes: ${f.freeze_events} — verify before applying` : ''}</span>
                </span>
              </label>
            `).join('')}
            <button class="btn btn-primary btn-lg btn-full" id="dr-apply">Apply Selected Repairs</button>
          `}
        </div></div>`;
      bindHeaderEvents(el, { onBack: () => navigate.pop() });

      el.querySelector('#dr-apply')?.addEventListener('click', async () => {
        const ids = [...el.querySelectorAll('.dr-check:checked')].map(c => Number(c.value));
        if (!ids.length) { showToast('Select at least one member', 'error'); return; }
        const ok = await showConfirm({
          title: 'Apply date repairs?',
          message: `This will change the membership end date for ${ids.length} member${ids.length === 1 ? '' : 's'} to the corrected values shown. Payments and history are not changed.`,
          confirmText: 'Apply',
        });
        if (!ok) return;
        const btn = el.querySelector('#dr-apply');
        btn.disabled = true; btn.textContent = 'Applying…';
        const r = await apiRequest('/api/mobile/v1/date-repair/apply', { method: 'POST', body: { member_ids: ids } });
        if (r.ok) {
          const applied = (r.data.results || []).filter(x => x.applied).length;
          showToast(`Repaired ${applied} member${applied === 1 ? '' : 's'}`, 'success');
          load();
        } else {
          showToast(r.error.message, 'error');
          btn.disabled = false; btn.textContent = 'Apply Selected Repairs';
        }
      });
    };
    await load();
  }
};
