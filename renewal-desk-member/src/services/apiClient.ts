import * as SecureStore from 'expo-secure-store';
import {
  DashboardResponse,
  GymBranding,
  MembershipPlan,
  PaymentInfo,
  PaymentRecord,
  AccessEventRecord,
  AccessSummary,
  RenewalRecord,
  Member,
  RenewalDemand,
  UPIPaymentSession,
} from '../types';

const TOKEN_KEY = 'vynla_member_token';
const REFRESH_TOKEN_KEY = 'vynla_member_refresh_token';
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://gym-production-910c.up.railway.app').replace(/\/$/, '');
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string } | null | undefined> | undefined;

// ── Secure Token Storage ─────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // Fallback if secure store fails
  }
}

async function saveRefreshToken(token: string): Promise<void> {
  try { await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token); } catch { /* SecureStore may be unavailable */ }
}

async function refreshMemberSession(): Promise<{ accessToken: string; refreshToken: string } | null | undefined> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        await clearToken();
        return null;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${API_BASE}/api/member/v1/auth/refresh`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          await clearToken();
          return null;
        }
        if (!response.ok) return undefined;
        const envelope = await response.json();
        const accessToken = envelope?.data?.access_token;
        const nextRefreshToken = envelope?.data?.refresh_token;
        if (!envelope?.success || !accessToken || !nextRefreshToken) return undefined;
        await saveToken(accessToken);
        await saveRefreshToken(nextRefreshToken);
        return { accessToken, refreshToken: nextRefreshToken };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return undefined;
    }
  })();
  try { return await refreshInFlight; }
  finally { refreshInFlight = undefined; }
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  } catch {
    // Fallback
  }
}

// ── HTTP Helper ──────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 12000,
  authenticated = true,
): Promise<T> {
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };

  try {
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const makeRequest = async (token?: string) => {
      const requestHeaders = { ...headers };
      if (token) requestHeaders.Authorization = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, headers: requestHeaders, signal: controller.signal });
      } finally { clearTimeout(timer); }
    };

    const token = authenticated ? await getToken() : null;
    let res = await makeRequest(token || undefined);
    if (res.status === 401 && authenticated) {
      const renewed = await refreshMemberSession();
      if (!renewed) {
        if (renewed === null) throw new Error('Your session has expired. Please log in again.');
        throw new Error('Could not refresh your session. Check your connection and retry.');
      }
      res = await makeRequest(renewed.accessToken);
    }

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      if (res.status === 401) {
        await clearToken();
        throw new Error('Your session has expired. Please log in again.');
      }
      let errorMsg = 'Something went wrong.';
      if (typeof json?.error === 'string') {
        errorMsg = json.error;
      } else if (json?.error && typeof json.error === 'object') {
        errorMsg = json.error.message || json.error.code || 'Something went wrong.';
      } else if (typeof json?.message === 'string') {
        errorMsg = json.message;
      } else if (res.status === 404) {
        errorMsg = path.includes('auth')
          ? "We couldn't find a member account for this number. Please contact your gym."
          : 'The requested service or endpoint is temporarily unavailable. Please try again shortly.';
      } else if (res.status >= 500) {
        errorMsg = 'Gym service is temporarily unavailable. Please try again shortly.';
      }
      throw new Error(errorMsg);
    }

    return json as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }
    throw new Error("Couldn't connect to gym service. Check your internet connection and try again.");
  }
}

// ── Member API Client ────────────────────────────────────────────────

export const apiClient = {
  // Auth
  async requestOtp(phone: string): Promise<{ success: boolean; challenge?: string; gym_name?: string; message?: string; is_staff?: boolean; error?: string }> {
    return request('/api/member/v1/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }, 12000, false);
  },

  async verifyOtp(phone: string, otp: string, challenge: string): Promise<{ success: boolean; data: { token: string; refresh_token: string; member: any } }> {
    const res = await request<{ success: boolean; data: { token: string; refresh_token: string; member: any } }>('/api/member/v1/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp, challenge }),
    }, 12000, false);
    if (res.success && res.data?.token) {
      await saveToken(res.data.token);
      if (res.data.refresh_token) await saveRefreshToken(res.data.refresh_token);
    }
    return res;
  },

  // Dashboard & Branding
  async getDashboard(): Promise<DashboardResponse> {
    const res = await request<{ success: boolean; data: DashboardResponse }>('/api/member/v1/dashboard');
    return res.data;
  },

  async getGymBranding(): Promise<GymBranding> {
    const res = await request<{ success: boolean; data: { branding: GymBranding } }>('/api/member/v1/gym-branding');
    return res.data.branding;
  },

  // Membership Detail
  async getMembership(): Promise<{
    membership: {
      status: string;
      plan_name: string | null;
      plan_price: string | null;
      plan_duration_days: number | null;
      membership_start: string | null;
      membership_end: string | null;
      days_left: number | null;
      is_expired: boolean;
      joined_on: string | null;
    };
    gym: { name: string | null; phone: string | null };
    renewal_history: RenewalRecord[];
    active_renewal_demand: RenewalDemand | null;
  }> {
    const res = await request<{ success: boolean; data: any }>('/api/member/v1/membership');
    return res.data;
  },

  // Plans
  async getPlans(): Promise<MembershipPlan[]> {
    const res = await request<{ success: boolean; data: { plans: MembershipPlan[] } }>('/api/member/v1/plans');
    return res.data.plans;
  },

  // Payment Info for Renewal
  async getPaymentInfo(): Promise<PaymentInfo> {
    const res = await request<{ success: boolean; data: PaymentInfo }>('/api/member/v1/payment-info');
    return res.data;
  },

  // Automated UPI Renewal Flow
  async initiateUpiRenewal(planId?: number): Promise<UPIPaymentSession> {
    const res = await request<{ success: boolean; data: UPIPaymentSession }>('/api/member/v1/renew/initiate-upi', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId }),
    });
    return res.data;
  },

  async confirmUpiPayment(paymentId?: number, reference?: string): Promise<{
    payment_id: number;
    amount_paid: string;
    standard_price?: string;
    discount?: string;
    reference?: string;
    new_end?: string;
    plan_name?: string;
    status: string;
  }> {
    const res = await request<{ success: boolean; message?: string; data: any }>('/api/member/v1/renew/confirm-upi', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, reference }),
    });
    return res.data;
  },

  async failUpiPayment(paymentId?: number): Promise<{ success: boolean; message?: string }> {
    const res = await request<{ success: boolean; message?: string }>('/api/member/v1/renew/fail-upi', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId }),
    });
    return res;
  },

  async getPaymentStatus(paymentId: number): Promise<{
    payment_id: number;
    status: string;
    amount: string;
    reference?: string;
    new_end?: string | null;
    is_verified: boolean;
  }> {
    const res = await request<{ success: boolean; data: any }>(`/api/member/v1/renew/payment-status/${paymentId}`);
    return res.data;
  },

  // Claim Payment
  async claimPayment(planId?: number, reference?: string): Promise<{
    payment_id: number;
    amount: string;
    plan_name?: string | null;
    status: string;
    already_pending?: boolean;
  }> {
    const res = await request<{ success: boolean; message?: string; data: any }>('/api/member/v1/renew/claim', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId, reference }),
    });
    return res.data;
  },

  // Payments History
  async getPayments(page = 1, perPage = 20): Promise<{
    payments: PaymentRecord[];
    pagination: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const res = await request<{ success: boolean; data: any }>(`/api/member/v1/payments?page=${page}&per_page=${perPage}`);
    return res.data;
  },

  // Access & Attendance
  async getAccess(page = 1, perPage = 20): Promise<{
    summary: AccessSummary;
    events: AccessEventRecord[];
    pagination: { page: number; per_page: number; total: number; total_pages: number };
  }> {
    const res = await request<{ success: boolean; data: any }>(`/api/member/v1/access?page=${page}&per_page=${perPage}`);
    return res.data;
  },

  // Profile
  async getProfile(): Promise<{
    member: Member;
    gym: { name: string | null; phone: string | null; address: string | null };
    payment_info: PaymentInfo | null;
  }> {
    const res = await request<{ success: boolean; data: any }>('/api/member/v1/profile');
    return res.data;
  },

  async updateProfile(input: { email: string | null; address: string | null; gender: string | null }): Promise<{
    member: Member;
    gym: { name: string | null; phone: string | null; address: string | null };
    payment_info: PaymentInfo | null;
  }> {
    const res = await request<{ success: boolean; data: any }>('/api/member/v1/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  async uploadProfilePhoto(uri: string, mimeType: string, fileName: string): Promise<string | null> {
    const form = new FormData();
    form.append('photo', { uri, type: mimeType, name: fileName } as unknown as Blob);
    const res = await request<{ success: boolean; data: { profile_photo_url: string | null } }>(
      '/api/member/v1/profile/photo',
      { method: 'POST', body: form },
      30000,
    );
    return res.data.profile_photo_url;
  },

  async removeProfilePhoto(): Promise<void> {
    await request('/api/member/v1/profile/photo', { method: 'DELETE' });
  },
};
