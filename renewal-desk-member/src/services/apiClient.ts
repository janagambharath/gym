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
} from '../types';

const TOKEN_KEY = 'vynla_member_token';
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://gym-production-910c.up.railway.app').replace(/\/$/, '');

// ── Secure Token Storage ─────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // Fallback if secure store fails
  }
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
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Fallback
  }
}

// ── HTTP Helper ──────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 12000
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);

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
        if (json.error.code === 'NOT_FOUND' || res.status === 404) {
          errorMsg = "We couldn't find a member account for this number. Please contact your gym.";
        } else {
          errorMsg = json.error.message || json.error.code || 'Something went wrong.';
        }
      } else if (res.status === 404) {
        errorMsg = "We couldn't find a member account for this number. Please contact your gym.";
      } else if (res.status >= 500) {
        errorMsg = 'Gym service is temporarily unavailable. Please try again shortly.';
      }
      throw new Error(errorMsg);
    }

    return json as T;
  } catch (err: any) {
    clearTimeout(timer);
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
    });
  },

  async verifyOtp(phone: string, otp: string, challenge: string): Promise<{ success: boolean; data: { token: string; member: any } }> {
    const res = await request<{ success: boolean; data: { token: string; member: any } }>('/api/member/v1/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp, challenge }),
    });
    if (res.success && res.data?.token) {
      await saveToken(res.data.token);
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
};
