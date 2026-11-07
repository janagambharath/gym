/* Subscription Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderInfoRow, renderBadge, renderListSkeleton, renderErrorState } from '../components.js';
import { icon } from '../icons.js'; import { formatDate, formatCurrency, escapeHtml } from '../utils.js';
export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = `${renderHeader({title:'Subscription',showBack:true})}<div class="scroll-view" id="sub-scroll">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const [res, membersRes] = await Promise.all([
    apiRequest('/api/mobile/v1/subscription/status'),
    apiRequest('/api/mobile/v1/members?page=1&page_size=1'),
  ]);
  const scroll = el.querySelector('#sub-scroll');
  // V8-L25: the failure state had no retry and no detail.
  if (!res.ok) { scroll.innerHTML = renderErrorState(res.error?.message || 'Could not load subscription.'); scroll.querySelector('#retry-btn')?.addEventListener('click', () => load(el)); return; }
  const raw = res.data || {};
  // The subscription endpoint carries no member count (L11) — the members
  // list pagination total is the authoritative "members used" figure.
  const membersUsed = membersRes.ok ? membersRes.data.pagination?.total : null;
  // Normalize the subscription/status payload into the screen's shape.
  const s = {
    plan_name: raw.plan_name || raw.plan?.name,
    status: (raw.subscription_status || raw.status || 'active').toLowerCase(),
    current_period_end: raw.renews_at || raw.expires_at,
    member_limit: raw.max_members,
    members_used: raw.members_used ?? membersUsed ?? null,
    amount: raw.plan?.price ? Number(raw.plan.price) : null,
  };
  scroll.innerHTML = `<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${icon('star',28,'var(--brand)')}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${escapeHtml(s.plan_name||s.plan||'Free')}</h3>
      ${renderBadge(s.status||'active')}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Status', s.status||'active')}
      ${s.current_period_end ? renderInfoRow('Next Billing', formatDate(s.current_period_end)) : ''}
      ${s.member_limit ? renderInfoRow('Member Limit', String(s.member_limit)) : ''}
      ${s.members_used != null ? renderInfoRow('Members Used', String(s.members_used)) : ''}
      ${s.amount ? renderInfoRow('Amount', formatCurrency(s.amount)) : ''}
    </div></div>
  </div>`;
}
