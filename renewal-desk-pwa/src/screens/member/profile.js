/* Member Profile Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderInfoRow, renderListSkeleton } from '../../components.js';
import { escapeHtml, formatDate } from '../../utils.js';
import { attachLiveRefresh } from '../../live-refresh.js';
export default { async mount(el) {
  await load(el);
  attachLiveRefresh(el, () => load(el, true));
} };
async function load(el, background = false) {
  if (!background) el.innerHTML = `${renderHeader({title:'My Profile',showBack:true})}<div class="scroll-view" id="mpr-scroll">${renderListSkeleton()}</div>`;
  if (!background) bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  const res = await apiRequest('/api/member/v1/profile');
  if (el.dataset.screenDisposed === 'true' || (background && !res.ok)) return;
  const scroll = el.querySelector('#mpr-scroll');
  const d = res.ok ? res.data.member || res.data : {};
  scroll.innerHTML = `<div class="scroll-content">
    <div style="text-align:center;padding:var(--sp-xxl);background:var(--card)">
      <div style="display:inline-flex">${renderAvatar(d.full_name||'', 'xl')}</div>
      <h2 style="margin-top:var(--sp-md)">${escapeHtml(d.full_name||'—')}</h2>
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${renderInfoRow('Phone', d.phone||'—')}
      ${renderInfoRow('Email', d.email||'—')}
      ${renderInfoRow('Gender', d.gender||'—')}
      ${renderInfoRow('Member Since', formatDate(d.joined_on||d.created_at))}
    </div></div>
  </div>`;
}
