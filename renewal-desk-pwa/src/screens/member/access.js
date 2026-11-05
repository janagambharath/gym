/* Member Access (Attendance) Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState } from '../../components.js';
import { icon } from '../../icons.js'; import { formatDateTime } from '../../utils.js';
import { attachLiveRefresh } from '../../live-refresh.js';
let maPage = 1;
let maTotalPages = 1;
let maEvents = [];
export default { async mount(el) {
  maPage = 1; maEvents = [];
  await load(el);
  attachLiveRefresh(el, () => load(el, true));
} };
async function load(el, background = false) {
  if (!background) el.innerHTML = `${renderHeader({title:'Attendance',showBack:true})}<div class="scroll-view" id="ma-list">${renderListSkeleton()}</div>`;
  if (!background) bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  let res;
  if (background) {
    const pages = await Promise.all(Array.from({ length: maPage }, (_, i) =>
      apiRequest(`/api/member/v1/access?page=${i + 1}&per_page=20`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) maEvents = pages.flatMap(r => r.data.events || []);
  } else {
    res = await apiRequest(`/api/member/v1/access?page=${maPage}&per_page=20`);
    if (res.ok) maEvents = [...maEvents, ...(res.data.events || [])];
  }
  if (el.dataset.screenDisposed === 'true' || (background && !res.ok)) return;
  const list = el.querySelector('#ma-list');
  const total = res.ok ? (res.data.pagination?.total ?? null) : null;
  maTotalPages = res.ok ? (res.data.pagination?.total_pages ?? 1) : 1;
  const events = maEvents;
  if (!Array.isArray(events)||events.length===0) { list.innerHTML = renderEmptyState({icon:'access',title:'No attendance records',text:'Your gym visits will appear here'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${events.map(e=>`
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:var(--r-full);background:${e.event_type==='entry'?'var(--success-surface)':'var(--gray-100)'};display:flex;align-items:center;justify-content:center">
        ${icon(e.event_type==='entry'?'forward':'back',14,e.event_type==='entry'?'var(--success)':'var(--muted)')}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${e.event_type==='entry'?'Check In':'Check Out'}</div>
        <div class="list-item-subtitle">${formatDateTime(e.timestamp||e.created_at)}</div>
      </div>
    </div>`).join('')}</div>
    ${total != null ? `<div style="text-align:center;font-size:var(--fs-sm);color:var(--muted);padding:var(--sp-sm)">Showing ${events.length} of ${total} visits</div>` : ''}
    ${maPage < maTotalPages ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ma-more">Load more</button></div>` : ''}
  </div>`;
  list.querySelector('#ma-more')?.addEventListener('click', () => { maPage++; load(el); });
}
