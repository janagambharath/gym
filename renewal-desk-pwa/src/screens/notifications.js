/* Notifications Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml, formatRelativeTime, dedupeByKey } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Notifications',showBack:true})}
    <div style="padding:var(--sp-sm) var(--sp-lg);text-align:right"><button class="btn btn-sm btn-secondary" id="nf-read-all">Mark all read</button></div>
    <div class="scroll-view" id="nf-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#nf-read-all')?.addEventListener('click', async () => {
    const btn = el.querySelector('#nf-read-all');
    btn.disabled = true;
    // V6-L28: the old code ignored the result and cleared the unread
    // highlights optimistically — a failed request left the server state
    // unread while the UI claimed otherwise. Only clear on success.
    const res = await apiRequest('/api/mobile/v1/notifications/read-all', { method: 'POST' });
    btn.disabled = false;
    if (!res.ok) { showToast(res.error?.message || 'Could not mark notifications as read.', 'error'); return; }
    // Re-render without the unread highlight.
    el.querySelectorAll('#nf-list .list-item').forEach(row => { row.style.background = ''; row.querySelector('.list-item-title').style.fontWeight = 'var(--fw-normal)'; });
  });

  // V3-L25: the list used to silently cap at the server default (20) with
  // no way to see older notifications. Paginate with a total.
  let page = 1, total = 0, notifs = [], loading = false;
  const list = el.querySelector('#nf-list');
  const iconMap = {payment:'wallet',renewal:'renewals',member:'person',whatsapp:'whatsapp',bot:'robot',campaign:'megaphone'};

  function notifRowHtml(n, idx) {
    const ic = iconMap[n.type]||'notifications';
    return `<div class="list-item" data-idx="${idx}" style="${n.read?'':'background:var(--brand-subtle)'};cursor:pointer">
      <div style="width:36px;height:36px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${icon(ic,16,'var(--brand)')}</div>
      <div class="list-item-content">
        <div class="list-item-title" style="font-weight:${n.read?'var(--fw-normal)':'var(--fw-bold)'}">${escapeHtml(n.title||n.message||'')}</div>
        ${n.body?`<div class="list-item-subtitle">${escapeHtml(n.body)}</div>`:''}
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted);white-space:nowrap">${formatRelativeTime(n.created_at)}</span>
    </div>`;
  }

  function wireRows(container) {
    container.querySelectorAll('[data-idx]').forEach(row => {
      if (row.dataset.wired) return;
      row.dataset.wired = '1';
      row.addEventListener('click', async () => {
        const n = notifs[Number(row.dataset.idx)];
        if (!n) return;
        // Tapping marks the notification read (B-L5) — but only clear the
        // highlight once the server confirms it. V8-L21: the old code
        // cleared optimistically and fired the POST without awaiting it,
        // so a failed request left the server unread while the UI said read.
        if (n.id && !n.read) {
          const r = await apiRequest(`/api/mobile/v1/notifications/${n.id}/read`, { method: 'POST' });
          if (!r.ok) {
            showToast(r.error?.message || 'Could not mark as read.', 'error');
          } else {
            n.read = true;
            row.style.background = '';
            row.querySelector('.list-item-title').style.fontWeight = 'var(--fw-normal)';
          }
        }
        if (n.member_id) navigate.push('member-detail', { memberId: String(n.member_id) });
        else if (n.payment_id) navigate.push('payment-detail', { paymentId: String(n.payment_id) });
        else if (n.conversation_id) navigate.push('bot-conversation-detail', { conversationId: String(n.conversation_id) });
      });
    });
    // V4-L19: loadNotifications advances the page itself, only after
    // a successful fetch — pre-incrementing here silently skipped a
    // failed page.
    container.querySelector('#nf-more')?.addEventListener('click', () => { loadNotifications(true); });
  }

  function renderFooter() {
    const count = el.querySelector('#nf-count');
    if (count) count.textContent = `Showing ${notifs.length} of ${total} notifications`;
    const wrap = el.querySelector('#nf-more-wrap');
    if (wrap) wrap.style.display = notifs.length < total ? '' : 'none';
    const btn = el.querySelector('#nf-more');
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
  }

  async function loadNotifications(append) {
    if (loading) return;
    loading = true;
    // V4-L19: fetch the NEXT page without moving `page` first — the page
    // advances only when the fetch succeeds, so a failed page is retried
    // instead of silently skipped.
    const fetchPage = append ? page + 1 : page;
    const res = await apiRequest(`/api/mobile/v1/notifications?page=${fetchPage}&page_size=20`);
    loading = false;
    if (!res.ok) {
      if (append) { showToast(res.error?.message || 'Could not load more notifications.', 'error'); renderFooter(); return; }
      list.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load notifications</div><div class="empty-state-text">${escapeHtml(res.error?.message || 'Check your connection and try again.')}</div><button class="btn btn-primary" id="nf-retry" style="margin-top:var(--sp-md)">Try Again</button></div>`;
      list.querySelector('#nf-retry')?.addEventListener('click', () => { page = 1; notifs = []; loadNotifications(false); });
      return;
    }
    const pg = res.data.pagination || {};
    total = pg.total ?? (res.data.notifications || res.data || []).length;
    page = pg.page ?? fetchPage;
    const fresh = res.data.notifications || res.data || [];
    if (!Array.isArray(fresh)) return;
    // V5-M11: dedupe by id — a new notification landing between page
    // fetches shifts rows and the boundary row renders twice.
    const base = append ? notifs.length : 0;
    const freshDeduped = append
      ? dedupeByKey(fresh, (n) => n.id).filter((n) => !notifs.some((x) => x.id === n.id))
      : dedupeByKey(fresh, (n) => n.id);
    notifs = append ? [...notifs, ...freshDeduped] : freshDeduped;
    if (!append && notifs.length === 0) {
      list.innerHTML = renderEmptyState({icon:'notifications',title:'No notifications',text:'You\'re all caught up!'});
      return;
    }
    if (!append) {
      list.innerHTML = `<div class="scroll-content"><div class="card" id="nf-card" style="margin:var(--sp-lg)">${notifs.map((n, i) => notifRowHtml(n, i)).join('')}</div>
        <div id="nf-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center"></div>
        <div id="nf-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="nf-more">Load more</button></div></div>`;
      wireRows(list);
    } else {
      const card = el.querySelector('#nf-card');
      if (card) {
        card.insertAdjacentHTML('beforeend', freshDeduped.map((n, i) => notifRowHtml(n, base + i)).join(''));
        wireRows(card);
      }
    }
    renderFooter();
  }

  await loadNotifications(false);
}};
