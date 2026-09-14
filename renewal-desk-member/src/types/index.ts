export type MembershipState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'PAUSED' | 'CANCELLED';

export interface Member {
  id: number;
  full_name: string;
  phone: string;
  email?: string | null;
  joined_on?: string | null;
  status: string;
  membership_start: string | null;
  membership_end: string | null;
  days_left: number | null;
  is_expired: boolean;
  plan_name: string | null;
  plan_price: string | null;
}

export interface Gym {
  name: string | null;
  phone: string | null;
  address?: string | null;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  date?: string | null;
}

export interface Offer {
  id: number;
  title: string;
  description: string;
  promo_preset?: string | null;
  created_at?: string | null;
}

export interface GymBranding {
  gym_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  tagline: string;
  address: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  website: string | null;
  opening_hours: string;
  powered_by: string;
  announcements: Announcement[];
  offers: Offer[];
}

export interface MembershipPlan {
  id: number;
  name: string;
  duration_days: number;
  price: string;
}

export interface RenewalRecord {
  id: number;
  plan_name?: string | null;
  previous_end?: string | null;
  new_start: string;
  new_end: string;
  amount: string;
  standard_price?: string | null;
  discount?: string | null;
  channel?: string | null;
  created_at: string | null;
}

export interface PaymentRecord {
  id: number;
  amount: string;
  status: 'pending' | 'processing' | 'verified' | 'rejected' | 'failed' | 'cancelled' | 'refunded';
  method: string;
  channel?: 'online' | 'offline' | string;
  plan_name?: string | null;
  standard_price?: string | null;
  discount?: string | null;
  savings?: string | null;
  reference?: string | null;
  notes?: string | null;
  paid_on?: string | null;
  created_at?: string | null;
  verified_at?: string | null;
}

export interface RenewalDemand {
  id: number;
  plan_id: number | null;
  plan_name: string;
  standard_price: string;
  discount: string;
  final_payable: string;
  amount: string;
  savings: string;
  renewal_days: number;
  status: string;
  channel: string;
  created_at: string | null;
}

export interface UPIPaymentSession {
  payment_id: number;
  payable_amount: string;
  standard_price: string;
  discount: string;
  savings: string;
  plan_name: string;
  gym_name: string | null;
  upi_id: string;
  reference: string;
  upi_intent_uri: string;
  status: string;
}

export interface AccessEventRecord {
  id: number;
  event_type: 'ENTRY' | 'EXIT' | 'DENIED';
  direction?: string | null;
  timestamp: string;
  device_name?: string | null;
}

export interface AccessSummary {
  last_visit: string | null;
  today_entries: number;
  today_exits: number;
  is_inside: boolean;
  access_active: boolean;
}

export interface PaymentInfo {
  gym_name: string | null;
  gym_phone: string | null;
  upi_id: string | null;
  payment_label: string | null;
  instructions: string | null;
  qr_public_url: string | null;
}

export interface DashboardResponse {
  member: Member;
  gym: Gym;
  branding: GymBranding;
  recent_renewals: RenewalRecord[];
  pending_payment: {
    id: number;
    amount: string;
    status: string;
    created_at: string | null;
  } | null;
  active_renewal_demand: RenewalDemand | null;
}

export type RootTabParamList = {
  Home: undefined;
  Membership: undefined;
  Payments: undefined;
  Attendance: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  Renew: { initialPlanId?: number } | undefined;
};
