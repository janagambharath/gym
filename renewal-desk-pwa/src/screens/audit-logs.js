/* Audit Log Screen — owner-only (G2).
 * Reads GET /api/mobile/v1/audit-logs with page/per_page + action/from/to
 * filters. The server enforces owner-only; the nav entry is hidden for
 * staff (settings.js) and a staff session hitting this screen gets the
 * backend's 403 as the error state. */
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderListSkeleton, renderEmptyState, renderErrorState, showToast } from '../components.js';
import { escapeHtml, formatDateTime } from '../utils.js';

/** Human-readable label for a machine action key, e.g. member_blocked. */
export function auditActionLabel(action) {
  const known = {
    member_blocked: 'Member blocked at door',
    member_unblocked: 'Member unblocked at door',
    member_created: 'Member created',
    member_updated: 'Member updated',
    member_deleted: 'Member deleted',
    membership_renewed: 'Membership renewed',
    payment_recorded: 'Payment recorded',
    payment_verified: 'Payment verified',
    terminal_commissioned: 'Terminal commissioned',
    terminal_decommissioned: 'Terminal decommissioned',
    terminal_replaced: 'Terminal replaced',
    fingerprints_restored: 'Fingerprints restored',
    command_queued: 'Door command queued',
    command_failed: 'Door command failed',
    enroll_matched: 'Terminal ID linked to member',
    enroll_unlinked: 'Terminal ID unlinked',
  };
  if (action && known[action]) return known[action];
  return String(action || 'Unknown action')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One-line summary of a metadata object — never renders raw JSON blobs. */
export function auditMetadataSummary(metadata) {
  if (metadata == null) return '';
  if (typeof metadata === 'string') return metadata.length > 160 ? `${metadata.slice(0, 157)}…` : metadata;
  if (typeof metadata !== 'object') return String(metadata);
  const parts = Object.entries(metadata).slice(0, 3).map(([k, v]) => {
    const val = v != null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}: ${val}`;
  });
  const text = parts.join(' · ');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export default {
  async mount(el) {
    el.innerHTML = `${renderHeader({ title: 'Audit Log', showBack: true })}
      <div style="padding:var(--sp-md) var(--sp-lg) 0;display:flex;flex-wrap:wrap;gap:var(--sp-sm);align-items:flex-end">
        <label style="flex:2;min-width:140px;font-size:var(--fs-xs);color:var(--muted)">Action
          <input id="al-action" class="form-input" type="text" placeholder="e.g. member_blocked" autocomplete="off" style="margin-top:4px">
        </label>
        <label style="flex:1;min-width:110px;font-size:var(--fs-xs);color:var(--muted)">From
          <input id="al-from" class="form-input" type="date" style="margin-top:4px">
        </label>
        <label style="flex:1;min-width:110px;font-size:var(--fs-xs);color:var(--muted)">To
          <input id="al-to" class="form-input" type="date" style="margin-top:4px">
        </label>
        <button class="btn btn-secondary btn-sm" id="al-apply">Apply filters</button>
      </div>
      <div class="scroll-view" id="al-list">${renderListSkeleton()}</div>`;
    bindHeaderEvents(el, { onBack: () => navigate.pop() });

    let page = 1, total = 0, rows = [], loading = false;
    const list = el.querySelector('#al-list');
    const filters = () => ({
      action: el.querySelector('#al-action')?.value.trim() || '',
      from: el.querySelector('#al-from')?.value || '',
      to: el.querySelector('#al-to')?.value || '',
    });

    function rowHtml(item) {
      const meta = auditMetadataSummary(item.metadata);
      return `<div class="list-item" style="align-items:flex-start">
        <div class="list-item-content">
          <div class="list-item-title">${escapeHtml(auditActionLabel(item.action))}</div>
          <div class="list-item-subtitle">${escapeHtml(item.actor_name || 'System')}${item.resource_type ? ` · ${escapeHtml(item.resource_type)}${item.resource_id != null ? ` #${escapeHtml(String(item.resource_id))}` : ''}` : ''}</div>
          ${meta ? `<div class="list-item-subtitle">${escapeHtml(meta)}</div>` : ''}
        </div>
        <span style="font-size:var(--fs-xs);color:var(--muted);white-space:nowrap">${escapeHtml(formatDateTime(item.created_at))}</span>
      </div>`;
    }

    function renderFooter() {
      const count = el.querySelector('#al-count');
      if (count) count.textContent = `Showing ${rows.length} of ${total} events`;
      const wrap = el.querySelector('#al-more-wrap');
      if (wrap) wrap.style.display = rows.length < total ? '' : 'none';
      const btn = el.querySelector('#al-more');
      if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    }

    async function loadLogs(append) {
      if (loading) return;
      loading = true;
      const fetchPage = append ? page + 1 : page;
      const f = filters();
      const params = new URLSearchParams({ page: String(fetchPage), per_page: '20' });
      if (f.action) params.set('action', f.action);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      const res = await apiRequest(`/api/mobile/v1/audit-logs?${params.toString()}`);
      loading = false;
      if (!res.ok) {
        if (append) { showToast(res.error?.message || 'Could not load more audit events.', 'error'); renderFooter(); return; }
        list.innerHTML = renderErrorState(res.error?.message || 'Could not load the audit log.');
        list.querySelector('#retry-btn')?.addEventListener('click', () => { page = 1; rows = []; loadLogs(false); });
        return;
      }
      const fresh = res.data?.items || res.data?.logs || res.data?.audit_logs || [];
      total = res.data?.total ?? (Array.isArray(fresh) ? fresh.length : rows.length);
      page = res.data?.page ?? fetchPage;
      if (!Array.isArray(fresh)) return;
      const base = append ? rows.length : 0;
      const seen = new Set(rows.map((r) => r.id));
      const freshDeduped = fresh.filter((r) => r.id == null || !seen.has(r.id));
      rows = append ? [...rows, ...freshDeduped] : freshDeduped;
      if (!append && rows.length === 0) {
        list.innerHTML = renderEmptyState({ icon: 'report', title: 'No audit events', text: 'No activity matches these filters yet.' });
        return;
      }
      if (!append) {
        list.innerHTML = `<div class="scroll-content"><div class="card" id="al-card" style="margin:var(--sp-lg)">${rows.map(rowHtml).join('')}</div>
          <div id="al-count" style="padding:var(--sp-sm) 0;font-size:var(--fs-sm);color:var(--muted);text-align:center"></div>
          <div id="al-more-wrap" style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="al-more">Load more</button></div></div>`;
        list.querySelector('#al-more')?.addEventListener('click', () => loadLogs(true));
      } else {
        // The Load-more button was wired once on first render — do not
        // re-attach it here (duplicate handlers would double-fetch).
        const card = el.querySelector('#al-card');
        if (card) card.insertAdjacentHTML('beforeend', freshDeduped.map(rowHtml).join(''));
      }
      renderFooter();
    }

    el.querySelector('#al-apply')?.addEventListener('click', () => { page = 1; rows = []; loadLogs(false); });
    await loadLogs(false);
  },
};
