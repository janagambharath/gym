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
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Payment, PaymentsResponse } from '../types';
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

export function PaymentsScreen({ onLogout, onSelectPayment, onRecordPayment, refreshToken }: PaymentsScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'verify' | 'reject';
    paymentId: number;
    memberName: string;
    amount: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);

    void apiRequest<PaymentsResponse>(`/api/mobile/v1/payments?${params.toString()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPayments(result.data.payments);
        setTotalPages(result.data.pagination.total_pages);
        setError(undefined);
      } else {
        if (result.error.status === 401) { onLogout(); return; }
        setError(result.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [page, statusFilter, revision, refreshToken, onLogout]);

  const executeAction = useCallback(async (action: 'verify' | 'reject', paymentId: number) => {
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
    const isPending = item.status === 'pending';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => onSelectPayment?.(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Avatar name={item.member_name ?? 'M'} size={40} />
            <View style={styles.cardHeaderInfo}>
              <Text style={styles.memberName} numberOfLines={1}>
                {item.member_name ?? `Member #${item.member_id}`}
              </Text>
              <Text style={styles.paymentMeta}>
                {item.method?.toUpperCase()} · {formatDate(item.paid_on)}
              </Text>
            </View>
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
            <StatusBadge status={item.status} />
          </View>
        </View>

        {item.reference ? (
          <Text style={styles.reference}>Ref: {item.reference}</Text>
        ) : null}

        {item.renewal_days ? (
          <Text style={styles.reference}>Renewal: {item.renewal_days} days</Text>
        ) : null}

        {item.verified_by ? (
          <Text style={styles.reference}>Verified by: {item.verified_by}</Text>
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
              <Text style={styles.actionBtnText}><Icon name="checkmark" size={14} color={colors.textInverse} /> Verify</Text>
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
              <Text style={styles.rejectBtnText}><Icon name="close" size={14} color={colors.critical} /> Reject</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, [actionLoading, onSelectPayment]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payments</Text>
        <TouchableOpacity style={styles.addBtn} onPress={onRecordPayment}>
          <Icon name="add" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <FilterChips
        options={FILTER_OPTIONS}
        selected={statusFilter}
        onSelect={(key) => { setStatusFilter(key); setPage(1); }}
      />

      {loading && !refreshing ? (
        <View style={styles.skeletonContainer}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRevision((r) => r + 1)} />
      ) : payments.length === 0 ? (
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
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); setRevision((r) => r + 1); }}
              colors={[colors.brand]}
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
            <Text style={styles.pageButtonText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pageInfo}>Page {page} of {totalPages}</Text>
          <TouchableOpacity
            disabled={page >= totalPages}
            onPress={() => setPage((p) => p + 1)}
            style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
          >
            <Text style={styles.pageButtonText}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Confirm Dialog */}
      <ConfirmDialog
        visible={confirmAction !== null}
        title={confirmAction?.type === 'verify' ? 'Verify Payment' : 'Reject Payment'}
        message={
          confirmAction?.type === 'verify'
            ? `Verify payment of ${formatCurrency(confirmAction?.amount ?? '0')} from ${confirmAction?.memberName}? This will extend their membership.`
            : `Reject payment of ${formatCurrency(confirmAction?.amount ?? '0')} from ${confirmAction?.memberName}? This action cannot be undone.`
        }
        confirmLabel={confirmAction?.type === 'verify' ? 'Verify' : 'Reject'}
        destructive={confirmAction?.type === 'reject'}
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
    minHeight: 40,
  },
  actionBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  amount: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    fontVariant: ['tabular-nums'],
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
    marginLeft: spacing.md,
  },
  cardHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  addBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
  },
  listContent: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
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
  pageButtonText: {
    color: colors.brand,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
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
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  reference: {
    color: colors.muted,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  rejectBtn: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderWidth: 1,
  },
  rejectBtnText: {
    color: colors.critical,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  skeletonContainer: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  verifyBtn: {
    backgroundColor: colors.success,
  },
});
