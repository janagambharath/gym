/**
 * MemberHomeScreen — Dashboard for gym members.
 *
 * Shows: membership status card, days remaining, pending payment,
 * recent renewals, gym contact info, and renewal CTA.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../../theme/tokens';
import type { MemberDashboard } from '../../services/memberApiClient';
import { fetchMemberDashboard, getMemberSession } from '../../services/memberApiClient';
import { ErrorState } from '../../components/ErrorState';

type MemberHomeScreenProps = {
  onNavigateRenew: () => void;
  onNavigatePayments: () => void;
  onNavigateMembership: () => void;
};

export function MemberHomeScreen({
  onNavigateRenew,
  onNavigatePayments,
  onNavigateMembership,
}: MemberHomeScreenProps) {
  const [data, setData] = useState<MemberDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const session = getMemberSession();

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchMemberDashboard().then((result) => {
      if (!active) return;
      if (result.ok) {
        setData(result.data);
        setError(undefined);
      } else {
        setError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [revision]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRevision((r) => r + 1);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ErrorState message={error} onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  const member = data?.member;
  const gym = data?.gym;
  const isExpired = member?.is_expired;
  const daysLeft = member?.days_left;
  const showRenewCTA = isExpired || (daysLeft !== null && daysLeft !== undefined && daysLeft <= 14);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Hi, {member?.full_name?.split(' ')[0] ?? session?.fullName?.split(' ')[0] ?? 'there'}! 👋
          </Text>
          <Text style={styles.gymName}>{gym?.name ?? session?.gymName ?? ''}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Membership Status Card */}
        <TouchableOpacity
          style={[
            styles.statusCard,
            {
              borderColor: isExpired
                ? colors.critical
                : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                ? colors.warning
                : colors.success,
            },
          ]}
          onPress={onNavigateMembership}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: isExpired
                  ? colors.criticalSurface
                  : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                  ? colors.warningSurface
                  : colors.successSurface,
              },
            ]}
          >
            <Text style={styles.statusIcon}>
              {isExpired ? '⚠️' : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7 ? '⏰' : '✅'}
            </Text>
            <Text
              style={[
                styles.statusLabel,
                {
                  color: isExpired
                    ? colors.critical
                    : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                    ? colors.warning
                    : colors.success,
                },
              ]}
            >
              {isExpired
                ? 'Membership Expired'
                : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                ? 'Expiring Soon'
                : 'Active Membership'}
            </Text>
          </View>

          <View style={styles.statusDetails}>
            <DetailRow label="Plan" value={member?.plan_name ?? 'N/A'} />
            <DetailRow label="Valid Until" value={member?.membership_end ?? 'N/A'} />
            {daysLeft !== null && daysLeft !== undefined && !isExpired && (
              <DetailRow
                label="Days Remaining"
                value={daysLeft === 0 ? 'Expires today!' : `${daysLeft} days`}
                highlight={daysLeft <= 7}
              />
            )}
            {member?.plan_price && (
              <DetailRow label="Plan Price" value={`₹${member.plan_price}`} />
            )}
          </View>

          <View style={styles.viewDetailsRow}>
            <Text style={styles.viewDetailsText}>View Details</Text>
            <Icon name="forward" size={14} color={colors.brand} />
          </View>
        </TouchableOpacity>

        {/* Pending Payment */}
        {data?.pending_payment && (
          <View style={[styles.card, { borderColor: colors.warningBorder }]}>
            <View style={styles.cardHeader}>
              <Icon name="time" size={20} color={colors.warning} />
              <Text style={styles.cardTitle}>Payment Pending</Text>
            </View>
            <Text style={styles.pendingAmount}>₹{data.pending_payment.amount}</Text>
            <Text style={styles.pendingNote}>
              {"Your payment is being verified by the gym. You'll be notified once confirmed."}
            </Text>
          </View>
        )}

        {/* Renew CTA */}
        {showRenewCTA && !data?.pending_payment && (
          <TouchableOpacity
            style={styles.renewButton}
            onPress={onNavigateRenew}
            activeOpacity={0.7}
          >
            <Icon name="refresh" size={24} color="#fff" />
            <Text style={styles.renewButtonText}>
              {isExpired ? 'Renew Membership' : 'Renew Now'}
            </Text>
            {member?.plan_price && (
              <Text style={styles.renewButtonSub}>
                {member.plan_name} · ₹{member.plan_price}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.actionCard} onPress={onNavigatePayments} activeOpacity={0.7}>
            <View style={[styles.actionIconWrap, { backgroundColor: colors.infoSurface }]}>
              <Icon name="receipt" size={20} color={colors.brand} />
            </View>
            <Text style={styles.actionLabel}>Payment{'\n'}History</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={onNavigateMembership} activeOpacity={0.7}>
            <View style={[styles.actionIconWrap, { backgroundColor: colors.successSurface }]}>
              <Icon name="calendar" size={20} color={colors.success} />
            </View>
            <Text style={styles.actionLabel}>Membership{'\n'}Details</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={onNavigateRenew} activeOpacity={0.7}>
            <View style={[styles.actionIconWrap, { backgroundColor: colors.warningSurface }]}>
              <Icon name="cash" size={20} color={colors.warning} />
            </View>
            <Text style={styles.actionLabel}>Renew{'\n'}Now</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Renewals */}
        {data?.recent_renewals && data.recent_renewals.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="bookClock" size={20} color={colors.textSecondary} />
              <Text style={styles.cardTitle}>Recent Renewals</Text>
            </View>
            {data.recent_renewals.map((r) => (
              <View key={r.id} style={styles.renewalRow}>
                <View>
                  <Text style={styles.renewalDates}>
                    {r.new_start} → {r.new_end}
                  </Text>
                </View>
                <Text style={styles.renewalAmount}>₹{r.amount}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Contact Gym */}
        {gym?.phone && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="call" size={20} color={colors.textSecondary} />
              <Text style={styles.cardTitle}>Contact {gym.name}</Text>
            </View>
            <Text style={styles.gymPhone}>{gym.phone}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          highlight && { color: colors.warning, fontWeight: fontWeight.bold },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  gymName: {
    fontSize: fontSize.base,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 2,
    gap: spacing.lg,
    ...shadows.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  statusIcon: { fontSize: 20 },
  statusLabel: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  statusDetails: { gap: spacing.md },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  detailValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  viewDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  viewDetailsText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  pendingAmount: {
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.warning,
    textAlign: 'center',
  },
  pendingNote: {
    fontSize: fontSize.md,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  renewButton: {
    backgroundColor: colors.success,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
    ...shadows.md,
  },
  renewButtonText: {
    color: '#fff',
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
  },
  renewButtonSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.md,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  renewalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  renewalDates: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  renewalAmount: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.success,
  },
  gymPhone: {
    fontSize: fontSize.xl,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
});
