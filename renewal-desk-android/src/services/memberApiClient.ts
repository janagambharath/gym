/**
 * Member-side API client for Renewal Desk Member App.
 *
 * Uses the same runtime configuration and API base URL as the owner app
 * but authenticates with member OTP tokens instead of owner JWT.
 * Token is persisted in SecureStore for session persistence.
 */
import * as SecureStore from 'expo-secure-store';

import { getRuntimeConfiguration } from '../config/runtime';

// ── Types ────────────────────────────────────────────────────────────

export type MemberSession = {
  token: string;
  memberId: number;
  fullName: string;
  phone: string;
  gymName: string;
  membershipStatus: string;
  membershipEnd: string | null;
  planName: string | null;
};

export type MemberDashboard = {
  member: {
    id: number;
    full_name: string;
    phone: string;
    status: string;
    membership_start: string | null;
    membership_end: string | null;
    days_left: number | null;
    is_expired: boolean;
    plan_name: string | null;
    plan_price: string | null;
  };
  gym: {
    name: string | null;
    phone: string | null;
  };
  recent_renewals: {
    id: number;
    new_start: string;
    new_end: string;
    amount: string;
    created_at: string | null;
  }[];
  pending_payment: {
    id: number;
    amount: string;
    status: string;
    created_at: string | null;
  } | null;
};

export type MemberMembership = {
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
  gym: {
    name: string | null;
    phone: string | null;
  };
  renewal_history: {
    id: number;
    plan_name: string | null;
    previous_end: string | null;
    new_start: string;
    new_end: string;
    amount: string;
    created_at: string | null;
  }[];
};

export type MemberPlan = {
  id: number;
  name: string;
  duration_days: number;
  price: string;
};

export type MemberPayment = {
  id: number;
  amount: string;
  status: string;
  method: string;
  reference: string | null;
  notes: string | null;
  paid_on: string | null;
  created_at: string | null;
  verified_at: string | null;
};

export type MemberAccessSummary = {
  last_visit: string | null;
  today_entries: number;
  today_exits: number;
  is_inside: boolean;
  access_active: boolean;
};

export type MemberAccessEvent = {
  id: number;
  event_type: string;
  direction: string;
  timestamp: string;
  device_name: string | null;
};

