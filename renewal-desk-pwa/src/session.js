/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Session Management
   localStorage-based equivalent of secureSessionStore.ts
   ═══════════════════════════════════════════════════════════════════════ */

const SESSION_KEY = 'renewal-desk.pwa-session.v1';

/** @typedef {{ accessToken: string, refreshToken: string, tenantId: string, tenantName?: string, userId: string, userName?: string, userRole?: string, gymTimezone?: string, gymCurrency?: string, gymCountry?: string }} Session */

/**
 * @param {unknown} v
 * @returns {v is Session}
 */
function isSession(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.tenantId === 'string' &&
    typeof v.userId === 'string';
}

/** @param {Session} session */
export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* quota exceeded — non-fatal */ }
}

/** @returns {Session|undefined} */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return isSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}


const MEMBER_SESSION_KEY = 'renewal-desk.pwa-member-session.v1';

/** @param {{ token: string, memberId?: number, memberName?: string }} session */
export function saveMemberSession(session) {
  try {
    localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(session));
  } catch { /* quota exceeded — non-fatal */ }
}

/** @returns {{ token: string }|undefined} */
export function loadMemberSession() {
  try {
    const raw = localStorage.getItem(MEMBER_SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.token === 'string') ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function clearMemberSession() {
  try {
    localStorage.removeItem(MEMBER_SESSION_KEY);
  } catch { /* ignore */ }
}
