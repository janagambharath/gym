import React, { useCallback, useRef, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/apiClient';
import { useBranding } from '../context/BrandingContext';
import { formatGymDate } from '../utils/gymTime';
import { PaymentRecord } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { colors, radii, spacing, typography } from '../theme/tokens';

export const PaymentsScreen: React.FC = () => {
  const { theme } = useBranding();

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const loadedPages = useRef(1);
  const requestId = useRef(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchPayments = useCallback(async (pageNum = 1, refreshLoaded = false) => {
    const id = ++requestId.current;
    try {
      const target = refreshLoaded ? loadedPages.current : pageNum;
      const results = refreshLoaded
        ? await Promise.all(Array.from({ length: target }, (_, index) => apiClient.getPayments(index + 1, 20)))
        : [await apiClient.getPayments(pageNum, 20)];
      if (id !== requestId.current) return;
      const res = results[results.length - 1];
      const records = results.flatMap(result => result.payments);
      if (pageNum === 1 || refreshLoaded) {
        setPayments(records);
      } else {
        setPayments((prev) => [...prev, ...res.payments]);
      }
      setHasMore(res.pagination.page < res.pagination.total_pages);
      loadedPages.current = target;
      setPage(target);
    } catch {
      // Non-fatal
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useLiveEffect(() => {
    void fetchPayments(1, true);
    return () => { requestId.current += 1; };
  }, [fetchPayments]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPayments(1);
  }, [fetchPayments]);

  const onEndReached = () => {
    if (!loading && hasMore) {
      fetchPayments(page + 1);
    }
  };

  // V12-L4: render in gym time, not device-local time.
  const formatDate = (iso: string | null | undefined) => formatGymDate(iso);

  const renderPaymentItem = ({ item }: { item: PaymentRecord }) => {
    const isPending = item.status.toLowerCase() === 'pending' || item.status.toLowerCase() === 'processing';
    const isVerified = item.status.toLowerCase() === 'verified';
    const isRejected = item.status.toLowerCase() === 'rejected';
    const isOnline = item.channel === 'online';
    const hasDiscount = Boolean(item.discount && parseFloat(item.discount) > 0);

    return (
      <View style={styles.paymentCard}>
        <View style={styles.cardHeader}>
          <View style={styles.methodInfo}>
            <View
              style={[
                styles.iconBadge,
                isVerified && { backgroundColor: colors.activeSurface },
                isPending && { backgroundColor: colors.expiringSurface },
                isRejected && { backgroundColor: colors.expiredSurface },
              ]}
            >
              <Ionicons
                name={isVerified ? 'checkmark-circle' : isPending ? 'hourglass' : 'close-circle'}
                size={20}
                color={isVerified ? colors.active : isPending ? colors.expiring : colors.expired}
              />
            </View>
            <View>
              <Text style={styles.planNameText}>{item.plan_name || 'Membership Payment'}</Text>
              <Text style={styles.dateText}>
                {item.method?.toUpperCase()} · {formatDate(item.paid_on || item.created_at)}
              </Text>
            </View>
          </View>
          <StatusBadge status={item.status} size="sm" />
        </View>

        {/* Pricing Breakdown */}
        <View style={styles.pricingSection}>
          <View style={styles.channelRow}>
            <View style={[styles.channelBadge, isOnline ? styles.onlineBadge : styles.offlineBadge]}>
              <Text style={[styles.channelBadgeText, isOnline ? styles.onlineBadgeText : styles.offlineBadgeText]}>
                {isOnline ? 'Online (UPI)' : 'Gym Counter'}
              </Text>
            </View>
            {hasDiscount && item.discount ? (
              <View style={styles.savingsPill}>
                <Text style={styles.savingsPillText}>Saved ₹{item.discount}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.amountContainer}>
            {hasDiscount && item.standard_price ? (
              <Text style={styles.strikethroughPrice}>₹{item.standard_price}</Text>
            ) : null}
            <Text style={styles.amountText}>₹{item.amount}</Text>
          </View>
        </View>

        {item.reference && (
          <View style={styles.referenceRow}>
            <Text style={styles.referenceLabel}>Ref / UTR:</Text>
            <Text style={styles.referenceValue}>{item.reference}</Text>
          </View>
        )}

        {item.notes && (
          <Text style={styles.notesText} numberOfLines={2}>
            {item.notes}
          </Text>
        )}

        {/* V12-M1: a rejected payment must say why and what to do next —
            the backend sends rejected_reason/rejected_at (member_api.py
            :1999-2000) and the V11-M10 client half never rendered them. */}
        {isRejected && (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedReasonText}>
              {item.rejected_reason
                ? `Rejected: ${item.rejected_reason}`
                : 'Rejected by your gym.'}
              {item.rejected_at ? ` (${formatDate(item.rejected_at)})` : ''}
            </Text>
            <Text style={styles.rejectedNextText}>
              Please re-submit your payment or contact your gym.
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (loading && payments.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading payment history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={payments}
        renderItem={renderPaymentItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.primary]} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Payments & Receipts</Text>
            <Text style={styles.headerSubtitle}>
              Authoritative transaction records with {theme.gymName}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="wallet-outline"
            title="No Payments Yet"
            description="All your renewal payments and receipts will be listed here."
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  paymentCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  methodInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  planNameText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  amountText: {
    ...typography.h3,
    color: colors.text,
  },
  dateText: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
  pricingSection: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  channelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  channelBadge: {
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  channelBadgeText: {
    fontSize: 11,
    fontWeight: '700',
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
  savingsPill: {
    backgroundColor: '#DCFCE7',
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savingsPillText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '700',
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  strikethroughPrice: {
    ...typography.caption,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  referenceLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  referenceValue: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  notesText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontSize: 12,
  },
  // V12-M1: rejected-payment reason + next step.
  rejectedBox: {
    backgroundColor: colors.expiredSurface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.expiredBorder,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  rejectedReasonText: {
    ...typography.subtext,
    color: colors.expired,
    fontWeight: '600',
    lineHeight: 18,
  },
  rejectedNextText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});
