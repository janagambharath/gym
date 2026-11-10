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
  address?: string | null;
  gender: string | null;
  status: 'active' | 'expired' | 'paused' | 'deleted';
  membership_start: string | null;
  membership_end: string | null;
  days_until_expiry: number | null;
  plan: MemberPlan | null;
  joined_on: string | null;
  notes: string | null;
  whatsapp_opted_in: boolean;
  has_biometric: boolean;
  device_enroll_number?: string | null;
  // Member profile photo (owner-set from MemberDetailScreen, or
  // member-set from VYNLA). Signed URL, expires in 7 days — never
  // cached long-term; re-fetch the member to refresh it.
  profile_photo_url?: string | null;
  is_inside?: boolean;
  door_blocked?: boolean;
  door_access_pending?: boolean;
  door_access_pending_action?: 'block' | 'unblock' | null;
  door_access_connector?: 'adms_direct' | 'bridge' | null;
  door_access_error?: string | null;
  // V6-M8: latest manual command failed — door state is unknown.
  door_access_failed?: boolean;
  door_access_failed_action?: 'block' | 'unblock' | null;
  door_access_failed_at?: string | null;
  // V6-M9: queued command the terminal never picked up — not blocked-as-fact.
  door_access_stale_queued?: boolean;
  door_access_queued_since?: string | null;
  door_access_terminal_last_seen_at?: string | null;
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

// ─── Payment ─────────────────────────────────────────────────────────

export type Payment = {
  id: number;
  member_id: number;
  member_name: string | null;
  member_phone?: string | null;
  plan_id?: number | null;
  plan_name?: string | null;
  standard_price?: string | null;
  discount?: string | null;
  final_payable?: string | null;
  amount: string;
  paid_on: string | null;
  method: string;
  channel?: 'online' | 'offline';
  reference: string | null;
  status: string;
  renewal_days: number | null;
  renewal_start_date?: string | null;
  notes: string | null;
  created_by?: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string | null;
  receipt?: {
    payment_id: number;
    receipt_number: string;
    member_name: string;
    member_phone: string;
    gym_name: string;
    amount: string;
    plan_name: string;
    paid_on: string;
    valid_until: string;
    receipt_text: string;
    whatsapp_url: string;
  };
  whatsapp_url?: string | null;
};

export type PaymentSummaryToday = {
  total_collected: string;
  total_discount: string;
  payment_count: number;
  methods: {
    upi: string;
    cash: string;
    card: string;
    other: string;
  };
  channels: {
    online: string;
    offline: string;
  };
};

export type PaymentDashboardSummary = {
  today: PaymentSummaryToday;
  pending: {
    count: number;
    amount: string;
  };
  failed: {
    count: number;
  };
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
  // V5-L35: the backend serializes `channel` on renewals
  // (app/mobile_api/renewals.py) — render it like the PWA does.
  channel?: 'online' | 'offline';
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
  country: string;
  currency: string;
  show_biometric_link_banner: boolean;
  whatsapp_enabled: boolean;
  whatsapp_connection_status: 'NOT_CONNECTED' | 'PENDING' | 'ACTION_REQUIRED' | 'CONNECTED' | 'FAILED';
  max_members: number | null;
  subscription_status: string | null;
  billing: BillingEntitlement;
};

export type BillingEntitlement = {
  billing_source: 'MANUAL' | 'GOOGLE_PLAY';
  plan_id: string | null;
  plan_name: string | null;
  subscription_status: 'TRIAL' | 'ACTIVE' | 'PAYMENT_FAILED' | 'GRACE_PERIOD' | 'CANCELLED' | 'EXPIRED' | 'PENDING';
  started_at: string | null;
  renews_at: string | null;
  expires_at: string | null;
  grace_period_end: string | null;
  purchase_management_available: boolean;
};

export type BillingCatalogPlan = {
  id: string;
  name: string;
  price: string;
  currency: string;
};

export type BillingCatalogResponse = {
  country: string;
  currency: string;
  plans: BillingCatalogPlan[];
};

export type Plan = {
  id: number;
  name: string;
  duration_days: number;
  price: string;
};

export type PaymentSettings = {
  upi_id: string | null;
  payment_label: string | null;
  instructions: string | null;
  qr_public_url?: string | null;
  is_active: boolean;
};

