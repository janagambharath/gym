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
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
