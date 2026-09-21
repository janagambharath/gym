/* Campaign Detail Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton } from '../components.js';
import { formatDateTime, formatInteger, escapeHtml, SEGMENT_LABELS } from '../utils.js';
export default { async mount(el, params) {
  const cid = params?.campaignId;
  el.innerHTML = `${renderHeader({title:'Campaign',showBack:true})}<div class="scroll-view" id="cd-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest(`/api/mobile/v1/campaigns/${cid}`);
  const scroll = el.querySelector('#cd-scroll');
  if (!res.ok) { scroll.innerHTML = `<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>`; return; }
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
    ${c.recipients && c.recipients.length ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card">
      ${c.recipients.slice(0,20).map(r=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${escapeHtml(r.name||r.phone||'')}</div></div>${renderBadge(r.status||'sent')}</div>`).join('')}
    </div></div>` : ''}
  </div>`;
}};
