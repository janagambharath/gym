/* Campaign Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton, renderErrorState, showToast } from '../components.js';
import { formatDateTime, formatInteger, formatCurrency, escapeHtml, SEGMENT_LABELS } from '../utils.js';
export default { async mount(el, params) {
  const cid = params?.campaignId;
  el.innerHTML = `${renderHeader({title:'Campaign',showBack:true})}<div class="scroll-view" id="cd-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  async function load() {
  const scroll = el.querySelector('#cd-scroll');
  if (scroll) scroll.innerHTML = renderListSkeleton();
  const res = await apiRequest(`/api/mobile/v1/campaigns/${cid}`);
  if (!res.ok) {
    if (res.error?.status === 404) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>`; }
    else { scroll.innerHTML = renderErrorState(res.error?.message || 'Failed to load'); scroll.querySelector('#retry-btn')?.addEventListener('click', load); }
    return;
  }
  const c = res.data;
  // V11-H5: the backend serializer (_serialize_campaign /
  // get_campaign_results) returns ONLY total_* keys + segment_type —
  // the old recipient_count/sent_count/delivered_count/failed_count/
  // segment/recipients keys never exist, so every campaign rendered
  // "0 recipients / 0 sent, segment —". Read the real keys, surface the
  // attribution the backend already computes (total_renewed /
  // total_revenue_recovered), and drop the recipient-list UI (no
  // recipients array is ever sent with this payload).
  const isSendable = c.status === 'draft' || c.status === 'failed';
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${escapeHtml(c.name||'Campaign')}</h2>${renderBadge(c.status||'sent')}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Segment', SEGMENT_LABELS[c.segment_type]||c.segment_type||'—')}
      ${renderInfoRow('Recipients', formatInteger(c.total_recipients ?? 0))}
      ${renderInfoRow('Sent', formatInteger(c.total_sent ?? 0))}
      ${renderInfoRow('Delivered', formatInteger(c.total_delivered ?? 0))}
      ${renderInfoRow('Read', formatInteger(c.total_read ?? 0))}
      ${renderInfoRow('Replied', formatInteger(c.total_replied ?? 0))}
      ${renderInfoRow('Renewals attributed', formatInteger(c.total_renewed ?? 0))}
      ${renderInfoRow('Revenue recovered', formatCurrency(c.total_revenue_recovered ?? '0'))}
      ${renderInfoRow('Created', formatDateTime(c.created_at))}
      ${c.sent_at ? renderInfoRow('Sent At', formatDateTime(c.sent_at)) : ''}
      ${c.error_message ? renderInfoRow('Error', c.error_message) : ''}
    </div></div>
    ${isSendable ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)"><button class="btn btn-whatsapp btn-lg btn-full" id="cd-send">Send Campaign</button></div>` : ''}
  </div>`;
  el.querySelector('#cd-send')?.addEventListener('click', async () => {
    // V11-C1: a draft/failed campaign needs a send path — this is the
    // retry for a create-then-send that failed at the send step (same
    // endpoint Android's retrySend calls; the backend replays a
    // successful send instead of double-messaging).
    const btn = el.querySelector('#cd-send');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    const sendRes = await apiRequest(`/api/mobile/v1/campaigns/${cid}/send`, { method: 'POST' });
    if (sendRes.ok) {
      const sent = sendRes.data?.sent, total = sendRes.data?.total, failed = sendRes.data?.failed;
      showToast(
        (typeof sent === 'number' && typeof total === 'number')
          ? `Campaign launched! Sent to ${formatInteger(sent)} of ${formatInteger(total)} members${failed > 0 ? ` (${formatInteger(failed)} failed)` : ''}.`
          : 'Campaign launched!',
        'success');
      await load();
    } else {
      showToast(sendRes.error?.message || 'Could not send this campaign.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Send Campaign'; }
    }
  });
  }
  await load();
}};
