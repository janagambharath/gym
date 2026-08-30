import { getCachedSession } from './services/apiClient';

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

export type RecentHandover = {
  id: number;
  customer_name: string;
  phone: string;
  state?: string;
  handover_status?: string;
  last_message: string;
  last_message_at: string | null;
};

export type BotSummary = {
  handover_count: number;
  total_leads: number;
  new_leads: number;
  trial_requests: number;
  recent_handovers: RecentHandover[];
};

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
  bot_summary?: BotSummary;
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
  country?: string;
  currency?: string;
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

// ---------------------------------------------------------------------------
// WhatsApp Bot
// ---------------------------------------------------------------------------

/** Tenant-scoped operational counters returned by GET /bot/stats. */
export type BotStats = {
  total_conversations: number;
  total_leads: number;
  trial_requests: number;
  contacted_leads: number;
  converted_leads: number;
  handover_requested: number;
};

/** Safe, owner-managed bot settings returned by GET /bot/config. */
export type BotConfig = {
  greeting_message: string | null;
  opening_hours: string | null;
  map_link: string | null;
  trial_enabled: boolean;
  trial_price: string | null;
  trial_duration_days: number | null;
  registration_link: string | null;
  handover_enabled: boolean;
};

export type BotFAQ = {
  id: number;
  question: string;
  answer: string;
  enabled: boolean;
};

export type BotConfigResponse = {
  config: BotConfig;
  faqs: BotFAQ[];
};

export type BotConfigUpdate = Partial<BotConfig>;

export type BotConversation = {
  id: number;
  phone: string;
  customer_name: string | null;
  state: string;
  handover_status: string;
  last_message_at: string | null;
};

export type BotConversationsResponse = {
  conversations: BotConversation[];
};

export type BotMessage = {
  id: number;
  sender: string;
  body: string;
  created_at: string | null;
};

export type BotLead = {
  id: number;
  name: string | null;
  phone: string;
  source: string;
  intent: string | null;
  status: string;
  interested_plan: string | null;
  trial_requested: boolean;
  notes: string | null;
  created_at: string | null;
  conversation_id: number | null;
};

/** Read-only lead context included with a conversation history. */
export type BotLeadSummary = Pick<
  BotLead,
  | 'id'
  | 'name'
  | 'phone'
  | 'source'
  | 'intent'
  | 'status'
  | 'interested_plan'
  | 'trial_requested'
  | 'created_at'
>;

/** Bounded transcript returned by GET /bot/conversations/:id. */
export type BotConversationDetailResponse = {
  conversation: BotConversation;
  messages: BotMessage[];
  lead: BotLeadSummary | null;
};

export type BotLeadsResponse = {
  leads: BotLead[];
  pagination: Pagination;
};

export type BotLeadDetailResponse = {
  lead: BotLead;
  messages: BotMessage[];
};

export type BotLeadUpdate = Pick<BotLead, 'status' | 'notes' | 'name'>;

// ─── Notifications ───────────────────────────────────────────────────

export type AppNotificationItem = {
  id: number;
  title: string;
  body: string;
  category: 'handover' | 'lead' | 'trial' | 'payment' | 'renewal' | 'general';
  data?: {
    screen?: string;
    conversation_id?: number;
    lead_id?: number;
    payment_id?: number;
    member_id?: number;
    phone?: string;
    customer_name?: string;
  };
  is_read: boolean;
  created_at: string | null;
};

export type NotificationsResponse = {
  notifications: AppNotificationItem[];
  unread_count: number;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
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
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format a number according to gym currency or specified currency code */
export function formatCurrency(value: string | number, customCurrency?: string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num)) return '0';

  const currencyCode = (customCurrency || getCachedSession()?.gymCurrency || 'INR').toUpperCase();
  const symbolMap: Record<string, string> = {
    INR: '₹',
    AED: 'AED ',
    USD: '$',
    GBP: '£',
    EUR: '€',
    AUD: 'A$',
    CAD: 'C$',
    SAR: 'SAR ',
    QAR: 'QAR ',
    KWD: 'KWD ',
    OMR: 'OMR ',
    SGD: 'S$',
  };
  const symbol = symbolMap[currencyCode] ?? `${currencyCode} `;
  const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
  return `${symbol}${num.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Get days text from days_until_expiry */
export function getDaysText(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days > 0) return `${days} days`;
  if (days === 0) return 'Today';
  return `${Math.abs(days)}d overdue`;
}
