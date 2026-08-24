import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type StatusBadgeProps = {
  status: string;
  size?: 'sm' | 'md';
};

type BadgeStyle = { bg: string; text: string; label: string };

function getStatusStyle(status: string): BadgeStyle {
  switch (status.toLowerCase()) {
    case 'active':
      return { bg: colors.statusActiveSurface, text: colors.statusActive, label: 'ACTIVE' };
    case 'expiring':
      return { bg: colors.statusExpiringSurface, text: colors.statusExpiring, label: 'EXPIRING' };
    case 'expired':
      return { bg: colors.statusExpiredSurface, text: colors.statusExpired, label: 'EXPIRED' };
    case 'pending':
      return { bg: colors.statusPendingSurface, text: colors.statusPending, label: 'PENDING' };
    case 'verified':
    case 'paid':
      return { bg: colors.statusPaidSurface, text: colors.statusPaid, label: status.toUpperCase() };
    case 'rejected':
    case 'failed':
      return { bg: colors.statusFailedSurface, text: colors.statusFailed, label: status.toUpperCase() };
    case 'deleted':
      return { bg: colors.gray100, text: colors.muted, label: 'DELETED' };
    default:
      return { bg: colors.gray100, text: colors.muted, label: status.toUpperCase() };
  }
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const style = getStatusStyle(status);
  const isSmall = size === 'sm';

  return (
    <View
      accessibilityLabel={`Status: ${style.label}`}
      style={[
        styles.badge,
        { backgroundColor: style.bg },
        isSmall ? styles.badgeSm : styles.badgeMd,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: style.text },
          isSmall ? styles.textSm : styles.textMd,
        ]}
      >
        {style.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.xs,
  },
  badgeMd: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
  },
  textMd: {
    fontSize: fontSize.sm,
  },
  textSm: {
    fontSize: fontSize.xs,
  },
});
