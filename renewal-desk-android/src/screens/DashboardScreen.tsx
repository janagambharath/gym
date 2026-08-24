import { type ReactNode, useCallback, useEffect, useState } from 'react';
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
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { DashboardData, Member, Payment } from '../types';
import { formatCurrency, formatDate, getDaysText, getMemberDisplayStatus } from '../types';

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
  const hasAttention = Boolean(
    data && (data.expiring_soon > 0 || data.pending_payments > 0 || data.expired > 0),
  );

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
        <View style={styles.brandBlock}>
          <BrandMark />
          <Text style={styles.brandName}>Renewal Desk</Text>
        </View>
        {session?.tenantName ? (
          <View style={styles.gymSelector}>
            <Icon name="fitness" size={14} color={colors.textSecondary} />
            <Text style={styles.gymName} numberOfLines={1}>{session.tenantName}</Text>
            <Icon name="forward" size={13} color={colors.muted} />
          </View>
        ) : <View style={styles.topBarSpacer} />}
        <View style={styles.topBarRight}>
          <View
            accessibilityLabel={hasAttention ? 'Attention items are waiting' : 'No attention items'}
            style={styles.notificationButton}
          >
            <Icon name="notifications" size={21} color={colors.text} />
            {hasAttention ? <View style={styles.notificationDot} /> : null}
          </View>
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
                Here&apos;s the live view of what needs your attention today.
              </Text>
            </View>

            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <DashboardMetric
                icon={<Icon name="members" size={18} color={colors.brand} />}
                iconBg={colors.brandSubtle}
                label="Active Members"
                value={data.total_active}
                detail="Current total"
              />
              <DashboardMetric
                icon={<Icon name="time" size={18} color={colors.statusExpiring} />}
                iconBg={colors.statusExpiringSurface}
                label="Expiring Soon"
                value={data.expiring_soon}
                detail={data.expiring_today ? `${data.expiring_today} today` : 'Next 7 days'}
                detailColor={colors.statusExpiring}
              />
              <DashboardMetric
                icon={<Icon name="alert" size={18} color={colors.statusExpired} />}
                iconBg={colors.statusExpiredSurface}
                label="Expired"
                value={data.expired}
                detail="Need attention"
                detailColor={colors.statusExpired}
              />
              <DashboardMetric
                icon={<Icon name="wallet" size={18} color={colors.statusPending} />}
                iconBg={colors.statusPendingSurface}
                label="Pending Payments"
                value={data.pending_payments}
                detail="Awaiting review"
                detailColor={colors.statusPending}
              />
            </View>

            {/* Revenue */}
            <View style={styles.card}>
              <View style={styles.revenueHeading}>
                <SectionHeader title="Revenue Overview" icon={<Icon name="currency" size={18} color={colors.brand} />} />
                <View style={styles.periodPill}>
                  <Text style={styles.periodPillText}>Live totals</Text>
                </View>
              </View>
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
                <SectionHeader
                  title="Attention Required"
                  icon={<Icon name="warning" size={18} color={colors.statusExpiring} />}
                  actionLabel="View all"
                  onAction={onNavigateRenewals}
                />
                <View style={styles.attentionGrid}>
                  {data.expiring_soon > 0 ? (
                    <AttentionTile
                      color={colors.statusExpiring}
                      label="Expiring soon"
                      onPress={onNavigateRenewals}
                      value={data.expiring_soon}
                    />
                  ) : null}
                  {data.pending_payments > 0 ? (
                    <AttentionTile
                      color={colors.statusPending}
                      label="Pending payments"
                      onPress={onNavigatePayments}
                      value={data.pending_payments}
                    />
                  ) : null}
                  {data.expired > 0 ? (
                    <AttentionTile
                      color={colors.statusExpired}
                      label="Expired members"
                      onPress={onNavigateRenewals}
                      value={data.expired}
                    />
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
                {upcoming.map((m) => {
                  const daysText = getDaysText(m.days_until_expiry);
                  return (
                    <TouchableOpacity
                    key={m.id}
                    style={styles.upcomingRow}
                    onPress={() => onNavigateMemberDetail?.(m)}
                  >
                    <Avatar name={m.full_name} size={38} />
                    <View style={styles.upcomingInfo}>
                      <Text style={styles.upcomingName} numberOfLines={1}>{m.full_name}</Text>
                      <Text style={styles.upcomingDetail}>
                        {m.plan?.name ?? 'No plan'} · {m.plan?.duration_days ? `${m.plan.duration_days}d` : ''}
                      </Text>
                    </View>
                    <View style={styles.upcomingRight}>
                      <Text style={styles.upcomingDate}>{formatDate(m.membership_end)}</Text>
                      {daysText ? <Text style={styles.upcomingDays}>{daysText}</Text> : null}
                      <StatusBadge status={getMemberDisplayStatus(m)} />
                    </View>
                    </TouchableOpacity>
                  );
                })}
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
            <View style={styles.quickActionsCard}>
              <View style={styles.quickActions}>
                <QuickAction icon={<Icon name="personAdd" size={21} color={colors.brand} />} label="Add Member" onPress={onNavigateAddMember} />
                <QuickAction icon={<Icon name="renewals" size={21} color={colors.brand} />} label="Renew" onPress={onNavigateRenewals} />
                <QuickAction icon={<Icon name="receipt" size={21} color={colors.brand} />} label="Payment" onPress={onNavigateRecordPayment ?? onNavigatePayments} />
                <QuickAction icon={<Icon name="whatsapp" size={21} color={colors.whatsapp} />} label="WhatsApp" onPress={onNavigateWhatsApp ?? onNavigateSettings} />
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type DashboardMetricProps = {
  icon: ReactNode;
  iconBg: string;
  label: string;
  value: number | string;
  detail: string;
  detailColor?: string;
};

function DashboardMetric({ icon, iconBg, label, value, detail, detailColor }: DashboardMetricProps) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={1} style={[styles.metricDetail, detailColor ? { color: detailColor } : undefined]}>
        {detail}
      </Text>
    </View>
  );
}