export type MemberProfile = {
  member: {
    id: number;
    full_name: string;
    phone: string;
    email: string | null;
    joined_on: string | null;
    status: string;
  };
  gym: {
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  payment_info: {
    upi_id: string | null;
    payment_label: string | null;
    instructions: string | null;
  } | null;
};

export type MemberPaymentInfo = {
  gym_name: string | null;
  gym_phone: string | null;
  upi_id: string | null;
  payment_label: string | null;
  instructions: string | null;
  qr_public_url: string | null;
};

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type BackendEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

// ── Session Storage ──────────────────────────────────────────────────

const SESSION_KEY = 'renewal-desk.member-session.v1';

let cachedSession: MemberSession | undefined;

export function getMemberSession(): MemberSession | undefined {
  return cachedSession;
}

export async function saveMemberSession(session: MemberSession): Promise<void> {
  cachedSession = session;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function loadMemberSession(): Promise<MemberSession | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && typeof parsed.memberId === 'number') {
      cachedSession = parsed as MemberSession;
      return cachedSession;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function clearMemberSession(): Promise<void> {
  cachedSession = undefined;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

// ── API Helpers ──────────────────────────────────────────────────────

function getBaseUrl(): string {
  const config = getRuntimeConfiguration();
  return config.apiBaseUrl || 'https://gym-production-910c.up.railway.app';
}

async function memberApiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
    anonymous?: boolean;
  } = {},
): Promise<ApiResult<T>> {
  const baseUrl = getBaseUrl();
  const { method = 'GET', body, anonymous = false } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (!anonymous && cachedSession?.token) {
    headers['Authorization'] = `Bearer ${cachedSession.token}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const envelope = (await response.json()) as BackendEnvelope<T>;

    if (response.status === 401 && !anonymous) {
      await clearMemberSession();
      return { ok: false, error: 'Session expired. Please sign in again.' };
    }

    if (!response.ok || !envelope.success) {
      return { ok: false, error: envelope.error || envelope.message || `Request failed (${response.status}).` };
    }

    return { ok: true, data: envelope.data as T };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Request timed out. Please try again.' };
    }
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────

export type OtpRequestResult = {
  challenge: string;
  gym_name: string | null;
};

export async function requestOtp(phone: string): Promise<ApiResult<OtpRequestResult>> {
  return memberApiRequest<OtpRequestResult>('/api/member/v1/auth/request-otp', {
    method: 'POST',
    body: { phone },
    anonymous: true,
  });
}

export type OtpVerifyResult = {
  token: string;
  member: {
    id: number;
    full_name: string;
    phone: string;
    gym_name: string | null;
    membership_status: string;
    membership_end: string | null;
    plan_name: string | null;
  };
};

export async function verifyOtp(
  phone: string,
  otp: string,
  challenge: string,
): Promise<ApiResult<OtpVerifyResult>> {
  const result = await memberApiRequest<OtpVerifyResult>('/api/member/v1/auth/verify-otp', {
    method: 'POST',
    body: { phone, otp, challenge },
    anonymous: true,
  });

  if (result.ok && result.data) {
    const { token, member } = result.data;
    const session: MemberSession = {
      token,
      memberId: member.id,
      fullName: member.full_name,
      phone: member.phone,
      gymName: member.gym_name || '',
      membershipStatus: member.membership_status,
      membershipEnd: member.membership_end,
      planName: member.plan_name,
    };
    await saveMemberSession(session);
  }

  return result;
}

// ── Dashboard ────────────────────────────────────────────────────────

export async function fetchMemberDashboard(): Promise<ApiResult<MemberDashboard>> {
  return memberApiRequest<MemberDashboard>('/api/member/v1/dashboard');
}

// ── Membership ───────────────────────────────────────────────────────

export async function fetchMemberMembership(): Promise<ApiResult<MemberMembership>> {
  return memberApiRequest<MemberMembership>('/api/member/v1/membership');
}

// ── Plans ────────────────────────────────────────────────────────────

export async function fetchMemberPlans(): Promise<ApiResult<{ plans: MemberPlan[] }>> {
  return memberApiRequest<{ plans: MemberPlan[] }>('/api/member/v1/plans');
}

// ── Payment Claim ────────────────────────────────────────────────────

export type ClaimResult = {
  payment_id: number;
  amount: string;
  plan_name: string | null;
  status: string;
  already_pending?: boolean;
};

export async function claimPayment(
  planId?: number,
  reference?: string,
): Promise<ApiResult<ClaimResult>> {
  const body: Record<string, unknown> = {};
  if (planId) body.plan_id = planId;
  if (reference) body.reference = reference;

  return memberApiRequest<ClaimResult>('/api/member/v1/renew/claim', {
    method: 'POST',
    body,
  });
}

// ── Payment History ──────────────────────────────────────────────────

export type PaymentHistoryResult = {
  payments: MemberPayment[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
};

export async function fetchMemberPayments(page = 1): Promise<ApiResult<PaymentHistoryResult>> {
  return memberApiRequest<PaymentHistoryResult>(`/api/member/v1/payments?page=${page}`);
}

// ── Access / Attendance ──────────────────────────────────────────────

export type AccessResult = {
  summary: MemberAccessSummary;
  events: MemberAccessEvent[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
};

export async function fetchMemberAccess(page = 1): Promise<ApiResult<AccessResult>> {
  return memberApiRequest<AccessResult>(`/api/member/v1/access?page=${page}`);
}

// ── Profile ──────────────────────────────────────────────────────────

export async function fetchMemberProfile(): Promise<ApiResult<MemberProfile>> {
  return memberApiRequest<MemberProfile>('/api/member/v1/profile');
}

// ── Payment Info ─────────────────────────────────────────────────────

export async function fetchMemberPaymentInfo(): Promise<ApiResult<MemberPaymentInfo>> {
  return memberApiRequest<MemberPaymentInfo>('/api/member/v1/payment-info');
}
