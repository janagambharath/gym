/* Campaign Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton, renderErrorState } from '../components.js';
import { formatDateTime, formatInteger, escapeHtml, SEGMENT_LABELS } from '../utils.js';
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
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${escapeHtml(c.name||'Campaign')}</h2>${renderBadge(c.status||'sent')}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Segment', SEGMENT_LABELS[c.segment]||c.segment||'—')}
      ${renderInfoRow('Recipients', formatInteger(c.recipient_count||0))}
      ${renderInfoRow('Sent', formatInteger(c.sent_count||0))}
      ${renderInfoRow('Delivered', formatInteger(c.delivered_count||0))}
      ${renderInfoRow('Failed', formatInteger(c.failed_count||0))}
      ${renderInfoRow('Created', formatDateTime(c.created_at))}
      ${c.sent_at ? renderInfoRow('Sent At', formatDateTime(c.sent_at)) : ''}
    </div></div>
    ${c.recipients && c.recipients.length ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)" id="cd-recip-note">Showing ${Math.min(20, c.recipients.length)} of ${formatInteger(c.recipient_count || c.recipients.length)} recipients</div>
      <div class="card" id="cd-recips">
      ${c.recipients.slice(0,20).map(r=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${escapeHtml(r.name||r.phone||'')}</div></div>${renderBadge(r.status||'sent')}</div>`).join('')}
      </div>
      ${c.recipients.length > 20 ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="cd-more">Show more</button></div>` : ''}
    </div>` : ''}
  </div>`;
  let shown = 20;
  el.querySelector('#cd-more')?.addEventListener('click', () => {
    shown = Math.min(c.recipients.length, shown + 20);
    el.querySelector('#cd-recips').innerHTML = c.recipients.slice(0, shown).map(r=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${escapeHtml(r.name||r.phone||'')}</div></div>${renderBadge(r.status||'sent')}</div>`).join('');
    el.querySelector('#cd-recip-note').textContent = `Showing ${shown} of ${formatInteger(c.recipient_count || c.recipients.length)} recipients`;
    if (shown >= c.recipients.length) el.querySelector('#cd-more')?.remove();
  });
  }
  await load();
}};
