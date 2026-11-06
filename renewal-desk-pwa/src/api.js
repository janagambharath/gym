/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — API Client
   Mirrored from renewal-desk-android/src/services/apiClient.ts
   ═══════════════════════════════════════════════════════════════════════ */

import { saveSession, loadSession, clearSession, loadMemberSession, saveMemberSession, clearMemberSession } from './session.js';
import { configureDisplayPreferences } from './utils.js';

// ─── Configuration ───────────────────────────────────────────────────
// V3-L32: the base URL comes from the build environment (VITE_API_BASE_URL,
// same env pattern as the Android runtime.ts fix) — no other URL is
// hardcoded anywhere. With no env set, the current production URL stays
// the fallback.
const PRODUCTION_API_BASE_URL = 'https://gym-production-910c.up.railway.app';
// V4-L21: an unset VITE_API_BASE_URL used to silently fall back to the
// production URL. The fallback is KEPT (the Railway prod build sets no
// env var, so throwing here would break the live deploy) but it is now
// LOUD: a console warning on every build that falls back, a dev-only
// on-screen banner, and an exported flag any screen can check.
// REQUIRED VAR for a deliberate target: VITE_API_BASE_URL — set it in the
// build environment (e.g. Railway variables) to point the PWA at a
// staging/dev backend instead of production.
export let apiBaseUrlIsFallback = false;
function warnApiBaseFallback(reason) {
  apiBaseUrlIsFallback = true;
  console.warn(`[Renewal Desk] VITE_API_BASE_URL ${reason} — falling back to production API ${PRODUCTION_API_BASE_URL}. Set VITE_API_BASE_URL in the build environment to target another backend.`);
  // Banner only in non-production builds: real gym owners must never see
  // a developer warning.
  try {
    if (typeof document === 'undefined') return;
    if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'production') return;
    const show = () => {
      if (document.getElementById('rd-api-base-warn')) return;
      const b = document.createElement('div');
      b.id = 'rd-api-base-warn';
      b.textContent = 'Dev warning: VITE_API_BASE_URL is not set — using the production API.';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fef3c7;color:#92400e;font-size:12px;padding:6px 10px;text-align:center';
      document.body.prepend(b);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  } catch { /* ignore */ }
}
function resolveApiBaseUrl() {
  const raw = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '';
  const trimmed = String(raw).trim();
  if (!trimmed) { warnApiBaseFallback('is not set'); return PRODUCTION_API_BASE_URL; }
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) { warnApiBaseFallback(`contains credentials (${trimmed})`); return PRODUCTION_API_BASE_URL; }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') { warnApiBaseFallback(`is not https/localhost (${trimmed})`); return PRODUCTION_API_BASE_URL; }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    warnApiBaseFallback(`is not a valid URL (${trimmed})`);
    return PRODUCTION_API_BASE_URL;
  }
}
const API_BASE_URL = resolveApiBaseUrl();

