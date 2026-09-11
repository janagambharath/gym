import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatCurrency, formatDate } from '../types';

type FastRenewalScreenProps = {
  paymentId: number;
  memberName: string;
  amount: string;
  planName?: string;
  paymentMethod?: string;
  paymentReference?: string;
  membershipEnd?: string;
  onBack: () => void;
  onConfirmed: () => void;
};

/**
 * Fast Renewal Confirmation — the 1-2 tap workflow.
 *
 * Instead of: search member → open profile → open payment → edit → save
 * This screen: tap notification/card → see summary → CONFIRM RENEWAL → done.
 */
export function FastRenewalScreen({
  paymentId,
  memberName,
  amount,
  planName,
  paymentMethod,
  paymentReference,
  membershipEnd,
  onBack,
  onConfirmed,
}: FastRenewalScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{
    new_start: string;
    new_end: string;
  } | null>(null);

  const handleConfirm = useCallback(async () => {
    Alert.alert(
      'Confirm Renewal',
      `Verify payment of ${formatCurrency(amount)} from ${memberName} and extend their membership?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'default',
          onPress: async () => {
            setConfirming(true);
            const res = await apiRequest<{
              renewal: { new_start: string; new_end: string };
            }>(`/api/mobile/v1/payments/${paymentId}/verify`, {
              method: 'POST',
            });

            setConfirming(false);

            if (res.ok) {
              setConfirmed(true);
              setResult(res.data.renewal ?? null);
            } else if (res.error.code === 'CONFLICT' || res.error.status === 409) {
              // Idempotent completion: payment was already verified/confirmed
              setConfirmed(true);
            } else {
              Alert.alert('Error', res.error.message || 'Failed to verify payment.');
            }
          },
        },
      ],
    );
  }, [paymentId, amount, memberName]);

  if (confirmed) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Icon name="check" size={48} color={colors.textInverse} />
          </View>
          <Text style={styles.successTitle}>Renewal Confirmed!</Text>
          <Text style={styles.successSubtitle}>{memberName}&apos;s membership has been renewed.</Text>

          {result && (
            <View style={styles.resultCard}>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>New Start</Text>
                <Text style={styles.resultValue}>{formatDate(result.new_start)}</Text>
              </View>
              <View style={styles.resultDivider} />
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>New End</Text>
                <Text style={styles.resultValue}>{formatDate(result.new_end)}</Text>
              </View>
              <View style={styles.resultDivider} />
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Amount</Text>
                <Text style={[styles.resultValue, { color: colors.success }]}>
                  {formatCurrency(amount)}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.revenueBanner}>
            <Icon name="revenue" size={20} color={colors.success} />
            <Text style={styles.revenueBannerText}>
              {formatCurrency(amount)} recovered for your gym
            </Text>
          </View>

          <TouchableOpacity style={styles.doneButton} onPress={onConfirmed} activeOpacity={0.7}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Renewal</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        {/* Payment Summary Card */}
        <View style={styles.paymentCard}>
          <View style={styles.paymentCardHeader}>
            <Avatar name={memberName} size={56} />
            <View style={styles.paymentCardInfo}>
              <Text style={styles.memberName}>{memberName}</Text>
              <StatusBadge status="pending" label="Payment Pending" size="sm" />
            </View>
          </View>

          <View style={styles.paymentDetails}>
            <DetailRow label="Amount" value={formatCurrency(amount)} highlight />
            {planName && <DetailRow label="Plan" value={planName} />}
            {paymentMethod && <DetailRow label="Method" value={paymentMethod} />}
            {paymentReference && <DetailRow label="Reference" value={paymentReference} />}
            {membershipEnd && <DetailRow label="Current Expiry" value={formatDate(membershipEnd)} />}
          </View>
        </View>

        {/* What happens when you confirm */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>What happens when you confirm:</Text>
          <View style={styles.infoRow}>
            <Icon name="check" size={16} color={colors.success} />
            <Text style={styles.infoText}>Payment is marked as verified</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="check" size={16} color={colors.success} />
            <Text style={styles.infoText}>Membership is automatically extended</Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="check" size={16} color={colors.success} />
            <Text style={styles.infoText}>Revenue Recovered metric is updated</Text>
          </View>
        </View>

        {/* Confirm Button */}
        <TouchableOpacity
          style={[styles.confirmButton, confirming && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          activeOpacity={0.7}
          disabled={confirming}
        >
          {confirming ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <>
              <Icon name="check" size={22} color={colors.textInverse} />
              <Text style={styles.confirmButtonText}>CONFIRM RENEWAL</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && styles.detailValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  paymentCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
  },
  paymentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  paymentCardInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  memberName: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  paymentDetails: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  detailValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  detailValueHighlight: {
    fontSize: fontSize['2xl'],
    color: colors.success,
    fontWeight: fontWeight.extrabold,
  },
  infoCard: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  infoTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  confirmButton: {
    flexDirection: 'row',
    backgroundColor: colors.success,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.md,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.extrabold,
    letterSpacing: 1,
  },
  // Success state
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
    gap: spacing.lg,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  successSubtitle: {
    fontSize: fontSize.lg,
    color: colors.muted,
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  resultValue: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  resultDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  revenueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    width: '100%',
  },
  revenueBannerText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.success,
  },
  doneButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxxxl,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  doneButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
});
