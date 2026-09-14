import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { InfoRow } from '../components/InfoRow';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { loadSession } from '../storage/secureSessionStore';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Payment } from '../types';
import { formatCurrency, formatDate } from '../types';

type PaymentDetailScreenProps = {
  paymentId: number;
  onBack: () => void;
  onUpdated?: () => void;
};

export function PaymentDetailScreen({ paymentId, onBack, onUpdated }: PaymentDetailScreenProps) {
  const [payment, setPayment] = useState<Payment | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [showVerify, setShowVerify] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [acting, setActing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  const fetchPayment = useCallback(() => apiRequest<Payment>(`/api/mobile/v1/payments/${paymentId}`).then((res) => {
    if (res.ok) {
      setPayment(res.data);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }), [paymentId]);

  useEffect(() => {
    void fetchPayment();
    void loadSession().then((session) => {
      setIsOwner(session?.userRole === 'gym_owner');
    });
  }, [fetchPayment]);

  const handleVerify = useCallback(async () => {
    if (acting) return;
    setActing(true);
    const res = await apiRequest(`/api/mobile/v1/payments/${paymentId}/verify`, { method: 'POST' });
    setActing(false);
    setShowVerify(false);
    if (res.ok) {
      Alert.alert('Success', 'Payment verified and membership extended.');
      onUpdated?.();
      void fetchPayment();
    } else {
      Alert.alert('Error', res.error.message);
    }
  }, [acting, paymentId, fetchPayment, onUpdated]);

  const handleReject = useCallback(async () => {
    if (acting) return;
    setActing(true);
    const res = await apiRequest(`/api/mobile/v1/payments/${paymentId}/reject`, { method: 'POST' });
    setActing(false);
    setShowReject(false);
    if (res.ok) {
      Alert.alert('Rejected', 'Payment has been rejected.');
      onUpdated?.();
      void fetchPayment();
    } else {
      Alert.alert('Error', res.error.message);
    }
  }, [acting, paymentId, fetchPayment, onUpdated]);

  const handleCancelDemand = useCallback(async () => {
    if (acting) return;
    setActing(true);
    const res = await apiRequest(`/api/mobile/v1/payments/${paymentId}/cancel`, { method: 'POST' });
    setActing(false);
    setShowCancel(false);
    if (res.ok) {
      Alert.alert('Cancelled', 'Payment demand cancelled.');
      onUpdated?.();
      void fetchPayment();
    } else {
      Alert.alert('Error', res.error.message);
    }
  }, [acting, paymentId, fetchPayment, onUpdated]);

  const handleDelete = useCallback(async () => {
    if (acting) return;
    setActing(true);
    const res = await apiRequest(`/api/mobile/v1/payments/${paymentId}`, { method: 'DELETE' });
    setActing(false);
    setShowDelete(false);
    if (res.ok) {
      Alert.alert('Deleted', 'Payment record has been removed.');
      onUpdated?.();
      onBack();
    } else {
      Alert.alert('Error', res.error.message);
    }
  }, [acting, paymentId, onUpdated, onBack]);

  const isPending = payment?.status === 'pending' || payment?.status === 'processing';
  const hasDiscount = Boolean(payment?.discount && parseFloat(payment.discount) > 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Payment Details" onBack={onBack} />

      {loading ? (
        <View style={styles.content}><LoadingSkeleton lines={6} height={18} /></View>
      ) : error || !payment ? (
        <ErrorState message={error ?? 'Payment not found'} onRetry={fetchPayment} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Header Card */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Avatar name={payment.member_name ?? 'M'} size={48} />
              <View style={styles.headerInfo}>
                <Text style={styles.memberName}>{payment.member_name ?? `Member #${payment.member_id}`}</Text>
                {payment.member_phone ? (
                  <Text style={styles.phoneText}>{payment.member_phone}</Text>
                ) : null}
                <Text style={styles.paymentIdText}>Payment #{payment.id}</Text>
              </View>
              <StatusBadge status={payment.status} />
            </View>
            <View style={styles.amountBox}>
              <Text style={styles.amountLabel}>
                {payment.status === 'verified' ? 'Amount Collected' : 'Payable Amount'}
              </Text>
              <Text style={styles.amountValue}>{formatCurrency(payment.amount)}</Text>
              {payment.channel ? (
                <View style={[styles.channelBadge, payment.channel === 'online' ? styles.onlineBadge : styles.offlineBadge]}>
                  <Text style={[styles.channelBadgeText, payment.channel === 'online' ? styles.onlineBadgeText : styles.offlineBadgeText]}>
                    {payment.channel === 'online' ? 'Online (VYNLA App)' : 'Counter (Offline)'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Pricing & Plan Details */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="document" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Plan & Pricing</Text>
            </View>
            <InfoRow label="Plan" value={payment.plan_name ?? 'Membership Renewal'} />
            {payment.standard_price ? (
              <InfoRow label="Catalog Price" value={formatCurrency(payment.standard_price)} />
            ) : null}
            {hasDiscount && payment.discount ? (
              <InfoRow label="Discount Given" value={`- ${formatCurrency(payment.discount)}`} />
            ) : null}
            <InfoRow label="Net Final Amount" value={formatCurrency(payment.amount)} />
            <InfoRow label="Renewal Days" value={payment.renewal_days ? `${payment.renewal_days} Days` : '—'} />
          </View>

          {/* Transaction Details */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="payments" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Transaction Info</Text>
            </View>
            <InfoRow label="Method" value={payment.method?.toUpperCase() ?? '—'} />
            <InfoRow label="Channel" value={payment.channel === 'online' ? 'Online (VYNLA App)' : 'Counter (Cash / POS)'} />
            <InfoRow label="Paid / Requested On" value={formatDate(payment.paid_on || payment.created_at) ?? '—'} />
            <InfoRow label="Reference / UTR" value={payment.reference ?? '—'} />
            {payment.created_by ? <InfoRow label="Recorded By" value={payment.created_by} /> : null}
            {payment.notes ? <InfoRow label="Notes" value={payment.notes} /> : null}
          </View>

          {/* Verification Info */}
          {payment.verified_by || payment.verified_at ? (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Icon name="shield" size={18} color={colors.success} />
                <Text style={styles.sectionTitle}>Verification</Text>
              </View>
              {payment.verified_by ? <InfoRow label="Verified By" value={payment.verified_by} /> : null}
              {payment.verified_at ? <InfoRow label="Verified At" value={formatDate(payment.verified_at) ?? '—'} /> : null}
            </View>
          ) : null}

          {/* Actions for Pending / Processing Payments */}
          {isPending ? (
            <View style={styles.actionColumn}>
              <View style={styles.actions}>
                <PrimaryButton
                  title="Verify Payment"
                  variant="primary"
                  onPress={() => setShowVerify(true)}
                  icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
                  style={styles.actionButton}
                />
                <PrimaryButton
                  title="Reject"
                  variant="danger"
                  onPress={() => setShowReject(true)}
                  icon={<Icon name="close" size={18} color={colors.textInverse} />}
                  style={styles.actionButton}
                />
              </View>
              <PrimaryButton
                title="Cancel Demand"
                variant="outline"
                onPress={() => setShowCancel(true)}
                icon={<Icon name="close" size={18} color={colors.muted} />}
                style={styles.cancelDemandButton}
              />
            </View>
          ) : null}

          {/* Delete Payment Button (strictly for gym_owner) */}
          {isOwner ? (
            <View style={styles.deleteSection}>
              <PrimaryButton
                title="Delete Record"
                variant="outline"
                onPress={() => setShowDelete(true)}
                icon={<Icon name="delete" size={18} color={colors.critical} />}
                style={styles.deleteButton}
              />
            </View>
          ) : null}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={showVerify}
        title="Verify Payment"
        message={`Verify payment of ${formatCurrency(payment?.amount ?? '0')}? This will extend the member's membership.`}
        confirmLabel="Verify"
        confirmVariant="primary"
        loading={acting}
        onConfirm={() => void handleVerify()}
        onCancel={() => setShowVerify(false)}
      />

      <ConfirmDialog
        visible={showReject}
        title="Reject Payment"
        message="Are you sure you want to reject this payment? This action cannot be undone."
        confirmLabel="Reject"
        confirmVariant="danger"
        loading={acting}
        onConfirm={() => void handleReject()}
        onCancel={() => setShowReject(false)}
      />

      <ConfirmDialog
        visible={showCancel}
        title="Cancel Payment Demand"
        message={`Cancel pending demand of ${formatCurrency(payment?.amount ?? '0')}? The pending bill will be cancelled.`}
        confirmLabel="Cancel Demand"
        confirmVariant="danger"
        loading={acting}
        onConfirm={() => void handleCancelDemand()}
        onCancel={() => setShowCancel(false)}
      />

      <ConfirmDialog
        visible={showDelete}
        title="Delete Payment"
        message="Are you sure you want to delete this payment record? If this payment extended the membership, the expiry date will be reverted safely."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={acting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDelete(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionButton: { flex: 1 },
  actionColumn: { gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md },
  amountBox: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
  },
  amountLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  amountValue: { color: colors.text, fontSize: fontSize['5xl'], fontVariant: ['tabular-nums'], fontWeight: fontWeight.extrabold },
  cancelDemandButton: {
    borderColor: colors.border,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  channelBadge: {
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  channelBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  deleteButton: {
    borderColor: colors.critical,
  },
  deleteSection: {
    marginTop: spacing.sm,
  },
  headerCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.md,
  },
  headerInfo: { flex: 1, marginLeft: spacing.md },
  headerTop: { alignItems: 'center', flexDirection: 'row' },
  memberName: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
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
  paymentIdText: { color: colors.muted, fontSize: fontSize.sm },
  phoneText: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
});
