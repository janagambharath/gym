// G2 — Owner-facing audit log (v11 product gap).
//
// Backend contract (coordinator state gaps-g1-g5, backend crew implements
// exactly this):
//   GET /api/mobile/v1/audit-logs?page&per_page&action&actor_id&from&to
//   (owner-only, gym-scoped, default 20/page, max 100)
//   → { items: [{ id, created_at, actor_name, action, resource_type,
//        resource_id, metadata }], page, per_page, total }
//
// RN-free on purpose: the URL builder / formatters live here so node:test
// can assert them without a RN runtime; AuditLogScreen only wires them
// to apiRequest.

export type AuditLogItem = {
  id: number;
  created_at: string | null;
  actor_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: number | string | null;
  metadata: Record<string, unknown> | string | null;
};

export type AuditLogResponse = {
  items: AuditLogItem[];
  page: number;
  per_page: number;
  total: number;
  /** Tolerated if the backend ever nests pagination like other lists. */
  pagination?: { page: number; per_page: number; total: number; total_pages: number };
};

export type AuditLogFilters = {
  page?: number;
  per_page?: number;
  action?: string;
  actor_id?: number | string;
  from?: string;
  to?: string;
};

export function buildAuditLogsUrl(filters: AuditLogFilters = {}): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('per_page', String(filters.per_page ?? 20));
  if (filters.action?.trim()) params.set('action', filters.action.trim());
  if (filters.actor_id !== undefined && filters.actor_id !== '' && filters.actor_id !== null) {
    params.set('actor_id', String(filters.actor_id));
  }
  if (filters.from?.trim()) params.set('from', filters.from.trim());
  if (filters.to?.trim()) params.set('to', filters.to.trim());
  return `/api/mobile/v1/audit-logs?${params.toString()}`;
}

/** Human-readable action label: `member_blocked` → "Member Blocked". */
export function formatAuditAction(action: string): string {
  return action
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** "members #42" / "—" when the row carries no resource. */
export function formatAuditResource(item: AuditLogItem): string {
  if (!item.resource_type) return '—';
  return item.resource_id === null || item.resource_id === undefined
    ? item.resource_type
    : `${item.resource_type} #${item.resource_id}`;
}

/**
 * One-line metadata summary. Objects render as up to 3 `key: value`
 * pairs; a plain string renders as-is; null/empty renders '—'. Values
 * are stringified, never rendered as raw template data.
 */
export function formatAuditMetadata(metadata: AuditLogItem['metadata']): string {
  if (metadata === null || metadata === undefined) return '—';
  if (typeof metadata === 'string') return metadata.trim() || '—';
  const entries = Object.entries(metadata);
  if (entries.length === 0) return '—';
  const shown = entries.slice(0, 3).map(([key, value]) => {
    const rendered =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `${key}: ${rendered}`;
  });
  return shown.join(' · ') + (entries.length > 3 ? ' …' : '');
}

/** Pagination guard — mirrors hasMoreNotifications. */
export function hasMoreAuditLogs(total: number, loaded: number): boolean {
  return loaded < total;
}

/** Merge a newly fetched page onto the list, de-duplicated by id. */
export function mergeAuditLogPage(
  prev: AuditLogItem[],
  page: AuditLogItem[],
): AuditLogItem[] {
  const seen = new Set(prev.map((item) => item.id));
  return [...prev, ...page.filter((item) => !seen.has(item.id))];
}
