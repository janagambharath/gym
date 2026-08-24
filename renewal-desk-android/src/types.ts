/**
 * Shared type definitions matching the actual backend API response shapes.
 * These are the source of truth for data types across all screens.
 */

// ─── Member ──────────────────────────────────────────────────────────

export type MemberPlan = {
  id: number;
  name: string;
  duration_days: number;
  price: string;
};

export type Member = {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  gender: string | null;
  status: 'active' | 'expired' | 'deleted';
  membership_start: string | null;
  membership_end: string | null;
  days_until_expiry: number | null;
  plan: MemberPlan | null;
  joined_on: string | null;
  notes: string | null;
  whatsapp_opted_in: boolean;
  has_biometric: boolean;
};

export type MembersResponse = {
  members: Member[];
  pagination: Pagination;
};

// ─── Pagination ──────────────────────────────────────────────────────

export type Pagination = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

// ─── Dashboard ───────────────────────────────────────────────────────

export type DashboardData = {
  total_active: number;
  expiring_soon: number;
  expired: number;
  pending_payments: number;
  sent_reminders: number;
  failed_reminders: number;
  total_collected: string;
  revenue_today?: string;
  revenue_week?: string;
  revenue_month?: string;
  expiring_today?: number;
  pending_payment_amount?: string;
};

// ─── Payment ─────────────────────────────────────────────────────────

export type Payment = {
  id: number;
  member_id: number;
  member_name: string | null;
  amount: string;
  paid_on: string | null;
  method: string;
  reference: string | null;
  status: string;
  renewal_days: number | null;
  notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string | null;
};

export type PaymentsResponse = {
  payments: Payment[];
  pagination: Pagination;
};

// ─── Renewal ─────────────────────────────────────────────────────────

export type Renewal = {
  id: number;
  member_id: number;
  member_name: string | null;
  plan_name: string | null;
  previous_end: string | null;
  new_start: string | null;
  new_end: string | null;
  amount: string;
  notes: string | null;
  renewed_by: string | null;
  created_at: string | null;
};

export type RenewalsResponse = {
  renewals: Renewal[];
  pagination: Pagination;
};

// ─── Settings ────────────────────────────────────────────────────────

export type GymSettings = {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  whatsapp_enabled: boolean;
  max_members: number | null;
  subscription_status: string | null;
};

export type Plan = {
  id: number;
  name: string;
  duration_days: number;
  price: string;
};

export type SettingsResponse = {
  gym: GymSettings;
  plans: Plan[];
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Derive the display status for a member (active/expiring/expired). */
export function getMemberDisplayStatus(member: Member): 'active' | 'expiring' | 'expired' {
  if (member.status === 'expired') return 'expired';
  if (
    member.days_until_expiry !== null &&
    member.days_until_expiry !== undefined &&
    member.days_until_expiry <= 7 &&
    member.days_until_expiry >= 0
  ) {
    return 'expiring';
  }
  return member.status === 'active' ? 'active' : 'expired';
}

/** Format a date string to "DD Mon YYYY" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format a number as Indian Rupees */
export function formatCurrency(value: string | number): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num)) return '₹0';
  return `₹${num.toLocaleString('en-IN')}`;
}

/** Get days text from days_until_expiry */
export function getDaysText(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days > 0) return `${days} days`;
  if (days === 0) return 'Today';
  return `${Math.abs(days)}d overdue`;
}
