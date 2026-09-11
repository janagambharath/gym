import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type StatusBadgeProps = {
  status?: string;
  size?: 'sm' | 'md';
  label?: string;
  color?: string;
  backgroundColor?: string;
};

type BadgeStyle = { bg: string; text: string; label: string };

function getStatusStyle(status: string): BadgeStyle {
  switch (status.toLowerCase()) {
    case 'active':
      return { bg: colors.statusActiveSurface, text: colors.statusActive, label: 'ACTIVE' };
    case 'trial':
      return { bg: colors.warningSurface, text: colors.warning, label: 'TRIAL' };
    case 'expiring':
      return { bg: colors.statusExpiringSurface, text: colors.statusExpiring, label: 'EXPIRING' };
    case 'expired':
      return { bg: colors.statusExpiredSurface, text: colors.statusExpired, label: 'EXPIRED' };
    case 'cancelled':
    case 'canceled':
      return { bg: colors.warningSurface, text: colors.warning, label: 'CANCELLED' };
    case 'grace_period':
      return { bg: colors.warningSurface, text: colors.warning, label: 'GRACE PERIOD' };
    case 'payment_failed':
      return { bg: colors.statusFailedSurface, text: colors.statusFailed, label: 'PAYMENT FAILED' };
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
    case 'new':
      return { bg: colors.infoSurface, text: colors.info, label: 'NEW' };
    case 'contacted':
      return { bg: colors.statusPendingSurface, text: colors.statusPending, label: 'CONTACTED' };
    case 'interested':
      return { bg: colors.warningSurface, text: colors.warning, label: 'INTERESTED' };
    case 'trial_requested':
      return { bg: colors.warningSurface, text: colors.warning, label: 'TRIAL' };
    case 'booked':
      return { bg: colors.infoSurface, text: colors.info, label: 'BOOKED' };
    case 'converted':
      return { bg: colors.successSurface, text: colors.success, label: 'CONVERTED' };
    case 'lost':
      return { bg: colors.criticalSurface, text: colors.critical, label: 'LOST' };
    case 'closed':
      return { bg: colors.gray100, text: colors.muted, label: 'CLOSED' };
    case 'bot_active':
    case 'bot_resumed':
      return { bg: colors.infoSurface, text: colors.info, label: 'BOT ACTIVE' };
    case 'human_requested':
      return { bg: colors.warningSurface, text: colors.warning, label: 'HANDOVER' };
    case 'human_active':
      return { bg: colors.statusPendingSurface, text: colors.statusPending, label: 'STAFF ACTIVE' };
    default:
      return { bg: colors.gray100, text: colors.muted, label: status ? status.toUpperCase() : 'UNKNOWN' };
  }
}

export function StatusBadge({
  status = '',
  size = 'sm',
  label,
  color,
  backgroundColor,
}: StatusBadgeProps) {
  const style = getStatusStyle(status);
  const badgeLabel = label ?? style.label;
  const badgeBg = backgroundColor ?? style.bg;
  const badgeTextColor = color ?? style.text;
  const isSmall = size === 'sm';

  return (
    <View
      accessibilityLabel={`Status: ${badgeLabel}`}
      style={[
        styles.badge,
        { backgroundColor: badgeBg },
        isSmall ? styles.badgeSm : styles.badgeMd,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: badgeTextColor },
          isSmall ? styles.textSm : styles.textMd,
        ]}
      >
        {badgeLabel}
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
