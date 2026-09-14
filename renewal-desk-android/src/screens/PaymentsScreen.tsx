import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Payment, PaymentsResponse, PaymentDashboardSummary } from '../types';
import { formatCurrency, formatDate } from '../types';

type PaymentsScreenProps = {
  onLogout: () => void;
  onSelectPayment?: (paymentId: number) => void;
  onRecordPayment?: () => void;
  refreshToken?: number;
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', dotColor: colors.statusPending },
  { key: 'verified', label: 'Verified', dotColor: colors.statusVerified },
  { key: 'rejected', label: 'Rejected', dotColor: colors.statusRejected },
];

const CHANNEL_OPTIONS = [
  { key: 'all', label: 'All Channels' },
  { key: 'online', label: 'VYNLA (Online)' },
  { key: 'offline', label: 'Counter / Cash' },
];

export function PaymentsScreen({ onLogout, onSelectPayment, onRecordPayment, refreshToken }: PaymentsScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<PaymentDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'verify' | 'reject' | 'cancel';
    paymentId: number;
    memberName: string;
    amount: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());

    // Fetch payments list and summary
    Promise.all([
      apiRequest<PaymentsResponse>(`/api/mobile/v1/payments?${params.toString()}`),
      apiRequest<PaymentDashboardSummary>('/api/mobile/v1/payments/summary'),
    ]).then(([listRes, sumRes]) => {
      if (cancelled) return;
      if (listRes.ok) {
        setPayments(listRes.data.payments);
        setTotalPages(listRes.data.pagination.total_pages);
        setError(undefined);
      } else {
        if (listRes.error.status === 401) { onLogout(); return; }
        setError(listRes.error.message);
      }

      if (sumRes.ok) {
        setSummary(sumRes.data);
      }

      setLoading(false);
      setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [page, statusFilter, channelFilter, searchQuery, revision, refreshToken, onLogout]);

  const executeAction = useCallback(async (action: 'verify' | 'reject' | 'cancel', paymentId: number) => {
    setActionLoading(paymentId);
    const result = await apiRequest<{ message: string }>(
      `/api/mobile/v1/payments/${paymentId}/${action}`,
      { method: 'POST' },
    );
    if (result.ok) {
      setRevision((r) => r + 1);
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setActionLoading(null);
    setConfirmAction(null);
  }, [onLogout]);

  const renderPayment = useCallback(({ item }: { item: Payment }) => {
    const isPending = item.status === 'pending' || item.status === 'processing';
    const isOnline = item.channel === 'online';
    const hasDiscount = Boolean(item.discount && parseFloat(item.discount) > 0);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => onSelectPayment?.(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Avatar name={item.member_name ?? 'M'} size={42} />
            <View style={styles.cardHeaderInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {item.member_name ?? `Member #${item.member_id}`}
                </Text>
                <View style={[styles.channelBadge, isOnline ? styles.onlineBadge : styles.offlineBadge]}>
                  <Text style={[styles.channelBadgeText, isOnline ? styles.onlineBadgeText : styles.offlineBadgeText]}>
                    {isOnline ? 'VYNLA' : 'Counter'}
                  </Text>
                </View>
              </View>
              {item.member_phone ? (
                <Text style={styles.phoneText}>{item.member_phone}</Text>
              ) : null}
              <Text style={styles.paymentMeta}>
                {item.method?.toUpperCase()} · {formatDate(item.paid_on || item.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.cardHeaderRight}>
            {hasDiscount && item.standard_price ? (
              <View style={styles.discountRow}>
                <Text style={styles.strikethroughPrice}>{formatCurrency(item.standard_price)}</Text>
                <View style={styles.savingsPill}>
                  <Text style={styles.savingsPillText}>-₹{item.discount}</Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
            <StatusBadge status={item.status} />
          </View>
        </View>

        {/* Plan and references */}
        <View style={styles.detailsRow}>
          {item.plan_name ? (
            <View style={styles.planBadge}>
              <Icon name="document" size={12} color={colors.brand} />
              <Text style={styles.planBadgeText}>{item.plan_name}</Text>
            </View>
          ) : null}
          {item.renewal_days ? (
            <Text style={styles.metaBadgeText}>{item.renewal_days} Days</Text>
          ) : null}
        </View>

        {item.reference ? (
          <Text style={styles.reference}>Ref / UTR: {item.reference}</Text>
        ) : null}

        {item.created_by ? (
          <Text style={styles.reference}>Staff: {item.created_by}</Text>
        ) : null}

        {item.verified_by ? (
          <Text style={styles.verifiedText}>Verified by: {item.verified_by}</Text>
        ) : null}

        {isPending ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.verifyBtn]}
              onPress={() =>
                setConfirmAction({
                  type: 'verify',
                  paymentId: item.id,
                  memberName: item.member_name ?? 'Member',
                  amount: item.amount,
                })
              }
              disabled={actionLoading === item.id}
            >
              <Text style={styles.actionBtnText}>
                <Icon name="checkmark" size={14} color={colors.textInverse} /> Verify
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() =>
                setConfirmAction({
                  type: 'reject',
                  paymentId: item.id,
                  memberName: item.member_name ?? 'Member',
                  amount: item.amount,
                })
              }
              disabled={actionLoading === item.id}
            >
              <Text style={styles.rejectBtnText}>
                <Icon name="close" size={14} color={colors.critical} /> Reject
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={() =>
                setConfirmAction({
                  type: 'cancel',
                  paymentId: item.id,
                  memberName: item.member_name ?? 'Member',
                  amount: item.amount,
                })
              }
              disabled={actionLoading === item.id}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, [actionLoading, onSelectPayment]);

  const renderHeader = () => (
    <View style={styles.headerSection}>
      {/* Revenue & Collections KPI Cards */}
      {summary ? (
        <View style={styles.summaryContainer}>
          {/* Card 1: Today's Collected */}
          <View style={[styles.summaryCard, styles.summaryCardPrimary]}>
            <View style={styles.summaryCardTop}>
              <Text style={styles.summaryLabel}>TODAY'S COLLECTIONS</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{summary.today.payment_count} paid</Text>
              </View>
            </View>
            <Text style={styles.summaryValue}>{formatCurrency(summary.today.total_collected)}</Text>
            {parseFloat(summary.today.total_discount || '0') > 0 ? (
              <Text style={styles.summarySubtext}>
                Discounts given: {formatCurrency(summary.today.total_discount)}
              </Text>
            ) : (
              <Text style={styles.summarySubtext}>Net verified cashflow</Text>
            )}
          </View>

          {/* Card 2: Channels Breakdown */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.summaryCardHalf]}>
              <Text style={styles.summarySmallLabel}>ONLINE (VYNLA)</Text>
              <Text style={styles.summarySmallValue}>{formatCurrency(summary.today.channels.online)}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardHalf]}>
              <Text style={styles.summarySmallLabel}>COUNTER (OFFLINE)</Text>
              <Text style={styles.summarySmallValue}>{formatCurrency(summary.today.channels.offline)}</Text>
            </View>
          </View>

          {/* Pending Demands Banner */}
          {summary.pending.count > 0 ? (
            <View style={styles.pendingBanner}>
              <Icon name="clock" size={16} color={colors.statusPending} />
              <Text style={styles.pendingBannerText}>
                <Text style={styles.boldText}>{summary.pending.count} pending</Text> payment review (
                {formatCurrency(summary.pending.amount)})
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by UTR, member name, or phone..."
          placeholderTextColor={colors.muted}
          value={searchQuery}
          onChangeText={(txt) => {
            setSearchQuery(txt);
            setPage(1);
          }}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 ? (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setPage(1); }}>
            <Icon name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterSection}>
        <FilterChips
          options={FILTER_OPTIONS}
          selected={statusFilter}
          onSelect={(key) => { setStatusFilter(key); setPage(1); }}
        />
        <View style={styles.channelFilterRow}>
          {CHANNEL_OPTIONS.map((opt) => {
            const isSelected = channelFilter === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.channelChip, isSelected && styles.channelChipSelected]}
                onPress={() => { setChannelFilter(opt.key); setPage(1); }}
              >
                <Text style={[styles.channelChipText, isSelected && styles.channelChipTextSelected]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Payments</Text>
          <Text style={styles.headerSubtitle}>Collections, demands & cashflow</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={onRecordPayment} activeOpacity={0.8}>
          <Icon name="add" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.skeletonContainer}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRevision((r) => r + 1)} />
      ) : payments.length === 0 && !summary ? (
        <EmptyState
          icon={<Icon name="payments" size={40} color={colors.muted} />}
          title="No payments"
          subtitle={statusFilter !== 'all' ? `No ${statusFilter} payments found.` : 'No payment activity yet.'}
        />
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPayment}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); setRevision((r) => r + 1); }}
              colors={[colors.brand]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={<Icon name="payments" size={40} color={colors.muted} />}
              title="No payments matched"
              subtitle="Try switching filters or recording a new payment."
            />
          }
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && !loading ? (
        <View style={styles.pagination}>
          <TouchableOpacity
            disabled={page <= 1}
            onPress={() => setPage((p) => p - 1)}
            style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
          >
            <Icon name="back" size={16} color={page <= 1 ? colors.muted : colors.brand} />
          </TouchableOpacity>
          <Text style={styles.pageInfo}>Page {page} of {totalPages}</Text>
          <TouchableOpacity
            disabled={page >= totalPages}
            onPress={() => setPage((p) => p + 1)}
            style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
          >
            <Icon name="forward" size={16} color={page >= totalPages ? colors.muted : colors.brand} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Confirm Dialog */}
      <ConfirmDialog
        visible={confirmAction !== null}
        title={
          confirmAction?.type === 'verify'
            ? 'Verify Payment'
            : confirmAction?.type === 'cancel'
            ? 'Cancel Demand'
            : 'Reject Payment'
        }
        message={
          confirmAction?.type === 'verify'
            ? `Verify payment of ${formatCurrency(confirmAction?.amount ?? '0')} from ${confirmAction?.memberName}? This will extend their membership.`
            : confirmAction?.type === 'cancel'
            ? `Cancel payment demand of ${formatCurrency(confirmAction?.amount ?? '0')} for ${confirmAction?.memberName}? This will remove the pending bill.`
            : `Reject payment of ${formatCurrency(confirmAction?.amount ?? '0')} from ${confirmAction?.memberName}? This action cannot be undone.`
        }
        confirmLabel={
          confirmAction?.type === 'verify'
            ? 'Verify'
            : confirmAction?.type === 'cancel'
            ? 'Cancel Demand'
            : 'Reject'
        }
        destructive={confirmAction?.type === 'reject' || confirmAction?.type === 'cancel'}
        loading={actionLoading !== null}
        onConfirm={() => {
          if (confirmAction) {
            void executeAction(confirmAction.type, confirmAction.paymentId);
          }
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  actionBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  amount: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    fontVariant: ['tabular-nums'],
  },
  boldText: {
    fontWeight: fontWeight.bold,
  },
  cancelBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardHeaderInfo: {
    flex: 1,
    marginLeft: spacing.md,
    minWidth: 0,
  },
  cardHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  channelBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  channelBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  channelChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  channelChipSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  channelChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  channelChipTextSelected: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
  },
  channelFilterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  countBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  detailsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  discountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  filterSection: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerSection: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
  },
  listContent: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  metaBadgeText: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  offlineBadge: {
    backgroundColor: '#F1F5F9',
  },
  offlineBadgeText: {
    color: '#475569',
  },
  onlineBadge: {
    backgroundColor: '#EEF2FF',
  },
  onlineBadgeText: {
    color: '#4F46E5',
  },
  pageButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pageButtonDisabled: {
    opacity: 0.3,
  },
  pageInfo: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  paymentMeta: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  pendingBanner: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pendingBannerText: {
    color: colors.warningDark,
    fontSize: fontSize.xs,
  },
  phoneText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  planBadge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  planBadgeText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  reference: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  rejectBtn: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderWidth: 1,
  },
  rejectBtnText: {
    color: colors.critical,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  savingsPill: {
    backgroundColor: '#DCFCE7',
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  savingsPillText: {
    color: '#15803D',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  skeletonContainer: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  strikethroughPrice: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textDecorationLine: 'line-through',
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  summaryCardHalf: {
    flex: 1,
  },
  summaryCardPrimary: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  summaryCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryContainer: {
    gap: spacing.sm,
  },
  summaryLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summarySmallLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  summarySmallValue: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.extrabold,
    marginTop: 2,
  },
  summarySubtext: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: fontSize.xs,
    marginTop: 4,
  },
  summaryValue: {
    color: colors.textInverse,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  verifiedText: {
    color: colors.successDark,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  verifyBtn: {
    backgroundColor: colors.success,
  },
  addBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  searchContainer: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.sm,
    paddingVertical: spacing.sm,
  },
});
