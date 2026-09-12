export const colors = {
  // Slate neutrals
  bg: '#F8FAFC',
  card: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#475569',
  muted: '#94A3B8',
  border: '#E2E8F0',
  borderSubtle: '#F1F5F9',

  // Platform identity (VYNLA)
  platform: '#2563EB',
  platformDark: '#1D4ED8',
  platformSubtle: '#EFF6FF',
  whatsapp: '#25D366',

  // Membership semantic status
  active: '#059669',
  activeSurface: '#ECFDF5',
  activeBorder: '#A7F3D0',

  expiring: '#D97706',
  expiringSurface: '#FFFBEB',
  expiringBorder: '#FDE68A',

  expired: '#DC2626',
  expiredSurface: '#FEF2F2',
  expiredBorder: '#FECACA',

  paused: '#7C3AED',
  pausedSurface: '#F5F3FF',
  pausedBorder: '#DDD6FE',

  cancelled: '#64748B',
  cancelledSurface: '#F8FAFC',
  cancelledBorder: '#E2E8F0',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radii = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const },
  bodySemibold: { fontSize: 15, fontWeight: '600' as const },
  subtext: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 11, fontWeight: '500' as const },
  badge: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.5 },
};
