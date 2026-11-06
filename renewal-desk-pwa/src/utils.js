/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Utility Functions
   Mirrored from renewal-desk-android/src/types.ts helpers
   ═══════════════════════════════════════════════════════════════════════ */

// ─── Display Preferences ─────────────────────────────────────────────

const localeByCountry = {
  AE: 'en-AE', AU: 'en-AU', GB: 'en-GB', IN: 'en-IN', US: 'en-US',
};

let displayPreferences = {
  country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata',
};

export function configureDisplayPreferences(prefs) {
  displayPreferences = {
    country: (prefs.country || displayPreferences.country).toUpperCase(),
    currency: (prefs.currency || displayPreferences.currency).toUpperCase(),
    timezone: prefs.timezone || displayPreferences.timezone,
  };
}

/** The gym's IANA timezone as configured for display (V6-L29). */
export function getGymTimezone() {
  return displayPreferences.timezone;
}

/**
 * Dedupe a list of rows by a key function, keeping the first occurrence
 * (V5-M11 / V6-L32). Paginated lists re-fetch overlapping windows when a
 * new row lands between page fetches, so plain [...old, ...new] renders
 * duplicates.
 */
export function dedupeByKey(rows, keyFn) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const k = keyFn(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function displayLocale() {
  return localeByCountry[displayPreferences.country] ?? 'en-US';
}

// ─── Date Formatting ─────────────────────────────────────────────────

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T12:00:00.000Z`)
    : new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: '2-digit', month: 'short', year: 'numeric',
      timeZone: displayPreferences.timezone,
    }).format(d);
  } catch {
    return d.toLocaleDateString(displayLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleString(displayLocale());
  }
}

/** Time-only variant of formatDateTime, in the gym timezone (V5-L24). */
export function formatTime(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      hour: 'numeric', minute: '2-digit',
      timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' });
  }
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: 'numeric', month: 'short',
      timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleDateString(displayLocale());
  }
}

export function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatShortDate(dateStr);
}

// ─── Currency Formatting ─────────────────────────────────────────────

export function formatCurrency(value, customCurrency) {
  const amount = typeof value === 'string' ? Number(value) : value;
  const currency = (customCurrency || displayPreferences.currency || 'INR').toUpperCase();
  try {
    return new Intl.NumberFormat(displayLocale(), {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

export function formatInteger(value) {
  return new Intl.NumberFormat(displayLocale()).format(value);
}

export function getCurrencySymbol() {
  const c = (displayPreferences.currency || 'INR').toUpperCase();
  const map = {
    INR: '₹', AED: 'AED ', USD: '$', GBP: '£', EUR: '€',
    AUD: 'A$', CAD: 'C$', SAR: 'SAR ', QAR: 'QAR ',
    KWD: 'KWD ', OMR: 'OMR ', SGD: 'S$',
  };
  return map[c] ?? `${c} `;
}

// ─── Member Helpers ──────────────────────────────────────────────────

export function getMemberDisplayStatus(member) {
  if (member.status === 'paused') return 'paused';
  if (member.status === 'expired') return 'expired';
  if (member.days_until_expiry != null && member.days_until_expiry <= 7 && member.days_until_expiry >= 0) {
    return 'expiring';
  }
  return member.status === 'active' ? 'active' : 'expired';
}

export function getMemberStatusColor(status) {
  switch (status) {
    case 'active': return { text: 'var(--status-active)', bg: 'var(--status-active-surface)', border: 'var(--success-border)' };
    case 'expiring': return { text: 'var(--status-expiring)', bg: 'var(--status-expiring-surface)', border: 'var(--warning-border)' };
    case 'expired': return { text: 'var(--status-expired)', bg: 'var(--status-expired-surface)', border: 'var(--critical-border)' };
    case 'paused': return { text: 'var(--warning)', bg: 'var(--warning-surface)', border: 'var(--warning-border)' };
    default: return { text: 'var(--muted)', bg: 'var(--gray-100)', border: 'var(--border)' };
  }
}

export function getPaymentStatusColor(status) {
  switch (status) {
    case 'verified': case 'paid': return { text: 'var(--status-paid)', bg: 'var(--status-paid-surface)' };
    case 'pending': return { text: 'var(--status-pending)', bg: 'var(--status-pending-surface)' };
    case 'rejected': case 'failed': return { text: 'var(--status-failed)', bg: 'var(--status-failed-surface)' };
    default: return { text: 'var(--muted)', bg: 'var(--gray-100)' };
  }
}

export function getDaysText(days) {
  if (days == null) return null;
  if (days > 0) return `${days} days`;
  if (days === 0) return 'Today';
  return `${Math.abs(days)}d overdue`;
}

export function getGymTodayISO() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: displayPreferences.timezone,
    }).formatToParts(new Date());
    const find = (t) => parts.find(p => p.type === t)?.value;
    const y = find('year'), m = find('month'), d = find('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch { /* fallback */ }
  return new Date().toISOString().slice(0, 10);
}

/** Timezone offset (ms) of `timeZone` at `date`, via Intl. */
function tzOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - date.getTime();
}

/**
 * Parse a "YYYY-MM-DDTHH:MM" wall time as gym-local time and return an ISO
 * UTC string (V6-L29). A datetime-local value carries no zone; `new Date()`
 * read it in the device zone, which is wrong whenever the device tz differs
 * from the gym's. Returns null on invalid input.
 */
export function gymLocalInputToIso(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || (s || 0) > 59) return null;
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const tz = displayPreferences.timezone;
  // Wall time -> UTC: subtract the gym-tz offset at that instant; one
  // refinement pass covers a DST edge landing on the other side.
  let utc = wallAsUtc - tzOffsetMs(tz, new Date(wallAsUtc));
  utc = wallAsUtc - tzOffsetMs(tz, new Date(utc));
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** Format a Date as "YYYY-MM-DDTHH:MM" wall time in the gym timezone. */
export function toGymLocalInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: displayPreferences.timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
}

// ─── Avatar Color ────────────────────────────────────────────────────

const avatarColors = [
  '#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626',
  '#0891B2', '#4F46E5', '#0D9488', '#C026D3', '#EA580C',
];

export function getAvatarColor(name) {
  if (!name) return avatarColors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

// ─── Segment Labels ──────────────────────────────────────────────────

export const SEGMENT_LABELS = {
  expiring_today: 'Expiring Today',
  expiring_3d: 'Expiring in 3 Days',
  expiring_7d: 'Expiring in 7 Days',
  expiring_14d: 'Expiring in 14 Days',
  expiring_30d: 'Expiring in 30 Days',
  recently_expired: 'Recently Expired',
  inactive_30d: 'Inactive 30+ Days',
  inactive_60d: 'Inactive 60+ Days',
  inactive_90d: 'Inactive 90+ Days',
  all_active: 'All Active Members',
  all_expired: 'All Expired Members',
  all_customers: 'All Customers',
  custom_import: 'Custom Contact List',
};

// ─── HTML Helpers ────────────────────────────────────────────────────

/** Safely escape HTML to prevent XSS */
export function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  // textContent→innerHTML escapes only &<> — quotes must be escaped too,
  // or value="..." interpolations break (and truncate) on names like John "JD".
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape for use inside a double-quoted HTML attribute value. */
export function escapeAttr(str) {
  return escapeHtml(str);
}

/** Generate a UUID v4 for idempotency keys */
export function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/** Debounce a function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Greeting based on time of day */
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