function AttentionTile({
  color,
  label,
  onPress,
  value,
}: {
  color: string;
  label: string;
  onPress?: () => void;
  value: number;
}) {
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress} style={styles.attentionTile}>
      <Text style={[styles.attentionValue, { color }]}>{value}</Text>
      <Text numberOfLines={2} style={styles.attentionLabel}>{label}</Text>
      <Icon name="forward" size={13} color={colors.muted} />
    </TouchableOpacity>
  );
}

function BrandMark() {
  return (
    <View accessibilityLabel="Renewal Desk" style={styles.brandMark}>
      <Text style={styles.brandGlyph}>R</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: ReactNode; label: string; onPress?: () => void }) {
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
  attentionGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  attentionLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    lineHeight: 15,
    marginTop: spacing.xxs,
  },
  attentionTile: {
    backgroundColor: colors.gray50,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 78,
    padding: spacing.sm,
  },
  attentionValue: {
    fontSize: fontSize['2xl'],
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.extrabold,
  },
  avatarButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 40,
  },
  brandBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  brandGlyph: {
    color: colors.brand,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.extrabold,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  brandName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.extrabold,
    letterSpacing: -0.2,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xl,
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
    paddingTop: spacing.xs,
  },
  greetingSub: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  greetingText: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
  },
  gymName: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  gymSelector: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    marginHorizontal: spacing.xs,
    maxWidth: 126,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  metricCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    minHeight: 116,
    minWidth: 0,
    padding: spacing.sm,
    ...shadows.sm,
  },
  metricDetail: {
    color: colors.muted,
    fontSize: 10,
    marginTop: spacing.xxs,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 30,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 30,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    lineHeight: 14,
    minHeight: 28,
  },
  metricValue: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.xxs,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  notificationButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    position: 'relative',
    width: 36,
  },
  notificationDot: {
    backgroundColor: colors.critical,
    borderColor: colors.surface,
    borderRadius: 5,
    borderWidth: 1,
    height: 9,
    position: 'absolute',
    right: 5,
    top: 4,
    width: 9,
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
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.lg,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  quickActionLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActionsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  periodPill: {
    backgroundColor: colors.gray50,
    borderColor: colors.borderLight,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  periodPillText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
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
  revenueHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  topBarRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  topBarSpacer: {
    flex: 1,
  },
  upcomingDate: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  upcomingDays: {
    color: colors.statusExpiring,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
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
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
});
