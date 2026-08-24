/**
 * Renewal Desk Design System — Design Tokens
 *
 * Derived from the 5 visual references. Premium B2B SaaS palette:
 * white surfaces, refined dark typography, restrained blue primary,
 * semantic status colors, subtle borders and elevation.
 */

// ─── Color Palette ───────────────────────────────────────────────────

export const colors = {
  // Brand
  brand: '#2563EB',
  brandDark: '#1D4ED8',
  brandLight: '#3B82F6',
  brandSubtle: '#EFF6FF',

  // Surfaces
  background: '#F8F9FB',
  card: '#FFFFFF',
  surface: '#FFFFFF',

  // Text
  text: '#0F172A',
  textSecondary: '#475569',
  muted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Borders
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  borderFocus: '#2563EB',

  // Semantic — Success
  success: '#059669',
  successDark: '#047857',
  successSurface: '#ECFDF5',
  successBorder: '#A7F3D0',

  // Semantic — Warning
  warning: '#D97706',
  warningDark: '#B45309',
  warningSurface: '#FFFBEB',
  warningBorder: '#FDE68A',

  // Semantic — Error / Critical
  critical: '#DC2626',
  criticalDark: '#B91C1C',
  criticalSurface: '#FEF2F2',
  criticalBorder: '#FECACA',

  // Semantic — Info
  info: '#2563EB',
  infoSurface: '#EFF6FF',
  infoBorder: '#BFDBFE',

  // Status-specific
  statusActive: '#059669',
  statusActiveSurface: '#ECFDF5',
  statusExpiring: '#D97706',
  statusExpiringSurface: '#FFFBEB',
  statusExpired: '#DC2626',
  statusExpiredSurface: '#FEF2F2',
  statusPending: '#7C3AED',
  statusPendingSurface: '#F5F3FF',
  statusPaid: '#059669',
  statusPaidSurface: '#ECFDF5',
  statusFailed: '#DC2626',
  statusFailedSurface: '#FEF2F2',
  statusVerified: '#059669',
  statusRejected: '#DC2626',

  // WhatsApp
  whatsapp: '#25D366',
  whatsappDark: '#128C7E',

  // Neutral shades
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',

  // Overlay
  overlay: 'rgba(15, 23, 42, 0.5)',
  overlayLight: 'rgba(15, 23, 42, 0.08)',
} as const;

// ─── Spacing Scale ───────────────────────────────────────────────────

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
  section: 48,
} as const;

// ─── Radius Scale ────────────────────────────────────────────────────

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 9999,
} as const;

// ─── Typography Scale ────────────────────────────────────────────────

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 15,
  xl: 16,
  '2xl': 18,
  '3xl': 20,
  '4xl': 24,
  '5xl': 28,
  '6xl': 32,
} as const;

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const lineHeight = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.6,
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

// ─── Status Helpers ──────────────────────────────────────────────────

export type MemberStatus = 'active' | 'expiring' | 'expired' | 'pending' | 'deleted';
export type PaymentStatus = 'pending' | 'verified' | 'rejected' | 'paid' | 'failed';

export function getMemberStatusColor(status: string): { text: string; bg: string; border: string } {
  switch (status) {
    case 'active':
      return { text: colors.statusActive, bg: colors.statusActiveSurface, border: colors.successBorder };
    case 'expiring':
      return { text: colors.statusExpiring, bg: colors.statusExpiringSurface, border: colors.warningBorder };
    case 'expired':
      return { text: colors.statusExpired, bg: colors.statusExpiredSurface, border: colors.criticalBorder };
    default:
      return { text: colors.muted, bg: colors.gray100, border: colors.border };
  }
}

export function getPaymentStatusColor(status: string): { text: string; bg: string } {
  switch (status) {
    case 'verified':
    case 'paid':
      return { text: colors.statusPaid, bg: colors.statusPaidSurface };
    case 'pending':
      return { text: colors.statusPending, bg: colors.statusPendingSurface };
    case 'rejected':
    case 'failed':
      return { text: colors.statusRejected, bg: colors.statusFailedSurface };
    default:
      return { text: colors.muted, bg: colors.gray100 };
  }
}
