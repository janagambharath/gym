/* Payment Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js'; import { formatCurrency, formatDate, formatDateTime, escapeHtml } from '../utils.js';
export default { async mount(el, params) {
  const paymentId = params?.paymentId;
  const res = await apiRequest(`/api/mobile/v1/payments/${paymentId}`);
  if (!res.ok) { el.innerHTML = `${renderHeader({title:'Payment',showBack:true})}<div class="empty-state"><div class="empty-state-title">Payment not found</div></div>`; bindHeaderEvents(el,{onBack:()=>navigate.pop()}); return; }
  const p = res.data;
  el.innerHTML = `${renderHeader({ title: 'Payment Detail', showBack: true })}
    <div class="scroll-view"><div class="scroll-content">
      <div style="text-align:center;padding:var(--sp-xxl);background:var(--card);border-bottom:1px solid var(--border-light)">
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold);margin-bottom:var(--sp-sm)">${formatCurrency(p.amount)}</div>
        ${renderBadge(p.status)}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        ${renderInfoRow('Member', p.member_name || '—')}
        ${renderInfoRow('Plan', p.plan_name || '—')}
        ${p.standard_price ? renderInfoRow('Standard Price', formatCurrency(p.standard_price)) : ''}
        ${p.discount && p.discount !== '0' && p.discount !== '0.00' ? renderInfoRow('Discount', formatCurrency(p.discount)) : ''}
        ${renderInfoRow('Method', p.method)}
        ${p.channel ? renderInfoRow('Channel', p.channel) : ''}
        ${renderInfoRow('Reference', p.reference || '—')}
        ${renderInfoRow('Date', formatDate(p.paid_on || p.created_at))}
        ${p.notes ? renderInfoRow('Notes', p.notes) : ''}
        ${p.created_by ? renderInfoRow('Created By', p.created_by) : ''}
        ${p.verified_by ? renderInfoRow('Verified By', p.verified_by) : ''}
        ${p.verified_at ? renderInfoRow('Verified At', formatDateTime(p.verified_at)) : ''}
      </div></div>
      <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
        ${p.status === 'pending' ? `<button class="btn btn-success btn-full" id="pd-verify">${icon('check',18,'white')} Verify Payment</button>
        <button class="btn btn-danger btn-full" id="pd-reject">${icon('close',18,'white')} Reject Payment</button>` : ''}
        <button class="btn btn-secondary btn-full btn-sm" id="pd-delete" style="margin-top:var(--sp-md)">${icon('delete',16)} Delete Payment</button>
      </div>
    </div></div>`;
  bindHeaderEvents(el, { onBack: () => navigate.pop() });
  el.querySelector('#pd-verify')?.addEventListener('click', async () => {
    const r = await apiRequest(`/api/mobile/v1/payments/${paymentId}/verify`, { method:'POST' });
    if (r.ok) { showToast('Payment verified!','success'); navigate.pop(); } else showToast(r.error.message,'error');
  });
  el.querySelector('#pd-reject')?.addEventListener('click', async () => {
    const yes = await showConfirm({ title:'Reject Payment', message:'This will reject the payment.', confirmText:'Reject', destructive:true });
    if (!yes) return;
    const r = await apiRequest(`/api/mobile/v1/payments/${paymentId}/reject`, { method:'POST' });
    if (r.ok) { showToast('Payment rejected','success'); navigate.pop(); } else showToast(r.error.message,'error');
  });
  el.querySelector('#pd-delete')?.addEventListener('click', async () => {
    const yes = await showConfirm({ title:'Delete Payment', message:'This cannot be undone.', confirmText:'Delete', destructive:true });
    if (!yes) return;
    const r = await apiRequest(`/api/mobile/v1/payments/${paymentId}`, { method:'DELETE' });
    if (r.ok) { showToast('Payment deleted','success'); navigate.pop(); } else showToast(r.error.message,'error');
  });
}};
