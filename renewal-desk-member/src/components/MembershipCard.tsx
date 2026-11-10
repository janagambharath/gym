import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Member } from '../types';
import { StatusBadge } from './StatusBadge';
import { useBranding } from '../context/BrandingContext';
import { formatGymDate } from '../utils/gymTime';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface MembershipCardProps {
  member: Member;
  onRenew: () => void;
}

export const MembershipCard: React.FC<MembershipCardProps> = ({ member, onRenew }) => {
  const { theme } = useBranding();

  const daysLeft = member.days_left;
  // V12-M2: the backend's is_expired is True when membership_end is None
  // (models/member.py:109-113), but "expired" is the wrong label when no
  // end date was ever set — nothing expired. Surface "no expiry set"
  // instead; the door still treats it as inactive (access_active is
  // false for a null-end member), so this is display copy, not access.
  const noExpiry = member.membership_end === null;
  const isExpired = !noExpiry && (member.is_expired || (daysLeft !== null && daysLeft < 0));
  const isExpiring = !isExpired && !noExpiry && daysLeft !== null && daysLeft <= 7;
  const isPaused = member.status.toLowerCase() === 'paused';

  let statusText = 'ACTIVE';
  if (isPaused) statusText = 'PAUSED';
  else if (noExpiry) statusText = 'NO EXPIRY';
  else if (isExpired) statusText = 'EXPIRED';
  else if (isExpiring) statusText = 'EXPIRING';

  let daysText = '';
  if (noExpiry && !isPaused) {
    daysText = 'No expiry set — ask your gym';
  } else if (isExpired) {
    const daysAgo = Math.abs(daysLeft ?? 0);
    daysText = daysAgo === 0 ? 'Expired today' : `Expired ${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;
  } else if (isPaused) {
    daysText = 'Membership currently paused';
  } else if (daysLeft !== null) {
    daysText = `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`;
  }

  // V12-L4: render in gym time, not device-local time.
  const formatDate = (iso: string | null) => formatGymDate(iso);

  return (
    <View style={styles.card}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.planInfo}>
          <Text style={styles.planLabel}>MEMBERSHIP PLAN</Text>
          <Text style={styles.planName}>{member.plan_name || 'Standard Access'}</Text>
        </View>
        <StatusBadge status={statusText} />
      </View>

      {/* Days Remaining Hero */}
      <View style={styles.daysContainer}>
        {daysLeft !== null && !isPaused && (
          <Text
            style={[
              styles.daysNumber,
              isExpired && styles.daysExpired,
              isExpiring && styles.daysExpiring,
            ]}
          >
            {Math.abs(daysLeft)}
          </Text>
        )}
        <View style={styles.daysTextContainer}>
          <Text
            style={[
              styles.daysSubtext,
              isExpired && styles.daysExpiredText,
              isExpiring && styles.daysExpiringText,
            ]}
          >
            {daysText.toUpperCase()}
          </Text>
          <Text style={styles.dateRange}>
            Valid: {formatDate(member.membership_start)} – {formatDate(member.membership_end)}
          </Text>
        </View>
      </View>

      {/* Renew Action */}
      <TouchableOpacity
        style={[styles.renewButton, { backgroundColor: theme.primary }]}
        onPress={onRenew}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Renew Membership"
      >
        <Ionicons name="refresh-circle" size={20} color={theme.primaryText} />
        <Text style={[styles.renewButtonText, { color: theme.primaryText }]}>
          {isExpired ? 'Renew Expired Membership' : 'Renew Membership'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  planInfo: {
    flex: 1,
  },
  planLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  planName: {
    ...typography.h3,
    color: colors.text,
  },
  daysContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
    marginVertical: spacing.sm,
    gap: spacing.md,
  },
  daysNumber: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.active,
    lineHeight: 48,
  },
  daysExpiring: {
    color: colors.expiring,
  },
  daysExpired: {
    color: colors.expired,
  },
  daysTextContainer: {
    flex: 1,
  },
  daysSubtext: {
    ...typography.bodySemibold,
    color: colors.text,
    letterSpacing: 0.3,
  },
  daysExpiringText: {
    color: colors.expiring,
  },
  daysExpiredText: {
    color: colors.expired,
  },
  dateRange: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  renewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  renewButtonText: {
    ...typography.bodySemibold,
  },
});
