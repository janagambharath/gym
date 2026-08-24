import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member } from '../types';
import { formatDate, getDaysText, getMemberDisplayStatus } from '../types';

type RenewalsScreenProps = {
  onLogout: () => void;
  onSelectMember?: (member: Member) => void;
  onRenew?: (member: Member) => void;
};

export function RenewalsScreen({ onLogout, onSelectMember, onRenew }: RenewalsScreenProps) {
  const [upcoming, setUpcoming] = useState<Member[]>([]);
  const [expired, setExpired] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      const [upcomingRes, expiredRes] = await Promise.all([
        apiRequest<{ members: Member[] }>('/api/mobile/v1/renewals/upcoming'),
        apiRequest<{ members: Member[] }>('/api/mobile/v1/renewals/expired'),
      ]);

      if (cancelled) return;

      if (upcomingRes.ok) {
        setUpcoming(upcomingRes.data.members);
      } else if (upcomingRes.error.status === 401) {
        onLogout();
        return;
      }

      if (expiredRes.ok) {
        setExpired(expiredRes.data.members);
      }

      if (!upcomingRes.ok && !expiredRes.ok) {
        setError(upcomingRes.ok ? undefined : upcomingRes.error.message);
      } else {
        setError(undefined);
      }

      setLoading(false);
      setRefreshing(false);
    };

    void fetchData();
    return () => { cancelled = true; };
  }, [revision, onLogout]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRevision((n) => n + 1);
  }, []);

  // Split upcoming into "today" and "next 7 days"
  const today = upcoming.filter(
    (m) => m.days_until_expiry !== null && m.days_until_expiry <= 0,
  );
  const thisWeek = upcoming.filter(
    (m) => m.days_until_expiry !== null && m.days_until_expiry > 0,
  );

  const renderMemberRow = useCallback((item: Member) => {
    const displayStatus = getMemberDisplayStatus(item);
    const daysText = getDaysText(item.days_until_expiry);

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.memberRow}
        onPress={() => onSelectMember?.(item)}
        activeOpacity={0.6}
      >
        <Avatar name={item.full_name} size={40} />
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>{item.full_name}</Text>
          <Text style={styles.memberDetail}>{item.phone}</Text>
          <Text style={styles.memberDetail}>{item.plan?.name ?? 'No plan'}</Text>
        </View>
        <View style={styles.memberRight}>
          <Text style={styles.memberExpiry}>{formatDate(item.membership_end)}</Text>
          {daysText ? (
            <Text style={[
              styles.daysText,
              {
                color: item.days_until_expiry !== null && item.days_until_expiry <= 0
                  ? colors.statusExpired
                  : colors.statusExpiring,
              },
            ]}>
              {daysText}
            </Text>
          ) : null}
          <StatusBadge status={displayStatus} />
        </View>
        <TouchableOpacity
          style={styles.renewIcon}
          onPress={() => onRenew?.(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.renewIconText}>🔄</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [onSelectMember, onRenew]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Renewals</Text>
        </View>
        <View style={styles.skeletonContainer}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Renewals</Text>
        </View>
        <ErrorState message={error} onRetry={refresh} />
      </SafeAreaView>
    );
  }

  const totalCount = today.length + thisWeek.length + expired.length;

  if (totalCount === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Renewals</Text>
        </View>
        <EmptyState
          icon={<Icon name="checkmark" size={40} color={colors.success} />}
          title="All caught up!"
          subtitle="No upcoming renewals or expired memberships at the moment."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Renewals</Text>
        <Text style={styles.headerSubtitle}>
          {upcoming.length} upcoming · {expired.length} expired
        </Text>
      </View>

      <FlatList
        data={[1]} // Single item list to render sections
        keyExtractor={() => 'sections'}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} />
        }
        renderItem={() => (
          <View style={styles.content}>
            {/* Expiring Today */}
            {today.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.statusExpired }]} />
                  <Text style={styles.sectionTitle}>Expiring Today</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{today.length}</Text>
                  </View>
                </View>
                <View style={styles.card}>
                  {today.map(renderMemberRow)}
                </View>
              </View>
            ) : null}

            {/* Next 7 Days */}
            {thisWeek.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.statusExpiring }]} />
                  <Text style={styles.sectionTitle}>Next 7 Days</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{thisWeek.length}</Text>
                  </View>
                </View>
                <View style={styles.card}>
                  {thisWeek.map(renderMemberRow)}
                </View>
              </View>
            ) : null}

            {/* Expired */}
            {expired.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.statusExpired }]} />
                  <Text style={styles.sectionTitle}>Expired</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{expired.length}</Text>
                  </View>
                </View>
                <View style={styles.card}>
                  {expired.map(renderMemberRow)}
                </View>
              </View>
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    ...shadows.sm,
  },
  content: {
    gap: spacing.xxl,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  countBadge: {
    backgroundColor: colors.gray200,
    borderRadius: 10,
    minWidth: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    alignItems: 'center',
  },
  countText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  daysText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerSubtitle: {
    color: colors.muted,
    fontSize: fontSize.md,
    marginTop: spacing.xxs,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
  },
  memberDetail: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  memberExpiry: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  memberInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  memberRight: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
  },
  memberRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  renewIcon: {
    marginLeft: spacing.sm,
    padding: spacing.xs,
  },
  renewIconText: {
    fontSize: 18,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  section: {
    gap: spacing.md,
  },
  sectionDot: {
    borderRadius: 4,
    height: 8,
    marginRight: spacing.sm,
    width: 8,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  skeletonContainer: {
    gap: spacing.md,
    padding: spacing.lg,
  },
});
