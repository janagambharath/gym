/**
 * Centralized icon definitions using @expo/vector-icons.
 * Single source of truth for all icons used across the app.
 *
 * Usage:
 *   import { Icon, TabIcon } from '../theme/icons';
 *   <Icon name="members" size={20} color={colors.text} />
 *   <TabIcon name="dashboard" focused={true} color={colors.brand} size={24} />
 */
import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Icon Map ────────────────────────────────────────────────────────

const ICON_MAP = {
  // Navigation / Tabs
  dashboard: { family: 'ion', name: 'grid-outline', activeName: 'grid' },
  members: { family: 'ion', name: 'people-outline', activeName: 'people' },
  renewals: { family: 'ion', name: 'refresh-outline', activeName: 'refresh' },
  payments: { family: 'ion', name: 'card-outline', activeName: 'card' },
  more: { family: 'ion', name: 'ellipsis-horizontal-outline', activeName: 'ellipsis-horizontal' },

  // Actions
  add: { family: 'ion', name: 'add-outline' },
  edit: { family: 'ion', name: 'create-outline' },
  delete: { family: 'ion', name: 'trash-outline' },
  search: { family: 'ion', name: 'search-outline' },
  filter: { family: 'ion', name: 'funnel-outline' },
  back: { family: 'ion', name: 'chevron-back' },
  forward: { family: 'ion', name: 'chevron-forward' },
  chevronUp: { family: 'ion', name: 'chevron-up' },
  chevronDown: { family: 'ion', name: 'chevron-down' },
  close: { family: 'ion', name: 'close-outline' },
  checkmark: { family: 'ion', name: 'checkmark-circle' },
  send: { family: 'ion', name: 'send-outline' },
  retry: { family: 'ion', name: 'reload-outline' },
  logout: { family: 'ion', name: 'log-out-outline' },

  // Domain
  person: { family: 'ion', name: 'person-outline' },
  personAdd: { family: 'ion', name: 'person-add-outline' },
  calendar: { family: 'ion', name: 'calendar-outline' },
  time: { family: 'ion', name: 'time-outline' },
  cash: { family: 'ion', name: 'cash-outline' },
  wallet: { family: 'ion', name: 'wallet-outline' },
  receipt: { family: 'ion', name: 'receipt-outline' },
  star: { family: 'ion', name: 'star-outline' },
  alert: { family: 'ion', name: 'alert-circle-outline' },
  warning: { family: 'ion', name: 'warning-outline' },
  info: { family: 'ion', name: 'information-circle-outline' },
  shield: { family: 'ion', name: 'shield-checkmark-outline' },
  lock: { family: 'ion', name: 'lock-closed-outline' },
  settings: { family: 'ion', name: 'settings-outline' },
  business: { family: 'ion', name: 'business-outline' },
  call: { family: 'ion', name: 'call-outline' },
  mail: { family: 'ion', name: 'mail-outline' },
  location: { family: 'ion', name: 'location-outline' },
  globe: { family: 'ion', name: 'globe-outline' },
  stats: { family: 'ion', name: 'stats-chart-outline' },
  analytics: { family: 'ion', name: 'analytics-outline' },
  clipboard: { family: 'ion', name: 'clipboard-outline' },
  document: { family: 'ion', name: 'document-text-outline' },
  notifications: { family: 'ion', name: 'notifications-outline', activeName: 'notifications' },
  help: { family: 'ion', name: 'help-circle-outline' },
  chatbubble: { family: 'ion', name: 'chatbubble-outline' },
  flash: { family: 'ion', name: 'flash-outline' },
  fitness: { family: 'mci', name: 'dumbbell' },
  whatsapp: { family: 'mci', name: 'whatsapp' },
  robot: { family: 'mci', name: 'robot-outline' },
  account: { family: 'mci', name: 'account-circle-outline' },
  staff: { family: 'mci', name: 'account-group-outline' },
  plan: { family: 'mci', name: 'tag-outline' },
  currency: { family: 'mci', name: 'currency-inr' },
  trendUp: { family: 'mci', name: 'trending-up' },
  handshake: { family: 'mci', name: 'handshake-outline' },
  target: { family: 'mci', name: 'target' },
  brain: { family: 'mci', name: 'brain' },
  messageReply: { family: 'mci', name: 'message-reply-outline' },
  lead: { family: 'mci', name: 'account-plus-outline' },
  bookClock: { family: 'mci', name: 'book-clock-outline' },
  testTube: { family: 'mci', name: 'test-tube' },
} as const;

export type IconName = keyof typeof ICON_MAP;

// ─── Icon Component ──────────────────────────────────────────────────

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 20, color = '#1A1A2E' }: IconProps) {
  const entry = ICON_MAP[name];
  if (entry.family === 'mci') {
    return <MaterialCommunityIcons name={entry.name as any} size={size} color={color} />;
  }
  return <Ionicons name={entry.name as any} size={size} color={color} />;
}

// ─── Tab Icon Component ──────────────────────────────────────────────

type TabIconProps = {
  name: IconName;
  focused: boolean;
  color: string;
  size?: number;
};

export function TabIcon({ name, focused, color, size = 24 }: TabIconProps) {
  const entry = ICON_MAP[name];
  const iconName = focused && 'activeName' in entry ? (entry as any).activeName : entry.name;
  if (entry.family === 'mci') {
    return <MaterialCommunityIcons name={iconName as any} size={size} color={color} />;
  }
  return <Ionicons name={iconName as any} size={size} color={color} />;
}
