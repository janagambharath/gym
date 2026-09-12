/**
 * MemberMembershipScreen — Detailed membership view for gym members.
 *
 * Shows: current plan details, validity dates, days remaining,
 * full renewal history, and "Renew Now" CTA.
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
import type { MemberMembership } from '../../services/memberApiClient';
import { fetchMemberMembership } from '../../services/memberApiClient';
import { ErrorState } from '../../components/ErrorState';

type MemberMembershipScreenProps = {
  onNavigateRenew: () => void;
};

export function MemberMembershipScreen({ onNavigateRenew }: MemberMembershipScreenProps) {
  const [data, setData] = useState<MemberMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchMemberMembership().then((result) => {
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

  const membership = data?.membership;
  const gym = data?.gym;
  const isExpired = membership?.is_expired;
  const daysLeft = membership?.days_left;
  const renewals = data?.renewal_history ?? [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Membership</Text>
        <Text style={styles.gymSubtitle}>{gym?.name ?? 'Gym Membership'}</Text>
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
        {/* Status Card */}
        <View
          style={[
            styles.card,
            {
              borderColor: isExpired
                ? colors.critical
                : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                ? colors.warning
                : colors.success,
            },
          ]}
        >
          <View style={styles.statusHeader}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: isExpired
                    ? colors.criticalSurface
                    : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                    ? colors.warningSurface
                    : colors.successSurface,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
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
                  ? 'Expired'
                  : daysLeft !== null && daysLeft !== undefined && daysLeft <= 7
                  ? 'Expiring Soon'
                  : 'Active'}
              </Text>
            </View>
            <Text style={styles.planNameText}>{membership?.plan_name ?? 'Standard Plan'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailsGrid}>
            <DetailItem
              label="Valid From"
              value={membership?.membership_start ?? 'N/A'}
            />
            <DetailItem
              label="Valid Until"
              value={membership?.membership_end ?? 'N/A'}
            />
            <DetailItem
              label="Days Remaining"
              value={
                isExpired
                  ? 'Expired'
                  : daysLeft !== null && daysLeft !== undefined
                  ? `${daysLeft} days`
                  : 'N/A'
              }
              highlight={daysLeft !== null && daysLeft !== undefined && daysLeft <= 7}
            />
            <DetailItem
              label="Plan Price"
              value={membership?.plan_price ? `₹${membership.plan_price}` : 'N/A'}
            />
            {membership?.joined_on && (
              <DetailItem label="Member Since" value={membership.joined_on} />
            )}
            {membership?.plan_duration_days && (
              <DetailItem
                label="Duration"
                value={`${membership.plan_duration_days} days`}
              />
            )}
          </View>

          <TouchableOpacity
            style={styles.renewActionBtn}
            onPress={onNavigateRenew}
            activeOpacity={0.7}
          >
            <Icon name="refresh" size={18} color="#fff" />
            <Text style={styles.renewActionText}>
              {isExpired ? 'Renew Now' : 'Extend / Renew Plan'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Renewal History */}
        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Renewal History</Text>
          {renewals.length === 0 ? (
            <View style={styles.emptyHistory}>
              <Text style={styles.emptyHistoryText}>No past renewals recorded yet.</Text>
            </View>
          ) : (
            renewals.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.historyTop}>
                  <Text style={styles.historyPlan}>{item.plan_name ?? 'Membership'}</Text>
                  <Text style={styles.historyAmount}>₹{item.amount}</Text>
                </View>
                <View style={styles.historyBottom}>
                  <Text style={styles.historyPeriod}>
                    {item.new_start} → {item.new_end}
                  </Text>
                  {item.created_at && (
                    <Text style={styles.historyDate}>
                      Renewed: {item.created_at.split('T')[0]}
                    </Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailItemLabel}>{label}</Text>
      <Text
        style={[
          styles.detailItemValue,
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
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  gymSubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.bottomTabSafe,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 2,
    gap: spacing.lg,
    ...shadows.md,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  planNameText: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  detailsGrid: {
    gap: spacing.md,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailItemLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  detailItemValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  renewActionBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  renewActionText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  historySection: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  emptyHistory: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyHistoryText: {
    color: colors.muted,
    fontSize: fontSize.base,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.sm,
  },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyPlan: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  historyAmount: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.extrabold,
    color: colors.success,
  },
  historyBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xxs,
  },
  historyPeriod: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  historyDate: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
});
