import { getRuntimeConfiguration } from '../config/runtime';
import { clearSession, loadSession, MobileSession, saveSession } from '../storage/secureSessionStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiError = {
  message: string;
  status?: number;
  field?: string;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  /** Skip auth header (e.g. for login). */
  anonymous?: boolean;
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let cachedSession: MobileSession | undefined;
let refreshInFlight: Promise<MobileSession | undefined> | undefined;

/** Called by the auth flow after login or refresh. */
export function setCachedSession(session: MobileSession | undefined): void {
  cachedSession = session;
}

/** Called by navigation to check if the user has a cached session. */
export function getCachedSession(): MobileSession | undefined {
  return cachedSession;
}

/** Load session from SecureStore into memory. Call once at app startup. */
export async function restoreSession(): Promise<MobileSession | undefined> {
  cachedSession = await loadSession();
  return cachedSession;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function attemptRefresh(baseUrl: string): Promise<MobileSession | undefined> {
  if (!cachedSession?.refreshToken) {
    return undefined;
  }

  try {
    const response = await fetch(`${baseUrl}/api/mobile/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: cachedSession.refreshToken }),
    });

    if (!response.ok) {
      // Refresh failed — force re-login.
      await clearSession();
      cachedSession = undefined;
      return undefined;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const newSession: MobileSession = {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: typeof data.expires_at === 'string' ? data.expires_at : undefined,
      tenantId: cachedSession.tenantId,
      tenantName: cachedSession.tenantName,
      userId: cachedSession.userId,
      userName: cachedSession.userName,
      userRole: cachedSession.userRole,
    };

    await saveSession(newSession);
    cachedSession = newSession;
    return newSession;
  } catch {
    await clearSession();
    cachedSession = undefined;
    return undefined;
  }
}

/** Deduplicated refresh — only one refresh request at a time. */
async function refreshOnce(baseUrl: string): Promise<MobileSession | undefined> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = attemptRefresh(baseUrl);
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const config = getRuntimeConfiguration();
  if (!config.apiBaseUrl) {
    return { ok: false, error: { message: 'API base URL is not configured.' } };
  }

  const { method = 'GET', body, anonymous = false, timeoutMs = 15_000 } = options;

  const makeRequest = async (token?: string): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      return await fetch(`${config.apiBaseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const token = anonymous ? undefined : cachedSession?.accessToken;
    let response = await makeRequest(token);

    // 401 with a session → attempt one token refresh and retry.
    if (response.status === 401 && !anonymous && cachedSession) {
      const refreshed = await refreshOnce(config.apiBaseUrl);
      if (refreshed) {
        response = await makeRequest(refreshed.accessToken);
      } else {
        return {
          ok: false,
          error: { message: 'Session expired. Please sign in again.', status: 401 },
        };
      }
    }

    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody.message === 'string') {
          message = errorBody.message;
        } else if (typeof errorBody.error === 'string') {
          message = errorBody.error;
        }
      } catch {
        // Use the default message.
      }
      return { ok: false, error: { message, status: response.status } };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: { message: 'Request timed out. Please try again.' } };
    }
    return {
      ok: false,
      error: { message: 'Could not reach the server. Check your connection.' },
    };
  }
}

// ---------------------------------------------------------------------------
// Auth convenience functions
// ---------------------------------------------------------------------------

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_at?: string;
  user: {
    id: string;
    email: string;
    full_name: string;
    role: string;
    gym_id: string;
    gym_name: string;
  };
};

export async function login(email: string, password: string): Promise<ApiResult<LoginResponse>> {
  const result = await apiRequest<LoginResponse>('/api/mobile/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });

  if (result.ok) {
    const { data } = result;
    const session: MobileSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      tenantId: data.user.gym_id,
      tenantName: data.user.gym_name,
      userId: data.user.id,
      userName: data.user.full_name,
      userRole: data.user.role,
    };
    await saveSession(session);
    cachedSession = session;
  }

  return result;
}

export async function logout(): Promise<void> {
  try {
    // Best-effort server-side logout.
    await apiRequest('/api/mobile/v1/auth/logout', { method: 'POST' });
  } catch {
    // Ignore — we clear the local session regardless.
  } finally {
    await clearSession();
    cachedSession = undefined;
  }
}
