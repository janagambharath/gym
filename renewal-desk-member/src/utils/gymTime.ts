// V12-L4: member dates must render in the gym's timezone, not the device's.
// No member payload carries gym.timezone — verified against the backend:
// dashboard `gym` (member_api.py ~:1053), membership `gym` (~:1152) and
// profile `gym` (~:2161) send name/phone/address only, and _get_gym_branding
// (~:380-447) has no timezone field. The web client reads the same absent
// field and falls back to Asia/Kolkata (vynla.js applyGymPrefs, V9-L12),
// and every gym in scope is Hyderabad — so the RN client formats in
// Asia/Kolkata, matching the web's effective behaviour. If the backend ever
// ships gym.timezone on a member payload, point GYM_TIME_ZONE at it instead
// of hardcoding (that is a backend change, out of scope for this fix).
export const GYM_TIME_ZONE = 'Asia/Kolkata';

// Calendar-day key (YYYY-M-D) of a timestamp in the gym's timezone.
function gymDayKey(d: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: GYM_TIME_ZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return null;
  }
}

function gymDayKeyShifted(days: number): string | null {
  // Today in gym time, shifted by whole gym-calendar days.
  const nowKey = gymDayKey(new Date());
  if (!nowKey) return null;
  const [y, m, day] = nowKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, day + days));
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`;
}

/** 'Today · 10:30 AM' / 'Yesterday · 10:30 AM' / '12 Nov · 10:30 AM' — gym time. */
export function formatGymDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const timeStr = new Intl.DateTimeFormat('en-IN', {
      timeZone: GYM_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    const key = gymDayKey(d);
    if (key && key === gymDayKey(new Date())) return `Today · ${timeStr}`;
    if (key && key === gymDayKeyShifted(-1)) return `Yesterday · ${timeStr}`;
    const dateStr = new Intl.DateTimeFormat('en-IN', {
      timeZone: GYM_TIME_ZONE,
      day: 'numeric',
      month: 'short',
    }).format(d);
    return `${dateStr} · ${timeStr}`;
  } catch {
    return new Date(iso).toLocaleString('en-IN');
  }
}

/** '12 Nov 2026' — gym time. */
export function formatGymDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: GYM_TIME_ZONE,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
