/**
 * Renewal Desk Design System — Design Tokens
 *
 * Gradient blue + white. Clean, modern gym system.
 */

// ─── Color Palette ───────────────────────────────────────────────────

export const colors = {
  // Brand — gradient blue
  brand: '#5B9BD5',
  brandDark: '#3A7BC0',
  brandLight: '#8FC1EB',
  brandSubtle: '#E8F2FC',
  // Gradient stops: #2B7FFF → #1D6FDB → #14489B (135deg)
  // react-native-linear-gradient not installed — use colors.brand as solid fallback
  brandGradient: ['#A8D0F0', '#7FB5E8', '#5B9BD5'] as const,
  volt: '#D9F24F',
  voltDark: '#B8D42E',

  // Surfaces — clean white on soft blue-tinted background
  background: '#FAF6EF',
  card: '#FFFFFF',
  surface: '#FFFFFF',

  // Text
  text: '#141414',
  textSecondary: '#5C564A',
  muted: '#A39C8B',
  textInverse: '#FFFFFF',

  // Borders
  border: '#D5E5F5',
  borderLight: '#EAF3FC',
  borderFocus: '#1D6FDB',

  // Semantic — Success
  success: '#2D7A3D',
  successDark: '#1F5A2C',
  successSurface: '#EAF4E4',
  successBorder: '#BFE0B5',

  // Semantic — Warning
  warning: '#B45309',
  warningDark: '#92400E',
  warningSurface: '#FBF3DF',
  warningBorder: '#F0D9A8',

  // Semantic — Error / Critical
  critical: '#C2410C',
  criticalDark: '#9A3412',
  criticalSurface: '#FBEDE3',
  criticalBorder: '#F5C9A8',

  // Semantic — Info
  info: '#1D4ED8',
  infoSurface: '#E8EFFD',
  infoBorder: '#B9CFF5',

  // Status-specific
  statusActive: '#2D7A3D',
  statusActiveSurface: '#EAF4E4',
  statusExpiring: '#B45309',
  statusExpiringSurface: '#FBF3DF',
  statusExpired: '#C2410C',
  statusExpiredSurface: '#FBEDE3',
  statusPending: '#6D5BD0',
  statusPendingSurface: '#EFECFA',
  statusPaid: '#2D7A3D',
  statusPaidSurface: '#EAF4E4',
  statusFailed: '#C2410C',
  statusFailedSurface: '#FBEDE3',
  statusVerified: '#2D7A3D',
  statusRejected: '#C2410C',

  // WhatsApp
  whatsapp: '#1FA855',
  whatsappDark: '#147A3E',

  // Neutral shades (cool, blue-tinted)
  gray50: '#F7FAFF',
  gray100: '#EFF4FA',
  gray200: '#DCE6F2',
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
  bottomTabSafe: 80,
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
