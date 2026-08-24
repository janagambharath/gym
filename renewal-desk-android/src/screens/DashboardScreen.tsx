import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Avatar } from '../components/Avatar';
import { ErrorState } from '../components/ErrorState';
import { DashboardSkeleton } from '../components/LoadingSkeleton';
import { MetricCard } from '../components/MetricCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { DashboardData, Member, Payment } from '../types';
import { formatCurrency, formatDate, getMemberDisplayStatus } from '../types';

type DashboardScreenProps = {
  onLogout: () => void;
  onNavigateMembers: () => void;
  onNavigatePayments?: () => void;
  onNavigateRenewals?: () => void;
  onNavigateSettings?: () => void;
  onNavigateMemberDetail?: (member: Member) => void;
  onNavigateAddMember?: () => void;
  onNavigateRecordPayment?: () => void;
  onNavigateWhatsApp?: () => void;
  refreshToken?: number;
};

export function DashboardScreen({
  onLogout,
  onNavigateMembers,
  onNavigatePayments,
  onNavigateRenewals,
  onNavigateSettings,
  onNavigateMemberDetail,
  onNavigateAddMember,
  onNavigateRecordPayment,
  onNavigateWhatsApp,
  refreshToken,
}: DashboardScreenProps) {
  const [data, setData] = useState<DashboardData | undefined>();
  const [upcoming, setUpcoming] = useState<Member[]>([]);
  const [recentPayments, setRecentPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const session = getCachedSession();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      const [dashRes, upcomingRes, paymentsRes] = await Promise.all([
        apiRequest<DashboardData>('/api/mobile/v1/dashboard'),
        apiRequest<{ members: Member[] }>('/api/mobile/v1/renewals/upcoming'),
        apiRequest<{ payments: Payment[]; pagination: unknown }>('/api/mobile/v1/payments?page_size=5'),
      ]);

      if (cancelled) return;

      if (dashRes.ok) {
        setData(dashRes.data);
        setError(undefined);
      } else {
        if (dashRes.error.status === 401) { onLogout(); return; }
        setError(dashRes.error.message);
      }

      if (upcomingRes.ok) setUpcoming(upcomingRes.data.members.slice(0, 5));
      if (paymentsRes.ok) setRecentPayments(paymentsRes.data.payments.slice(0, 5));

      setLoading(false);
      setRefreshing(false);
    };

    void fetchAll();
    return () => { cancelled = true; };
  }, [revision, refreshToken, onLogout]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRevision((n) => n + 1);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    onLogout();
  }, [onLogout]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Text style={styles.brandName}>Renewal Desk</Text>
          {session?.tenantName ? (
            <View style={styles.gymSelector}>
              <Icon name="fitness" size={14} color={colors.muted} />
              <Text style={styles.gymName} numberOfLines={1}>{session.tenantName}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            accessibilityLabel="Sign out"
            onPress={() => void handleLogout()}
            style={styles.avatarButton}
          >
            <Avatar name={session?.userName ?? 'U'} size={34} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl colors={[colors.brand]} onRefresh={refresh} refreshing={refreshing} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && !refreshing ? (
          <DashboardSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data ? (
          <>
            {/* Greeting */}
            <View style={styles.greeting}>
              <Text style={styles.greetingText}>
                {getGreeting()}, {session?.userName?.split(' ')[0] ?? 'there'}
              </Text>
              <Text style={styles.greetingSub}>
                Here&apos;s what needs your attention today.
              </Text>
            </View>

            {/* Key Metrics */}
            <View style={styles.metricsRow}>
              <MetricCard
                icon={<Icon name="members" size={18} color={colors.brand} />}
                iconBg={colors.brandSubtle}
                label="Active Members"
                value={data.total_active}
              />
              <MetricCard
                icon={<Icon name="time" size={18} color={colors.statusExpiring} />}
                iconBg={colors.statusExpiringSurface}
                label="Expiring Soon"
                value={data.expiring_soon}
                subtext="Next 7 days"
                subtextColor={colors.statusExpiring}
              />
            </View>
            <View style={styles.metricsRow}>
              <MetricCard
                icon={<Icon name="alert" size={18} color={colors.statusExpired} />}
                iconBg={colors.statusExpiredSurface}
                label="Expired"
                value={data.expired}
                subtext="Need attention"
                subtextColor={colors.statusExpired}
              />
              <MetricCard
                icon={<Icon name="wallet" size={18} color={colors.statusPending} />}
                iconBg={colors.statusPendingSurface}
                label="Pending Pay"
                value={data.pending_payments}
              />
            </View>

            {/* Revenue */}
            <View style={styles.card}>
              <SectionHeader title="Revenue Overview" icon={<Icon name="currency" size={18} color={colors.brand} />} />
              <View style={styles.revenueGrid}>
                <View style={styles.revenueItem}>
                  <Text style={styles.revenueLabel}>Today</Text>
                  <Text style={styles.revenueValue}>
                    {formatCurrency(data.revenue_today ?? '0')}
                  </Text>
                </View>
                <View style={[styles.revenueItem, styles.revenueItemBorder]}>
                  <Text style={styles.revenueLabel}>This Week</Text>
                  <Text style={styles.revenueValue}>
                    {formatCurrency(data.revenue_week ?? '0')}
                  </Text>
                </View>
                <View style={[styles.revenueItem, styles.revenueItemBorder]}>
                  <Text style={styles.revenueLabel}>This Month</Text>
                  <Text style={styles.revenueValue}>
                    {formatCurrency(data.revenue_month ?? '0')}
                  </Text>
                </View>
              </View>
            </View>

            {/* Attention Required */}
            {(data.expiring_soon > 0 || data.pending_payments > 0 || data.expired > 0) ? (
              <View style={styles.card}>
                <SectionHeader title="Attention Required" icon={<Icon name="warning" size={18} color={colors.statusExpiring} />} />
                <View style={styles.attentionRow}>
                  {data.expiring_soon > 0 ? (
                    <TouchableOpacity style={styles.attentionItem} onPress={onNavigateRenewals}>
                      <View style={[styles.attentionDot, { backgroundColor: colors.statusExpiring }]}>
                        <Text style={styles.attentionDotText}>{data.expiring_soon}</Text>
                      </View>
                      <Text style={styles.attentionLabel}>Members expiring soon</Text>
                      <Icon name="forward" size={16} color={colors.muted} />
                    </TouchableOpacity>
                  ) : null}
                  {data.pending_payments > 0 ? (
                    <TouchableOpacity style={styles.attentionItem} onPress={onNavigatePayments}>
                      <View style={[styles.attentionDot, { backgroundColor: colors.statusPending }]}>
                        <Text style={styles.attentionDotText}>{data.pending_payments}</Text>
                      </View>
                      <Text style={styles.attentionLabel}>Pending payments</Text>
                      <Icon name="forward" size={16} color={colors.muted} />
                    </TouchableOpacity>
                  ) : null}
                  {data.expired > 0 ? (
                    <TouchableOpacity style={styles.attentionItem} onPress={onNavigateRenewals}>
                      <View style={[styles.attentionDot, { backgroundColor: colors.statusExpired }]}>
                        <Text style={styles.attentionDotText}>{data.expired}</Text>
                      </View>
                      <Text style={styles.attentionLabel}>Expired memberships</Text>
                      <Icon name="forward" size={16} color={colors.muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Upcoming Renewals */}
            {upcoming.length > 0 ? (
              <View style={styles.card}>
                <SectionHeader
                  title="Upcoming Renewals"
                  icon={<Icon name="renewals" size={18} color={colors.brand} />}
                  actionLabel="View All"
                  onAction={onNavigateRenewals}
                />
                {upcoming.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.upcomingRow}
                    onPress={() => onNavigateMemberDetail?.(m)}
                  >
                    <Avatar name={m.full_name} size={36} />
                    <View style={styles.upcomingInfo}>
                      <Text style={styles.upcomingName} numberOfLines={1}>{m.full_name}</Text>
                      <Text style={styles.upcomingDetail}>
                        {m.plan?.name ?? 'No plan'} · {m.plan?.duration_days ? `${m.plan.duration_days}d` : ''}
                      </Text>
                    </View>
                    <View style={styles.upcomingRight}>
                      <Text style={styles.upcomingDate}>{formatDate(m.membership_end)}</Text>
                      <StatusBadge status={getMemberDisplayStatus(m)} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Recent Payments */}
            {recentPayments.length > 0 ? (
              <View style={styles.card}>
                <SectionHeader
                  title="Recent Payments"
                  icon={<Icon name="cash" size={18} color={colors.brand} />}
                  actionLabel="View All"
                  onAction={onNavigatePayments}
                />
                {recentPayments.map((p) => (
                  <View key={p.id} style={styles.paymentRow}>
                    <Avatar name={p.member_name ?? 'M'} size={36} />
                    <View style={styles.paymentInfo}>
                      <Text style={styles.paymentName} numberOfLines={1}>
                        {p.member_name ?? `Member #${p.member_id}`}
                      </Text>
                      <Text style={styles.paymentDetail}>
                        {p.method?.toUpperCase()} · {formatDate(p.paid_on)}
                      </Text>
                    </View>
                    <View style={styles.paymentRight}>
                      <Text style={styles.paymentAmount}>{formatCurrency(p.amount)}</Text>
                      <StatusBadge status={p.status} />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <QuickAction icon={<Icon name="personAdd" size={22} color={colors.brand} />} label="Add Member" onPress={onNavigateAddMember} />
              <QuickAction icon={<Icon name="renewals" size={22} color={colors.brand} />} label="Renew" onPress={onNavigateRenewals} />
              <QuickAction icon={<Icon name="receipt" size={22} color={colors.brand} />} label="Payment" onPress={onNavigateRecordPayment ?? onNavigatePayments} />
              <QuickAction icon={<Icon name="whatsapp" size={22} color={colors.whatsapp} />} label="WhatsApp" onPress={onNavigateWhatsApp ?? onNavigateSettings} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      style={styles.quickAction}
    >
      <View style={styles.quickActionIcon}>
        {icon}
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  attentionDot: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginRight: spacing.md,
    minWidth: 28,
    paddingHorizontal: spacing.xs,
  },
  attentionDotText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  attentionItem: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  attentionLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.base,
  },
  attentionRow: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  avatarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  brandName: {
    color: colors.brand,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  greeting: {
    paddingVertical: spacing.sm,
  },
  greetingSub: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    marginTop: spacing.xxs,
  },
  greetingText: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
  },
  gymName: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.xs,
  },
  gymSelector: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.xxs,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  paymentAmount: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.bold,
  },
  paymentDetail: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  paymentInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  paymentName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  paymentRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  paymentRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  quickAction: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  quickActionIcon: {
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: radius.lg,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  quickActionLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  revenueGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  revenueItem: {
    flex: 1,
  },
  revenueItemBorder: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    paddingLeft: spacing.sm,
  },
  revenueLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  revenueValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.xxs,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  topBarLeft: {
    flex: 1,
  },
  topBarRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  upcomingDate: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  upcomingDetail: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  upcomingInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  upcomingName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  upcomingRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  upcomingRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
});
