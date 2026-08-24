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
  const [acting, setActing] = useState(false);

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
  }, [fetchPayment]);

  const handleVerify = useCallback(async () => {
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
  }, [paymentId, fetchPayment, onUpdated]);

  const handleReject = useCallback(async () => {
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
  }, [paymentId, fetchPayment, onUpdated]);

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
                <Text style={styles.paymentIdText}>Payment #{payment.id}</Text>
              </View>
              <StatusBadge status={payment.status} />
            </View>
            <View style={styles.amountBox}>
              <Text style={styles.amountLabel}>Amount</Text>
              <Text style={styles.amountValue}>{formatCurrency(payment.amount)}</Text>
            </View>
          </View>

          {/* Details */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="document" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Details</Text>
            </View>
            <InfoRow label="Method" value={payment.method?.toUpperCase() ?? '—'} />
            <InfoRow label="Paid On" value={formatDate(payment.paid_on) ?? '—'} />
            <InfoRow label="Reference" value={payment.reference ?? '—'} />
            <InfoRow label="Renewal Days" value={payment.renewal_days ? String(payment.renewal_days) : '—'} />
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

          {/* Created */}
          <View style={styles.card}>
            <InfoRow label="Created At" value={formatDate(payment.created_at) ?? '—'} />
          </View>

          {/* Actions for Pending Payments */}
          {payment.status === 'pending' ? (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionButton: { flex: 1 },
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
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.section },
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
  paymentIdText: { color: colors.muted, fontSize: fontSize.sm },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
});
