/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — API Client
   Mirrored from renewal-desk-android/src/services/apiClient.ts
   ═══════════════════════════════════════════════════════════════════════ */

import { saveSession, loadSession, clearSession } from './session.js';
import { configureDisplayPreferences } from './utils.js';

// ─── Configuration ───────────────────────────────────────────────────
const API_BASE_URL = 'https://gym-production-910c.up.railway.app';

// ─── Internal State ──────────────────────────────────────────────────
/** @type {import('./session.js').Session|undefined} */
let cachedSession;
/** @type {Promise<import('./session.js').Session|undefined>|undefined} */
let refreshInFlight;

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
    const token = anonymous ? undefined : cachedSession?.accessToken;
    let response = await makeRequest(token);

    if (response.status === 401 && !anonymous && cachedSession) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        response = await makeRequest(refreshed.accessToken);
      } else {
        return { ok: false, error: { message: 'Session expired. Please sign in again.', status: 401 } };
      }
    }

    const envelope = await response.json();
    if (!response.ok || !envelope.success) {
      return {
        ok: false,
        error: {
          message: envelope.error?.message ?? `Request failed (${response.status}).`,
          code: envelope.error?.code,
          status: response.status,
        },
      };
    }
    return { ok: true, data: envelope.data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: { message: 'Request timed out. Please try again.' } };
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
  try {
    return await apiRequest('/api/mobile/v1/auth/account', { method: 'DELETE' });
  } finally {
    clearSession();
    cachedSession = undefined;
  }
}

// ─── Member Auth ─────────────────────────────────────────────────────

export async function memberRequestOtp(phone, gymSlug) {
  return apiRequest('/api/member/v1/auth/request-otp', {
    method: 'POST', body: { phone, gym_slug: gymSlug }, anonymous: true,
  });
}

export async function memberVerifyOtp(phone, otp, challengeToken) {
  return apiRequest('/api/member/v1/auth/verify-otp', {
    method: 'POST', body: { phone, otp, challenge_token: challengeToken }, anonymous: true,
  });
}