export type SettingsResponse = {
  gym: GymSettings;
  plans: Plan[];
  payment_settings?: PaymentSettings;
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
  category: 'handover' | 'lead' | 'trial' | 'payment' | 'renewal' | 'general' | 'terminal_offline';
  data?: {
    screen?: string;
    conversation_id?: number;
    lead_id?: number;
    payment_id?: number;
    member_id?: number;
    phone?: string;
    customer_name?: string;
    /** G3 (v11): terminal-offline alerts carry the terminal serial and
     * the last successful poll so the inbox can render them distinctly. */
    device_serial?: string;
    last_success_at?: string | null;
    integration_id?: number;
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

/** Derive the display status for a member (active/expiring/expired/paused). */
export function getMemberDisplayStatus(member: Member): 'active' | 'expiring' | 'expired' | 'paused' {
  if (member.status === 'paused') return 'paused';
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

type DisplayPreferences = {
  country: string;
  currency: string;
  timezone: string;
};

const localeByCountry: Record<string, string> = {
  AE: 'en-AE', AU: 'en-AU', GB: 'en-GB', IN: 'en-IN', US: 'en-US',
};

let displayPreferences: DisplayPreferences = {
  country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata',
};

/** The last invalid stored gym timezone seen (e.g. Yodha's literal
 * 'india'). Mirrors the PWA V9-L12: formatters used to fall back to
 * device-local time silently while the UI still claimed "(gym time)".
 * The bad value is remembered so the Dashboard can warn the owner
 * instead (V10-L34); the effective zone falls back to Asia/Kolkata
 * EXPLICITLY, never silently to device-local. */
let invalidStoredTimezone: string | null = null;

/** The stored timezone that failed validation, or null when it is valid. */
export function getInvalidStoredTimezone(): string | null {
  return invalidStoredTimezone;
}

/** The timezone actually used for display (always a valid IANA zone). */
export function getEffectiveTimezone(): string {
  return displayPreferences.timezone;
}

/** Timezones already warned about, so a broken gym timezone is loud once
 * instead of spamming the log on every formatted date. */
const warnedInvalidTimezones = new Set<string>();

function warnInvalidTimezoneOnce(timezone: string): void {
  if (warnedInvalidTimezones.has(timezone)) return;
  warnedInvalidTimezones.add(timezone);
  console.warn(
    `[display] Invalid gym timezone "${timezone}" — dates will use Asia/Kolkata until the gym profile is fixed in Settings.`,
  );
}

/** True when Intl accepts the timezone. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The gym's configured timezone (for date-key helpers that need it). */
export function getDisplayTimezone(): string {
  return displayPreferences.timezone;
}

/**
 * Gym-local YYYY-MM-DD key that never throws: an invalid gym timezone
 * falls back to the device-local date (with a loud warning) instead of
 * the RangeError that used to crash Renew/Record Payment at render
 * (V5-L32). The fallback date can be a day off the gym's — the warning
 * is the signal to fix the stored timezone, not a silent correction.
 */
export function safeDateKeyInTimezone(value: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    const key = `${part('year')}-${part('month')}-${part('day')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  } catch {
    // Fall through to the device-local key below.
  }
  warnInvalidTimezoneOnce(timezone);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Configure output from the authenticated gym's server-provided locale. */
export function configureDisplayPreferences(preferences: Partial<DisplayPreferences>): void {
  // V5-L32: validate the gym timezone once at session load — a typo'd
  // timezone used to crash money screens at render (RangeError) while
  // every shared formatter silently fell back to device-local times.
  // Warn loudly here so the bad value is visible; the formatters and
  // safeDateKeyInTimezone still fall back instead of throwing.
  // V10-L34 (PWA V9-L12 mirror): remember the invalid stored value and
  // fall back to Asia/Kolkata EXPLICITLY, so the Dashboard warning can
  // name the stored value and the effective zone instead of the UI
  // silently claiming "(gym time)" while showing device-local times.
  const storedTz = preferences.timezone ?? displayPreferences.timezone;
  if (storedTz && !isValidTimezone(storedTz)) {
    invalidStoredTimezone = storedTz;
    warnInvalidTimezoneOnce(storedTz);
  } else if (storedTz) {
    invalidStoredTimezone = null;
  }
  displayPreferences = {
    country: preferences.country?.toUpperCase() || displayPreferences.country,
    currency: preferences.currency?.toUpperCase() || displayPreferences.currency,
    timezone: storedTz && isValidTimezone(storedTz) ? storedTz : (storedTz ? 'Asia/Kolkata' : displayPreferences.timezone),
  };
}

function displayLocale(): string {
  return localeByCountry[displayPreferences.country] ?? 'en-US';
}

/** Format a date in the gym's configured country and timezone. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T12:00:00.000Z`)
    : new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: displayPreferences.timezone,
    }).format(d);
  } catch {
    return d.toLocaleDateString(displayLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

/** Format a number according to gym currency or specified currency code */
export function formatCurrency(value: string | number, customCurrency?: string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  const currency = (customCurrency || displayPreferences.currency || 'INR').toUpperCase();
  try {
    return new Intl.NumberFormat(displayLocale(), {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currency} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleString(displayLocale());
  }
}

/** Format just the time-of-day in the gym's timezone (for punch/event times). */
export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      hour: 'numeric', minute: '2-digit',
      timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' });
  }
}

const countryPrefixByCode: Record<string, string> = {
  IN: '+91', US: '+1', GB: '+44', AE: '+971', SG: '+65', AU: '+61',
};

/** Map a gym timezone to the phone country prefix for that gym's country.
 * Derived from the gym's own timezone — never a hardcoded +91. When the
 * timezone is unknown, fall back to the gym's stored country; when that
 * is unknown too, return '' (no prefix) so a 10-digit number is left as
 * typed instead of being silently mislabelled +91. */
export function getPhoneCountryPrefix(timezone?: string, country?: string): string {
  if (timezone) {
    const tz = timezone.toLowerCase();
    if (tz.startsWith('asia/kolkata') || tz.startsWith('asia/calcutta') || tz === 'ist') return '+91';
    if (tz.startsWith('america/')) return '+1';
    if (tz.startsWith('europe/london')) return '+44';
    if (tz.startsWith('asia/dubai')) return '+971';
    if (tz.startsWith('asia/singapore')) return '+65';
    if (tz.startsWith('australia/')) return '+61';
  }
  const code = country?.trim().toUpperCase();
  if (code && countryPrefixByCode[code]) return countryPrefixByCode[code];
  return '';
}

/** Best-effort locale guess from an E.164 phone number.
 * No member endpoint exposes the gym's country/currency/timezone, so the
 * member app derives display prefs from the member's own phone prefix
 * (a gym's members overwhelmingly share its country). A backend
 * gym-branding locale field would be the proper fix. */
export function localeFromPhonePrefix(phone: string | undefined): Partial<DisplayPreferences> {
  const digits = (phone || '').replace(/[^\d]/g, '');
  // E.164 prefixes, longest first.
  const table: [string, Partial<DisplayPreferences>][] = [
    ['971', { country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' }],
    ['44', { country: 'GB', currency: 'GBP', timezone: 'Europe/London' }],
    ['65', { country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore' }],
    ['61', { country: 'AU', currency: 'AUD', timezone: 'Australia/Sydney' }],
    ['1', { country: 'US', currency: 'USD', timezone: 'America/New_York' }],
    ['91', { country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' }],
  ];
  for (const [prefix, prefs] of table) {
    if (digits.startsWith(prefix)) return prefs;
  }
  return {};
}

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(displayLocale(), {
      day: 'numeric', month: 'short', timeZone: displayPreferences.timezone,
    }).format(date);
  } catch {
    return date.toLocaleDateString(displayLocale());
  }
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat(displayLocale()).format(value);
}

export function getGymTodayISO(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: displayPreferences.timezone,
    }).formatToParts(new Date());
    const find = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = find('year'); const month = find('month'); const day = find('day');
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall through only if timezone-aware Intl support is unavailable.
  }
  return new Date().toISOString().slice(0, 10);
}

/** Return the currency symbol for the current gym (e.g. '₹', '$', 'AED '). */
export function getCurrencySymbol(): string {
  const currencyCode = (displayPreferences.currency || 'INR').toUpperCase();
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
  return symbolMap[currencyCode] ?? `${currencyCode} `;
}

/** Get days text from days_until_expiry */
export function getDaysText(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days > 0) return `${days} days`;
  if (days === 0) return 'Today';
  return `${Math.abs(days)}d overdue`;
}

// ─── Access / Live Access ────────────────────────────────────────────

export type AccessSummary = {
  inside_now: number;
  entries_today: number;
  exits_today: number;
  denied_today: number;
  last_event_at: string | null;
  device_online: boolean;
  device_name: string | null;
  last_heartbeat: string | null;
  has_legacy_events?: boolean;
  bridge_provisioned?: boolean;
  bridge_online?: boolean;
  device_serial?: string;
  installed_version?: string;
  pending_commands?: number;
  failed_commands?: number;
  heartbeat_age_seconds?: number | null;
  remote_unlock_available?: boolean;
  remote_unlock_reason?: string;
  remote_unlock_path?: 'bridge' | 'adms';
  /** Direct Cloud (ADMS) integration id, or null when the gym is on the legacy bridge. Set by /access/summary; gates the bridge-only Re-sync button. */
  adms_integration_id?: number | null;
  /**
   * Queued Direct ADMS commands (V10-L33) — added to the summary
   * payload by the backend in the same fix-all. Absent (undefined) on
   * an older backend: the screen renders nothing in that case.
   * Exact contract: { count, commands: [{ id, action, enroll_number, queued_at }] }.
   */
  queued_adms_commands?: {
    count: number;
    commands: {
      id: number;
      action: string;
      enroll_number: string | null;
      queued_at: string | null;
    }[];
  } | null;
  /**
   * G3 (v11): terminal-offline alert — present ONLY while the terminal
   * has not polled for 60+ minutes. The dashboard renders a warning
   * card from this field and drops it automatically when polling
   * resumes. Absent (undefined) on an older backend: the dashboard
   * renders nothing. Exact contract: { since, last_success_at }.
   */
  terminal_offline?: {
    since: string;
    last_success_at: string | null;
  } | null;
};

export type AccessEvent = {
  id: number;
  event_type: 'ENTRY' | 'EXIT' | 'ACCESS_DENIED' | 'ATTENDANCE' | 'UNKNOWN';
  direction: 'IN' | 'OUT' | 'UNKNOWN';
  event_timestamp: string;
  member_id: number | null;
  member_name: string | null;
  profile_photo_url?: string | null;
  membership_status: string | null;
  device_name: string | null;
  device_enroll_number: string;
  biometric_user_id?: string | null;
  is_invalid: boolean;
  verify_method: number | null;
};

export type AccessEventsResponse = {
  events: AccessEvent[];
  pagination: Pagination;
};

// ─── Campaigns ───────────────────────────────────────────────────────

export type CampaignType = 'recovery' | 'promotion';

export type PromoPreset =
  | 'special_offer'
  | 'festival_offer'
  | 'referral_offer'
  | 'pt_offer'
  | 'new_membership'
  | 'announcement';

export type CampaignSegmentType =
  | 'expiring_today'
  | 'expiring_3d'
  | 'expiring_7d'
  | 'expiring_14d'
  | 'expiring_30d'
  | 'recently_expired'
  | 'inactive_30d'
  | 'inactive_60d'
  | 'inactive_90d'
  | 'all_active'
  | 'all_expired'
  | 'all_customers'
  | 'custom_import';

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'completed' | 'failed';

export type Campaign = {
  id: number;
  name: string;
  campaign_type?: CampaignType;
  promo_preset?: PromoPreset | null;
  segment_type: CampaignSegmentType;
  status: CampaignStatus;
  total_recipients: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_replied: number;
  total_renewed: number;
  total_revenue_recovered: string;
  sent_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string | null;
  error_message: string | null;
};

export type CampaignRecipient = {
  id: number;
  member_id: number;
  member_name: string | null;
  member_phone: string | null;
  member_status: string | null;
  plan_name: string | null;
  plan_price: string | null;
  membership_end: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  reply_at: string | null;
  payment_claimed_at: string | null;
  renewed_at: string | null;
  renewal_amount: string | null;
  error_message: string | null;
};

export type CampaignSegment = {
  type: CampaignSegmentType;
  label: string;
};

export type SegmentPreview = {
  segment_type: CampaignSegmentType;
  total: number;
  preview: {
    id: number;
    full_name: string;
    phone: string;
    membership_end: string | null;
    days_until_expiry: number | null;
    plan_name: string | null;
    plan_price: string | null;
  }[];
};

export type CampaignsResponse = {
  campaigns: Campaign[];
  pagination: Pagination;
};

export type CampaignRecipientsResponse = {
  recipients: CampaignRecipient[];
  pagination: Pagination;
};

export type CampaignTemplate = {
  name: string;
  purpose: 'recovery' | 'promotion' | 'system';
  title: string;
  variables: string[];
  description: string;
  body_preview: string;
};

export type ImportedContact = {
  name: string;
  phone: string;
  expiry_date?: string | null;
  plan?: string | null;
  renewal_amount?: number | null;
};

export type ImportValidationRow = {
  row: number;
  raw: Record<string, string>;
  error?: string;
  normalized?: ImportedContact;
};

export type ImportValidationResult = {
  valid: boolean;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  valid_contacts: ImportedContact[];
  errors: ImportValidationRow[];
};

export type CooldownCheckResult = {
  total_checked: number;
  in_cooldown_count: number;
  in_cooldown_phones: string[];
  days: number;
};

// ─── Revenue Recovered ───────────────────────────────────────────────

export type RevenueRecovered = {
  total_renewals: number;
  total_amount: string;
  campaign_renewals: number;
  campaign_amount: string;
  /** Verified-only money: renewals backed by a verified payment. */
  payment_backed_renewals?: number;
  payment_backed_amount?: string;
  /** Owner-recorded renewals with no verified payment on file. */
  direct_renewals?: number;
  direct_amount?: string;
};

export type RecoveryRate = {
  revenue_at_risk: string;
  revenue_recovered: string;
  recovery_rate: string;
  risk_breakdown: {
    total: string;
    expiring_count: number;
    expiring_amount: string;
    expired_count: number;
    expired_amount: string;
  };
  recovered_breakdown: RevenueRecovered;
};

export type TodaysAction = {
  type: 'expiring_today' | 'pending_payments' | 'new_leads';
  count: number;
  label: string;
  action: string;
};

export type LatestCampaign = {
  id: number;
  name: string;
  segment_type: CampaignSegmentType;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_replied: number;
  total_renewed: number;
  total_revenue_recovered: string;
  sent_at: string | null;
};

// ─── Enhanced Dashboard ──────────────────────────────────────────────

export type DashboardData = {
  total_active: number;
  expiring_soon: number;
  expired: number;
  pending_payments: number;
  sent_reminders: number;
  failed_reminders: number;
  total_collected: string;
  revenue_at_risk: string;
  revenue_today: string;
  revenue_week: string;
  revenue_month: string;
  expiring_today: number;
  revenue_recovered: RevenueRecovered | null;
  recovery_rate: RecoveryRate | null;
  todays_actions: TodaysAction[];
  latest_campaign: LatestCampaign | null;
  bot_summary: {
    handover_count: number;
    total_leads: number;
    new_leads: number;
    trial_requests: number;
    recent_handovers: {
      id: number;
      phone: string;
      customer_name: string;
      state: string;
      handover_status: string;
      last_message: string;
      last_message_at: string | null;
    }[];
  };
  access_summary: AccessSummary | null;
};

/** Segment label mapping for display purposes. */
export const SEGMENT_LABELS: Record<CampaignSegmentType, string> = {
  expiring_today: 'Expiring Today',
  expiring_3d: 'Expiring in 3 Days',
  expiring_7d: 'Expiring in 7 Days',
  expiring_14d: 'Expiring in 14 Days',
  expiring_30d: 'Expiring in 30 Days',
  recently_expired: 'Recently Expired',
  inactive_30d: 'Inactive 30+ Days',
  inactive_60d: 'Inactive 60+ Days',
  inactive_90d: 'Inactive 90+ Days',
  all_active: 'All Active Members',
  all_expired: 'All Expired Members',
  all_customers: 'All Customers (Active + Expired)',
  custom_import: 'Custom Contact List',
};
