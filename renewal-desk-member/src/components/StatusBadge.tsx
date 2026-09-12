import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '../theme/tokens';

export type BadgeStatus =
  | 'ACTIVE'
  | 'EXPIRING'
  | 'EXPIRED'
  | 'PAUSED'
  | 'CANCELLED'
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'refunded';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toUpperCase();

  let bg = colors.card;
  let textColor = colors.textSecondary;
  let borderColor = colors.border;
  let iconName: keyof typeof Ionicons.glyphMap = 'information-circle';
  let label = status;

  switch (normalized) {
    case 'ACTIVE':
      bg = colors.activeSurface;
      textColor = colors.active;
      borderColor = colors.activeBorder;
      iconName = 'checkmark-circle';
      label = 'ACTIVE';
      break;

    case 'EXPIRING':
    case 'EXPIRING SOON':
      bg = colors.expiringSurface;
      textColor = colors.expiring;
      borderColor = colors.expiringBorder;
      iconName = 'time';
      label = 'EXPIRING';
      break;

    case 'EXPIRED':
      bg = colors.expiredSurface;
      textColor = colors.expired;
      borderColor = colors.expiredBorder;
      iconName = 'alert-circle';
      label = 'EXPIRED';
      break;

    case 'PAUSED':
      bg = colors.pausedSurface;
      textColor = colors.paused;
      borderColor = colors.pausedBorder;
      iconName = 'pause-circle';
      label = 'PAUSED';
      break;

    case 'CANCELLED':
      bg = colors.cancelledSurface;
      textColor = colors.cancelled;
      borderColor = colors.cancelledBorder;
      iconName = 'close-circle';
      label = 'CANCELLED';
      break;

    case 'VERIFIED':
      bg = colors.activeSurface;
      textColor = colors.active;
      borderColor = colors.activeBorder;
      iconName = 'checkmark-done-circle';
      label = 'VERIFIED';
      break;

    case 'PENDING':
    case 'CLAIMED':
      bg = colors.expiringSurface;
      textColor = colors.expiring;
      borderColor = colors.expiringBorder;
      iconName = 'hourglass';
      label = 'CLAIMED';
      break;

    case 'REJECTED':
      bg = colors.expiredSurface;
      textColor = colors.expired;
      borderColor = colors.expiredBorder;
      iconName = 'close-circle';
      label = 'REJECTED';
      break;

    case 'REFUNDED':
      bg = colors.cancelledSurface;
      textColor = colors.cancelled;
      borderColor = colors.cancelledBorder;
      iconName = 'return-up-back';
      label = 'REFUNDED';
      break;

    default:
      label = status.toUpperCase();
      break;
  }

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderColor },
        isSmall && styles.badgeSmall,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
    >
      <Ionicons name={iconName} size={isSmall ? 12 : 14} color={textColor} />
      <Text style={[styles.text, { color: textColor }, isSmall && styles.textSmall]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  text: {
    ...typography.badge,
  },
  textSmall: {
    fontSize: 10,
  },
});