/** Turn an error payload of any shape into a displayable string. */
function errorMessage(err, fallback) {
  if (typeof err === 'string' && err) return err;
  if (err && typeof err.message === 'string' && err.message) return err.message;
  if (err && typeof err === 'object') {
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return fallback;
}

// ─── Internal State ──────────────────────────────────────────────────
/** @type {import('./session.js').Session|undefined} */
let cachedSession;
/** @type {Promise<import('./session.js').Session|undefined>|undefined} */
let refreshInFlight;
/** @type {Promise<{token: string, refreshToken: string}|null|undefined>|undefined} */
let memberRefreshInFlight;

// ─── Session Management ──────────────────────────────────────────────

/** @param {import('./session.js').Session|undefined} session */
export function setCachedSession(session) {
  cachedSession = session;
  if (session) {
    configureDisplayPreferences({
      country: session.gymCountry,
      currency: session.gymCurrency,
      timezone: session.gymTimezone,
    });
  }
}

export function getCachedSession() {
  return cachedSession;
}

/** Load session from localStorage into memory. Call once at app startup. */
export function restoreSession() {
  cachedSession = loadSession();
  if (cachedSession) {
    configureDisplayPreferences({
      country: cachedSession.gymCountry,
      currency: cachedSession.gymCurrency,
      timezone: cachedSession.gymTimezone,
    });
  }
  return cachedSession;
}

// ─── Token Refresh ───────────────────────────────────────────────────

async function attemptRefresh() {
  if (!cachedSession?.refreshToken) return undefined;
  try {
    const response = await fetch(`${API_BASE_URL}/api/mobile/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: cachedSession.refreshToken }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearSession();
        cachedSession = undefined;
      }
      return undefined;
    }
    const envelope = await response.json();
    if (!envelope.success || !envelope.data) {
      clearSession();
      cachedSession = undefined;
      return undefined;
    }
    const newSession = {
      accessToken: envelope.data.access_token,
      refreshToken: envelope.data.refresh_token,
      tenantId: cachedSession.tenantId,
      tenantName: cachedSession.tenantName,
      userId: cachedSession.userId,
      userName: cachedSession.userName,
      userRole: cachedSession.userRole,
      gymTimezone: cachedSession.gymTimezone,
      gymCurrency: cachedSession.gymCurrency,
      gymCountry: cachedSession.gymCountry,
    };
    saveSession(newSession);
    cachedSession = newSession;
    return newSession;
  } catch {
    return undefined;
  }
}

async function refreshOnce() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = attemptRefresh();
  try { return await refreshInFlight; }
  finally { refreshInFlight = undefined; }
}

async function attemptMemberRefresh() {
  const memberSession = loadMemberSession();
  if (!memberSession?.refreshToken) {
    clearMemberSession();
    return null;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/member/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: memberSession.refreshToken }),
    });
    if (response.status === 401 || response.status === 403) {
      clearMemberSession();
      return null;
    }
    if (!response.ok) return undefined;
    const envelope = await response.json();
    const accessToken = envelope?.data?.access_token;
    const refreshToken = envelope?.data?.refresh_token;
    if (!envelope?.success || !accessToken || !refreshToken) return undefined;
    const renewed = { ...memberSession, token: accessToken, refreshToken };
    saveMemberSession(renewed);
    return renewed;
  } catch {
    return undefined;
  }
}

async function refreshMemberOnce() {
  if (memberRefreshInFlight) return memberRefreshInFlight;
  memberRefreshInFlight = attemptMemberRefresh();
  try { return await memberRefreshInFlight; }
  finally { memberRefreshInFlight = undefined; }
}

// ─── Core Request ────────────────────────────────────────────────────

/**
 * @template T
 * @param {string} path
 * @param {{ method?: string, body?: object, headers?: Record<string,string>, anonymous?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<{ok: true, data: T}|{ok: false, error: {message: string, code?: string, status?: number}}>}
 */
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers: extraHeaders, anonymous = false, timeoutMs = 15000 } = options;

  const makeRequest = async (token) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
  };

  try {
    // Member endpoints authenticate with the member JWT from the OTP login,
    // never the gym owner's token (privilege confusion otherwise).
    const isMemberPath = path.startsWith('/api/member/v1/');
    const token = anonymous
      ? undefined
      : (isMemberPath ? loadMemberSession()?.token : cachedSession?.accessToken);
    let response = await makeRequest(token);

    if (response.status === 401 && !anonymous) {
      if (isMemberPath) {
        const refreshed = await refreshMemberOnce();
        if (refreshed) response = await makeRequest(refreshed.token);
        else if (refreshed === null) {
          return { ok: false, error: { message: 'Member session expired. Please sign in again.', status: 401 } };
        } else {
          return { ok: false, error: { message: 'Could not refresh your member session. Check your connection and retry.' } };
        }
      } else if (cachedSession) {
        const refreshed = await refreshOnce();
        if (refreshed) response = await makeRequest(refreshed.accessToken);
        else return { ok: false, error: { message: 'Session expired. Please sign in again.', status: 401 } };
      }
    }

    const envelope = await response.json();
    if (response.status === 401 && !anonymous && isMemberPath) clearMemberSession();
    if (!response.ok || !envelope.success) {
      // V6-L23: the main error path used to read envelope.error?.message
      // directly, so a string-form error fell through to the generic text
      // and the top-level message (which carries e.g. access denials) was
      // dropped. Route through errorMessage() and expose envelope.message.
      return {
        ok: false,
        error: {
          message: errorMessage(envelope.error, envelope.message || `Request failed (${response.status}).`),
          code: envelope.error?.code,
          status: response.status,
        },
        message: typeof envelope.message === 'string' ? envelope.message : undefined,
      };
    }
    // V6-L23: a 200 success envelope can still carry a top-level message
    // (e.g. "Access denied: … membership is expired" on a denied
    // check-in, where data.event_type is ACCESS_DENIED) — expose it so
    // call sites can tell a denial from a success.
    return { ok: true, data: envelope.data, message: typeof envelope.message === 'string' ? envelope.message : undefined };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: { message: 'Request timed out. Please try again.' } };
    }
    if (error instanceof SyntaxError) {
      // e.g. a 500 HTML error page where JSON was expected — a server error,
      // not an offline device.
      return { ok: false, error: { message: 'The server returned an unexpected response. Please try again.' } };
    }
    return { ok: false, error: { message: 'Could not reach the server. Check your connection.' } };
  }
}

// ─── Auth Functions ──────────────────────────────────────────────────

function persistSession(data) {
  const session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tenantId: String(data.gym.id),
    tenantName: data.gym.name,
    userId: String(data.user.id),
    userName: data.user.full_name,
    userRole: data.user.role,
    gymTimezone: data.gym.timezone,
    gymCurrency: data.gym.currency,
    gymCountry: data.gym.country,
  };
  saveSession(session);
  setCachedSession(session);
}

export async function login(email, password) {
  const result = await apiRequest('/api/mobile/v1/auth/login', {
    method: 'POST', body: { email, password }, anonymous: true,
  });
  if (result.ok) persistSession(result.data);
  return result;
}

export async function signup(params) {
  const locales = {
    India: { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
    UAE: { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' },
    'United States': { country: 'US', currency: 'USD', timezone: 'America/New_York' },
    'United Kingdom': { country: 'GB', currency: 'GBP', timezone: 'Europe/London' },
    Australia: { country: 'AU', currency: 'AUD', timezone: 'Australia/Sydney' },
  };
  const locale = locales[params.country] ?? locales.India;
  const result = await apiRequest('/api/mobile/v1/auth/register', {
    method: 'POST',
    body: {
      owner_name: params.fullName,
      email: params.email,
      phone: params.phone,
      password: params.password,
      gym_name: params.gymName,
      country: locale.country,
      currency: params.currency ?? locale.currency,
      timezone: params.timezone ?? locale.timezone,
      terms_accepted: true,
    },
    anonymous: true,
  });
  if (result.ok) persistSession(result.data);
  return result;
}

export async function logout() {
  try {
    const refreshToken = cachedSession?.refreshToken;
    await apiRequest('/api/mobile/v1/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refresh_token: refreshToken } : {},
    });
  } catch { /* ignore */ }
  finally {
    clearSession();
    cachedSession = undefined;
  }
}

export async function deleteAccount() {
  // Only clear the session when the delete actually succeeded — a failed
  // delete must not sign the owner out believing their data is gone (M30).
  const res = await apiRequest('/api/mobile/v1/auth/account', { method: 'DELETE' });
  if (res.ok) {
    clearSession();
    cachedSession = undefined;
  }
  return res;
}

// ─── Member Auth ─────────────────────────────────────────────────────

export async function memberRequestOtp(phone, gymSlug) {
  const body = gymSlug ? { phone, gym_slug: gymSlug } : { phone };
  return apiRequest('/api/member/v1/auth/request-otp', {
    method: 'POST', body, anonymous: true,
  });
}

export async function memberVerifyOtp(phone, otp, challengeToken) {
  return apiRequest('/api/member/v1/auth/verify-otp', {
    method: 'POST', body: { phone, otp, challenge: challengeToken, challenge_token: challengeToken }, anonymous: true,
  });
}

/** Upload an owner-selected payment QR image. Routes through the shared
 *  FormData upload path so an expired token is refreshed and retried (M28),
 *  instead of forcing a re-login like the old hand-rolled fetch did. */
export async function uploadPaymentQrImage(file, timeoutMs = 15000) {
  const form = new FormData();
  form.append('qr_image', file);
  return uploadFormData('/api/mobile/v1/settings/payment/qr', form, timeoutMs);
}

/** POST a FormData body (file uploads) with auth + token refresh, no hardcoded host. */
export async function uploadFormData(path, formData, timeoutMs = 60000) {
  const doFetch = async (token) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
  };
  try {
    let response = await doFetch(cachedSession?.accessToken);
    if (response.status === 401 && cachedSession) {
      const refreshed = await refreshOnce();
      if (refreshed) response = await doFetch(refreshed.accessToken);
      else return { ok: false, error: { message: 'Session expired. Please sign in again.', status: 401 } };
    }
    const envelope = await response.json().catch(() => ({}));
    // V3-L33: envelope.error can be an object — interpolating it raw
    // rendered as "[object Object]". Stringify with the message first.
    if (!response.ok || !envelope.success) return { ok: false, error: { message: errorMessage(envelope.error, 'Upload failed.') } };
    return { ok: true, data: envelope.data };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: { message: 'Upload timed out. Check your connection and retry.' } };
    return { ok: false, error: { message: 'Could not upload. Check your connection.' } };
  }
}

/** Record manual member check-in or check-out */
export async function checkInMember(memberId, type = 'ENTRY') {
  return apiRequest('/api/mobile/v1/access/checkin', {
    method: 'POST',
    body: { member_id: memberId, type },
  });
}
