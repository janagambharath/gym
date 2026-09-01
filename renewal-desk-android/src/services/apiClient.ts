import { getRuntimeConfiguration } from '../config/runtime';
import { clearSession, loadSession, MobileSession, saveSession } from '../storage/secureSessionStore';
import { configureDisplayPreferences } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiError = {
  message: string;
  code?: string;
  status?: number;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  /** Additional non-sensitive request headers, such as Idempotency-Key. */
  headers?: Record<string, string>;
  /** Skip auth header (e.g. for login). */
  anonymous?: boolean;
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Backend envelope — every response is { success, data?, error? }
// ---------------------------------------------------------------------------

type BackendEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let cachedSession: MobileSession | undefined;
let refreshInFlight: Promise<MobileSession | undefined> | undefined;

/** Called by the auth flow after login or refresh. */
export function setCachedSession(session: MobileSession | undefined): void {
  cachedSession = session;
  if (session) {
    configureDisplayPreferences({
      country: session.gymCountry,
      currency: session.gymCurrency,
      timezone: session.gymTimezone,
    });
  }
}

/** Called by navigation to check if the user has a cached session. */
export function getCachedSession(): MobileSession | undefined {
  return cachedSession;
}

/** Load session from SecureStore into memory. Call once at app startup. */
export async function restoreSession(): Promise<MobileSession | undefined> {
  cachedSession = await loadSession();
  if (cachedSession) {
    configureDisplayPreferences({
      country: cachedSession.gymCountry,
      currency: cachedSession.gymCurrency,
      timezone: cachedSession.gymTimezone,
    });
  }
  return cachedSession;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

type RefreshResponse = {
  access_token: string;
  refresh_token: string;
};

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
      // Explicit 401/403 means the refresh token is truly expired/invalid -> clear session.
      if (response.status === 401 || response.status === 403) {
        await clearSession();
        cachedSession = undefined;
      }
      return undefined;
    }

    const envelope = (await response.json()) as BackendEnvelope<RefreshResponse>;
    if (!envelope.success || !envelope.data) {
      await clearSession();
      cachedSession = undefined;
      return undefined;
    }

    const newSession: MobileSession = {
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

    await saveSession(newSession);
    cachedSession = newSession;
    return newSession;
  } catch {
    // Transient network failure should NOT destroy valid local credentials.
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
// Core request function — unwraps { success, data } envelope
// ---------------------------------------------------------------------------

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const config = getRuntimeConfiguration();
  if (!config.apiBaseUrl) {
    return { ok: false, error: { message: 'API base URL is not configured.' } };
  }

  const { method = 'GET', body, headers: extraHeaders, anonymous = false, timeoutMs = 15_000 } = options;

  const makeRequest = async (token?: string): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...extraHeaders,
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

    // Parse the backend envelope.
    const envelope = (await response.json()) as BackendEnvelope<T>;

    if (!response.ok || !envelope.success) {
      const message = envelope.error?.message ?? `Request failed (${response.status}).`;
      const code = envelope.error?.code;
      return { ok: false, error: { message, code, status: response.status } };
    }

    // Unwrap: return envelope.data as T
    return { ok: true, data: envelope.data as T };
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
// Auth convenience functions — match actual backend response shapes
// ---------------------------------------------------------------------------

export type LoginResponseData = {
  access_token: string;
  refresh_token: string;
  user: {
    id: number;
    email: string;
    full_name: string;
    role: string;
  };
  gym: {
    id: number;
    name: string;
    slug: string;
    timezone: string;
    country?: string;
    currency?: string;
    whatsapp_enabled: boolean;
  };
};

export type RegistrationInput = {
  owner_name: string;
  email: string;
  phone: string;
  password: string;
  gym_name: string;
  country: string;
  currency: string;
  timezone: string;
  terms_accepted: true;
};

export type RegistrationResponseData = LoginResponseData & {
  registration: {
    gym_id: number;
    owner_id: number;
    setup_state: 'PLAN_SELECTION';
    billing: { subscription_status: string };
  };
};

async function persistAuthenticatedSession(data: LoginResponseData): Promise<void> {
  const session: MobileSession = {
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
  await saveSession(session);
  setCachedSession(session);
}

export async function registerAccount(
  input: RegistrationInput,
): Promise<ApiResult<RegistrationResponseData>> {
  const result = await apiRequest<RegistrationResponseData>('/api/mobile/v1/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });
  if (result.ok) await persistAuthenticatedSession(result.data);
  return result;
}

export async function login(email: string, password: string): Promise<ApiResult<LoginResponseData>> {
  const result = await apiRequest<LoginResponseData>('/api/mobile/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });

  if (result.ok) {
    await persistAuthenticatedSession(result.data);
  }

  return result;
}

export async function signup(params: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  gymName: string;
  country: string;
  currency?: string;
  timezone?: string;
}): Promise<ApiResult<LoginResponseData>> {
  const locales: Record<string, { country: string; currency: string; timezone: string }> = {
    India: { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
    UAE: { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' },
    'United States': { country: 'US', currency: 'USD', timezone: 'America/New_York' },
    'United Kingdom': { country: 'GB', currency: 'GBP', timezone: 'Europe/London' },
    Australia: { country: 'AU', currency: 'AUD', timezone: 'Australia/Sydney' },
  };
  const locale = locales[params.country] ?? locales.India;
  const result = await apiRequest<LoginResponseData>('/api/mobile/v1/auth/register', {
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

  if (result.ok) {
    await persistAuthenticatedSession(result.data);
  }

  return result;
}

export async function googleLogin(idToken: string, extras?: {
  gym_name?: string;
  country?: string;
  phone?: string;
  timezone?: string;
}): Promise<ApiResult<LoginResponseData>> {
  const result = await apiRequest<LoginResponseData>('/api/mobile/v1/auth/google', {
    method: 'POST',
    body: { id_token: idToken, ...extras },
    anonymous: true,
  });

  if (result.ok) {
    await persistAuthenticatedSession(result.data);
  }

  return result;
}

export async function logout(): Promise<void> {
  try {
    const refreshToken = cachedSession?.refreshToken;
    await apiRequest('/api/mobile/v1/auth/logout', {
      method: 'POST',
      body: refreshToken ? { refresh_token: refreshToken } : {},
    });
  } catch {
    // Ignore — we clear the local session regardless.
  } finally {
    await clearSession();
    cachedSession = undefined;
  }
}

// ---------------------------------------------------------------------------
// Google Play Billing
// ---------------------------------------------------------------------------

export type BillingCatalogPlan = {
  id: string;
  name: string;
  price: string;
  currency: string;
};

export type BillingEntitlement = {
  billing_source: 'MANUAL' | 'GOOGLE_PLAY';
  subscription_status: 'ACTIVE' | 'TRIAL' | 'PENDING' | 'PAYMENT_FAILED' | 'GRACE_PERIOD' | 'CANCELLED' | 'EXPIRED';
  plan_id: string | null;
  plan_name: string | null;
  started_at: string | null;
  renews_at: string | null;
  expires_at: string | null;
  grace_period_end: string | null;
  purchase_management_available: boolean;
};

export async function getBillingEntitlement(): Promise<ApiResult<BillingEntitlement>> {
  return apiRequest<BillingEntitlement>('/api/mobile/v1/billing/entitlement');
}

export async function getBillingCatalog(): Promise<ApiResult<{ country: string; currency: string; plans: BillingCatalogPlan[] }>> {
  return apiRequest<{ country: string; currency: string; plans: BillingCatalogPlan[] }>('/api/mobile/v1/billing/catalog');
}

export async function getGooglePlayPurchaseContext(): Promise<ApiResult<{ obfuscated_account_id: string }>> {
  return apiRequest<{ obfuscated_account_id: string }>('/api/mobile/v1/billing/purchase-context');
}

export async function verifyGooglePlayPurchase(productId: string, purchaseToken: string): Promise<ApiResult<BillingEntitlement>> {
  return apiRequest<BillingEntitlement>('/api/mobile/v1/billing/purchases/verify', {
    method: 'POST',
    body: {
      product_id: productId,
      purchase_token: purchaseToken,
    },
  });
}

export async function restoreGooglePlayPurchases(purchases: { product_id: string; purchase_token: string }[]): Promise<ApiResult<BillingEntitlement>> {
  return apiRequest<BillingEntitlement>('/api/mobile/v1/billing/restore', {
    method: 'POST',
    body: { purchases },
  });
}

// ---------------------------------------------------------------------------
// WhatsApp Onboarding & Profile
// ---------------------------------------------------------------------------

export type WhatsAppConnectionStatusData = {
  status: 'CONNECTED' | 'NOT_CONNECTED' | 'PENDING' | 'ACTION_REQUIRED' | 'FAILED' | 'DISCONNECTED';
  status_description: string;
  next_action: string;
  business_phone_number: string;
  phone_number_id: string;
  waba_id: string;
  coexistence_eligible: boolean;
  profile: {
    about: string;
    description: string;
    address: string;
    email: string;
    vertical: string;
  };
};

export async function getWhatsAppConnectionStatus(): Promise<ApiResult<WhatsAppConnectionStatusData>> {
  return apiRequest<WhatsAppConnectionStatusData>('/api/mobile/v1/whatsapp/connection-status');
}

export async function getWhatsAppOnboardingConfig(): Promise<ApiResult<{
  meta_app_id: string;
  config_id: string;
  gym_id: number;
  gym_name: string;
  supported_methods: { id: string; title: string; description: string; recommended: boolean }[];
}>> {
  return apiRequest('/api/mobile/v1/whatsapp/onboarding-config');
}

export async function connectWaba(params: {
  wabaId?: string;
  phoneNumberId: string;
  businessPhoneNumber?: string;
}): Promise<ApiResult<{ status: string; message: string; phone_number_id: string }>> {
  return apiRequest('/api/mobile/v1/whatsapp/connect-waba', {
    method: 'POST',
    body: {
      waba_id: params.wabaId,
      phone_number_id: params.phoneNumberId,
      business_phone_number: params.businessPhoneNumber,
    },
  });
}

export async function updateWhatsAppProfile(params: {
  about?: string;
  address?: string;
  email?: string;
}): Promise<ApiResult<{ name: string; about: string; address: string; email: string; business_phone_number: string }>> {
  return apiRequest('/api/mobile/v1/whatsapp/profile', {
    method: 'PATCH',
    body: params,
  });
}

// ---------------------------------------------------------------------------
// Onboarding Progress Checklist
// ---------------------------------------------------------------------------

export type OnboardingStep = {
  id: string;
  title: string;
  completed: boolean;
  route: string | null;
};

export type OnboardingProgressData = {
  completed_count: number;
  total_count: number;
  percentage: number;
  is_complete: boolean;
  steps: OnboardingStep[];
};

export async function getOnboardingProgress(): Promise<ApiResult<OnboardingProgressData>> {
  return apiRequest<OnboardingProgressData>('/api/mobile/v1/onboarding/progress');
}

