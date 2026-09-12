/**
 * MemberPaymentHistoryScreen — Payment and transaction history for gym members.
 *
 * Shows: list of payments with verification status, amounts, dates, and references.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../../theme/tokens';
import type { MemberPayment } from '../../services/memberApiClient';
import { fetchMemberPayments } from '../../services/memberApiClient';
import { ErrorState } from '../../components/ErrorState';

export function MemberPaymentHistoryScreen() {
  const [payments, setPayments] = useState<MemberPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadPayments = useCallback(async (pageNum = 1) => {
    const result = await fetchMemberPayments(pageNum);
    if (result.ok) {
      if (pageNum === 1) {
        setPayments(result.data.payments);
      } else {
        setPayments((prev) => [...prev, ...result.data.payments]);
      }
      setTotalPages(result.data.pagination.total_pages);
      setPage(pageNum);
      setError(undefined);
    } else {
      setError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchMemberPayments(1).then((result) => {
      if (!active) return;
      if (result.ok) {
        setPayments(result.data.payments);
        setTotalPages(result.data.pagination.total_pages);
        setPage(1);
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

  const handleLoadMore = useCallback(() => {
    if (page < totalPages && !loading && !refreshing) {
      void loadPayments(page + 1);
    }
  }, [page, totalPages, loading, refreshing, loadPayments]);

  if (loading && payments.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && payments.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ErrorState message={error} onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  const renderStatusBadge = (status: string) => {
    let bg: string = colors.gray100;
    let textCol: string = colors.textSecondary;
    let label = status;

    if (status === 'verified' || status === 'paid') {
      bg = colors.successSurface;
      textCol = colors.success;
      label = 'Verified';
    } else if (status === 'pending') {
      bg = colors.warningSurface;
      textCol = colors.warning;
      label = 'Pending Verification';
    } else if (status === 'rejected') {
      bg = colors.criticalSurface;
      textCol = colors.critical;
      label = 'Rejected';
    }

    return (
      <View style={[styles.badge, { backgroundColor: bg }]}>
        <Text style={[styles.badgeText, { color: textCol }]}>{label}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payment History</Text>
        <Text style={styles.headerSubtitle}>Your membership payments and claims</Text>
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="receipt" size={48} color={colors.muted} />
            <Text style={styles.emptyTitle}>No payments yet</Text>
            <Text style={styles.emptySubtitle}>
              When you renew or claim payments, they will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.paymentCard}>
            <View style={styles.cardTop}>
              <View>
                <Text style={styles.amount}>₹{item.amount}</Text>
                <Text style={styles.method}>
                  {item.method ? item.method.replace('_', ' ').toUpperCase() : 'PAYMENT'}
                </Text>
              </View>
              {renderStatusBadge(item.status)}
            </View>

            {item.reference ? (
              <View style={styles.referenceRow}>
                <Text style={styles.referenceLabel}>Ref / ID:</Text>
                <Text style={styles.referenceValue}>{item.reference}</Text>
              </View>
            ) : null}

            {item.notes ? (
              <Text style={styles.notesText} numberOfLines={2}>
                {item.notes}
              </Text>
            ) : null}

            <View style={styles.cardFooter}>
              <Text style={styles.dateText}>
                {item.paid_on
                  ? `Paid: ${item.paid_on.split('T')[0]}`
                  : item.created_at
                  ? `Submitted: ${item.created_at.split('T')[0]}`
                  : ''}
              </Text>
              {item.verified_at && (
                <Text style={styles.verifiedDate}>
                  Verified: {item.verified_at.split('T')[0]}
                </Text>
              )}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
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
  headerSubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.bottomTabSafe,
  },
  paymentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  amount: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  method: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  referenceRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  referenceLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  referenceValue: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
  notesText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  dateText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  verifiedDate: {
    fontSize: fontSize.xs,
    color: colors.success,
    fontWeight: fontWeight.medium,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl * 2,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
