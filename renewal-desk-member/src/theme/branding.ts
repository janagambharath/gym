import { colors } from './tokens';
import { GymBranding } from '../types';

const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export function sanitizeColor(color: string | null | undefined, fallback: string): string {
  if (!color || typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : fallback;
}

export function getReadableTextColor(bgHex: string): string {
  try {
    const cleanHex = bgHex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
    // Standard relative luminance formula
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#0F172A' : '#FFFFFF';
  } catch {
    return '#FFFFFF';
  }
}

export interface ResolvedBrandingTheme {
  gymName: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
  accent: string;
  primaryText: string;
  tagline: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  hours: string;
  poweredBy: string;
}

export const defaultBrandingTheme: ResolvedBrandingTheme = {
  gymName: 'VYNLA Gym',
  logoUrl: null,
  primary: colors.platform,
  secondary: colors.platformDark,
  accent: colors.platformSubtle,
  primaryText: '#FFFFFF',
  tagline: 'Personalized Member Experience',
  phone: null,
  whatsapp: null,
  address: null,
  hours: 'Mon-Sat: 6:00 AM - 10:00 PM · Sun: 7:00 AM - 1:00 PM',
  poweredBy: 'VYNLA',
};

export function resolveBrandingTheme(branding?: GymBranding | null): ResolvedBrandingTheme {
  if (!branding) return defaultBrandingTheme;

  const primary = sanitizeColor(branding.primary_color, colors.platform);
  const secondary = sanitizeColor(branding.secondary_color, colors.platformDark);
  const accent = sanitizeColor(branding.accent_color, colors.platformSubtle);

  return {
    gymName: branding.gym_name || defaultBrandingTheme.gymName,
    logoUrl: branding.logo_url || null,
    primary,
    secondary,
    accent,
    primaryText: getReadableTextColor(primary),
    tagline: branding.tagline || defaultBrandingTheme.tagline,
    phone: branding.phone || null,
    whatsapp: branding.whatsapp_number || branding.phone || null,
    address: branding.address || null,
    hours: branding.opening_hours || defaultBrandingTheme.hours,
    poweredBy: branding.powered_by || 'VYNLA',
  };
}
