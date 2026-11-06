/* Member Access (Attendance) Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, showToast } from '../../components.js';
import { icon } from '../../icons.js'; import { formatDateTime, formatTime, dedupeByKey } from '../../utils.js';
import { attachLiveRefresh } from '../../live-refresh.js';
let maPage = 1;
let maTotalPages = 1;
let maTotal = 0;
let maEvents = [];
// V6-L25: background (live-refresh) failures used to be silent — toast once
// and stamp the count line with the last good time.
let maBgErrorShown = false;
let maLastGoodAt = null;
const maEventKey = (e) => e.id ?? `${e.timestamp || e.created_at || ''}|${e.event_type || ''}`;
export default { async mount(el) {
  maPage = 1; maEvents = [];
  await load(el);
  attachLiveRefresh(el, () => load(el, true));
} };
async function load(el, background = false, append = false) {
  if (!background && !append) {
    maPage = 1; maEvents = [];
    el.innerHTML = `${renderHeader({title:'Attendance',showBack:true})}<div class="scroll-view" id="ma-list">${renderListSkeleton()}</div>`;
  }
  if (!background && !append) bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  // V5-L22: fetch-then-advance — the old click handler pre-incremented
  // maPage, then a failed fetch collapsed totalPages to 1 and hid the
  // button, skipping the page forever. The page moves only on success.
  const fetchPage = append ? maPage + 1 : maPage;
  let res;
  if (background) {
    const pages = await Promise.all(Array.from({ length: maPage }, (_, i) =>
      apiRequest(`/api/member/v1/access?page=${i + 1}&per_page=20`)));
    res = pages.find(r => !r.ok) || pages[pages.length - 1];
    if (res.ok) {
      // V6-L32: dedupe across the re-fetched pages.
      maEvents = dedupeByKey(pages.flatMap(r => r.data.events || []), maEventKey);
    }
  } else {
    res = await apiRequest(`/api/member/v1/access?page=${fetchPage}&per_page=20`);
    if (res.ok) {
      // V6-L32: dedupe the append — a new event between page fetches
      // shifts rows and the boundary event renders twice.
      maEvents = append
        ? dedupeByKey([...maEvents, ...(res.data.events || [])], maEventKey)
        : dedupeByKey(res.data.events || [], maEventKey);
      maPage = fetchPage;
    }
  }
  if (el.dataset.screenDisposed === 'true') return;
  if (!res.ok) {
    if (background) {
      if (!maBgErrorShown) { maBgErrorShown = true; showToast('Could not refresh your attendance — showing the last loaded visits.', 'error'); }
      const countEl = el.querySelector('#ma-count');
      if (countEl && maLastGoodAt) countEl.textContent = `Showing ${maEvents.length} of ${maTotal ?? maEvents.length} visits · last updated ${formatTime(maLastGoodAt)}`;
      return;
    }
    if (append) { showToast(res.error?.message || 'Could not load more visits.', 'error'); return; }
    const list = el.querySelector('#ma-list');
    if (list) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load attendance</div><div class="empty-state-text">${res.error?.message || 'Check your connection and try again.'}</div><button class="btn btn-primary" id="ma-retry" style="margin-top:var(--sp-md)">Try Again</button></div>`;
      list.querySelector('#ma-retry')?.addEventListener('click', () => load(el));
    }
    return;
  }
  maBgErrorShown = false;
  maLastGoodAt = new Date();
  const list = el.querySelector('#ma-list');
  const total = res.data.pagination?.total ?? null;
  maTotal = total ?? maEvents.length;
  maTotalPages = res.data.pagination?.total_pages ?? 1;
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
    ${total != null ? `<div id="ma-count" style="text-align:center;font-size:var(--fs-sm);color:var(--muted);padding:var(--sp-sm)">Showing ${events.length} of ${total} visits</div>` : ''}
    ${maPage < maTotalPages ? `<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="ma-more">Load more</button></div>` : ''}
  </div>`;
  // V5-L22: load() advances maPage itself, only on success.
  list.querySelector('#ma-more')?.addEventListener('click', () => { load(el, false, true); });
}
